// =====================================================================
// 순수본 2공장 시설관리시스템 — 공통 기능 (로그인, 상단 메뉴, 비밀번호 변경)
// 모든 앱 페이지가 이 파일을 같이 씁니다. 보통은 고칠 일이 없습니다.
// =====================================================================
(function () {
  const CFG = window.APP_CONFIG || {};
  const ROOT = new URL('.', document.currentScript.src).href; // 사이트 맨 위 주소
  const configured = !!(CFG.SUPABASE_KEY && !String(CFG.SUPABASE_KEY).startsWith('여기에'));

  const SYS_NAME = CFG.SYSTEM_NAME || `${CFG.PLANT_NAME || ''} ${CFG.TEAM_NAME || ''}`.trim();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- 공통 스타일 ----------------
  const css = `
    .pt-tip { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 50%; background: #fff3c4; color: #8a6100; border: 1px solid #e6c65c; font-size: 11px; font-weight: 700; cursor: pointer; margin: 0 3px; vertical-align: 1px; line-height: 1; user-select: none; }
    .pt-tip:hover, .pt-tip:focus-visible { background: #ffe58a; outline: none; }
    #pt-tipbox { position: fixed; z-index: 3000; background: #fffbe6; border: 1px solid #e6c65c; border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.18); font-size: 13px; line-height: 1.65; color: #333; max-height: 70vh; overflow: auto; }
    #pt-tipbox .h { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px 4px 12px; border-bottom: 1px dashed #ecd88f; position: sticky; top: 0; background: #fffbe6; }
    #pt-tipbox .h button { border: none; background: none; font-size: 18px; cursor: pointer; color: #8a6100; line-height: 1; }
    #pt-tipbox .b, .pt-tipd .b { padding: 8px 12px 10px; font-weight: normal; text-align: left; white-space: normal; }
    #pt-tipbox .f, .pt-tipd .f { font-family: Consolas, monospace; background: #fff; border: 1px solid #f0e2a8; border-radius: 4px; padding: 5px 8px; margin: 6px 0; }
    #pt-tipbox .ex, .pt-tipd .ex { color: #6b5a1e; background: #fff7d1; border-radius: 4px; padding: 4px 8px; margin: 6px 0; }
    #pt-tipbox code, .pt-tipd code { background: #fff; padding: 0 3px; border-radius: 3px; }
    .pt-tipd { border-bottom: 1px solid #eee; padding: 6px 0; } .pt-tipd summary { cursor: pointer; } .pt-tipd .b { background: #fffbe6; border-radius: 6px; margin-top: 6px; font-size: 13px; line-height: 1.65; }

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

  // ---------------- 휴일 빈칸 채우기 (검침) ----------------
  // 쉬는 날(주말·공휴일)에 못 읽은 지침은, 다시 읽은 날의 값을 그 사이 빈 날에 그대로 넣는다 (엑셀에서 복사해 붙이던 방식)
  //  → 쉬는 동안 쓴 양은 쉬기 전 마지막 날 사용량으로 잡힘. 빈칸만 채우고 이미 있는 값은 안 건드림.
  const FILL_METERS = ['가스식당', '상수도40A', '상수도50A', '폐수방류량']; // 가스보일러는 휴일 지침을 따로 확인해 넣으므로 제외
  const FILL_MAX_GAP = 6; // 이보다 긴 공백은 채우지 않음 (검침을 오래 빠뜨린 경우)
  const addDaysStr = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // from~to 사이 빈 날을 채움. 반환: [{d, id, v}]
  async function fillMeterGaps(from, to, ids = FILL_METERS) {
    const sb = Portal.sb, start = addDaysStr(from, -(FILL_MAX_GAP + 1));
    const { data, error } = await sb.from('meter_daily').select('d, v').gte('d', start).lte('d', to).order('d');
    if (error) throw error;
    const map = {}; (data || []).forEach(r => { map[r.d] = r.v || {}; });
    const has = (ds, id) => map[ds] && map[ds][id] !== undefined && map[ds][id] !== null && map[ds][id] !== '';
    const patches = {}, out = [];
    ids.forEach(id => {
      let last = null;
      for (let ds = start; ds <= to; ds = addDaysStr(ds, 1)) {
        if (!has(ds, id)) continue;
        const v = Number(map[ds][id]);
        if (last) {
          const gap = []; for (let x = addDaysStr(last, 1); x < ds; x = addDaysStr(x, 1)) gap.push(x);
          if (gap.length && gap.length <= FILL_MAX_GAP && v >= Number(map[last][id]))
            gap.forEach(x => { if (x >= from) { (patches[x] = patches[x] || {})[id] = v; out.push({ d: x, id, v }); } });
        }
        last = ds;
      }
    });
    for (const [ds, patch] of Object.entries(patches)) {
      const { error: e2 } = await sb.rpc('meter_save', { p_d: ds, p_weather: null, p_tmin: null, p_tmax: null, p_patch: patch });
      if (e2) throw e2;
    }
    return out;
  }

  // ---------------- 쉬는 날 (주말 + 공휴일) ----------------
  // 공휴일·대체공휴일 (해마다 config.js 의 HOLIDAYS 로 더하거나 여기 목록을 고치면 됨)
  const HOLIDAYS = new Set([
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-03', '2026-06-06',
    '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
    '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-05', '2027-05-13', '2027-06-06', '2027-08-15', '2027-08-16',
    '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25', '2027-12-27',
    ...(CFG.HOLIDAYS || [])
  ]);
  const isOffDay = ds => { const w = new Date(ds + 'T00:00:00').getDay(); return w === 0 || w === 6 || HOLIDAYS.has(ds); };

  const Portal = {
    config: CFG,
    root: ROOT,
    esc,
    sb: null,
    me: null,
    isAdmin: () => !!(Portal.me && Portal.me.role === 'admin'),
    isPartner: () => !!(Portal.me && Portal.me.role === 'partner'),
    isViewer: () => !!(Portal.me && Portal.me.role === 'viewer'),
    visibleApps: () => (CFG.APPS || []).filter(a => (!(Portal.me && Portal.me.role === 'partner') || a.partner) && (!a.admin || (Portal.me && Portal.me.role === 'admin'))), // admin: true 인 앱은 관리자만
    appUrl: app => ROOT + app.path,
    start,
    callAdmin,
    FILL_METERS,
    fillMeterGaps,
    isOffDay,
    addDaysStr
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
          <h1>🏭 ${esc(SYS_NAME)}</h1>
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
    document.title = opts.title ? opts.title + ' - ' + SYS_NAME : SYS_NAME;

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
    if (prof.role === 'viewer') viewerGuard(sb); // 보기 전용: 저장·수정·삭제 요청은 보내지 않고 바로 오류 (DB에서도 24번 SQL로 막힘)
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
  }

  const VIEWER_MSG = '보기 전용 계정은 저장·수정·삭제를 할 수 없습니다.';
  function viewerGuard(sb) {
    if (sb.__viewer) return; sb.__viewer = true;
    const deny = () => { const p = Promise.resolve({ data: null, error: { message: VIEWER_MSG } });
      const q = new Proxy(function () {}, { get(_, k) { if (k === 'then' || k === 'catch' || k === 'finally') return p[k].bind(p); return () => q; }, apply() { return q; } }); return q; };
    const wrap = (obj, bad) => new Proxy(obj, { get(o, k) { if (bad.includes(k)) return deny; const v = o[k]; return typeof v === 'function' ? v.bind(o) : v; } });
    const from = sb.from.bind(sb); sb.from = t => wrap(from(t), ['insert', 'update', 'upsert', 'delete']);
    sb.rpc = () => deny();
    if (sb.storage && sb.storage.from) { const sf = sb.storage.from.bind(sb.storage); sb.storage.from = b => wrap(sf(b), ['upload', 'remove', 'update', 'move', 'copy']); }
  }
  function renderBar() {
    const me = Portal.me;
    const apps = Portal.visibleApps().filter(a => a.ready);
    document.getElementById('pt-bar').innerHTML = `
      <a class="pt-home" href="${ROOT}">🏭 ${esc(SYS_NAME)}</a>
      <nav class="pt-apps">
        <a href="${ROOT}" class="${opts.appId === 'home' ? 'current' : ''}">🏠 홈</a>
        ${apps.map(a => `<a href="${Portal.appUrl(a)}" class="${a.id === opts.appId ? 'current' : ''}">${a.icon} ${esc(a.name)}</a>`).join('')}
      </nav>
      <div class="pt-user">
        <span id="pt-user-label">${esc(me.name)}${me.role === 'admin' ? ' (관리자)' : me.role === 'partner' ? ' (협력업체)' : me.role === 'viewer' ? ' (보기 전용)' : ''}</span>
        <button type="button" id="pt-pw-btn">비밀번호 변경</button>
        <button type="button" id="pt-logout-btn">로그아웃</button>
      </div>`;
    if (me.role === 'viewer' && !document.getElementById('pt-viewer')) document.getElementById('pt-bar').insertAdjacentHTML('afterend', '<div id="pt-viewer" style="background:#fff4d6;color:#7a5200;text-align:center;font-size:13px;padding:5px 8px;border-bottom:1px solid #f0d58a">👁 보기 전용 계정입니다 — 화면에서 값을 바꿔도 저장되지 않습니다.</div>');
    document.getElementById('pt-pw-btn').addEventListener('click', () => document.getElementById('pt-pw-modal').classList.add('active'));
    document.getElementById('pt-logout-btn').addEventListener('click', async () => {
      if (!confirm('로그아웃 하시겠습니까?')) return;
      await Portal.sb.auth.signOut();
      location.reload();
    });
  }
  Portal.renderBar = renderBar;

  // =====================================================================
  // ⓘ 메모 (엑셀 메모처럼): 용어·계산식 설명 — 누르면 열리고, 다시 누르거나 바깥을 누르면 닫힘
  //  화면에서는 Portal.tip('키') 로 ⓘ 를 붙임 · 전체 목록은 Portal.tipIndex()
  // =====================================================================
  const TIPS = {
    r: { t: '상관계수 r (피어슨)', b: `두 값이 얼마나 <b>같이 움직이는지</b>를 −1 ~ 1로 나타낸 숫자. 엑셀 <code>=CORREL(사용량, 인자)</code>와 같은 값.
      <div class="f">r = Σ(x − x̄)(y − ȳ) ÷ √[ Σ(x − x̄)² × Σ(y − ȳ)² ]</div>
      · x = 그 달 인자(예: 원육 투입량), y = 그 달 사용량(예: 생산동 kWh), x̄·ȳ = 기간 평균<br>
      · 분자: 둘 다 평균보다 많거나 둘 다 적은 달은 +, 한쪽만 많은 달은 − 로 쌓임 · 분모: 각자 흔들린 크기로 나눠 단위를 없앰
      <div class="ex">예) 원육 30·40·50톤, 생산동 7·8·9만kWh → 평균 40, 8 → 곱의 합 20 ÷ √(200×2)=20 → <b>r = 1.00</b></div>
      · <b>1에 가까움</b> 같이 늘고 줄어듦 · <b>0 근처</b> 관계 없음 · <b>마이너스</b> 반대로 움직임 (예: 쉬는 날이 많은 달은 사용량이 적음 → 쉬는 날 수와 r이 −)<br>
      · 0.7 이상 강함 · 0.4~0.7 보통 · 0.2~0.4 약함 · r²(= r×r)은 사용량 차이 중 그 인자로 설명되는 비율 (r 0.8 → 64%)<br>
      · 구성별 비교: 고른 기간의 <b>마감된 달</b>만, 둘 다 값이 있는 달만, 4개월 미만이면 「-」 · 하루당 보기를 켜면 둘 다 날수로 나눈 뒤 계산<br>
      · 주의: 달이 적으면(6~9개월) 한두 달에 크게 흔들림 · 원육·포장·생산일처럼 인자끼리도 같이 움직여서 r이 높아도 진짜 원인이라는 보장은 없음` },
    unit: { t: '원단위 · 일평균', b: `<b>원단위</b> = 사용량 ÷ 생산 지표. 예: 전기 원단위 = 전기 kWh ÷ 원육 투입 kg (kWh/kg). 생산이 많고 적음을 빼고 효율만 비교하려는 값.<br>
      · 구성별 비교의 원단위 선 = 막대(고른 구성 사용량) ÷ 고른 인자, 한 달 전체 값끼리 나눔 (포장 EA는 1,000EA당) · 평균기온은 0·음수가 있어 나누지 않음<br>
      <b>일평균</b> = 월 사용량 ÷ 그 달 날수 (2월처럼 날수가 다른 달끼리 공정하게 비교) · 용수는 고지서 검침 기간이 전월 12일~당월 11일이라 전월 날수로 나눔 · 진행 중인 달은 뺌` },
    persrc: { t: '사용량 출처 · 같은 요일 비교', b: `· <b>월별</b>: 고지서 값. 고지서를 아직 안 넣은 달은 설비검침 일일값 합(「일일합산」 표시)<br>
      · <b>일별·주별</b>: 전기는 파워플래너 일별값, 나머지는 아침 8시 검침 차이(그날 08시 → 다음날 08시)<br>
      · <b>전년 동일·전주 비교</b>: 날짜가 아니라 <b>같은 요일</b>끼리 맞춤 — 전년은 364일 전(52주 전), 4주 전은 28일 전. 평일·주말 사용량이 크게 달라서 요일을 맞춰야 공정함<br>
      · 「생산 없음」: 생산 대시보드 일별 실적에 원육 투입이 없는 날 (자료가 있는 기간 안에서만 표시)` },
    degday: { t: '난방도일 · 냉방도일 · 더운 정도', b: `기온이 사용량에 주는 영향을 한 달 숫자 하나로 만든 것 (하루 평균기온 = 설비검침 최저·최고 기온의 평균).<br>
      · <b>난방도일(HDD)</b> = Σ max(0, 18℃ − 하루 평균기온) — 18℃보다 추운 만큼의 한 달 합<br>
      · <b>냉방도일(CDD)</b> = Σ max(0, 하루 평균기온 − 24℃) — 24℃보다 더운 만큼의 합<br>
      · 18·24℃는 건물 냉난방에서 쓰는 일반 기준. 우리 공장은 냉동·냉장·자숙실 냉방처럼 훨씬 낮은 기온부터 전기를 쓰기 시작해서, <b>더운 정도</b>는 기준을 5~22℃ 중 <b>실제 사용량에 가장 잘 맞는 온도</b>로 찾아 씀 (지금 계산으로는 5℃)
      <div class="ex">예) 하루 평균 25℃ 날 → 더운 정도(5℃) 20, 냉방도일(24℃) 1</div>
      · 가스는 난방용이 없어서(스팀은 자숙탱크·레토르트만) 난방도일이 오차를 줄일 때만 씀 · 현장 온수는 전기보일러라 「추운 정도」는 전기 식에 들어감` },
    baseline: { t: '예상 사용량 기준선', b: `「<b>원육 투입량·날씨·날수가 이렇다면 원래 이만큼 쓴다</b>」를 계산한 값. 실제 사용량이 이보다 적으면 절감, 많으면 초과.<br>
      · 기준 달(보통 전년)의 실적으로 식을 한 번 만들어 그 해 내내 <b>고정</b>해서 씀 — 연도를 바꿔 봐도 기준 달이 같으면 식은 그대로<br>
      · 전기: 생산동(= 전체 − 폐수동 − 공조냉동 − 부하 변동)만 식으로 맞추고, 폐수동·공조냉동은 계량기 실측을 그대로 더함 (26년 1~2월은 계량기 분리 전이라 자동 제외)<br>
      · 가스: 보일러만 식으로, 식당 가스는 실측 그대로 더함<br>
      · <b>맞는 정도</b>(R²) 100%에 가까울수록, <b>월 평균 오차</b> 작을수록 믿을 만함 (오차 = 달마다 |식 − 실제| ÷ 실제의 평균)` },
    ols: { t: '계수 계산 (최소제곱법)', b: `식의 숫자(계수)는 <b>모든 기준 달에서 「식으로 계산한 값 − 실제」의 제곱 합이 가장 작아지는 값</b>으로 찾음. 엑셀 추세선·<code>LINEST</code>와 같은 방법.
      <div class="f">생산동 = A × 달력 날수 + C × 원육 kg (+ W × 더운 정도)</div>
      · 예) A = 1,789 → 생산과 관계없이 하루에 기본으로 쓰는 생산동 전기(조명·사무실·공기압축기·계량기 없는 설비) · C = 0.437 → 원육 1kg 더 넣을 때마다 0.437kWh 더 씀<br>
      · 계수가 마이너스로 나오는 조합은 「늘수록 덜 쓴다」는 말이 안 되는 식이라 쓰지 않음 · 인자를 더 넣어 오차가 확실히(0.3~0.5%p 넘게) 줄 때만 넣음<br>
      · 각 달에 어떻게 맞았는지는 ① 아래 「계수가 어떻게 나왔는지 보기」 표에서 확인` },
    rate: { t: '절감률 · 매달 목표', b: `<b>목표 사용량 = 그 달 예상 사용량 × (1 − 절감률)</b>.<br>
      · 식(기준선)은 고정이지만, 매달 <b>그 달 실제 원육 투입량·날씨</b>를 넣어 예상 사용량을 다시 계산하므로 달마다 목표 숫자는 달라짐 → 생산이 많은 달은 목표도 큼<br>
      · 평가: 예상보다 절감률 이상 덜 썼으면 달성 · 분기·연간은 달별 예상·실제를 더해서 비교<br>
      · ④ 연간 계획표는 원육 투입 「계획」과 평년 기온을 넣어 미리 계산한 예산용 숫자` },
    kpi: { t: 'KPI 지표 검토 용어', b: `「사용량 ÷ 무엇」을 KPI로 쓸지 고를 때 보는 세 가지.<br>
      · <b>같이 움직임 (r)</b>: 사용량과 그 지표의 상관계수 — 높을수록 좋음<br>
      · <b>원단위 흔들림</b> = 달마다 (사용량 ÷ 지표)의 표준편차 ÷ 평균 — 작을수록 매달 일정한 지표<br>
      · <b>고정분 비율</b> = 사용량을 「고정 + 지표 × 계수」 직선으로 맞췄을 때 고정 몫 ÷ 평균 사용량 — 크면 생산이 늘기만 해도 원단위가 저절로 좋아짐 (효율과 관계없이)<br>
      · <b>생산 많을수록 원단위 r</b>: 마이너스로 크면 위와 같은 이유로 원단위 KPI가 생산량에 끌려다님 → 이럴 땐 원단위보다 「예상 사용량 대비 절감률」로 목표를 잡는 게 공정` },
    pick: { t: '목표에 쓸 지표 고르기 경고', b: `고른 지표로 식을 만들어 보고 아래 경우 경고함.<br>
      · <b>계수 마이너스</b>: 그 지표가 늘수록 덜 쓴다는 식 → 목표에 쓰지 않고 자동 식으로 계산 (그 지표를 빼면 적용)<br>
      · <b>지표끼리 r 0.8 이상</b>: 둘이 거의 똑같이 움직여서 어느 쪽 몫인지 갈리지 않음 → 하나만<br>
      · <b>지표가 너무 많음</b>: 기준 달 수 ÷ 3개 넘게 넣으면 우연히 잘 맞을 수 있음<br>
      · 자동 식과 「월 평균 오차」를 나란히 보여 주니 더 잘 맞는 쪽을 고르면 됨` },
    decomp: { t: '원인 나누기 · 운전·관리 차이', b: `비교 달 대비 늘어난 양을 몫별로 나눔.<br>
      · <b>실측</b>(폐수동·공조냉동·식당 가스): 계량기 차이 그대로<br>
      · <b>원육·날수·생산일·날씨</b>: 두 달의 차이 × 예상 사용량 식의 계수 (예: 원육 +14,651kg × 0.437 = +6,396kWh)<br>
      · <b>이상 사용일</b>: 평소보다 더 쓴 날의 초과분 합의 차이<br>
      · <b>운전·관리 차이</b> = 전체 차이 − 위 몫을 다 뺀 나머지 → 생산·날씨로 설명 안 되는 진짜 절감·낭비. 크면 그 기간 특이사항·설비 운전을 확인` },
    anom: { t: '이상 사용일 기준', b: `· <b>평소</b> = 최근 4주 동안 <b>같은 종류 날</b>(생산일끼리, 쉬는 날끼리)의 중앙값. 생산일·쉬는 날은 전기 사용량으로 자동 구분 (주말 특근도 생산일로 봄)<br>
      · 그날 사용량이 평소의 <b>1.4배</b>(민감도 보통, 높음 1.3·낮음 1.5)를 넘으면 빨간 막대<br>
      · 「지침 오류」: 검침 지침이 전날보다 작아지는 등 숫자가 맞지 않는 날<br>
      · 중앙값을 쓰는 이유: 하루 튄 날이 평소 값을 끌어올리지 않게` },
    pkg: { t: '완제품 중량', b: `<b>완제품 kg = 포장 EA × 제품 1개 중량</b>.<br>
      · 1개 중량: 직접 넣은 g이 있으면 그 값, 없으면 제품명에 적힌 중량(130g, 1kg, 70g×3 → 210g)을 자동으로 읽음 · 「3입 120g」처럼 애매한 건 곱하지 않음<br>
      · 그날(그 달) 포장 EA의 90% 이상 중량을 알아야 값이 나옴 · 수율 = 완제품 ÷ 원육` },
    wqmin: { t: '폐수 고지 농도 최소값', b: `익산시는 별도로 한 달에 3번쯤 채수해서 평균을 냄. <b>BOD 100 · TOC 80 · SS 100 mg/L</b>보다 낮게 나와도 이 값으로 올려서 부과함 (「최소」 표시).` }
  };
  function tip(k, label) { return TIPS[k] ? `<span class="pt-tip" tabindex="0" role="button" data-tip="${k}" title="눌러서 설명 보기 — ${esc(TIPS[k].t)}">${label || 'ⓘ'}</span>` : ''; }
  let tipOpen = null;
  function tipClose() { const b = document.getElementById('pt-tipbox'); if (b) b.remove(); tipOpen = null; }
  function tipShow(el, k) {
    tipClose(); const T = TIPS[k]; if (!T) return;
    const b = document.createElement('div'); b.id = 'pt-tipbox'; b.setAttribute('role', 'dialog');
    b.innerHTML = `<div class="h"><b>${esc(T.t)}</b><button type="button" aria-label="닫기">×</button></div><div class="b">${T.b}</div>`;
    document.body.appendChild(b); tipOpen = k; tipAt = Date.now();
    b.querySelector('button').onclick = tipClose;
    const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, w = Math.min(460, vw - 24);
    b.style.width = w + 'px';
    let left = Math.min(Math.max(12, r.left), vw - w - 12), top = r.bottom + 6;
    if (top + b.offsetHeight > window.innerHeight - 8 && r.top - b.offsetHeight - 6 > 8) top = r.top - b.offsetHeight - 6;
    b.style.left = left + 'px'; b.style.top = Math.max(8, top) + 'px';
  }
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('.pt-tip');
    if (t) { e.preventDefault(); e.stopImmediatePropagation(); const k = t.dataset.tip; if (tipOpen === k) tipClose(); else tipShow(t, k); return; }
    if (tipOpen && !(e.target.closest && e.target.closest('#pt-tipbox'))) tipClose();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') tipClose(); const t = e.target.closest && e.target.closest('.pt-tip'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); } });
  let tipAt = 0; window.addEventListener('scroll', () => { if (tipOpen && Date.now() - tipAt > 500) tipClose(); }, { passive: true }); // 열자마자 생기는 스크롤은 무시
  // 전체 목록 (다시 찾아보기)
  function tipIndex(keys) {
    tipClose(); const ks = keys || Object.keys(TIPS);
    let m = document.getElementById('pt-tipindex'); if (m) m.remove();
    m = document.createElement('div'); m.id = 'pt-tipindex'; m.className = 'modal-overlay active';
    m.innerHTML = `<div class="modal" style="max-width:640px;max-height:85vh;overflow:auto"><h2>📖 용어·계산식 메모</h2><div class="hint" style="margin-bottom:8px">화면의 ⓘ 를 눌러도 같은 설명이 나옵니다.</div>` +
      ks.map(k => `<details class="pt-tipd"><summary><b>${esc(TIPS[k].t)}</b></summary><div class="b">${TIPS[k].b}</div></details>`).join('') +
      `<div class="modal-actions"><button class="btn" type="button" onclick="document.getElementById('pt-tipindex').remove()">닫기</button></div></div>`;
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
  }
  Portal.tip = tip; Portal.tipIndex = tipIndex; Portal.TIPS = TIPS;

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
