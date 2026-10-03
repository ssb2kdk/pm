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
    /* 숫자 칸의 위아래 화살표 없애기 (잘못 눌러 값이 바뀌지 않게) */
    input[type=number]::-webkit-outer-spin-button, input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type=number] { -moz-appearance: textfield; appearance: textfield; }
  `;

  // 숫자 칸: 마우스 휠·키보드 ↑↓로 값이 바뀌지 않게
  document.addEventListener('wheel', e => { const t = e.target; if (t && t.type === 'number' && document.activeElement === t) t.blur(); }, { passive: true });
  document.addEventListener('keydown', e => { const t = e.target; if (t && t.type === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) e.preventDefault(); }, true);

  const Portal = {
    config: CFG,
    root: ROOT,
    esc,
    sb: null,
    me: null,
    isAdmin: () => !!(Portal.me && Portal.me.role === 'admin'),
    isPartner: () => !!(Portal.me && Portal.me.role === 'partner'),
    visibleApps: () => (CFG.APPS || []).filter(a => !(Portal.me && Portal.me.role === 'partner') || a.partner),
    appUrl: app => ROOT + app.path,
    start,
    callAdmin,
    enableAI
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
    // 협력업체 계정은 허용된 앱만
    if (prof.role === 'partner' && opts.appId !== 'home' && !Portal.visibleApps().some(a => a.id === opts.appId)) {
      const first = Portal.visibleApps().find(a => a.ready);
      location.replace(first ? Portal.appUrl(first) : ROOT); return;
    }

    renderBar();
    document.getElementById('pt-login').hidden = true;
    document.getElementById('pt-bar').hidden = false;
    const a = appEl(); if (a) a.hidden = false;
    if (!readyCalled && opts.onReady) { readyCalled = true; opts.onReady(Portal); }
    document.dispatchEvent(new Event('portal-ready'));
  }

  function renderBar() {
    const me = Portal.me;
    const apps = Portal.visibleApps().filter(a => a.ready);
    document.getElementById('pt-bar').innerHTML = `
      <a class="pt-home" href="${ROOT}">🏭 ${esc(CFG.PLANT_NAME)} ${esc(CFG.TEAM_NAME)}</a>
      <nav class="pt-apps">
        <a href="${ROOT}" class="${opts.appId === 'home' ? 'current' : ''}">🏠 홈</a>
        ${apps.map(a => `<a href="${Portal.appUrl(a)}" class="${a.id === opts.appId ? 'current' : ''}">${a.icon} ${esc(a.name)}</a>`).join('')}
      </nav>
      <div class="pt-user">
        <span id="pt-user-label">${esc(me.name)}${me.role === 'admin' ? ' (관리자)' : me.role === 'partner' ? ' (협력업체)' : ''}</span>
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
  // ---------------- AI에게 묻기 (관리자 전용) ----------------
  // 페이지에서 Portal.enableAI({ page: '유틸리티', context: () => '데이터 요약 글', suggestions: [...] }) 로 켬
  function mdLite(t) { // 간단한 마크다운 → HTML (굵게, 목록, 표, 줄바꿈)
    const lines = esc(t).split('\n'); let out = '', inTable = false, inList = false;
    const inline = x => x.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const ln of lines) {
      if (/^\s*\|.*\|\s*$/.test(ln)) {
        if (/^\s*\|[\s:\-|]+\|\s*$/.test(ln)) continue;
        const cells = ln.trim().slice(1, -1).split('|').map(c => inline(c.trim()));
        if (!inTable) { out += '<table class="ai-t"><tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr>'; inTable = true; }
        else out += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
        continue;
      }
      if (inTable) { out += '</table>'; inTable = false; }
      const li = ln.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(li[1])}</li>`; continue; }
      if (inList) { out += '</ul>'; inList = false; }
      const h = ln.match(/^#{1,4}\s+(.*)$/);
      out += h ? `<div class="ai-h">${inline(h[1])}</div>` : (ln.trim() ? `<div>${inline(ln)}</div>` : '<div class="ai-gap"></div>');
    }
    if (inTable) out += '</table>'; if (inList) out += '</ul>';
    return out;
  }
  function enableAI(o) {
    const go = () => {
      if (!Portal.me || Portal.me.role !== 'admin') return;
      if (document.getElementById('ai-fab')) return;
      const st = document.createElement('style');
      st.textContent = `
        #ai-fab { position: fixed; right: 18px; bottom: 18px; z-index: 90; background: #5b3fa8; color: #fff; border: none; border-radius: 26px; padding: 12px 18px; font-size: 14px; font-weight: bold; box-shadow: 0 4px 14px rgba(0,0,0,.25); cursor: pointer; }
        #ai-panel { position: fixed; right: 18px; bottom: 76px; z-index: 91; width: min(440px, calc(100vw - 24px)); height: min(620px, calc(100vh - 110px)); background: #fff; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.3); display: flex; flex-direction: column; overflow: hidden; font-size: 13px; }
        #ai-panel .hd { background: #5b3fa8; color: #fff; padding: 10px 14px; display: flex; align-items: center; gap: 8px; }
        #ai-panel .hd b { flex: 1; } #ai-panel .hd button { background: transparent; border: 1px solid rgba(255,255,255,.5); color: #fff; border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 12px; }
        #ai-msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: #f7f6fb; }
        .ai-m { max-width: 92%; padding: 9px 12px; border-radius: 10px; line-height: 1.6; word-break: break-word; }
        .ai-m.u { align-self: flex-end; background: #5b3fa8; color: #fff; white-space: pre-wrap; }
        .ai-m.a { align-self: flex-start; background: #fff; border: 1px solid #e4e0f0; }
        .ai-m.e { align-self: flex-start; background: #fdeceb; color: #a32d2d; }
        .ai-m ul { margin: 4px 0; padding-left: 18px; } .ai-m .ai-h { font-weight: bold; margin-top: 4px; color: #3d2a78; } .ai-m .ai-gap { height: 6px; }
        .ai-t { border-collapse: collapse; margin: 6px 0; font-size: 12px; } .ai-t th, .ai-t td { border: 1px solid #ddd; padding: 3px 6px; text-align: right; } .ai-t th { background: #f0edf8; text-align: center; }
        .ai-sug { display: flex; flex-wrap: wrap; gap: 6px; } .ai-sug button { border: 1px solid #cfc6ea; background: #fff; color: #5b3fa8; border-radius: 14px; padding: 5px 10px; font-size: 12px; cursor: pointer; text-align: left; }
        #ai-form { display: flex; gap: 6px; padding: 10px; border-top: 1px solid #eee; }
        #ai-q { flex: 1; resize: none; height: 44px; border: 1px solid #ccc; border-radius: 8px; padding: 8px; font: inherit; }
        #ai-send { background: #5b3fa8; color: #fff; border: none; border-radius: 8px; padding: 0 14px; cursor: pointer; font-weight: bold; }
        #ai-send:disabled { opacity: .5; }
        @media print { #ai-fab, #ai-panel { display: none !important; } }`;
      document.head.appendChild(st);
      document.body.insertAdjacentHTML('beforeend', `<button id="ai-fab">🤖 AI에게 묻기</button>
        <div id="ai-panel" hidden><div class="hd"><b>🤖 AI에게 묻기 · ${esc(o.page || '')}</b><button id="ai-new">새 대화</button><button id="ai-close">✕</button></div>
        <div id="ai-msgs"></div>
        <form id="ai-form"><textarea id="ai-q" placeholder="예) 9월 가스가 왜 늘었어?  (Enter 보내기, Shift+Enter 줄바꿈)"></textarea><button id="ai-send">보내기</button></form></div>`);
      const panel = document.getElementById('ai-panel'), msgs = document.getElementById('ai-msgs'), q = document.getElementById('ai-q'), send = document.getElementById('ai-send');
      let history = [];
      const intro = () => {
        msgs.innerHTML = `<div class="ai-m a">지금 화면의 데이터(월별 사용량·비용·원단위, 목표, 최근 일별 검침·기온, 이상 사용)를 보고 답합니다. 데이터에 없는 내용은 답하지 못해요.</div>
          <div class="ai-sug">${(o.suggestions || []).map(x => `<button type="button">${esc(x)}</button>`).join('')}</div>`;
        msgs.querySelectorAll('.ai-sug button').forEach(b => b.onclick = () => { q.value = b.textContent; ask(); });
      };
      const add = (cls, html) => { const d = document.createElement('div'); d.className = 'ai-m ' + cls; d.innerHTML = html; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; };
      async function ask() {
        const question = q.value.trim(); if (!question || send.disabled) return;
        q.value = ''; send.disabled = true;
        add('u', esc(question));
        const wait = add('a', '생각하는 중… (10~30초)');
        try {
          let ctx = ''; try { ctx = await o.context(); } catch (e) { ctx = '(데이터 요약 실패: ' + e.message + ')'; }
          const { data, error } = await Portal.sb.functions.invoke('ask-ai', { body: { question, context: ctx, page: o.page || '', history } });
          let msg = null;
          if (error) { msg = error.message; try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) { } if (/Failed to send|fetch/i.test(msg)) msg = 'AI 기능(ask-ai)에 연결할 수 없습니다. Supabase Edge Functions 설정을 확인해 주세요.'; }
          else if (data && data.error) msg = data.error;
          if (msg) { wait.className = 'ai-m e'; wait.textContent = '⚠ ' + msg; return; }
          wait.innerHTML = mdLite(data.answer || '(빈 답변)') + (data.left !== undefined ? `<div style="font-size:11px;color:#999;margin-top:6px">오늘 남은 질문 ${data.left}회</div>` : '');
          history.push({ role: 'user', content: question }, { role: 'assistant', content: data.answer || '' });
        } catch (e) { wait.className = 'ai-m e'; wait.textContent = '⚠ ' + e.message; }
        finally { send.disabled = false; q.focus(); }
      }
      document.getElementById('ai-fab').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) { if (!msgs.children.length) intro(); q.focus(); } };
      document.getElementById('ai-close').onclick = () => panel.hidden = true;
      document.getElementById('ai-new').onclick = () => { history = []; intro(); };
      document.getElementById('ai-form').onsubmit = e => { e.preventDefault(); ask(); };
      q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); } });
    };
    if (Portal.me) go(); else document.addEventListener('portal-ready', go, { once: true });
  }

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
