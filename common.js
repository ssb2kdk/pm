// =====================================================================
// 순수본 2공장 시설팀 웹페이지 — 공통 기능 (로그인, 상단 메뉴, 비밀번호 변경)
// 모든 앱 페이지가 이 파일을 같이 씁니다. 보통은 고칠 일이 없습니다.
// =====================================================================
(function () {
  const CFG = window.APP_CONFIG || {};
  const ROOT = new URL('.', document.currentScript.src).href; // 사이트 맨 위 주소
  const configured = !!(CFG.SUPABASE_KEY && !String(CFG.SUPABASE_KEY).startsWith('여기에'));

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- 공통 스타일 ----------------
  const css = `
    * { box-sizing: border-box; }
    body { font-family: 'Malgun Gothic', 'Segoe UI', sans-serif; margin: 0; background: #f4f6f8; color: #222; font-size: 14px; }
    [hidden] { display: none !important; }
    .btn { background: #2c5aa0; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; text-decoration: none; display: inline-block; }
    .btn.secondary { background: #666; } .btn.danger { background: #d93025; } .btn.small { padding: 5px 10px; font-size: 12px; }
    .btn:hover { opacity: 0.9; } .btn:disabled { opacity: 0.5; cursor: default; }
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 100; }
    .modal-overlay.active { display: flex; }
    .modal { background: #fff; border-radius: 10px; padding: 20px; width: 92%; max-width: 440px; max-height: 90vh; overflow-y: auto; }
    .modal h2 { margin-top: 0; font-size: 16px; }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 12px; color: #555; margin-bottom: 4px; }
    .field input, .field select, .field textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .empty-state { text-align: center; color: #888; padding: 40px 0; }
    .loading { text-align: center; padding: 30px; color: #888; }

    .pt-bar { background: #1d3f73; color: #fff; padding: 8px 20px; display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; font-size: 13px; }
    .pt-home { color: #fff; text-decoration: none; font-weight: bold; white-space: nowrap; }
    .pt-apps { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
    .pt-apps a { color: rgba(255,255,255,0.75); text-decoration: none; padding: 4px 10px; border-radius: 5px; white-space: nowrap; }
    .pt-apps a:hover { background: rgba(255,255,255,0.1); color: #fff; }
    .pt-apps a.current { background: rgba(255,255,255,0.18); color: #fff; font-weight: bold; }
    .pt-user { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
    .pt-user button { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.35); padding: 4px 9px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .pt-user button:hover { background: rgba(255,255,255,0.1); }

    #pt-login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pt-login-box { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.12); padding: 28px 24px; width: 100%; max-width: 360px; }
    .pt-login-box h1 { font-size: 17px; margin: 0 0 4px; color: #2c5aa0; }
    .pt-login-box .sub { font-size: 12px; color: #888; margin-bottom: 20px; }
    .pt-login-box .btn { width: 100%; padding: 10px; font-size: 14px; margin-top: 6px; }
    .pt-login-error { color: #d93025; font-size: 13px; min-height: 18px; margin-top: 10px; }
    @media print { .pt-bar, #pt-login { display: none !important; } }
  `;

  const Portal = {
    config: CFG,
    root: ROOT,
    esc,
    sb: null,
    me: null,
    isAdmin: () => !!(Portal.me && Portal.me.role === 'admin'),
    appUrl: app => ROOT + app.path,
    start,
    callAdmin
  };
  window.Portal = Portal;

  let opts = {};

  function start(o) {
    opts = o || {};
    const style = document.createElement('style');
    style.textContent = css;
    document.head.prepend(style);

    // 상단 바 + 로그인 화면 + 비밀번호 변경 창을 페이지 맨 앞에 붙임
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="pt-bar" id="pt-bar" hidden></div>
      <div id="pt-login" hidden>
        <form class="pt-login-box" id="pt-login-form" autocomplete="on">
          <h1>🏭 ${esc(CFG.PLANT_NAME)} ${esc(CFG.TEAM_NAME)}</h1>
          <div class="sub">${esc(opts.title || '')}</div>
          <div class="field"><label>아이디</label><input type="text" id="pt-login-id" autocomplete="username" autocapitalize="off" required></div>
          <div class="field"><label>비밀번호</label><input type="password" id="pt-login-pw" autocomplete="current-password" required></div>
          <button class="btn" type="submit" id="pt-login-btn">로그인</button>
          <div class="pt-login-error" id="pt-login-error"></div>
        </form>
      </div>
      <div class="modal-overlay" id="pt-pw-modal">
        <div class="modal">
          <h2>비밀번호 변경</h2>
          <div class="field"><label>새 비밀번호 (6자 이상)</label><input type="password" id="pt-pw-new" autocomplete="new-password"></div>
          <div class="field"><label>새 비밀번호 확인</label><input type="password" id="pt-pw-new2" autocomplete="new-password"></div>
          <div class="modal-actions">
            <button class="btn secondary" type="button" id="pt-pw-cancel">취소</button>
            <button class="btn" type="button" id="pt-pw-save">변경</button>
          </div>
        </div>
      </div>`);
    if (opts.title) document.title = opts.title + ' - ' + CFG.PLANT_NAME;

    document.getElementById('pt-login-form').addEventListener('submit', onLogin);
    document.getElementById('pt-pw-cancel').addEventListener('click', () => document.getElementById('pt-pw-modal').classList.remove('active'));
    document.getElementById('pt-pw-save').addEventListener('click', changeMyPassword);

    if (!configured) {
      showLogin('설정이 필요합니다: config.js 파일의 SUPABASE_KEY 칸에 Publishable key를 넣어주세요.');
      document.getElementById('pt-login-btn').disabled = true;
      return;
    }
    Portal.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
    Portal.sb.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' && Portal.me) location.reload();
    });
    Portal.sb.auth.getSession().then(({ data: { session } }) => session ? enter() : showLogin());
  }

  function appEl() { return document.getElementById(opts.appElementId || 'app'); }

  function showLogin(message) {
    Portal.me = null;
    const a = appEl(); if (a) a.hidden = true;
    document.getElementById('pt-bar').hidden = true;
    document.getElementById('pt-login').hidden = false;
    document.getElementById('pt-login-error').textContent = message || '';
    document.getElementById('pt-login-btn').disabled = false;
  }

  async function onLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('pt-login-btn');
    const errEl = document.getElementById('pt-login-error');
    const id = document.getElementById('pt-login-id').value.trim().toLowerCase();
    const pw = document.getElementById('pt-login-pw').value;
    if (!id || !pw) return;
    btn.disabled = true; errEl.textContent = '';
    const { error } = await Portal.sb.auth.signInWithPassword({ email: id + '@' + CFG.EMAIL_DOMAIN, password: pw });
    if (error) {
      btn.disabled = false;
      errEl.textContent = /invalid/i.test(error.message) ? '아이디 또는 비밀번호가 틀렸습니다.' : '로그인 실패: ' + error.message;
      return;
    }
    document.getElementById('pt-login-pw').value = '';
    await enter();
  }

  let readyCalled = false;
  async function enter() {
    const sb = Portal.sb;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return showLogin();
    const { data: prof, error } = await sb.from('profiles').select('id, username, name, role, active').eq('id', user.id).maybeSingle();
    if (error || !prof) { await sb.auth.signOut(); return showLogin('계정 정보를 불러오지 못했습니다. 관리자에게 문의하세요.'); }
    if (!prof.active) { await sb.auth.signOut(); return showLogin('사용 중지된 계정입니다. 관리자에게 문의하세요.'); }
    Portal.me = prof;

    renderBar();
    document.getElementById('pt-login').hidden = true;
    document.getElementById('pt-bar').hidden = false;
    const a = appEl(); if (a) a.hidden = false;
    if (!readyCalled && opts.onReady) { readyCalled = true; opts.onReady(Portal); }
  }

  function renderBar() {
    const me = Portal.me;
    const apps = (CFG.APPS || []).filter(a => a.ready);
    document.getElementById('pt-bar').innerHTML = `
      <a class="pt-home" href="${ROOT}">🏭 ${esc(CFG.PLANT_NAME)} ${esc(CFG.TEAM_NAME)}</a>
      <nav class="pt-apps">
        <a href="${ROOT}" class="${opts.appId === 'home' ? 'current' : ''}">🏠 홈</a>
        ${apps.map(a => `<a href="${Portal.appUrl(a)}" class="${a.id === opts.appId ? 'current' : ''}">${a.icon} ${esc(a.name)}</a>`).join('')}
      </nav>
      <div class="pt-user">
        <span id="pt-user-label">${esc(me.name)}${me.role === 'admin' ? ' (관리자)' : ''}</span>
        <button type="button" id="pt-pw-btn">비밀번호 변경</button>
        <button type="button" id="pt-logout-btn">로그아웃</button>
      </div>`;
    document.getElementById('pt-pw-btn').addEventListener('click', () => document.getElementById('pt-pw-modal').classList.add('active'));
    document.getElementById('pt-logout-btn').addEventListener('click', async () => {
      if (!confirm('로그아웃 하시겠습니까?')) return;
      await Portal.sb.auth.signOut();
      location.reload();
    });
  }
  Portal.renderBar = renderBar;

  async function changeMyPassword() {
    const a = document.getElementById('pt-pw-new').value, b = document.getElementById('pt-pw-new2').value;
    if (a.length < 6) return alert('비밀번호는 6자 이상이어야 합니다.');
    if (a !== b) return alert('두 비밀번호가 서로 다릅니다.');
    const { error } = await Portal.sb.auth.updateUser({ password: a });
    if (error) return alert('변경 실패: ' + error.message);
    document.getElementById('pt-pw-new').value = ''; document.getElementById('pt-pw-new2').value = '';
    document.getElementById('pt-pw-modal').classList.remove('active');
    alert('비밀번호가 변경되었습니다.');
  }

  // 관리자 전용 서버 기능(admin-users) 호출: 계정 만들기 / 비밀번호 초기화 / 삭제
  async function callAdmin(body) {
    const { data, error } = await Portal.sb.functions.invoke('admin-users', { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) { }
      if (/Failed to send|fetch/i.test(msg)) msg = '사용자 관리 기능(admin-users)에 연결할 수 없습니다. Supabase Edge Functions 설정을 확인해 주세요.';
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
})();
