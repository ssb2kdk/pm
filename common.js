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
    .pt-tip, .pt-admin-only { display: none !important; } body.pt-admin .pt-admin-only { display: inline-block !important; } body.pt-admin .pt-tip { display: inline-flex !important; }
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
    document.body.classList.toggle('pt-admin', prof.role === 'admin'); // ⓘ 메모는 관리자만
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
    if (prof.role !== 'partner' && (CFG.APPS || []).some(x => x.id === 'load' && x.ready)) loadAlarm(sb);
    if (prof.role !== 'partner') navBadges(sb);
  }

  // 위 메뉴 숫자 표시: 자재 발주 요청 처리 대기 건수 (2분마다)
  let navTimer = null;
  Portal.navBadges = () => Portal.sb && navBadges(Portal.sb);
  async function navBadges(sb) {
    clearTimeout(navTimer);
    try {
      const app = (CFG.APPS || []).find(x => x.id === 'mat' && x.ready);
      if (app) {
        const { data, error } = await sb.from('mat_req').select('id,urgent').in('status', ['요청', '확인']);
        const link = [...document.querySelectorAll('#pt-bar .pt-apps a')].find(a => a.getAttribute('href') === Portal.appUrl(app));
        if (link && !error) { let b = link.querySelector('.pt-nb'); const n = (data || []).length, u = (data || []).filter(x => x.urgent).length;
          if (!n) { if (b) b.remove(); } else { if (!b) { link.insertAdjacentHTML('beforeend', '<span class="pt-nb"></span>'); b = link.querySelector('.pt-nb'); }
            b.textContent = u ? `${n}·🚨${u}` : n; b.title = `처리 대기 ${n}건${u ? ` (급함 ${u})` : ''}`;
            b.style.cssText = 'display:inline-block;margin-left:5px;min-width:18px;padding:0 6px;border-radius:9px;background:#e5534b;color:#fff;font-size:11px;font-weight:700;line-height:17px;text-align:center'; } }
      }
    } catch (e) { }
    navTimer = setTimeout(() => navBadges(sb), 120000);
  }

  // ---------------- 설비 과부하 경보: 어느 화면에서든 기준 전류 110% 넘으면 위에 빨간 띠 ----------------
  const ALARM_PCT = 1.1;
  let alarmCfg = null, alarmCfgAt = 0, alarmTimer = null;
  async function loadAlarm(sb) {
    clearTimeout(alarmTimer);
    try {
      if (!alarmCfg || Date.now() - alarmCfgAt > 600000) {
        const [p, c] = await Promise.all([sb.from('load_panels').select('id,name'), sb.from('load_channels').select('panel_id,ch,name,limit_a')]);
        if (!p.error && !c.error) { alarmCfg = { P: Object.fromEntries((p.data || []).map(x => [x.id, x.name])), C: c.data || [] }; alarmCfgAt = Date.now(); }
      }
      const { data, error } = await sb.rpc('load_latest');
      if (!error && alarmCfg) {
        const L = Object.fromEntries((data || []).map(r => [r.panel_id, r])), now = Date.now(), over = [];
        alarmCfg.C.forEach(c => { const r = L[c.panel_id], lim = Number(c.limit_a) || 0; if (!r || !lim) return; const age = (now - new Date(r.ts)) / 60000, a = Number(r['ch' + c.ch]);
          if (age <= 5 && a >= lim * ALARM_PCT) over.push({ p: alarmCfg.P[c.panel_id] || c.panel_id, n: c.name || ('CH' + c.ch), a, lim, age }); });
        showAlarm(over);
      }
    } catch (e) { }
    alarmTimer = setTimeout(() => loadAlarm(sb), 60000);
  }
  function showAlarm(over) {
    let el = document.getElementById('pt-alarm');
    let snooze = 0; try { snooze = Number(sessionStorage.getItem('pt-alarm-snooze') || 0); } catch (e) { }
    const base = document.title.replace(/^🚨 /, '');
    if (!over.length || Date.now() < snooze) { if (el) el.remove(); document.title = base; return; }
    document.title = '🚨 ' + base;
    const loadApp = (CFG.APPS || []).find(x => x.id === 'load');
    const html = `<span style="font-weight:700">🚨 과부하 경보</span> ` + over.map(o => `<span style="background:rgba(255,255,255,.18);border-radius:10px;padding:2px 8px;white-space:nowrap">${esc(o.p)} · ${esc(o.n)} <b>${o.a.toFixed(1)} A</b> (기준 ${o.lim} A · ${Math.round(o.a / o.lim * 100)}%)</span>`).join(' ') +
      `<span style="margin-left:auto;display:flex;gap:6px">${loadApp ? `<a href="${Portal.appUrl(loadApp)}" style="color:#fff;border:1px solid rgba(255,255,255,.7);border-radius:12px;padding:2px 10px;text-decoration:none;font-size:12px">부하 모니터링 보기</a>` : ''}
       <button type="button" id="pt-alarm-x" style="background:none;color:#fff;border:1px solid rgba(255,255,255,.7);border-radius:12px;padding:2px 10px;cursor:pointer;font-size:12px">10분 숨기기</button></span>`;
    if (!el) { document.getElementById('pt-bar').insertAdjacentHTML('afterend', '<div id="pt-alarm" style="position:sticky;top:0;z-index:60;background:#c62828;color:#fff;font-size:13px;padding:7px 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 2px 6px rgba(0,0,0,.2)"></div>'); el = document.getElementById('pt-alarm'); }
    el.innerHTML = html;
    document.getElementById('pt-alarm-x').onclick = () => { try { sessionStorage.setItem('pt-alarm-snooze', String(Date.now() + 600000)); } catch (e) { } el.remove(); document.title = base; };
  }

  const VIEWER_MSG = '보기 전용 계정은 저장·수정·삭제를 할 수 없습니다.';
  function viewerGuard(sb) {
    if (sb.__viewer) return; sb.__viewer = true;
    const deny = () => { const p = Promise.resolve({ data: null, error: { message: VIEWER_MSG } });
      const q = new Proxy(function () {}, { get(_, k) { if (k === 'then' || k === 'catch' || k === 'finally') return p[k].bind(p); return () => q; }, apply() { return q; } }); return q; };
    const wrap = (obj, bad) => new Proxy(obj, { get(o, k) { if (bad.includes(k)) return deny; const v = o[k]; return typeof v === 'function' ? v.bind(o) : v; } });
    const from = sb.from.bind(sb); sb.from = t => wrap(from(t), ['insert', 'update', 'upsert', 'delete']);
    const rpc = sb.rpc.bind(sb), READ_RPC = /^(load_latest|load_series|load_day_get|load_run_get|load_runtime|load_energy|load_csv|usage_info)$/; // 읽기 전용 함수는 허용
    sb.rpc = (n, a) => READ_RPC.test(n) ? rpc(n, a) : deny();
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
      · 참고 · 구성별 그래프: 기준 기간(또는 최근 24개월)의 <b>마감된 달</b>만, 둘 다 값이 있는 달만, 4개월 미만이면 「-」 · 하루당 보기를 켜면 둘 다 날수로 나눈 뒤 계산<br>
      · 주의: 달이 적으면(6~9개월) 한두 달에 크게 흔들림 · 원육·포장·생산일처럼 인자끼리도 같이 움직여서 r이 높아도 진짜 원인이라는 보장은 없음` },
    unit: { t: '원단위 · 일평균', b: `<b>원단위</b> = 사용량 ÷ 생산 지표. 예: 전기 원단위 = 전기 kWh ÷ 원육 투입 kg (kWh/kg). 생산이 많고 적음을 빼고 효율만 비교하려는 값.<br>
      · 참고 · 구성별 그래프의 원단위 선 = 막대(고른 구성 사용량) ÷ 고른 인자, 한 달 전체 값끼리 나눔 (포장 EA는 1,000EA당) · 평균기온은 0·음수가 있어 나누지 않음<br>
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
      · 현장 온수는 전기보일러라 「추운 정도」는 전기 식에 들어감<br>
      · <b>가스에 난방도일이 있는 이유</b>: 난방용 가스는 없지만(스팀은 자숙탱크·레토르트만) 겨울엔 ① 보일러 급수가 차가워(5℃ 안팎 vs 여름 20℃+) 같은 스팀에 연료가 더 들고 ② 배관·탱크 열손실이 크고 ③ 아침 예열·자숙수 데우는 열이 늘어남. 그래서 원육 kg당 가스가 겨울에 3~4배 → 생산일·원육만으로는 설명이 안 돼(오차 13%) 난방도일을 넣으면 5%로 줄어 자동으로 들어감<br>
      · 보일러 2대 운전은 26.1.6까지만(1.7부터 1대) → 겨울이 높은 건 2대 운전 탓이 아니라 추위 탓이 큼<br>
      · 실측 근거: 1/24~25 주말 보일러 1대를 24시간 켜 둔 날(생산 없음) = 하루 약 835㎥ → <b>대기만 해도 한겨울 시간당 약 35㎥</b>. 1월 생산일 평균 약 653㎥ 중 켜 둔 14시간 몫이 약 487㎥(약 75%) — 겨울엔 「얼마나 삶았나」보다 「몇 시간 켜 뒀나」가 더 큼<br>
      · <b>계수 검산 (1월 보통 생산일 16일 평균 624㎥)</b>: 식 = 기본 274 + 추위 276 + 원육 72 = 622㎥ ↔ 실측 = 대기 14h × 34.8 = 487 + 생산 스팀 137 = 624㎥ → 합은 맞음. 식의 「기본+추위」(550)가 실측 대기(487)보다 63㎥ 크고 「원육」(72)이 실측 스팀(137)보다 65㎥ 작음 = 겨울엔 삶는 데 드는 스팀도 늘어나는데(찬 물·찬 원육 데우기, 배관 손실) 식은 원육 계수를 1년 평균 하나로 써서 그 몫이 「추위」로 들어간 것. 월 합계·목표에는 문제 없음<br>
      · 여름 대기는 실측이 없음 — 식으로는 생산일 기본 약 274㎥(14h면 시간당 약 20㎥). 확인하려면 생산일에 보일러 켤 때와 자숙 시작 직전에 계량기를 한 번씩 더 읽으면 그 사이가 대기(+예열)량<br>
      · 주의: 26년 1~3월은 가동 초기(생산 적음)라 「추워서」와 「생산이 적어서」가 일부 섞였을 수 있음 → 생산이 많은 상태로 추워지는 11~12월 자료로 확인한 뒤 가스 식을 확정하는 게 안전` },
    baseline: { t: '예상 사용량 기준선', b: `「<b>원육 투입량·날씨·날수가 이렇다면 원래 이만큼 쓴다</b>」를 계산한 값. 실제 사용량이 이보다 적으면 절감, 많으면 초과.<br>
      · 기준 달(보통 전년)의 실적으로 식을 한 번 만들어 그 해 내내 <b>고정</b>해서 씀 — 연도를 바꿔 봐도 기준 달이 같으면 식은 그대로<br>
      · 전기: 생산동(= 전체 − 폐수동 − 공조냉동 − 부하 변동)만 식으로 맞추고, 폐수동·공조냉동은 계량기 실측을 그대로 더함 (26년 1~2월은 계량기 분리 전이라 자동 제외)<br>
      · 가스: 보일러만 식으로, 식당 가스는 실측 그대로 더함<br>
      · <b>맞는 정도</b>(R²) 100%에 가까울수록, <b>월 평균 오차</b> 작을수록 믿을 만함 (오차 = 달마다 |식 − 실제| ÷ 실제의 평균)` },
    ols: { t: '계수 계산 (최소제곱법)', b: `식의 숫자(계수)는 <b>모든 기준 달에서 「식으로 계산한 값 − 실제」의 제곱 합이 가장 작아지는 값</b>으로 찾음. 엑셀 추세선·<code>LINEST</code>와 같은 방법.
      <div class="f">생산동 = A × 달력 날수 + C × 원육 kg (+ W × 더운 정도)</div>
      · 예) A = 1,789 → 원육 양과 관계없는 생산동 고정분을 <b>달력 하루 평균</b>으로 나눈 값 (쉬는 날 대기전력 + 생산하는 날 켜는 조명·공기압축기·설비 기본 부하가 섞인 평균 — 쉬는 날 생산동 실제 사용량보다 큼) · C = 0.437 → 원육 1kg 더 넣을 때마다 0.437kWh 더 씀<br>
      <div class="f">가스 보일러(= 전체 − 식당) = 생산일 1일당 × 생산일 수 + 원육 1kg당 × 원육 kg + 난방도일 1당 × 난방도일</div>
      · 예) 생산일 1일당 약 12,000MJ(≈280㎥) → 원육 양·추위와 관계없이 <b>보일러를 켜는 날마다 드는 기본</b> (켜 두는 동안 대기·예열·배관 열손실 등). 쉬는 날은 보일러를 꺼서 0이라 「달력 날수」가 아니라 「생산일 수」에 붙음 · 원육 1kg당 약 5.2MJ → 삶는 양만큼 더 드는 스팀 · 난방도일 1당 약 490MJ → 추운 만큼 더 듦
      <div class="ex">예) 7월(난방도일 0): 22일 × 12,000 + 28,784kg × 5.2 ≈ 41만MJ — 실제 보일러 41만MJ와 거의 같음. 계수는 9개 달을 한꺼번에 가장 잘 맞추는 값이라 어느 한 달만 보고 나온 숫자가 아님 (1㎥ ≈ 43MJ)</div>
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
      · 그날 사용량이 평소보다 <b>+40%</b>(평소의 1.4배)를 넘게 쓰면 빨간 막대 — 「이 달 이상 사용일 전체」에서 +20% ~ +100%로 바꿀 수 있음 (낮출수록 더 많이 잡힘)<br>
      · 「지침 오류」: 검침 지침이 전날보다 작아지는 등 숫자가 맞지 않는 날<br>
      · 중앙값을 쓰는 이유: 하루 튄 날이 평소 값을 끌어올리지 않게` },
    planfix: { t: '내년 계획의 폐수동·공조냉동', b: `전기 목표 = 생산동(기준 식) + 폐수동 + 공조냉동 + 부하 변동. 폐수동·공조냉동은 계량기로 재는 몫이라 내년 값은 이렇게 잡음:<br>
      · <b>공조냉동</b>: 기온에 따라 여름·겨울 차이가 커서(26년 3월 약 1.5만 vs 8월 약 4.3만 kWh) <b>기온 식</b>으로 — 공조냉동 = 하루 기본 × 날수 + 계수 × (기준 온도 넘는 하루 평균기온 합). 기준 온도는 26년 3월부터 실적에 가장 잘 맞는 값, 내년 기온은 평년값<br>
      · <b>폐수동</b>: 부하가 바뀌어 왔으므로(블로워 운전 등) 전년 같은 달이 아니라 <b>지금 부하 수준</b>으로 — 설비검침 폐수전력 지침으로 최근 60일 하루 평균 (그 사이 특이사항에 ⚡ 폐수동 부하 변동을 적었으면 그날 이후만) × 날수<br>
      · 내년에 설비가 늘거나 운전이 바뀔 계획은 목표·예산 ④ 위 「📌 계획 부하 변동」에 따로 적음 (특이사항은 실제 있었던 일만)` },
    planload: { t: '📌 계획 부하 변동', b: `내년에 <b>예정된</b> 설비 증설·운전 변경을 목표에 넣는 곳 (실제 있었던 일은 특이사항에).<br>
      <div class="f">그 달에 더하는 양 = 하루 양 × (시작일~끝 사이 날수) &nbsp;·&nbsp; 전기 하루 양 = 대당 kW × 대수 × 하루 가동시간, 가스(보일러) = ㎥/일 × 열량계수</div>
      · 더한 뒤에 절감률을 적용해 목표가 됨 (계획 예상 = 기준 식 예상 + 계획 부하 변동)<br>
      · 줄어드는 계획(설비 철거·운전시간 단축)은 kW나 ㎥를 − 로<br>
      · 예) 27.3.1~ 공조냉동 냉동기 30kW × 20h = 하루 600kWh → 3~12월 약 18.4만 kWh 추가<br>
      · 실제로 시작되면 그때 특이사항에 ⚡ 부하 변동으로 적어 두면 원인 찾기에도 나옴` },
    std: { t: '📐 기준 식', b: `전기·가스 사용량을 「지표 × 계수」로 계산하는 <b>하나의 식</b>. 지표 분석 · 원인 찾기 · 목표·예산이 모두 이 식을 같이 씀 — 한 곳에서 바꾸면 세 탭이 같이 바뀜.
      <div class="f">정하는 순서: 🔒 확정한 식 → 직접 고른 지표 → 자동 식</div>
      · <b>어디서 바꾸나</b>: 지표 분석 → ① 지표 넣기/빼기 또는 ② 추천 조합 누르기 → ③ 「이 지표로 목표 세우기」 → 목표·예산 ①에서 「🔒 확정」<br>
      · <b>쓰이는 곳</b><br>
      &nbsp;&nbsp;- 지표 분석: ② 추천 조합 · ③ 고른 지표 오차의 비교 기준<br>
      &nbsp;&nbsp;- 원인 찾기 ①: 늘어난 양을 지표별 몫(계수 × 이번 달 − 비교 달)으로 나눔 → 나머지가 「운전·관리 차이」<br>
      &nbsp;&nbsp;- 원인 찾기 「생산 실적과 비교」(일별 예상): 같은 지표를 하루 단위로 바꿔 씀 (달력 날수 → 하루 기본, 생산일수 → 생산한 날, 원육 → 그날 원육 kg, 난방도일 → 그날 18℃ 아래 ℃ …). 하루 식의 계수는 최근 120일로 따로 맞춤<br>
      &nbsp;&nbsp;- 목표·예산: 예상 사용량 × (1 − 절감률) = 목표<br>
      · <b>연도</b>: 지금 목표를 세우는 해의 식 (10월부터는 다음 해) — 기준 달은 목표·예산 ①에서 정함<br>
      · 전기는 생산동만 식으로 계산하고 폐수동·공조냉동·부하 변동은 실측 그대로, 가스는 보일러만 식으로 계산하고 식당은 실측 그대로 더함<br>
      · 전기는 공조냉동 계량이 나뉜 26년 3월 이전 달과 비교할 때만 예전 자동 식으로 나눔 (생산동을 따로 못 구해서)` },
    cand: { t: '🧪 후보 지표 검토', b: `지표 목록에 없는 자료를 <b>지금 📐 기준 식에 하나씩 더해 보고</b> 쓸만한지 판정.<br>
      · 후보: 작업 인시(인원×시간) · 전처리·파쇄 작업시간 · 내포장 호기×시간 · 자숙 투입량 · 자숙 회차·시간 · 레토르트 회차·가열 시간 (전기), 가스는 여기에 더운 정도<br>
      · 판정: ⭐ 쓸만함 = 더했을 때 교차검증 오차가 0.3%p 넘게 줄고 계수가 플러스 / 겹침 = 기준 식에 있는 지표와 r 0.8 넘게 같이 움직임(같은 정보) → 이때는 그 지표 <b>대신</b> 넣어 보고, 오차가 0.3%p 넘게 줄면 「⭐ ○○ 대신 쓰면」으로 표시 (목록에 넣은 뒤 자동 탐색에서 그 조합을 고르면 됨) / 관계 없음 = 계수 마이너스 / 도움 적음 = 오차가 거의 안 줄어듦 / 자료 부족 = 그 지표 자료가 있는 달이 적음 (레토르트는 26년 6월, 내포장 시각은 기록 시작 후부터)<br>
      · 「목록에 넣기」 하면 지표 분석 ① 쓸 수 있는 지표·② 추천 조합에 같이 들어감 — 그다음 ②에서 순위를 보고 고르면 됨` },
    coef: { t: '계수(지표 1단위당 사용량) 정하는 법', b: `식 「사용량 = 지표A × a + 지표B × b」의 a·b를 <b>기준 달 실제 사용량에 가장 잘 맞게</b> 정한 값 (최소제곱법 — 엑셀 추세선·LINEST와 같은 방식).
      <div class="f">a·b = 기준 달마다 (식으로 계산 − 실제)² 을 더한 값이 가장 작아지는 숫자</div>
      <div class="ex">예) 전기 = 자숙 작업시간 h당 416 + 더운 정도 ℃·일당 155 → 9월 자숙 200h, 더운 정도 400 이면 200×416 + 400×155 = 83,200 + 62,000 = 145,200 kWh</div>
      · 뜻: <b>416</b> = 자숙을 1시간 더 하면 전기가 약 416 kWh 더 듦 / <b>155</b> = 하루 평균기온이 5℃보다 1℃ 높은 날이 하루 늘 때마다 약 155 kWh / 달력 날수의 계수 = 생산과 상관없이 하루에 기본으로 쓰는 양<br>
      · 고정값(절편)은 따로 두지 않음 — 「달력 날수」가 그 역할을 함<br>
      · 기준 달이 바뀌거나 고지서 값이 고쳐지면 다시 계산됨 → 목표를 정했으면 목표·예산 ①에서 🔒 확정<br>
      · 계수가 마이너스로 나오면 「늘수록 덜 쓴다」는 뜻이라 쓰지 않음 (자동 추천에서도 뺌)` },
    indrec: { t: '★ 종합 추천 고르는 법', b: `세 가지를 같이 봄.<br>
      ① <b>교차검증 오차</b>(안 쓴 달 맞히기) — 작을수록 좋음 (기본 점수)<br>
      ② <b>지표 신뢰도</b> — 각 지표가 ① 목록의 「판단」에서 관계가 확인됐는지: 월·하루 r 모두 높음(⭐), 기온 지표는 월 r이 높으면, 날수 지표는 월 r이 높으면 인정. 확인 안 된 지표 하나당 2%p 감점<br>
      ③ <b>지표 수</b> — 하나 늘 때마다 0.3%p 감점 (같은 정도면 적은 쪽이 설명 쉽고 우연히 맞을 위험도 적음) · 자료 달이 적은 조합 1%p 감점<br>
      · 점수가 가장 낮은 조합이 종합 추천. 교차검증 1위와 다를 수 있음 (그 경우 차이가 몇 %p인지 표시)<br>
      · 기준 달이 7~9개라 연말(11~12월 겨울 자료)이 들어오면 다시 보는 걸 권장` },
    rday: { t: '하루 단위 r vs 월 단위 r', b: `같은 기간이라도 <b>무엇을 점 하나로 보느냐</b>가 달라 r이 다르게 나옴.<br>
      · <b>지표 분석 (월 단위)</b>: 점 하나 = <b>한 달 합계</b>. 기준 달 7~9개 점으로 계산 · 쉬는 날·날수·계절 차이까지 다 들어감 → <b>목표(월 단위)에 쓰는 건 이쪽</b><br>
      · <b>생산 일별 요약 비교 (하루 단위)</b>: 점 하나 = <b>생산한 하루</b>. 수십 개 점 · 쉬는 날은 빠지고, 매일 거의 같은 기본 부하(냉동·폐수·조명)는 r에 안 잡힘 → 「그날 많이 만들면 그날 더 쓰나」를 보는 용도<br>
      · 예) 기온은 하루 단위로는 날마다 비슷해서 r이 낮게, 월 단위로는 여름·겨울 차이가 커서 r이 높게 나오기 쉬움 / 달력 날수는 하루 단위엔 아예 없음<br>
      · 하루 값은 검침 시각(08시) 기준이라 생산일과 몇 시간 어긋나는 것도 차이를 만듦 (전기는 파워플래너 0~24시)` },
    explore: { t: '② 추천 조합 (지표 자동 탐색)', b: `직접 말하지 않은 지표까지 <b>쓸 수 있는 지표를 전부 1~3개씩 조합해 식을 맞춰 보고</b> 가장 잘 맞는 것만 남김.<br>
      · 후보 — 전기: 달력 날수·원육·완제품·포장 EA·생산일수·쉬는 날 수·더운 정도·난방도일·자숙·포장 작업시간 / 가스: 달력 날수·원육·완제품·포장 EA·생산일수·쉬는 날 수·자숙·포장 작업시간·보일러 켠 시간·실가동·난방도일·보일러 켠 날 난방도일<br>      · 이 목록은 지표 분석 <b>① 쓸 수 있는 지표 · ② 추천 조합 · 참고 구성별 그래프</b>가 모두 똑같이 씀<br>      · <b>왜 이 지표들인가</b> (통계로 고른 게 아니라 아래 조건으로 후보를 정하고, 그중 어느 게 맞는지는 r·자동 탐색이 판단): ① 매달 빠짐없이 자료가 있음 (생산 대시보드·월간입력·달력·설비검침 기온) ② 생산동 전기·보일러 가스를 실제로 움직일 만한 원인 (생산량·가동일·작업시간·기온, 가스는 보일러 켠 시간) ③ 내년 목표를 세울 때 계획값을 넣거나 추정할 수 있음<br>
      · <b>뺀 것</b>: 따로 계량하는 몫(폐수동·공조냉동·식당 — 실측 그대로 더함) · 다른 유틸리티 사용량(원인이 아니라 같이 움직이는 결과) · 평균기온(영하가 있어 계수로 못 씀 → 더운·추운 정도로) · 전기에 보일러 지표, 가스에 더운 정도(관계가 약함)<br>
      · <b>빼는 조합</b>: 계수가 마이너스(「늘수록 덜 쓴다」— 말이 안 됨) · 고른 지표끼리 r 0.8 넘게 같이 움직임(어느 쪽 몫인지 못 가름) · 자료 있는 달이 (지표 수 + 3)개보다 적음<br>
      · <b>순위 = 교차검증 오차</b>: 기준 달을 하나씩 빼고 나머지 달로 식을 만들어, 뺀 달을 맞혀 본 오차의 평균. 이미 아는 달에 맞춘 오차(기준 달 오차)는 지표를 늘릴수록 무조건 작아지지만, 교차검증 오차는 우연히 맞춘 식이면 커지므로 「앞으로도 맞을 식」을 고르는 데 더 적합<br>
      · 보일러 켠 시간처럼 자료가 늦게 시작한 지표는 그 달들만으로 맞춰서 「달 적음」 표시 — 달이 적으면 오차가 작게 나오기 쉬우니 참고<br>
      · <b>자동 식과 1위가 다를 수 있는 이유</b>: 자동 식은 「기준 달 오차」가 가장 작은 식(정해진 후보 안에서)을 고르고, 탐색은 「교차검증 오차」로 순위를 매김. 지표를 하나 더 넣으면 기준 달 오차는 거의 항상 줄지만, 달이 적을 때(7~9개월)는 그 지표가 우연히 맞춘 것일 수 있어 교차검증 오차는 오히려 커질 수 있음 — 탐색 표 아래 「비교」 줄에 지금 식의 교차검증 오차와 순위가 나옴<br>
      · 결과는 추천일 뿐이고 「이걸로 고르기」를 눌러야 목표 식에 들어감 (자동으로 목표가 바뀌지 않음)` },
    hddon: { t: '보일러 켠 날 난방도일', b: `난방도일(18℃보다 추운 만큼의 합)을 <b>보일러를 켠 날(보일러 가스 하루 50㎥ 넘게 쓴 날)만</b> 더한 값. 주말·휴일엔 보일러를 꺼서 추워도 가스를 안 쓰므로, 달 전체 난방도일보다 가스와 더 잘 맞음.` },
    boilh: { t: '보일러 켠 시간 · 실가동', b: `보일러(스팀)는 <b>자숙</b>과 <b>레토르트</b>에 쓰임. 생산 대시보드 공정 원본 기록(읽기만)으로 날마다 계산.
      <div class="f">켠 시간 = 켠 시각 ~ 끈 시각</div><div class="ex">예) 10/16 전처리 05:05 시작 · 레토르트 마지막 배출 완료(t4) → 05:05 ~ t4</div>
      · <b>⚡실측</b>: 설비별 부하 모니터링(쉘리)에 보일러 전류 기록이 있는 날은 <b>보일러 전류가 가동 기준 이상이 된 처음 시각 ~ 마지막 시각</b>을 그대로 씀 (관류보일러 1·2 중 먼저 켠 것 ~ 늦게 끈 것). 기록이 없는 날만 아래 추정 방식<br>
      · <b>켠 시각</b> = 그날 첫 전처리 시작 (전처리 들어가며 보일러를 켬) — 전처리 기록 없는 날만 첫 자숙 시작으로 대신<br>
      · <b>끈 시각</b> = 레토르트 돌린 날: 마지막 회차 <b>t4 배출 완료</b> (실제로 끄는 건 조금 더 뒤지만 지금 기록 중 가장 가까움) / 레토르트 없는 날: <b>내포장 마지막 종료 + 1시간</b> (호기별 기록 중 가장 늦은 끝 · FC 3kg 장조림 날 + 2시간) — 외포장은 시각 기록이 없어 안 씀<br>
      · <b>실가동</b> = 자숙(시작~종료)·레토르트(t1 가동 시작~t3 가열 종료) 구간을 겹치면 합치고, 구간 사이 쉬는 틈은 뺀 시간 합 = 실제로 스팀을 쓴 시간. 켠 시간 − 실가동 = 대기 시간<br>
      · 날짜 칸의 시각에 마우스를 올리면 켠·끈 시각을 무엇으로 잡았는지 나옴<br>
      · 주말에 안 끄고 간 날처럼 기록과 실제가 다른 날은 특이사항에 적어 두기<br>
      · 「보일러 가스 = 켠 시간 1h당 × 켠 시간 + 원육 1kg당 × 원육」으로 고르면 시간당 대기와 원육 계수가 따로 나옴 (한겨울 실측 대기 ≈ 시간당 35㎥ ≈ 1,500MJ와 비교)` },
    pkg: { t: '완제품 중량 · 포장 생산량', b: `<b>완제품 kg = 완제품 EA × 제품 1개 중량</b> (소스 포함한 제품 무게 — 생산 대시보드 월별 현황 「제품별 생산 현황」의 완제품 중량과 같은 방식).<br>
      · <b>완제품 EA(포장 생산량)</b> = 외포장 EA + 잔량 (생산 대시보드 외포장 기록, 시험 생산 제외 · 26년 3·4월 기록은 외포장 EA에 잔량이 이미 들어 있어 외포장 EA만 — 대시보드 월별 현황과 달마다 맞춰 확인) — 대시보드 「월 총생산 EA」와 같은 기준. 내포장 EA(불량 포함)나 생산일별요약 EA가 아님<br>
      · 대시보드 전월 비교의 「완제품 중량」(원육 × 수율 = 고기만 무게)과는 다름<br>
      · 1개 중량: 직접 넣은 g이 있으면 그 값, 없으면 제품명에 적힌 중량(130g, 1kg, 70g×3 → 210g)을 자동으로 읽음 · 「3입 120g」처럼 애매한 건 곱하지 않음<br>
      · 그날(그 달) 포장 EA의 90% 이상 중량을 알아야 값이 나옴 · 수율 = 완제품 ÷ 원육` },
    share: { t: '지표가 여러 개일 때 몫 나누기', b: `예상 사용량은 <b>지표마다 (계수 × 그 달 값)을 더한 것</b>이라, 각 지표의 몫이 그대로 보임.
      <div class="f">생산동 = 1,791 × 날수 + 0.437 × 원육kg + 14.8 × 더운 정도</div>
      <div class="ex">예) 9월: 1,791×30일 = 53,730 · 0.437×51,130kg = 22,344 · 14.8×514 = 7,607 → 생산동 83,681 + 폐수동 실측 17,052 + 공조냉동 실측 39,441 = <b>예상 140,174 kWh</b></div>
      · 이 달 몫: 기본(날수) 38% · 원육 16% · 더운 정도 5% · 폐수동 12% · 공조냉동 28%<br>
      · <b>목표 = 예상 × (1 − 절감률)</b> → 절감률은 몫별로 따로가 아니라 <b>합계에 한 번</b> 적용 (3%면 모든 몫이 같이 3%씩 줄어든 셈)<br>
      · 계수는 지표들을 <b>한꺼번에</b> 맞춰서 나온 값이라, 각 계수 = 「다른 지표가 같을 때 그 지표 하나가 1 늘면 늘어나는 양」<br>
      · 그래서 서로 같이 움직이는 지표(r 0.8 이상)를 둘 다 넣으면 몫이 이리저리 갈려 믿을 수 없게 됨 → 하나만 고르라고 경고하는 이유<br>
      · <b>상관계수와 비중은 다른 것</b>: 달력 날수는 r이 −0.42인데 몫은 38%로 가장 큼 — 날수(28~31일)는 달마다 거의 안 바뀌어서 「같이 오르내림」(r)으로는 안 잡히지만, 원육 양과 관계없는 고정분(쉬는 날 대기전력 + 생산일 기본 부하의 하루 평균)이라 양은 큼 (전기요금의 기본요금과 비슷). r이 마이너스로 나온 건 30일 달에 생산이 많았던 우연 때문이고, 원육·기온을 같이 넣은 식에서는 하루당 +1,791로 정상<br>      · <b>1,789가 주말 실제보다 큰 이유</b>: ① 주말 전기 전체(2천대)에는 폐수동·공조냉동이 들어 있어 생산동만 보면 훨씬 작음 ② 1,789는 「주말 하루」가 아니라 원육 양과 상관없는 고정분 전체(생산일에만 켜는 설비 기본 부하 포함)를 달력 날수로 고르게 나눈 값 — 그래서 주말 생산동보다 크고, 대신 원육 몫(0.437)이 그만큼 작게 잡힘. 한 달 합계는 맞음` },
    lock: { t: '자동 식 · 목표 확정(잠금)', b: `· <b>자동 식</b>: 지표를 직접 안 고르면 전기는 달력 날수·원육·더운 정도(기준 온도 5~22℃ 중 가장 잘 맞는 것)·추운 정도를, 가스는 원육·생산일·난방도일 조합 중 가장 잘 맞는 것을 고름. 지표 고르기 칸에 지금 고른 지표가 나옴<br>
      · 자동 식은 <b>기준 달이 늘거나</b>(전년 달이 마감될 때마다) <b>고지서 값이 고쳐지면</b> 고르는 지표와 계수가 다시 계산됨 → 목표가 저절로 바뀔 수 있음<br>
      · <b>🔒 확정</b>: 그 순간의 지표·계수·기준 달을 저장해 두고 그대로 씀. 데이터가 바뀌어도 목표 식은 그대로 (절감률·원육 계획을 바꾸면 목표 숫자는 그만큼 바뀜)<br>
      · 확정 후에도 「지금 다시 자동으로 고르면」 결과를 같이 보여 주니, 차이가 커지면 확정을 풀고 다시 확정<br>
      · 「자동이 고른 지표를 직접 고른 것으로 옮기기」: 자동 식이 고른 지표를 그대로 직접 고른 지표로 고정 (계수는 데이터에 따라 바뀜)` },
    wqmin: { t: '폐수 고지 농도 최소값', b: `익산시는 별도로 한 달에 3번쯤 채수해서 평균을 냄. <b>BOD 100 · TOC 80 · SS 100 mg/L</b>보다 낮게 나와도 이 값으로 올려서 부과함 (「최소」 표시).` }
  };
  function tip(k, label) { return TIPS[k] && Portal.me && Portal.me.role === 'admin' ? `<span class="pt-tip" tabindex="0" role="button" data-tip="${k}" title="눌러서 설명 보기 — ${esc(TIPS[k].t)}">${label || 'ⓘ'}</span>` : ''; }
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
