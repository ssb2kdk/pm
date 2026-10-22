    // =====================================================================
    // 연도별 설정 (목표·보고서 코멘트): ut_monthly 의 'YYYY-00' 줄에 저장
    // =====================================================================
    let YEARDATA = {};   // { 2027: { targets: {...}, comments: { '2027-01': '...' } } }
    const yd = y => YEARDATA[y] || {};
    const tgt = y => yd(y).targets || {};
    // 3방향 합치기: 열었을 때 값(o) · 내가 고친 값(m) · 지금 DB 값(t) → 내가 바꾼 부분만 덮고 나머지는 남이 바꾼 최신 값 유지
    const isObj3 = v => v && typeof v === 'object' && !Array.isArray(v);
    const eq3 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function merge3(o, m, t) {
      if (eq3(m, o)) return t === undefined ? m : t; // 내가 안 바꿈 → 최신 값
      if (isObj3(m) && isObj3(t)) { const oo = isObj3(o) ? o : {}, out = { ...t };
        new Set([...Object.keys(m), ...Object.keys(oo)]).forEach(k => {
          if (!(k in m)) { if (k in oo && eq3(oo[k], t[k])) delete out[k]; return; } // 내가 지운 칸
          if (eq3(m[k], oo[k])) return; out[k] = merge3(oo[k], m[k], t[k]); });
        return out; }
      if (Array.isArray(m) && Array.isArray(t) && Array.isArray(o) && m.length === t.length && m.length === o.length) return m.map((x, i) => merge3(o[i], x, t[i]));
      return m;
    }
    async function freshYear(y) { // 저장 직전에 DB의 최신 연도 자료를 다시 읽음 (여럿이 동시에 고쳐도 덮어쓰지 않게)
      const { data, error } = await sb.from('ut_monthly').select('data').eq('ym', `${y}-00`).maybeSingle(); if (error) throw error;
      YEARDATA[y] = (data && data.data) || {}; return YEARDATA[y];
    }
    async function saveYear(y, patch) {
      const data = { ...(await freshYear(y)), ...patch };
      const { error } = await sb.from('ut_monthly').upsert({ ym: `${y}-00`, data }, { onConflict: 'ym' });
      if (error) throw error;
      YEARDATA[y] = data;
    }
    // 목표 원단위 (사용량/kg) · 연간 비용 목표
    const tUnit = (y, k) => { const v = tgt(y)[k + '_unit']; return v === undefined || v === null || v === '' ? null : Number(v); };
    const tCost = (y, k) => { const v = tgt(y)[k + '_cost']; return v === undefined || v === null || v === '' ? null : Number(v); };
    const tTotalUnit = y => { const v = tgt(y).total_unit; return v === undefined || v === null || v === '' ? null : Number(v); };
    const tProd = y => { const v = tgt(y).production; return v === undefined || v === null || v === '' ? null : Number(v); };
    // 목표 대비 (낮을수록 좋음): ▲ 초과(빨강) / ▼ 미달(초록)
    const vsTarget = (cur, t) => {
      if (cur === null || t === null || !t) return '';
      const p = (cur / t - 1) * 100;
      return `<span class="${p > 0.05 ? 'up' : 'down'}">${p > 0 ? '목표 초과 ▲' : '목표 이내 ▼'} ${nf1.format(Math.abs(p))}%</span>`;
    };

    // 연간 누적 (1월 ~ 기준월)
    function ytd(y, uptoYm) {
      const out = { production: 0, total: 0 }; UT.UTILS.forEach(u => { out[u.k] = { usage: 0, cost: 0 }; });
      let months = 0;
      yearMonths(y).forEach(ym => {
        if (ym > uptoYm) return;
        const s = S(ym); if (s.total === null && s.production === null) return;
        months++;
        out.production += s.production || 0; out.total += s.total || 0;
        UT.UTILS.forEach(u => { out[u.k].usage += s[u.k].usage || 0; out[u.k].cost += s[u.k].cost || 0; });
      });
      out.months = months;
      return out;
    }

    // =====================================================================
    // 월말 예측 (진행 중인 달)
    // =====================================================================
    const fcCache = {};
    function FC(ym) {
      if (UT.monthComplete(DAILY, ym) || ym > thisYm) return null;
      const key = ym + '|' + todayStr;
      if (!(key in fcCache)) fcCache[key] = UT.forecastSummary(ym, MONTHLY, DAILY, todayStr);
      return fcCache[key];
    }
    function forecastCard(ym) {
      const f = FC(ym); if (!f || !f.forecast || !f.forecast.days) return '';
      const prevS = S(UT.prevYm(ym));
      const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5));
      const tc = UT.UTILS.reduce((a, u) => a + (tCost(y, u.k) || 0), 0);
      return `<div class="card fc-card">
        <h3>🔮 ${m}월 월말 예상 <span class="sub">${f.forecast.asOf.slice(5).replace('-', '/')}까지 검침 ${f.forecast.days}일 기준 · 남은 날은 평일·주말 평균으로 추정</span></h3>
        <div class="fc-grid">
          <div><div class="hint">총비용 (VAT 포함)</div>${UT.UTILS.some(u => f[u.k].cost === null) ? '<b style="font-size:13px;color:#999">모든 항목 검침이 쌓이면 계산</b>' : `<b>${man(f.total)}</b><div class="hint">전월 ${pctTxt(f.total, prevS.total)}${tc ? ` · 월 목표 ${man(tc / 12)} 대비 ${pctTxt(f.total, tc / 12)}` : ''}</div>`}</div>
          ${UT.UTILS.map(u => `<div><div class="hint"><i class="dot" style="background:${u.color}"></i>${u.name}</div>${f[u.k].cost === null ? '<b style="font-size:13px;color:#999">검침 2일 이상 쌓이면 계산</b>' : `<b>${man(f[u.k].cost)}</b><div class="hint">${f0(f[u.k].usage)} ${u.unit} · 전월 ${pctTxt(f[u.k].usage, prevS[u.k].usage)}</div>`}</div>`).join('')}
        </div>
        <div class="hint" style="margin-top:6px">원육 투입량을 아직 안 넣은 달이라 원단위는 월말에 원육 투입량을 넣으면 계산됩니다. 회계보고 탭에서 이 예상값으로 가마감 표를 바로 뽑을 수 있습니다.</div>
      </div>`;
    }

    // =====================================================================
    // 목표 — 기준선(예상 사용량) 대비 절감 방식
    //   예상 사용량 = 날마다 기본량 × 날수 + 생산 1kg당 × 생산량 + 난방/냉방도일 영향
    //   목표 사용량 = 예상 사용량 × (1 − 절감률)
    // =====================================================================
    let targetY = null, targetDraft = {}, targetDirty = false, targetUtil = 'elec', targetOrig = null;
    const QN = ['1분기', '2분기', '3분기', '4분기'];
    function shiftTargetYear(d) {
      if (targetDirty && !confirm('저장하지 않은 목표가 있습니다. 이동할까요?')) return;
      targetY += d; renderTargets();
    }
    const lastCompleteYm = () => { let ym = thisYm; for (let i = 0; i < 3 && !UT.monthComplete(DAILY, ym); i++) ym = UT.prevYm(ym); return UT.monthComplete(DAILY, ym) ? ym : UT.prevYm(thisYm); };
    // 한 달 데이터 (실적 + 날씨)
    function monthRow(ym) {
      const s = S(ym), w = UT.monthWeather(ym, TEMPS || {});
      const r = { ym, days: w.days, op: UT.opDays(DAILY, ym, MONTHLY), prod: s.production, hdd: w.hdd, cdd: w.cdd, s };
      UT.UTILS.forEach(u => { r[u.k] = s[u.k].usage; r[u.k + '_cost'] = s[u.k].cost; });
      return r;
    }
    // 기준 달 (기본: 전년 1~12월 중 마감된 달, 생산량이 적은 가동 초기 달은 제외)
    function defaultBase(y) {
      const last = lastCompleteYm();
      const pick = (from, to) => { const c = []; for (let ym = from; ym <= to && ym <= last; ym = UT.nextYm(ym)) { const s = S(ym); if (s.production && s.elec.usage) c.push({ ym, p: s.production }); }
        const mx = Math.max(0, ...c.map(x => x.p)); return c.filter(x => x.p >= mx * 0.2).map(x => x.ym); };
      // 전년 1~12월 (없으면 그 전 12개월) → 그래도 6개월이 안 되면 최근 마감 12개월
      let b = pick(UT.ym(y - 1, 1), UT.ym(y - 1, 12));
      if (b.length < 6) { let from = last; for (let i = 0; i < 11; i++) from = UT.prevYm(from); b = pick(from, last); }
      return b;
    }
    const baseMonths = (t, y) => Array.isArray(t.base) && t.base.length ? t.base : defaultBase(y);
    const rateOf = (t, k) => { const v = (t.rate || {})[k]; return v === undefined || v === null || v === '' ? null : Number(v); };
    // 항목별로 기준에서 뺄 달 (평소와 다르게 운전한 달). 저장값이 없으면 기본값
    //  용수·폐수: 26년 4월 말~7월 폐수처리장 악취 희석용으로 물을 더 흘려보냄 (용수는 검침이 전월 12일~당월 11일이라 한 달 늦게 잡음)
    const EXCL_DEFAULT = { water: ['2026-05', '2026-06', '2026-07', '2026-08'], ww: ['2026-04', '2026-05', '2026-06', '2026-07'] };
    const EXCL_WHY = { water: '악취 희석용 물 추가 (26.4월 말~7월 · 용수 검침 기간 기준)', ww: '악취 희석용 물 추가 (26.4월 말~7월)' };
    const exclOf = (t, uk) => { const e = (t.excl || {})[uk]; return Array.isArray(e) ? e : (EXCL_DEFAULT[uk] || []); };
    const baseFor = (t, y, uk) => baseMonths(t, y).filter(ym => !exclOf(t, uk).includes(ym));
    // 용수·폐수: 날수·원육 (+ 난방도일 — 넣어서 오차가 0.5%p 넘게 줄고 계수가 0 이상일 때만)
    function fitSimple(months, uk) {
      const rows = months.map(monthRow).map(r => ({ ...r, y: r[uk] }));
      const a = UT.fitBaseline(rows, ['days', 'prod']), b = UT.fitBaseline(rows, ['days', 'prod', 'hdd']);
      const okA = a && a.coef.every(c => c >= 0), okB = b && b.feats.length === 3 && b.coef.every(c => c >= 0);
      if (okB && (!okA || b.mape < a.mape - 0.5)) return b;
      if (okA) return Object.assign(a, { hddDropped: !!b });
      return a || b;
    }
    function fitModels(t, y, autoOnly) {
      const out = {};
      UT.UTILS.forEach(u => { out[u.k] = UT.fitBaseline(baseFor(t, y, u.k).map(monthRow).map(r => ({ ...r, y: r[u.k] })), UT.MODEL_FEATS[u.k]); });
      ['water', 'ww'].forEach(k => { const m = fitSimple(baseFor(t, y, k), k); if (m) out[k] = m; });
      // 전기·가스 자동 식 = 지표 분석의 「추천 1위」(교차검증 오차가 가장 작은 조합) — 고르거나 확정하기 전까지
      ['elec', 'gas'].forEach(uk => { const am = autoBest(t, y, uk); if (am) out[uk] = am; });
      if (autoOnly) return out;
      // 고른 지표가 있으면 그 식으로 (전기·가스만)
      Object.defineProperty(out, '_auto', { value: { elec: out.elec, gas: out.gas }, enumerable: false });
      Object.defineProperty(out, '_pick', { value: {}, enumerable: false });
      ['elec', 'gas'].forEach(uk => {
        const L = lockOf(t, uk); if (L) { const lm = lockedModel(t, y, uk, L); if (lm) { lm.autoMape = out[uk] ? out[uk].mape : null; out[uk] = lm; return; } }
        const pm = fitPick(t, y, uk); if (!pm) return; out._pick[uk] = pm; pm.autoMape = out[uk] ? out[uk].mape : null; if (!pm.err && !pm.neg) out[uk] = pm; });
      return out;
    }

    // =====================================================================
    // 고른 지표로 목표 식 만들기 — 「② 지표 찾기」 탭(기간비교 구성별 비교)이나 목표 ①에서 고른 지표 (연도별 targets.pick)
    //  전기: 생산동(= 전체 − 폐수동 − 공조냉동 − 부하 변동)만 고른 지표로 맞추고, 폐수동·공조냉동·부하 변동은 계량기·이력 그대로 더함
    //  가스: 보일러(= 전체 − 식당)만 고른 지표로 맞추고, 식당 가스는 실측 그대로 더함
    // =====================================================================
    const PICK_U = { elec: { name: '전기', part: '전기 전체', unit: 'kWh' }, gas: { name: '가스', part: '보일러(스팀)', unit: 'MJ' } };
    // ★ 전기·가스 지표 목록 하나 — 구성별 비교(그래프·r 표) · 목표에 쓸 지표 고르기 · 🔍 자동 탐색이 모두 이 목록을 씀
    const FACS_BASE = {
      elec: ['days', 'op', 'idle', 'prod', 'pkg', 'ea', 'steamH', 'packH', 'warm', 'hdd'],
      gas: ['days', 'op', 'idle', 'prod', 'pkg', 'ea', 'steamH', 'packH', 'boilH', 'runH', 'retN', 'hdd', 'hddOn']
    };
    // 🧪 후보 지표 검토에서 「목록에 넣기」 한 것 (ut_monthly '9999-00' data.facsExtra)
    const facsExtra = uk => ((((YEARDATA[9999] || {}).facsExtra) || {})[uk] || []).filter(f => PE_FAC.some(z => z[0] === f) && !FACS_BASE[uk].includes(f));
    const FACS_U = { get elec() { return FACS_BASE.elec.concat(facsExtra('elec')); }, get gas() { return FACS_BASE.gas.concat(facsExtra('gas')); } };
    // 검토 후보 = 지금 목록에 없는 것 중 자료가 있는 것
    const CANDS = { elec: ['manH', 'prepH', 'crushH', 'packMH', 'steamKg', 'cookH', 'retN', 'retH'], gas: ['manH', 'prepH', 'crushH', 'packMH', 'steamKg', 'cookN', 'cookH', 'retH', 'warm'] };
    const PICK_PROD = { pkg: 1, ea: 1, steamH: 1, packH: 1, boilH: 1, runH: 1, retN: 1, retH: 1, cookN: 1, cookH: 1, packMH: 1, manH: 1, prepH: 1, crushH: 1, steamKg: 1 };
    const PICK_PER_OP = { boilH: 1, runH: 1 }; // 계획 달 추정을 원육 비율이 아니라 생산일 1일당 평균으로 하는 지표 // 생산 대시보드 일별 실적에서 오는 지표 (계획 달은 원육 비율로 추정)
    const pickOf = (t, uk) => { const p = (t.pick || {})[uk]; return Array.isArray(p) && p.length ? p : null; };
    const facName = f => { if (/^warmT:/.test(f)) return `더운 정도(${f.slice(6)}℃ 넘는 합)`; if (/^coldT:/.test(f)) return `추운 정도(${f.slice(6)}℃ 아래 합)`; const x = PE_FAC.find(z => z[0] === f); return x ? x[1].replace(/ \(.*\)/, '') : f; };
    const facUnit = f => { if (/^(warm|cold)T:/.test(f)) return '℃·일'; const x = PE_FAC.find(z => z[0] === f); return x ? x[2] : ''; };
    function pickYear() { return targetY || (Number(thisYm.slice(5)) >= 10 ? Number(thisYm.slice(0, 4)) + 1 : Number(thisYm.slice(0, 4))); }
    function resetPickCache() { Object.keys(STD_CACHE).forEach(k => delete STD_CACHE[k]); Object.keys(exploreCache).forEach(k => delete exploreCache[k]); Object.values(YEARDATA).forEach(d => { if (d && d.targets && d.targets._models) d.targets._models = undefined; }); }
    function pickPart(ym, uk) { // { y: 식으로 맞출 몫, fixed: 그대로 더할 실측, all: 전체 }
      const s = S(ym);
      // 전기는 전체 사용량(파워플래너)을 지표로 바로 맞춤 — 생산동·폐수동·공조냉동으로 나누지 않음
      if (uk === 'elec') { const all = s.elec.usage; if (all === null || all === undefined || !s.elec.calc && !(ym < thisYm)) return null; return { y: all, fixed: 0, all }; }
      const g = s.gas.usage; if (g === null || g === undefined || !s.gas.calc) return null; const rest = gasRestMJ({ ym, days: UT.daysIn(ym) }, null) || 0;
      return { y: g - rest, fixed: rest, all: g };
    }
    const peCache = {};
    function facOf(ym, f, plan) {
      const days = UT.daysIn(ym);
      if (f === 'days') return days;
      if (plan) { if (f === 'prod') return plan.prod; if (f === 'op') return plan.op; if (f === 'idle') return plan.op === null ? null : days - plan.op; }
      if (f === 'warm') return warmSum(ym, 5);
      if (/^warmT:/.test(f)) return warmSum(ym, Number(f.slice(6)));
      if (/^coldT:/.test(f)) return coldSum(ym, Number(f.slice(6)));
      if (f === 'hdd') { const w = UT.monthWeather(ym, TEMPS || {}); if (!plan && w.hdd !== null && w.hdd !== undefined) return w.hdd; const nm = normals()[Number(ym.slice(5))]; return nm ? nm.hdd : null; }
      if (plan) return null;
      const k = ym + '|' + (PRODD ? 1 : 0); const r = peCache[k] || (peCache[k] = peRow(ym)); const v = r.f[f]; return v === undefined ? null : v;
    }
    function fitPick(t, y, uk) {
      const F = pickOf(t, uk); if (!F) return null;
      if (F.some(f => PICK_PROD[f]) && !PRODD) return { pick: true, feats: F, err: '생산 대시보드 일별 실적을 불러오는 중이거나 읽지 못해 계산하지 못했습니다' };
      const rows = baseFor(t, y, uk).map(ym => { const p = pickPart(ym, uk); return p ? { ym, ...p, x: F.map(f => facOf(ym, f)) } : null; })
        .filter(r => r && r.y > 0 && r.x.every(v => v !== null && v !== undefined && !isNaN(v)));
      if (rows.length < F.length + 2) return { pick: true, feats: F, n: rows.length, err: `쓸 수 있는 기준 달이 ${rows.length}개라 지표 ${F.length}개를 계산할 수 없습니다 (지표 수 + 2개월 이상 필요${uk === 'elec' ? ' · 전기는 26년 3월부터' : ''})` };
      const c = UT.ols(rows.map(r => r.x), rows.map(r => r.y));
      if (!c) return { pick: true, feats: F, n: rows.length, err: '계산이 안 됩니다 — 고른 지표끼리 완전히 똑같이 움직입니다. 하나를 빼 주세요.' };
      const warn = [];
      const neg = c.some(v => v < 0); F.forEach((f, i) => { if (c[i] < 0) warn.push(`<b>${facName(f)}</b> 계수가 마이너스 — "늘수록 덜 쓴다"는 뜻이라 목표식으로 부적절 (빼는 걸 권장)`); });
      if (F.length > Math.max(1, Math.floor(rows.length / 3))) warn.push(`기준 달 ${rows.length}개에 지표 ${F.length}개 — 달 수에 비해 지표가 많아 우연히 잘 맞을 수 있음 (${Math.max(1, Math.floor(rows.length / 3))}개 이하 권장)`);
      for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) { const pr = pearson(rows.map(r => r.x[i]), rows.map(r => r.x[j])); if (pr && Math.abs(pr.r) >= 0.8) warn.push(`<b>${facName(F[i])}</b>·<b>${facName(F[j])}</b>가 서로 r ${pr.r.toFixed(2)} — 같이 움직여서 어느 쪽 몫인지 갈리지 않음 (하나만 권장)`); }
      const ratio = {}; F.filter(f => PICK_PROD[f]).forEach(f => { const i = F.indexOf(f), sp = rows.reduce((a, r) => a + ((PICK_PER_OP[f] ? UT.opDays(DAILY, r.ym, MONTHLY) : S(r.ym).production) || 0), 0); ratio[f] = sp ? rows.reduce((a, r) => a + r.x[i], 0) / sp : null; });
      const avgRest = uk === 'gas' ? rows.reduce((a, r) => a + r.fixed, 0) / Math.max(1, rows.reduce((a, r) => a + UT.daysIn(r.ym), 0)) : null;
      return Object.assign(pickModel(uk, F, c, ratio, avgRest, rows), { neg, warn });
    }
    // 지표·계수가 정해진 식 (고른 지표 / 확정한 식 공용): 기준 달에 맞춰 본 오차 + 앞으로의 달 예상
    function autoBest(t, y, uk) {
      const E = exploreModels(t, y, uk), b = E.list[0]; if (!b) return null;
      const m = fitPick(Object.assign({}, t, { pick: Object.assign({}, t.pick || {}, { [uk]: b.feats }) }), y, uk); if (!m || m.err) return null;
      return Object.assign(m, { auto: true, cv: b.cv });
    }
    function pickModel(uk, F, c, ratio, avgRest, rows) {
      ratio = ratio || {};
      const part = x => x.reduce((a, v, i) => a + c[i] * v, 0);
      rows.forEach(r => { r.pp = part(r.x); r.pred = r.pp + r.fixed; });
      const mean = rows.reduce((a, r) => a + r.all, 0) / rows.length, ssr = rows.reduce((a, r) => a + (r.all - r.pred) ** 2, 0), sst = rows.reduce((a, r) => a + (r.all - mean) ** 2, 0);
      return { pick: true, neg: false, warn: [], feats: F, coef: c, n: rows.length, rows, ratio, avgRest, r2: sst ? 1 - ssr / sst : null,
        mape: rows.reduce((a, r) => a + Math.abs(r.pred - r.all) / r.all, 0) / rows.length * 100,
        partMape: rows.reduce((a, r) => a + Math.abs(r.pp - r.y) / r.y, 0) / rows.length * 100,
        predict: r => {
          const plan = r.plan ? { prod: r.prod, op: r.op } : null;
          const x = F.map(f => { let v = facOf(r.ym, f, plan); if ((v === null || v === undefined) && plan && PICK_PROD[f] && ratio[f] !== null && ratio[f] !== undefined) { const b = PICK_PER_OP[f] ? r.op : r.prod; if (b) v = ratio[f] * b; } return v; });
          if (x.some(v => v === null || v === undefined || isNaN(v))) return null;
          let fixed; if (plan) fixed = uk === 'elec' ? 0 : (avgRest || 0) * UT.daysIn(r.ym); // 전기는 전체를 지표로 · 가스는 식당 하루 평균
          else { const p = pickPart(r.ym, uk); if (!p) return null; fixed = p.fixed; }
          return Math.max(0, part(x) + fixed);
        } };
    }
    // ---- 목표 확정 (잠금): 확정한 순간의 지표·계수·기준 달을 저장해, 데이터가 쌓여도 목표 식이 바뀌지 않게 ----
    const lockOf = (t, uk) => t && t.lock && t.lock[uk] ? t.lock[uk] : null;
    const isLocked = t => !!(t && t.lock && (t.lock.elec || t.lock.gas));
    function lockedModel(t, y, uk, L) {
      const rows = baseFor(t, y, uk).map(ym => { const p = pickPart(ym, uk); return p ? { ym, ...p, x: L.feats.map(f => facOf(ym, f)) } : null; })
        .filter(r => r && r.y > 0 && r.x.every(v => v !== null && v !== undefined && !isNaN(v)));
      if (!rows.length) return null;
      return Object.assign(pickModel(uk, L.feats, L.coef, L.ratio, L.avgRest, rows), { locked: true, lock: L });
    }
    // 지금 쓰는 식(자동/고른 지표) → 확정용 { feats, coef, ... }
    function lockSpec(m, uk, t, y) {
      if (!m) return null;
      let feats, coef;
      if (m.pick && !m.err) { feats = m.feats.slice(); coef = m.coef.slice(); }
      else if (m.hall) { feats = ['days', 'prod']; coef = [m.coef[0], m.coef[1]]; if (m.Tb !== null) { feats.push('warmT:' + m.Tb); coef.push(m.coef[2]); } if (m.Tc !== null) { feats.push('coldT:' + m.Tc); coef.push(m.coef[3]); } }
      else if (m.gasBoiler) { feats = m.feats.filter(f => f !== 'grest'); coef = feats.map(f => m.coef[m.feats.indexOf(f)]); }
      else return null; // 예비 식(휴무일 기준)은 확정 대상 아님
      const months = baseFor(t, y, uk), parts = months.map(ym => pickPart(ym, uk)).filter(Boolean);
      const avgRest = uk === 'gas' ? parts.reduce((a, p) => a + p.fixed, 0) / Math.max(1, months.filter(ym => pickPart(ym, uk)).reduce((a, ym) => a + UT.daysIn(ym), 0)) : null;
      const L = { feats, coef, ratio: m.ratio || {}, avgRest, src: m.pick && !m.auto ? 'pick' : 'auto' };
      const chk = lockedModel(t, y, uk, L); if (!chk) return null;
      return Object.assign(L, { mape: chk.mape, n: chk.n, months: chk.rows.map(r => r.ym) });
    }
    const featsText = m => !m ? '-' : m.err ? '계산 안 됨' : m.pick ? m.feats.map(facName).join(' · ')
      : m.hall ? ['달력 날수', '원육 투입량'].concat(m.Tb !== null ? [`더운 정도(${m.Tb}℃ 넘는 합)`] : [], m.Tc !== null ? [`추운 정도(${m.Tc}℃ 아래 합)`] : []).join(' · ')
      : m.gasBoiler ? m.feats.filter(f => f !== 'grest').map(f => f === 'op' ? '생산일수' : f === 'prod' ? '원육 투입량' : f === 'hdd' ? '추운 정도(난방도일)' : f).join(' · ')
      : m.idle ? '휴무일 기준·생산일·원육 (예비 식)' : '-';
    async function lockTargets() {
      if (!isAdmin()) return;
      if (targetDirty) { if (!confirm('저장하지 않은 변경이 있습니다. 먼저 저장하고 확정할까요?')) return; await saveTargets(); }
      const y = targetY; try { await freshYear(y); } catch (e) { alert('불러오기 실패: ' + errMsg(e)); return; }
      if (!PRODD) { try { await loadProdDaily(); } catch (e) { } }
      const t = JSON.parse(JSON.stringify(tgt(y))), models = fitModels(t, y);
      const L = { at: todayStr, by: (me && (me.name || me.username)) || '', base: baseMonths(t, y), baseAuto: !(Array.isArray(t.base) && t.base.length) };
      for (const uk of ['elec', 'gas']) { const sp = lockSpec(models[uk], uk, t, y); if (!sp) { alert(`${PICK_U[uk].name} 식을 확정할 수 없습니다 — 기준 달이 부족하거나 예비 식입니다.`); return; } L[uk] = sp; }
      const line = uk => `${PICK_U[uk].name}: ${L[uk].feats.map(facName).join(' · ')} (기준 달 ${L[uk].n}개 · 오차 ±${nf1.format(L[uk].mape)}%)`;
      if (!confirm(`${y}년 목표 식을 이대로 확정할까요?\n\n${line('elec')}\n${line('gas')}\n기준 달: ${L.base[0]} ~ ${L.base[L.base.length - 1]} (${L.base.length}개)\n\n확정하면 데이터가 쌓이거나 고쳐져도 지표·계수가 바뀌지 않습니다. 바꾸려면 「확정 풀기」를 해야 합니다.`)) return;
      t.base = L.base; t.lock = L;
      try { await saveYear(y, { targets: t }); } catch (e) { alert('저장 실패: ' + errMsg(e)); return; }
      resetPickCache(); targetOrig = null; targetDirty = false; renderTargets();
    }
    async function unlockTargets() {
      if (!isAdmin() || !confirm('목표 식 확정을 풀까요?\n\n풀면 지금 데이터로 지표·계수를 다시 계산합니다 (목표 숫자가 바뀔 수 있음).')) return;
      const y = targetY; try { await freshYear(y); } catch (e) { alert('불러오기 실패: ' + errMsg(e)); return; }
      const t = JSON.parse(JSON.stringify(tgt(y))); if (t.lock && t.lock.baseAuto) delete t.base; delete t.lock;
      try { await saveYear(y, { targets: t }); } catch (e) { alert('저장 실패: ' + errMsg(e)); return; }
      resetPickCache(); targetOrig = null; targetDirty = false; renderTargets();
    }
    // 지표 고르기 칸 (기간비교 구성별 비교 · 목표 ①에서 같이 씀)
    function pickBoxHtml(uk, ctx, facs) {
      const y = ctx === 'target' ? targetY : pickYear(), t = ctx === 'target' ? targetDraft : tgt(y), F = pickOf(t, uk) || [], ad = isAdmin(), U = PICK_U[uk];
      const list = FACS_U[uk].concat(F.filter(f => !FACS_U[uk].includes(f))); // 고른 지표 중 목록에 없는 것(예: 더운 정도 기준 온도 다른 것)도 보이게
      const auto = fitModels(t, y, true)[uk], pm = F.length ? fitPick(t, y, uk) : null, L = lockOf(t, uk);
      if (L) { const lm = lockedModel(t, y, uk, L), U2 = PICK_U[uk];
        return `<div class="pick-box"><div><b>🎯 ${y}년 ${U2.name} 목표 지표</b> ${Portal.tip('pick')} <span class="lock-b">🔒 확정 ${esc(t.lock.at || '')}</span></div>
          <div style="margin-top:6px">${U2.part} = ${L.feats.map((f, i) => `${facName(f)} ${facUnit(f) ? facUnit(f) + '당 ' : ''}<b>${Math.abs(L.coef[i]) >= 100 ? f0(L.coef[i]) : Number(L.coef[i].toPrecision(3)).toLocaleString('ko-KR')}</b>`).join(' + ')} <span class="hint">(${L.src === 'pick' ? '직접 고른 지표' : '자동 식'} · 기준 달 ${L.n}개)</span></div>
          <div class="hint" style="margin-top:2px">확정할 때 오차 ±${nf1.format(L.mape)}%${lm ? ` · 지금 데이터로 보면 ±${nf1.format(lm.mape)}%` : ''}${auto ? ` · 지금 다시 자동으로 고르면 「${featsText(auto)}」 ±${nf1.format(auto.mape)}%` : ''}</div>
          <div class="hint" style="margin-top:2px">확정된 식은 데이터가 쌓여도 바뀌지 않습니다. 바꾸려면 ${ctx === 'target' ? '위' : '<a href="#" onclick="switchTab(\'target\');return false">목표·예산</a> ①'}의 「확정 풀기」.</div></div>`; }
      let h = `<div class="pick-box"><div><b>🎯 ${y}년 ${U.name} 목표에 쓸 지표</b> ${Portal.tip('pick')} <span class="hint">${U.part}만 이 지표로 맞추고 ${uk === 'elec' ? '폐수동·공조냉동은 계량기 그대로' : '식당 가스는 실측 그대로'} 더함${ad ? ' · 눌러서 넣기/빼기' : ' (관리자만 바꿀 수 있음)'}</span></div>
        <div class="chips" style="margin-top:6px">${list.map(f => `<button class="chip ${F.includes(f) ? 'on' : ''}" ${ad ? `onclick="pickToggle('${uk}','${f}','${ctx}')"` : 'disabled'}>${F.includes(f) ? '✓ ' : ''}${facName(f)}</button>`).join('')}
        ${F.length && ad ? `<button class="chip" onclick="pickClear('${uk}','${ctx}')">자동으로 되돌리기</button>` : ''}</div>`;
      const em = auto ? `자동 식 월 평균 오차 ±${nf1.format(auto.mape)}%` : '자동 식 없음';
      if (!F.length) h += `<div style="margin-top:6px">지금은 <b>자동 식</b>으로 목표를 계산합니다 → 자동으로 고른 지표: <b>${featsText(auto)}</b> <span class="hint">(${em})</span></div>
        <div class="hint" style="margin-top:2px">📅 목표 식(자동·고른 지표 모두)은 ${ctx === 'period' ? '<b>맨 위 기간이 아니라</b> ' : ''}목표·예산 ①의 <b>기준 달</b>(${(() => { const b = baseFor(t, y, uk).filter(ym => uk !== 'elec' || ym >= HVAC_FULL_FROM); return b.length ? `${b[0].slice(2).replace('-', '.')} ~ ${b[b.length - 1].slice(2).replace('-', '.')}, ${b.length}개월` : '-'; })()})로 계산합니다${ctx === 'period' ? ' — 위 기간은 그래프·상관계수 표에만 적용' : ''}.</div>
        <div class="hint" style="margin-top:2px">자동 식은 기준 달이 늘거나 고지서 값이 고쳐지면 고르는 지표·계수가 바뀔 수 있습니다. 목표를 정했으면 목표·예산 ①에서 「🔒 확정」하세요.${ad ? ` <button class="chip" onclick="pickUseAuto('${uk}','${ctx}')">자동이 고른 지표를 직접 고른 것으로 옮기기</button>` : ''}</div>`;
      else if (pm && pm.err) h += `<div class="warn" style="margin-top:6px">⚠ ${pm.err} → 지금은 자동 식으로 계산합니다 (${em})</div>`;
      else if (pm) { const better = auto ? pm.mape <= auto.mape + 0.3 : true;
        h += `<div style="margin-top:6px">${U.part} = ${pm.feats.map((f, i) => `${facName(f)} ${facUnit(f) ? facUnit(f) + '당 ' : ''}<b>${Math.abs(pm.coef[i]) >= 100 ? f0(pm.coef[i]) : Number(pm.coef[i].toPrecision(3)).toLocaleString('ko-KR')}</b>`).join(' + ')} <span class="hint">(기준 달 ${pm.n}개)</span></div>
          <div class="hint" style="margin-top:2px">📅 목표·예산 ①의 기준 달 ${pm.n}개로 계산${ctx === 'period' ? ' (맨 위 기간과 무관 — 위 기간은 그래프·상관계수 표에만 적용)' : ''}</div>
          <div style="margin-top:2px">월 평균 오차 <b class="${pm.mape < 5 ? 'good' : pm.mape >= 10 ? 'warn' : ''}">±${nf1.format(pm.mape)}%</b> <span class="hint">vs ${em}</span> → ${pm.neg ? '<span class="warn">마이너스 계수가 있어 목표는 자동 식으로 계산 (그 지표를 빼면 적용됨)</span>' : better ? '<span class="good">이 지표로 목표 계산</span>' : '<span class="warn">자동 식보다 덜 맞음 (그래도 고른 지표로 계산)</span>'}</div>` +
          (pm.warn.length ? `<div class="warn" style="margin-top:4px">${pm.warn.map(w => '⚠ ' + w).join('<br>')}</div>` : '<div class="good" style="margin-top:4px">✔ 계수 모두 플러스 · 지표끼리 겹침 없음</div>'); }
      return h + exploreHtml(uk, ctx, t, y, F) + (ctx === 'period' ? candReviewHtml(uk, t, y) : '') + '</div>';
    }
    // ---- 지표 자동 탐색: 쓸 수 있는 지표를 1~3개씩 모두 조합해 맞춰 보고 가장 잘 맞는 것만 남김 ----
    //  빼는 조합: 계수 마이너스(늘수록 덜 쓴다 = 말이 안 됨) · 지표끼리 r 0.8 넘게 겹침 · 기준 달이 (지표 수 + 3)개보다 적음
    //  순위: 교차검증 오차 = 기준 달을 하나씩 빼고 나머지로 식을 만들어 뺀 달을 맞혀 본 오차의 평균 (지표를 많이 넣어 우연히 맞는 걸 걸러냄)
    const EXPLORE = FACS_U;
    const exploreCache = {};
    function exploreModels(t, y, uk) {
      const base = baseFor(t, y, uk), key = uk + '|' + base.join(',') + '|' + (PRODD ? 1 : 0) + (TEMPS ? 1 : 0); if (exploreCache[key]) return exploreCache[key];
      const C = EXPLORE[uk], parts = base.map(ym => ({ ym, p: pickPart(ym, uk) })).filter(r => r.p && r.p.y > 0);
      const X = {}; C.forEach(f => { X[f] = parts.map(r => facOf(r.ym, f)); });
      const ok = v => v !== null && v !== undefined && !isNaN(v);
      const combos = []; for (let i = 0; i < C.length; i++) { combos.push([C[i]]); for (let j = i + 1; j < C.length; j++) { combos.push([C[i], C[j]]); for (let k = j + 1; k < C.length; k++) combos.push([C[i], C[j], C[k]]); } }
      const res = [], why = { neg: 0, overlap: 0, few: 0 };
      const fitC = F => { // 한 조합 맞춰 보기 → 결과 또는 { bad: 빠진 이유 }
        F.forEach(f => { if (!X[f]) X[f] = parts.map(r => facOf(r.ym, f)); });
        const idx = parts.map((r, i) => i).filter(i => F.every(f => ok(X[f][i])));
        if (idx.length < F.length + 3) return { bad: 'few' };
        const xs = idx.map(i => F.map(f => X[f][i])), ys = idx.map(i => parts[i].p.y), fx = idx.map(i => parts[i].p.fixed), al = idx.map(i => parts[i].p.all);
        for (let a = 0; a < F.length; a++) for (let b = a + 1; b < F.length; b++) { const pr = pearson(xs.map(x => x[a]), xs.map(x => x[b])); if (pr && Math.abs(pr.r) >= 0.8) return { bad: 'overlap', pair: [F[a], F[b]], r: pr.r }; }
        const c = UT.ols(xs, ys); if (!c || c.some(v => !(v > 0))) return { bad: 'neg' };
        const pred = x => x.reduce((s2, v, i) => s2 + c[i] * v, 0);
        const mape = idx.reduce((s2, _, i) => s2 + Math.abs(pred(xs[i]) + fx[i] - al[i]) / al[i], 0) / idx.length * 100;
        let cv = 0, cvn = 0; for (let o = 0; o < idx.length; o++) { const c2 = UT.ols(xs.filter((_, i) => i !== o), ys.filter((_, i) => i !== o)); if (!c2) continue; cv += Math.abs(xs[o].reduce((s2, v, i) => s2 + c2[i] * v, 0) + fx[o] - al[o]) / al[o]; cvn++; }
        if (!cvn) return { bad: 'few' };
        return { feats: F, coef: c, n: idx.length, from: parts[idx[0]].ym, to: parts[idx[idx.length - 1]].ym, mape, cv: cv / cvn * 100 };
      };
      combos.forEach(F => { const r = fitC(F); if (r.bad) why[r.bad]++; else res.push(r); });
      res.sort((a, b) => a.cv - b.cv);
      return (exploreCache[key] = { list: res, tried: combos.length, why, nBase: parts.length, cands: C, fitC });
    }
    function exploreHtml(uk, ctx, t, y, F) {
      const E = exploreModels(t, y, uk), top = E.list.slice(0, 5), ad = isAdmin(), U = PICK_U[uk], same = (a, b) => a.length === b.length && a.every(f => b.includes(f));
      const cf = v => Math.abs(v) >= 100 ? f0(v) : Number(v.toPrecision(3)).toLocaleString('ko-KR');
      let h = `<details class="explore" style="margin-top:8px" open><summary><b>🔍 지표 자동 탐색</b> <span class="hint">— 쓸 수 있는 지표 ${E.cands.length}개(${E.cands.map(facName).join(', ')})를 1~3개씩 ${E.tried}가지로 모두 맞춰 보고, 쓸 만한 ${E.list.length}개 중 상위 5개만 보여 줌</span> ${Portal.tip('explore')}</summary>`;
      if (!top.length) return h + `<div class="hint" style="margin-top:6px">쓸 수 있는 조합이 없습니다 (기준 달 ${E.nBase}개).</div></details>`;
      h += `<div class="tbl-wrap" style="margin-top:6px"><table class="t"><tr><th>순위</th><th class="l">${U.part} = 지표 × 계수</th><th>기준 달 오차<br><span class="hint">월 평균</span></th><th>교차검증 오차<br><span class="hint">안 쓴 달 맞히기 · 순위 기준</span></th><th>기준 달</th>${ad ? '<th></th>' : ''}</tr>` +
        top.map((m, i) => `<tr${same(m.feats, F) ? ' class="best"' : ''}><td>${i + 1}${i === 0 ? ' ★' : ''}</td><td class="l">${m.feats.map((f, j) => `${facName(f)} ${facUnit(f) ? facUnit(f) + '당 ' : ''}<b>${cf(m.coef[j])}</b>`).join(' + ')}</td><td>±${nf1.format(m.mape)}%</td><td><b>±${nf1.format(m.cv)}%</b></td><td>${m.n}개<br><span class="hint">${m.from.slice(2).replace('-', '.')}~${m.to.slice(2).replace('-', '.')}</span>${m.n < E.nBase ? '<br><span class="warn" title="이 지표 자료가 없는 달은 빼고 맞춤 — 달이 적으면 오차가 작게 나올 수 있음">달 적음</span>' : ''}</td>${ad ? `<td>${same(m.feats, F) ? '<span class="good">고름</span>' : `<button class="btn secondary small" onclick="pickSet('${uk}','${m.feats.join(',')}','${ctx}')">이걸로 고르기</button>`}</td>` : ''}</tr>`).join('') + '</table></div>' +
        (() => { // 지금 목표 식(직접 고른 지표, 없으면 자동 식)이 탐색에서 몇 위인지
          const cur = F.length ? F : (() => { const sp = lockSpec(fitModels(t, y, true)[uk], uk, t, y); return sp ? sp.feats.map(f => f === 'warmT:5' ? 'warm' : f) : null; })(); if (!cur || !cur.length) return '';
          const i = E.list.findIndex(m => same(m.feats, cur)); if (i >= 0 && i < 5) return `<div class="hint" style="margin-top:4px">지금 ${F.length ? '고른 지표' : '자동 식'}(${cur.map(facName).join(' · ')})는 위 ${i + 1}위입니다.</div>`;
          const r = i >= 0 ? E.list[i] : E.fitC(cur), nm = cur.map(facName).join(' · ');
          if (r.bad) return `<div class="hint" style="margin-top:4px">지금 ${F.length ? '고른 지표' : '자동 식'}(${nm})는 탐색에서 빠졌습니다 — ${r.bad === 'overlap' ? `${facName(r.pair[0])}·${facName(r.pair[1])}가 서로 r ${r.r.toFixed(2)}로 겹침` : r.bad === 'neg' ? '계수 마이너스' : '자료 있는 달 부족'}.</div>`;
          return `<div style="margin-top:6px;font-size:13px">비교: 지금 ${F.length ? '고른 지표' : '자동 식'} <b>${nm}</b> → 기준 달 오차 ±${nf1.format(r.mape)}% · <b>교차검증 오차 ±${nf1.format(r.cv)}%</b>${i >= 0 ? ` (탐색 ${i + 1}위)` : ''} <span class="hint">— 자동 식은 기준 달 오차가 가장 작은 식을 고르고, 탐색은 교차검증 오차로 순위를 매겨서 다를 수 있음 ${Portal.tip('explore')}</span></div>`; })() +
        `<div class="hint" style="margin-top:4px">뺀 조합: 계수 마이너스 ${E.why.neg}개 · 지표끼리 겹침(r≥0.8) ${E.why.overlap}개 · 자료 있는 달 부족 ${E.why.few}개. 「이걸로 고르기」를 누르기 전까지 목표 식은 바뀌지 않습니다.</div></details>`;
      return h;
    }
    // =====================================================================
    // 2단계 지표 분석 (한 화면): 지표 목록 → 추천 조합(1·2·3개) → 고른 조합 오차 → 「이 지표로 목표 세우기」
    //  전기 = 전체 사용량(파워플래너) · 가스 = 보일러(식당은 실측 그대로 더함) · 기준 달 = 목표·예산 ①의 기준 달
    // =====================================================================
    let indU = 'elec'; const indSel = { elec: null, gas: null };
    async function renderIndicators() {
      const el = document.getElementById('ind-body'); if (!el) return;
      const need = []; if (!PRODD) need.push(loadProdDaily().catch(() => {})); if (!TEMPS) need.push(loadTemps().catch(() => {}));
      if (need.length) { el.innerHTML = '<div class="loading">생산 실적·기온 불러오는 중...</div>'; await Promise.all(need); }
      const uk = indU, y = pickYear(), t = tgt(y), U = PICK_U[uk], ad = isAdmin(), I = stdInfo(uk), L = lockOf(t, uk);
      const parts = baseFor(t, y, uk).map(ym => ({ ym, p: pickPart(ym, uk) })).filter(r => r.p && r.p.y > 0), ok = v => v !== null && v !== undefined && !isNaN(v);
      const C = FACS_U[uk], E = exploreModels(t, y, uk), cur = I && I.feats ? I.feats.map(f => f === 'warmT:5' ? 'warm' : f) : [];
      if (!indSel[uk]) indSel[uk] = cur.length ? cur.slice() : (E.list[0] ? E.list[0].feats.slice() : []);
      const S0 = indSel[uk], same = (a, b) => a.length === b.length && a.every(f => b.includes(f));
      const cf = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
      const unitY = uk === 'elec' ? 'kWh' : 'MJ';
      // ① 지표 목록 (r = 기준 달 동안 사용량과 같이 움직이는 정도)
      const rOf = f => { const rs = parts.filter(r => ok(facOf(r.ym, f))); const pr = rs.length >= 4 ? pearson(rs.map(r => facOf(r.ym, f)), rs.map(r => r.p.y)) : null; return { r: pr ? pr.r : null, n: rs.length }; };
      const b = parts.map(r => r.ym);
      let h = `<div class="toolbar" style="margin-bottom:6px"><span class="chips">${[['elec', '전기'], ['gas', '가스']].map(([k, n]) => `<button class="chip ${uk === k ? 'on' : ''}" onclick="indU='${k}';renderIndicators()">${n}</button>`).join('')}</span>
        <span class="hint">${uk === 'elec' ? '<b>전기 전체 사용량</b>(파워플래너 · 생산동+폐수동+공조냉동 모두)' : '<b>보일러 가스</b>(식당 가스는 생산과 무관해 실측 그대로 더함)'}에 맞춤 · ${y}년 목표용 기준 달 ${b.length ? `${b[0].slice(2).replace('-', '.')} ~ ${b[b.length - 1].slice(2).replace('-', '.')} (${b.length}개월)` : '-'} (아래에서 바꿈)</span></div>`;
      // 기준 기간 (지표를 맞출 달) — 목표·예산 ①의 기준 달과 같은 값 · 확정되면 못 바꿈
      { const cands = []; for (let ym = UT.ym(y - 2, 1); ym <= lastCompleteYm(); ym = UT.nextYm(ym)) { const sx = S(ym); if (sx.production && sx.elec.usage) cands.push(ym); }
        const base = baseMonths(t, y), auto = !(Array.isArray(t.base) && t.base.length), lk = isLocked(t), ro = !ad || lk;
        h += `<div style="margin-bottom:8px"><b style="font-size:13px">기준 기간</b> <span class="hint">${auto ? '(자동: 마감된 최근 달 · 원육이 아주 적은 가동 초기 달 제외)' : '(직접 고름)'}${lk ? ' · 🔒 확정되어 바꿀 수 없음' : ro ? ' · 관리자만 바꿈' : ' · 눌러서 넣기/빼기'} ${Portal.tip('baseline')}</span>
          <div class="chips" style="margin-top:4px">${cands.map(ym => `<button class="chip ${base.includes(ym) ? 'on' : ''}" ${ro ? 'disabled' : `onclick="indBase('${ym}')"`}>${ym.slice(2).replace('-', '.')}</button>`).join('')}
          ${!ro && !auto ? '<button class="chip" onclick="indBase(null)">자동으로 되돌리기</button>' : ''}</div></div>`; }
      h += `<div class="hint" style="margin-bottom:8px">지금 ${y}년 목표에 쓰는 지표: <b>${cur.length ? cur.map(facName).join(' · ') : '-'}</b> <span class="std-src ${I ? I.src : ''}" style="font-size:12px">${L ? '🔒 확정' : I && I.src === 'pick' ? '직접 고름' : '추천 1위 자동 (확정 전)'}</span></div>`;
      // 하루 단위 r (생산한 날만, 기준 달 기간) — 월 단위 r과 같이 보고 판단
      const dU = PD_UTIL[uk], dRows = []; if (PRODD && b.length) { const d0 = UT.dateStr(b[0], 1), d1e = UT.dateStr(b[b.length - 1], UT.daysIn(b[b.length - 1])), yst = UT.addDays(todayStr, -1), d1 = d1e > yst ? yst : d1e;
        for (let ds = d0; ds <= d1; ds = UT.addDays(ds, 1)) { const r = pdRow(ds), v = dU.val(ds); if (!r.x.prod || v === null || v === undefined || isNaN(v)) continue; dRows.push({ r, v }); } }
      const dOf = f => { const m = pdMap(f); if (!m || m[0] === 'prod') return null; const rs = dRows.filter(o => ok(o.r.x[m[0]])); if (rs.length < 20) return { r: null, n: rs.length }; const pr = pearson(rs.map(o => o.r.x[m[0]]), rs.map(o => o.v)); return { r: pr ? pr.r : null, n: rs.length }; };
      const isWx = f => ['warm', 'hdd', 'hddOn'].includes(f) || /^(warm|cold)T:/.test(f), isDay = f => ['days', 'op', 'idle'].includes(f);
      const judge = f => { const m = rOf(f), d = dOf(f), mr = m.r, dr = d ? d.r : null; let v, c;
        if (mr === null) { v = '자료 부족'; c = 'hint'; }
        else if (f === 'days') { v = '하루 기본 몫 — r로 판단 안 함 (28~31일이라 변화가 작아 r이 낮게 나옴)'; c = ''; }
        else if (isDay(f)) { v = mr >= 0.5 ? '날수 지표 — 월 단위로만 판단' : '날수 지표 — 관계 약함'; c = mr >= 0.5 ? '' : 'hint'; }
        else if (dr === null) { v = mr >= 0.6 ? '월 단위로만 확인' : '관계 약함'; c = 'hint'; }
        else if (mr >= 0.6 && dr >= 0.3) { v = '⭐ 월·하루 모두 관계 있음'; c = 'good'; }
        else if (mr >= 0.6) { v = isWx(f) ? '기온 — 월 단위로 판단 (하루는 계절 차이가 안 보임)' : '월에서만 — 우연·계절 겹침일 수 있음'; c = isWx(f) ? '' : 'warn'; }
        else if (dr >= 0.3) { v = '하루엔 관계 있음 — 다른 지표와 같이 쓰면 효과'; c = ''; }
        else { v = '관계 약함'; c = 'hint'; }
        return { m, d, v, c, ok: v.startsWith('⭐') || f === 'days' || (isWx(f) && mr >= 0.6) || (isDay(f) && mr >= 0.5) || v.startsWith('하루엔') }; };
      const J = Object.fromEntries(C.map(f => [f, judge(f)]));
      const rc = r => r === null || r === undefined ? '-' : `<b style="color:${r >= 0.7 ? '#1d6b35' : r >= 0.4 ? '#8a5a00' : '#888'}">${r.toFixed(2)}</b>`;
      h += `<div class="ind-cols"><div><h4 style="margin:4px 0">① 쓸 수 있는 지표 <span class="hint">눌러서 넣기/빼기</span> ${Portal.tip('rday')}</h4><div class="tbl-wrap"><table class="t ind-tbl"><tr><th></th><th class="l">지표</th><th>월 r<br><span class="hint">점 = 한 달</span></th><th>하루 r<br><span class="hint">점 = 생산한 날</span></th><th class="l">판단</th></tr>` +
        C.map(f => { const j = J[f], on = S0.includes(f); return `<tr class="${on ? 'sel' : ''}" onclick="indToggle('${f}')" style="cursor:pointer"><td><input type="checkbox" class="ind-chk" ${on ? 'checked' : ''} tabindex="-1"></td><td class="l">${facName(f)} <span class="hint">${facUnit(f)}</span></td><td>${rc(j.m.r)}${j.m.n < b.length ? `<div class="hint">${j.m.n}달</div>` : ''}</td><td>${j.d ? rc(j.d.r) + `<div class="hint">${j.d.n}일</div>` : '<span class="hint">-</span>'}</td><td class="l ${j.c}" style="font-size:12px">${j.v}</td></tr>`; }).join('') + '</table></div></div>';
      // ② 추천 조합: 지표 1·2·3개 각각 교차검증 오차가 가장 작은 것
      const best = n => E.list.filter(m => m.feats.length === n).slice(0, 2);
      h += `<div><h4 style="margin:4px 0">② 추천 조합 <span class="hint">지표 ${C.length}개를 1·2·3개씩 모두 맞춰 봄 · 교차검증 오차 작은 순 · 눌러서 보기</span> ${Portal.tip('explore')}</h4><div class="tbl-wrap"><table class="t ind-rec"><tr><th>개수</th><th class="l">지표</th><th>월 오차</th><th>교차검증 오차</th><th>달</th></tr>` +
        [1, 2, 3].map(n => { const L2 = best(n); if (!L2.length) return `<tr><td>${n}개</td><td colspan="4" class="hint l">쓸 만한 조합 없음</td></tr>`;
          return L2.map((m, i) => `<tr class="${same(m.feats, S0) ? 'sel' : ''}" onclick="indSet('${m.feats.join(',')}')" style="${same(m.feats, S0) ? 'background:#eef4ff' : ''}"><td>${i === 0 ? `<b>${n}개</b>` : ''}</td><td class="l">${i === 0 ? '⭐ ' : ''}${m.feats.map(facName).join(' + ')}</td><td>±${nf1.format(m.mape)}%</td><td><b>±${nf1.format(m.cv)}%</b></td><td>${m.n}${m.n < b.length ? ' <span class="hint">적음</span>' : ''}</td></tr>`).join(''); }).join('') +
        `</table></div><div class="hint" style="margin-top:4px">빠지는 조합: 계수 마이너스(늘수록 덜 쓴다 — 말이 안 됨) · 지표끼리 r 0.8 넘게 겹침 · 자료 달 부족. 지표가 많을수록 월 오차는 줄지만 교차검증 오차(안 쓴 달 맞히기)가 커지면 우연히 맞은 것.</div></div></div>`;
      // ★ 종합 추천: 교차검증 오차 + 지표 신뢰도(월·하루 r) + 지표 수(적을수록 설명 쉬움)
      const pool = E.list.slice(0, 40).map(m => { const bad = m.feats.filter(f => !J[f] || !J[f].ok); return { m, bad, score: m.cv + bad.length * 2 + (m.feats.length - 1) * 0.3 + (m.n < b.length ? 1 : 0) }; }).sort((a2, b2) => a2.score - b2.score);
      const top = pool[0], bestCv = E.list[0] ? E.list[0].cv : null;
      if (top) { const m = top.m, why = [];
        why.push(`교차검증 오차 <b>±${nf1.format(m.cv)}%</b>${bestCv !== null && m !== E.list[0] ? ` (가장 작은 조합 ±${nf1.format(bestCv)}%와 ${nf1.format(m.cv - bestCv)}%p 차이)` : ' (전체 1위)'}`);
        why.push(top.bad.length ? `⚠ ${top.bad.map(facName).join(', ')}은 관계 확인이 약함` : `지표 ${m.feats.length}개 모두 관계 확인됨 (${m.feats.map(f => J[f].v.replace('⭐ ', '')).join(' / ')})`);
        why.push(m.feats.length <= 2 ? `지표 ${m.feats.length}개라 설명이 쉬움` : '지표 3개 — 각각 몫이 분명한지 ③에서 확인');
        if (m.n < b.length) why.push(`⚠ 자료가 ${m.n}개월뿐 — 연말 자료로 한 번 더 확인`);
        h += `<div class="ind-res" style="border-color:#9fd3ae;background:#f3fbf5"><b>★ 종합 추천: ${m.feats.map(facName).join(' + ')}</b> ${same(m.feats, S0) ? '<span class="good">(지금 보고 있음)</span>' : `<button class="btn secondary small" onclick="indSet('${m.feats.join(',')}')">이 조합 보기</button>`}
          <ul style="margin:4px 0 0 18px;padding:0;font-size:13px">${why.map(w => `<li>${w}</li>`).join('')}</ul><div class="hint" style="margin-top:2px">교차검증 오차가 가장 작은 조합을 기본으로, 관계 확인이 약한 지표가 들어 있거나 지표가 많으면 감점해서 고름 ${Portal.tip('indrec')}</div></div>`; }
      // ③ 고른 조합 결과
      h += `<div class="ind-res" id="ind-res">${indResultHtml(uk, S0, parts, I, L, ad, y)}</div>`;
      el.innerHTML = h;
      indChart(uk, S0, parts);
    }
    function indFit(uk, F, parts) {
      const ok = v => v !== null && v !== undefined && !isNaN(v), rs = parts.filter(r => F.every(f => ok(facOf(r.ym, f))));
      if (!F.length) return { err: '지표를 하나 이상 고르세요.' };
      if (rs.length < F.length + 3) return { err: `자료가 있는 달이 ${rs.length}개라 지표 ${F.length}개를 계산할 수 없습니다 (지표 수 + 3개월 이상 필요).`, rs };
      const xs = rs.map(r => F.map(f => facOf(r.ym, f))), ys = rs.map(r => r.p.y), c = UT.ols(xs, ys);
      if (!c) return { err: '계산이 안 됩니다 — 고른 지표끼리 완전히 똑같이 움직입니다. 하나를 빼 주세요.', rs };
      const pred = xs.map(x => x.reduce((a, v, i) => a + c[i] * v, 0));
      const mape = rs.reduce((a, r, i) => a + Math.abs(pred[i] + r.p.fixed - r.p.all) / r.p.all, 0) / rs.length * 100;
      let cv = 0, n = 0; for (let o = 0; o < rs.length; o++) { const c2 = UT.ols(xs.filter((_, i) => i !== o), ys.filter((_, i) => i !== o)); if (!c2) continue; cv += Math.abs(xs[o].reduce((a, v, i) => a + c2[i] * v, 0) + rs[o].p.fixed - rs[o].p.all) / rs[o].p.all; n++; }
      const warn = []; F.forEach((f, i) => { if (c[i] < 0) warn.push(`<b>${facName(f)}</b> 계수가 마이너스 — 「늘수록 덜 쓴다」는 뜻이라 목표에 쓰기 부적절`); });
      for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) { const pr = pearson(xs.map(x => x[i]), xs.map(x => x[j])); if (pr && Math.abs(pr.r) >= 0.8) warn.push(`<b>${facName(F[i])}</b>·<b>${facName(F[j])}</b> r ${pr.r.toFixed(2)} — 같이 움직여 몫이 갈리지 않음 (하나만 권장)`); }
      if (F.length > Math.max(1, Math.floor(rs.length / 3))) warn.push(`달 ${rs.length}개에 지표 ${F.length}개 — 지표가 많아 우연히 맞을 수 있음`);
      return { c, rs, pred, mape, cv: n ? cv / n * 100 : null, warn };
    }
    function indResultHtml(uk, F, parts, I, L, ad, y) {
      const R = indFit(uk, F, parts), U = PICK_U[uk], cf = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
      const cur = I && I.feats ? I.feats.map(f => f === 'warmT:5' ? 'warm' : f) : [], isCur = cur.length === F.length && cur.every(f => F.includes(f));
      let h = `<h4 style="margin:0 0 4px">③ 고른 지표: ${F.length ? F.map(facName).join(' + ') : '-'}</h4>`;
      if (R.err) return h + `<div class="warn">⚠ ${R.err}</div>`;
      h += `<div>${U.part} = ${F.map((f, i) => `${facName(f)} ${facUnit(f) ? facUnit(f) + '당 ' : '× '}<b>${cf(R.c[i])}</b>`).join(' + ')}${uk === 'gas' ? ' <span class="hint">+ 식당 가스(실측)</span>' : ''}</div>
        <div style="margin-top:4px">월 평균 오차 <b class="${R.mape < 5 ? 'good' : R.mape >= 10 ? 'warn' : ''}">±${nf1.format(R.mape)}%</b> · 교차검증 오차 <b>±${R.cv === null ? '-' : nf1.format(R.cv)}%</b> <span class="hint">(기준 달 ${R.rs.length}개 · ${Portal.tip('ols')})</span></div>` +
        (R.warn.length ? `<div class="warn" style="margin-top:4px">${R.warn.map(w => '⚠ ' + w).join('<br>')}</div>` : '<div class="good" style="margin-top:4px">✔ 계수 모두 플러스 · 지표끼리 겹침 없음</div>') +
        `<div class="chart-box" style="height:240px;margin-top:8px"><canvas id="chart-ind"></canvas></div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">` +
        (L ? `<span class="hint">🔒 ${y}년 목표 지표가 확정되어 있습니다 (${L.feats.map(facName).join(' · ')}). 바꾸려면 목표·예산 ①에서 「확정 풀기」.</span>`
          : isCur ? `<span class="good">✔ 지금 ${y}년 목표에 쓰는 지표입니다</span> <button class="btn secondary small" onclick="switchTab('target')">3단계 목표·예산 보기 →</button>`
          : ad ? `<button class="btn" onclick="indUse()">이 지표로 ${y}년 목표 세우기 →</button> <span class="hint">3단계 목표·예산의 예상 사용량·목표가 이 지표로 계산됩니다 (확정은 목표·예산에서)</span>` : '<span class="hint">목표 지표는 관리자만 바꿀 수 있습니다</span>') + '</div>';
      return h;
    }
    function indChart(uk, F, parts) {
      const R = indFit(uk, F, parts); if (R.err || !document.getElementById('chart-ind')) return;
      const labels = R.rs.map(r => r.ym.slice(2).replace('-', '.')), act = R.rs.map(r => r.p.all), pr = R.rs.map((r, i) => R.pred[i] + r.p.fixed);
      mkChart('chart-ind', { type: 'bar', data: { labels, datasets: [{ label: '실제', data: act, backgroundColor: uk === 'elec' ? '#2a78d6' : '#eb6834', order: 2 }, { type: 'line', label: '고른 지표로 계산', data: pr, borderColor: '#222', backgroundColor: '#222', pointRadius: 3, borderWidth: 2, order: 1 }] },
        options: baseOpts(uk === 'elec' ? 'kWh' : 'MJ') });
    }
    async function indBase(ym) { // 기준 기간 넣기/빼기 → 바로 저장 (목표·예산 ① 기준 달과 같은 값)
      const y = pickYear(); try { await freshYear(y); const t = JSON.parse(JSON.stringify(tgt(y))); if (isLocked(t)) return;
        if (ym === null) delete t.base; else { const cur = baseMonths(t, y); t.base = cur.includes(ym) ? cur.filter(x => x !== ym) : [...cur, ym].sort(); }
        await saveYear(y, { targets: t }); resetPickCache(); indSel.elec = null; indSel.gas = null; renderIndicators(); } catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    function indToggle(f) { const a = indSel[indU] || []; indSel[indU] = a.includes(f) ? a.filter(x => x !== f) : [...a, f]; renderIndicators(); }
    function indSet(fs) { indSel[indU] = fs.split(','); renderIndicators(); }
    async function indUse() { await pickSet(indU, indSel[indU].join(','), 'period'); }
    // ---- 🧪 후보 지표 검토: 목록에 없는 지표를 지금 기준 식에 하나씩 더해 보고 쓸만한지 판정 ----
    function candReviewHtml(uk, t, y) {
      const I = stdInfo(uk); if (!I || !I.feats) return '';
      const S0 = I.feats.map(f => f === 'warmT:5' ? 'warm' : f), list = CANDS[uk].filter(c => !FACS_U[uk].includes(c) && !S0.includes(c)), inList = facsExtra(uk), ad = isAdmin();
      const parts = baseFor(t, y, uk).map(ym => ({ ym, p: pickPart(ym, uk) })).filter(r => r.p && r.p.y > 0), ok = v => v !== null && v !== undefined && !isNaN(v);
      const val = (ym, f) => facOf(ym, f);
      const cvOf = (F, rs) => { const xs = rs.map(r => F.map(f => val(r.ym, f))), ys = rs.map(r => r.p.y); const c = UT.ols(xs, ys); if (!c) return null; let e = 0, n = 0;
        for (let o = 0; o < rs.length; o++) { const c2 = UT.ols(xs.filter((_, i) => i !== o), ys.filter((_, i) => i !== o)); if (!c2) continue; e += Math.abs(xs[o].reduce((a, v, i) => a + c2[i] * v, 0) + rs[o].p.fixed - rs[o].p.all) / rs[o].p.all; n++; }
        return n ? { c, cv: e / n * 100 } : null; };
      const res = list.concat(inList.filter(f => !list.includes(f))).map(f => {
        const rs = parts.filter(r => S0.concat([f]).every(g => ok(val(r.ym, g))));
        const o = { f, n: rs.length, extra: inList.includes(f) };
        if (rs.length < S0.length + 4) { o.v = `자료 부족 (${rs.length}개월)`; o.cls = 'hint'; return o; }
        const pr = pearson(rs.map(r => val(r.ym, f)), rs.map(r => r.p.y)); o.r = pr ? pr.r : null;
        const ov = S0.map(g => { const q = pearson(rs.map(r => val(r.ym, f)), rs.map(r => val(r.ym, g))); return q ? [g, q.r] : null; }).filter(Boolean).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
        const a = cvOf(S0, rs), b = cvOf(S0.concat([f]), rs); if (!a || !b) { o.v = '계산 안 됨'; o.cls = 'hint'; return o; }
        o.cv0 = a.cv; o.cv1 = b.cv; o.coef = b.c[b.c.length - 1];
        if (!(o.coef > 0)) { o.v = '관계 없음 (계수 마이너스)'; o.cls = 'bad'; }
        else if (ov && Math.abs(ov[1]) >= 0.8) { // 같이 쓰면 같은 정보를 두 번 세는 것 → 겹치는 지표 「대신」 써 보기
          const S1 = S0.map(g => g === ov[0] ? f : g), c2 = cvOf(S1, rs), pos = c2 && c2.c.every(v => v > 0);
          o.rep = c2 ? c2.cv : null; o.repOf = ov[0];
          if (pos && a.cv - c2.cv >= 0.3) { o.v = `⭐ 「${facName(ov[0])}」 대신 쓰면 오차 ±${nf1.format(a.cv)}% → ±${nf1.format(c2.cv)}% <span class="hint">(둘은 r ${ov[1].toFixed(2)}로 같이 움직여 함께는 못 씀)</span>`; o.cls = 'good'; o.star = true; o.cv1 = c2.cv; }
          else { o.v = `「${facName(ov[0])}」와 겹침 (r ${ov[1].toFixed(2)}) — 대신 써도 ${c2 ? (pos ? `±${nf1.format(c2.cv)}%로 나아지지 않음` : '계수 마이너스') : '계산 안 됨'}`; o.cls = 'warn'; } }
        else if (a.cv - b.cv >= 0.3) { o.v = `⭐ 쓸만함 — 오차 ${nf1.format(a.cv - b.cv)}%p 줄어듦`; o.cls = 'good'; o.star = true; }
        else { o.v = '더해도 도움 적음'; o.cls = 'hint'; }
        return o; }).sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || ((a.cv1 ?? 99) - (b.cv1 ?? 99)));
      if (!res.length) return '';
      return `<details class="explore" style="margin-top:8px"><summary><b>🧪 후보 지표 검토</b> <span class="hint">— 목록에 없는 지표 ${res.length}개를 지금 📐 기준 식(${S0.map(facName).join(' · ')})에 하나씩 더해 보고 쓸만한지 판정</span> ${Portal.tip('cand')}</summary>
        <div class="tbl-wrap" style="margin-top:6px"><table class="t"><tr><th class="l">지표</th><th>자료 있는 달</th><th>r<br><span class="hint">${PICK_U[uk].part}와</span></th><th>교차검증 오차<br><span class="hint">기준 식 → 더하면 (겹치면 대신 쓰면)</span></th><th class="l">판정</th>${ad ? '<th></th>' : ''}</tr>` +
        res.map(o => `<tr><td class="l">${facName(o.f)}</td><td>${o.n}개</td><td>${o.r === undefined || o.r === null ? '-' : o.r.toFixed(2)}</td><td>${o.cv0 === undefined ? '-' : `±${nf1.format(o.cv0)}% → <b>±${nf1.format(o.cv1)}%</b>`}</td><td class="l ${o.cls}">${o.v}</td>${ad ? `<td>${o.extra ? `<button class="chip" onclick="facsExtraSet('${uk}','${o.f}',false)">목록에서 빼기</button>` : `<button class="chip" onclick="facsExtraSet('${uk}','${o.f}',true)">목록에 넣기</button>`}</td>` : ''}</tr>`).join('') +
        `</table></div><div class="hint" style="margin-top:4px">「목록에 넣기」를 누르면 구성별 비교·지표 고르기·자동 탐색 목록에 같이 들어갑니다 (기준 식은 바뀌지 않음). 같은 달 자료로만 비교해서 「자료 있는 달」이 적으면 참고만.</div></details>`;
    }
    async function facsExtraSet(uk, f, on) {
      try { const { data, error } = await sb.from('ut_monthly').select('data').eq('ym', '9999-00').maybeSingle(); if (error) throw error;
        const cur = (data && data.data) || {}, fx = Object.assign({ elec: [], gas: [] }, cur.facsExtra || {}); fx[uk] = on ? [...new Set([...(fx[uk] || []), f])] : (fx[uk] || []).filter(x => x !== f);
        const nd = { ...cur, facsExtra: fx }; const r = await sb.from('ut_monthly').upsert({ ym: '9999-00', data: nd }, { onConflict: 'ym' }); if (r.error) throw r.error;
        YEARDATA[9999] = nd; resetPickCache(); renderIndicators(); } catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    async function pickSet(uk, feats, ctx) {
      const F = feats.split(',');
      if (ctx === 'target') { targetDraft.pick = Object.assign({}, targetDraft.pick || {}); targetDraft.pick[uk] = F; targetDirty = true; renderTargets(targetDraft); return; }
      const y = pickYear(); try { await freshYear(y); const t = JSON.parse(JSON.stringify(tgt(y))); t.pick = Object.assign({}, t.pick || {}); t.pick[uk] = F; await saveYear(y, { targets: t }); resetPickCache(); renderIndicators(); } catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    // 자동이 고른 지표 → 직접 고른 지표로 (온도 기준이 5℃가 아니면 그 온도 그대로)
    async function pickUseAuto(uk, ctx) {
      const y = ctx === 'target' ? targetY : pickYear(), t = ctx === 'target' ? targetDraft : tgt(y), m = fitModels(t, y, true)[uk], sp = lockSpec(m, uk, t, y);
      if (!sp) { alert('자동 식을 옮길 수 없습니다 (기준 달 부족 또는 예비 식).'); return; }
      if (ctx === 'target') { targetDraft.pick = Object.assign({}, targetDraft.pick || {}); targetDraft.pick[uk] = sp.feats; targetDirty = true; renderTargets(targetDraft); return; }
      try { await freshYear(y); const t2 = JSON.parse(JSON.stringify(tgt(y))); t2.pick = Object.assign({}, t2.pick || {}); t2.pick[uk] = sp.feats; await saveYear(y, { targets: t2 }); resetPickCache(); renderIndicators(); } catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    async function pickToggle(uk, f, ctx) {
      if (ctx === 'target') { const cur = pickOf(targetDraft, uk) || []; targetDraft.pick = Object.assign({}, targetDraft.pick || {}); targetDraft.pick[uk] = cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f]; targetDirty = true; renderTargets(targetDraft); return; }
      const y = pickYear(); try { await freshYear(y); } catch (e) { alert('불러오기 실패: ' + errMsg(e)); return; }
      const t = JSON.parse(JSON.stringify(tgt(y))), cur = pickOf(t, uk) || [];
      t.pick = Object.assign({}, t.pick || {}); t.pick[uk] = cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f];
      try { await saveYear(y, { targets: t }); resetPickCache(); renderIndicators(); } catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    async function pickClear(uk, ctx) {
      if (ctx === 'target') { targetDraft.pick = Object.assign({}, targetDraft.pick || {}); delete targetDraft.pick[uk]; targetDirty = true; renderTargets(targetDraft); return; }
      const y = pickYear(); try { await freshYear(y); } catch (e) { alert('불러오기 실패: ' + errMsg(e)); return; }
      const t = JSON.parse(JSON.stringify(tgt(y))); t.pick = Object.assign({}, t.pick || {}); delete t.pick[uk];
      try { await saveYear(y, { targets: t }); resetPickCache(); renderIndicators(); } catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }

    // ---- KPI 지표 검토: 원육 kg당 등 「사용량 ÷ 무엇」이 관리 지표로 맞는지 ----
    async function renderKpiReview(t, y) {
      const el = document.getElementById('tg-kpi'); if (!el) return;
      if (!PRODD) { try { await loadProdDaily(); } catch (e) { } }
      const months = baseMonths(t, y).filter(ym => S(ym).production);
      const DEN = [['prod', '원육 kg'], ['pkg', '완제품 kg'], ['ea', '포장 1,000EA'], ['op', '생산일 1일']];
      const U = [['elec', '전기', 'kWh', ym => S(ym).elec.usage], ['gas', '가스', 'MJ', ym => S(ym).gas.usage]];
      const sd = a => { const m = a.reduce((x, v) => x + v, 0) / a.length; return Math.sqrt(a.reduce((x, v) => x + (v - m) ** 2, 0) / a.length) / m * 100; };
      let h = `<div class="story">「사용량 ÷ 무엇」을 KPI로 쓰려면 ① 사용량과 같이 움직여야 하고(r 높음) ② 매달 원단위가 덜 흔들려야 하며 ③ 고정분이 작아야 합니다 (고정분이 크면 생산이 늘기만 해도 원단위가 저절로 좋아짐). 기준 달 ${months.length}개 (목표 ① 기준 달) 로 계산했습니다.</div>`;
      const concl = [];
      U.forEach(([uk, un, unit, gv]) => {
        const res = DEN.map(([f, n]) => { const p = months.map(ym => { const x = f === 'prod' ? S(ym).production : facOf(ym, f), yv = gv(ym); return x && yv ? [f === 'ea' ? x / 1000 : x, yv] : null; }).filter(Boolean);
          if (p.length < 4) return { f, n, k: p.length };
          const xs = p.map(a => a[0]), ys = p.map(a => a[1]), pr = pearson(xs, ys), uv = p.map(a => a[1] / a[0]), mean = ys.reduce((a, b) => a + b, 0) / ys.length, bias = pearson(xs, uv);
          return { f, n, k: p.length, r: pr ? pr.r : null, cv: sd(uv), fix: pr ? Math.max(0, pr.a) / mean * 100 : null, bias: bias ? bias.r : null, uv: uv.reduce((a, b) => a + b, 0) / uv.length }; });
        const ok = res.filter(x => x.r !== undefined && x.r !== null && x.r >= 0.6), best = ok.length ? ok.reduce((a, b) => b.cv < a.cv ? b : a) : null;
        h += `<h4 style="margin:10px 0 4px">${un} <span class="hint">(${unit} · 전체 사용량 기준)</span></h4><div class="tbl-wrap"><table class="t kpi-tbl"><tr><th class="l">지표 (사용량 ÷ …)</th><th>평균 원단위</th><th>같이 움직임 (r)</th><th>원단위 흔들림<br><span class="hint">달마다 ±%</span></th><th>고정분 비율<br><span class="hint">생산과 무관하게 쓰는 몫</span></th><th>생산 많을수록 원단위<br><span class="hint">r (마이너스면 저절로 좋아짐)</span></th></tr>` +
          res.map(x => x.r === undefined ? `<tr><td class="l">${x.n}</td><td colspan="5" class="hint">자료 ${x.k}개월 — 계산 못 함${PICK_PROD[x.f] && !PRODD ? ' (생산 대시보드 자료 없음)' : ''}</td></tr>` :
            `<tr><td class="l ${best && best.f === x.f ? 'best' : ''}">${x.n}${best && best.f === x.f ? ' ★' : ''}${x.f === 'prod' ? ' <span class="hint">(지금 KPI)</span>' : ''}</td><td>${x.uv >= 100 ? f0(x.uv) : nf2.format(x.uv)} ${unit}</td><td class="${x.r < 0.6 ? 'bad' : ''}">${x.r === null ? '-' : x.r.toFixed(2)}</td><td class="${best && best.f === x.f ? 'best' : ''}">±${nf1.format(x.cv)}%</td><td class="${x.fix >= 30 ? 'bad' : ''}">${x.fix === null ? '-' : nf0.format(x.fix) + '%'}</td><td class="${x.bias !== null && x.bias <= -0.5 ? 'bad' : ''}">${x.bias === null ? '-' : x.bias.toFixed(2)}</td></tr>`).join('') + '</table></div>';
        const cur = res.find(x => x.f === 'prod');
        if (best) concl.push(`<b>${un}</b>: 원단위가 가장 덜 흔들리는 건 <b>${best.n}당</b> (±${nf1.format(best.cv)}%)${cur && cur.cv !== undefined && best.f !== 'prod' ? ` — 지금 KPI(원육 kg당 ±${nf1.format(cur.cv)}%)보다 안정적` : best.f === 'prod' ? ' — 지금 KPI(원육 kg당)가 가장 적합' : ''}.` +
          (best.fix >= 30 ? ` 다만 고정분이 ${nf0.format(best.fix)}%라 생산이 늘면 원단위가 저절로 좋아지고 줄면 나빠집니다 → <b>원단위 자체를 목표로 하기보다 「예상 사용량 대비 절감률」(아래 ①②)로 목표를 세우고, 원단위는 결과로 같이 보고</b>하는 걸 권장합니다.` : ` 고정분이 ${nf0.format(best.fix)}%로 작아 원단위를 그대로 목표로 써도 무리가 적습니다.`));
        else concl.push(`<b>${un}</b>: r 0.6 넘게 같이 움직이는 지표가 없습니다 — 생산량보다 날씨·기본 부하 영향이 큰 편이라 원단위 KPI는 맞지 않고, 예상 사용량 대비 절감률로 보는 게 맞습니다.`);
      });
      h += `<div class="kpi-con">${concl.join('<br>')}</div><div class="hint" style="margin-top:6px">· 원단위 흔들림 = 달마다 (사용량 ÷ 지표) 값의 표준편차 ÷ 평균 · 고정분 비율 = 사용량을 「고정 + 지표 × 계수」 직선으로 맞췄을 때 고정 몫 ÷ 평균 사용량 · 완제품 kg = 포장 EA × 제품 1개 중량 (원인 찾기 → 생산 일별 요약과 비교 → 「제품 1개 중량」 표) · 달이 적어(6~9개월) 참고용입니다.</div>`;
      el.innerHTML = h;
    }
    function toggleExcl(uk, ym) {
      const cur = exclOf(targetDraft, uk); targetDraft.excl = Object.assign({}, targetDraft.excl || {});
      targetDraft.excl[uk] = cur.includes(ym) ? cur.filter(x => x !== ym) : [...cur, ym].sort();
      targetDirty = true; renderTargets(targetDraft);
    }
    // ---- 전기: 휴무일 실측 기준선 + 생산일·원육 ----
    //  한 달 전기 = 휴무일 기본(하루 a × 날수) + 기온 영향(휴무일 식으로 날마다 계산해 합) + 생산일 × B + 원육 kg × C
    function idlePoints(months) {
      const pts = [], wwPerDay = {};
      months.forEach(ym => { const w = wwKwh(ym), h = meterKwh(ym, 'elec_hvac_kwh'); if (w !== null && h !== null) wwPerDay[ym] = (w + h) / UT.daysIn(ym); }); // 폐수동·공조냉동은 계량기로 따로 재므로 뺌
      months.filter(ym => ym in wwPerDay).forEach(ym => { for (let d = 1; d <= UT.daysIn(ym); d++) { const ds = UT.dateStr(ym, d), u = UT.dailyUsage(DAILY, ds), tt = (TEMPS || {})[ds];
        if (u.gas !== null && u.gas <= 50 && u.elec > 0 && tt !== undefined && tt !== null) pts.push({ d: ds, t: tt, v: u.elec - (wwPerDay[ym] || 0) - equipDay(ds, ['생산동', '기타']) }); } });
      return pts;
    }
    function wxOf(ym, idle) { // 그 달 기온 영향 합 (kWh) — 기온 기록 없는 날은 그 달 평균(없으면 평년) 기온
      const w = UT.monthWeather(ym, TEMPS || {}); let tm = w.tmean, guess = false;
      if (tm === null) { const nm = normals()[Number(ym.slice(5))]; tm = nm ? nm.tmean : null; guess = true; }
      if (tm === null || tm === undefined) return { wx: null, guess: true, tmean: null };
      let sum = 0; for (let d = 1; d <= UT.daysIn(ym); d++) { const tt = (TEMPS || {})[UT.dateStr(ym, d)]; sum += idle.ext(tt === undefined || tt === null ? tm : tt); }
      return { wx: sum, guess, tmean: tm };
    }
    // 목표 ①: 휴무일 전기 근거 (달별 휴무일 평균, 뺀 날)
    function idleDetail(idle) {
      const fc = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
      const by = {}; idle.pts.forEach(p => { (by[p.d.slice(0, 7)] = by[p.d.slice(0, 7)] || []).push(p); });
      const ex = new Set(idle.excluded.map(p => p.d));
      let t = `<table class="t tg-why"><tr><th class="l">달</th><th>휴무일<br><span class="hint">보일러 안 돈 날</span></th><th>평균기온</th><th>휴무일 평균 전기 (kWh/일)<br><span class="hint">폐수동·공조냉동·부하 변동분 제외</span></th><th>식으로 계산 (kWh/일)</th><th class="l">뺀 날 (예상과 ±20% 넘게 다름)</th></tr>`;
      Object.keys(by).sort().forEach(ym => { const l = by[ym].filter(p => !ex.has(p.d)), x = by[ym].filter(p => ex.has(p.d));
        const av = a => a.reduce((s, v) => s + v, 0) / a.length;
        t += `<tr><td class="l">${ym.slice(2).replace('-', '.')}</td><td>${l.length}일</td><td>${l.length ? nf1.format(av(l.map(p => p.t))) + '℃' : '-'}</td><td>${l.length ? f0(av(l.map(p => p.v))) : '-'}</td><td>${l.length ? f0(av(l.map(p => idle.base(p.t)))) : '-'}</td>
          <td class="l hint">${x.map(p => `${Number(p.d.slice(5, 7))}/${Number(p.d.slice(8))} ${f0(p.v)}kWh`).join(', ')}</td></tr>`; });
      t += '</table>';
      return `<details class="tg-whyd"><summary>전기 — 휴무일(생산 없는 날) 기준 보기 · ${idle.n}일 · 오차 ±${nf1.format(idle.mape)}%</summary>
        <div class="hint" style="margin:6px 0">보일러 가스를 안 쓴 날(생산 없는 날)의 하루 전기 사용량(폐수동·공조냉동은 계량기로 따로 재므로 빼고)으로 <b>매일 기본으로 도는 전기(계량기 없는 냉장창고 실외기·조명·사무실 등)</b>를 잡았습니다.
        ${idle.b || idle.c ? `기온이 오를수록 실외기 부하가 커져 더 쓰기 때문에 <b>하루 기본 ${fc(idle.a)} kWh + 평균기온 ${idle.Tb}℃ 넘는 1℃마다 ${fc(idle.b)} kWh${idle.c ? ` + ${idle.Tc}℃ 아래 1℃마다 ${fc(idle.c)} kWh` : ''}</b> 식으로 맞췄고,` : `공조냉동을 빼고 나니 기온과 관계없이 거의 일정해서 <b>하루 기본 ${fc(idle.a)} kWh</b>(평균)로 잡았고 (기온 영향은 공조냉동 실측에 들어 있음),`}
        공사·특이사항 등으로 예상과 20% 넘게 다른 날은 빼고 계산했습니다. 이 식으로 그 달 모든 날(생산일 포함)의 기본+기온 몫을 더하고, 나머지를 생산일 수와 원육 투입량으로 나눴습니다.</div>${t}</details>`;
    }
    function wwDetail(W, months) {
      const fc = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
      let t = `<table class="t tg-why"><tr><th class="l">달</th><th>날수 × ${fc(W.a)}</th><th>터보블로워<br><span class="hint">운전 이력</span></th><th>방류량(㎥) × ${fc(W.b)}</th>${W.useS ? `<th>슬러지 처리(kg) × ${fc(W.c)}</th>` : ''}<th>식으로 계산</th><th>폐수동 실측</th><th>차이</th></tr>`;
      months.map(wwRow).filter(r => r.kwh !== null && r.flow !== null).forEach(r => { const p = W.pred(r);
        t += `<tr><td class="l">${r.ym.slice(2).replace('-', '.')}</td><td>${r.days}<br><span class="hint">→ ${f0(W.a * r.days)}</span></td><td>${f0(r.blower / r.days)}/일<br><span class="hint">→ ${f0(r.blower)}</span></td><td>${f0(r.flow)}<br><span class="hint">→ ${f0(W.b * r.flow)}</span></td>${W.useS ? `<td>${f0(r.sludge)}<br><span class="hint">→ ${f0(W.c * (r.sludge || 0))}</span></td>` : ''}<td><b>${f0(p)}</b></td><td>${f0(r.kwh)}</td><td>${(p / r.kwh - 1) * 100 >= 0 ? '+' : ''}${nf1.format((p / r.kwh - 1) * 100)}%</td></tr>`; });
      t += '</table>';
      return `<details class="tg-whyd"><summary>폐수동 전력 — 터보블로워·방류량·슬러지로 나눠 보기 · 오차 ±${nf1.format(W.mape)}%</summary>
        <div class="hint" style="margin:6px 0">폐수동 계량기 값 = <b>날마다 도는 기본 ${fc(W.a)} kWh/일</b> + <b>터보블로워 (설비 운전 이력의 kW × 하루 가동시간)</b> + <b>방류량 1㎥당 ${fc(W.b)} kWh</b>${W.useS ? ` + <b>슬러지 처리 1kg당 ${fc(W.c)} kWh</b> (다온산업 장부)` : ''}. 블로워는 이력 값을 그대로 쓰고, 나머지 계수는 실측에 가장 잘 맞게 계산했습니다.</div>${t}</details>`;
    }
    // ---- 전기 (2026.10 개선): 공조냉동·폐수동은 계량기 실측 그대로, 나머지(생산동·조명·사무실 등)만 식으로 ----
    //  생산동 전기 = 하루 기본 A × 달력 날수 + 원육 1kg당 C × 원육 투입량
    //  · 생산일은 넣지 않음 (생산일이 늘면 원육도 같이 늘어 같은 몫을 두 번 세게 됨)
    //  · 공조냉동 계량기가 찍힌 2026년 3월부터 씀 (자숙1~3 전력계는 3/17부터지만 그 전엔 추워서 자숙실 냉방을 안 켬)
    //  · 생산동에도 계량기 없는 냉방(칠러·실외기 등)이 있어 기온 몫을 따로 둠: 하루 평균기온이 Tb℃ 넘는 만큼 × 계수 (Tb는 가장 잘 맞는 값)
    const HVAC_FULL_FROM = '2026-03';
    function warmSum(ym, Tb) { // 그 달 Σ max(0, 하루 평균기온 − Tb) · 기온 기록 없는 날은 그 달 평균(없으면 평년)
      const w = UT.monthWeather(ym, TEMPS || {}); let tm = w.tmean; if (tm === null) { const nm = normals()[Number(ym.slice(5))]; tm = nm ? nm.tmean : null; }
      if (tm === null || tm === undefined) return null;
      let s = 0; for (let d = 1; d <= UT.daysIn(ym); d++) { const t = (TEMPS || {})[UT.dateStr(ym, d)]; s += Math.max(0, (t === undefined || t === null ? tm : t) - Tb); } return s;
    }
    function coldSum(ym, Tc) { // 그 달 Σ max(0, Tc − 하루 평균기온)
      const w = UT.monthWeather(ym, TEMPS || {}); let tm = w.tmean; if (tm === null) { const nm = normals()[Number(ym.slice(5))]; tm = nm ? nm.tmean : null; }
      if (tm === null || tm === undefined) return null;
      let s2 = 0; for (let d = 1; d <= UT.daysIn(ym); d++) { const t = (TEMPS || {})[UT.dateStr(ym, d)]; s2 += Math.max(0, Tc - (t === undefined || t === null ? tm : t)); } return s2;
    }
    // ---- 가스: 보일러 스팀(자숙탱크·레토르트)만 식으로, 식당 가스(기숙사·통제 밖)는 실측 그대로 ----
    //  보일러 = 생산일 × B + 원육 × C (+ 난방도일 × H — 넣어서 오차가 0.5%p 넘게 줄고 계수가 0 이상일 때만)
    function gasRestMJ(r, avgPerDay) { const s2 = r.ym ? S(r.ym) : null, g = s2 && s2.gas.calc; if (g && s2.gas.usage !== null) return g.rest ? g.rest.mj || 0 : 0; return avgPerDay === null ? null : avgPerDay * (r.days || 30); }
    function fitGasBoiler(months) {
      const rows = months.map(monthRow).filter(r => r.gas !== null && r.gas !== undefined && r.op && r.prod && S(r.ym).gas.calc);
      if (rows.length < 4) return null;
      rows.forEach(r => { r.grest = gasRestMJ(r, null) || 0; });
      const avgRest = rows.reduce((a, r) => a + r.grest, 0) / Math.max(1, rows.reduce((a, r) => a + r.days, 0));
      const by = rows.map(r => r.gas - r.grest);
      const err = (X, c) => rows.reduce((a, r, i) => a + Math.abs(X[i].reduce((s2, x, j) => s2 + x * c[j], 0) - by[i]) / (by[i] || 1), 0) / rows.length;
      // 후보: 원육만 / 생산일만 / 둘 다 × 난방도일 넣음·뺌 — 오차가 가장 작은 것 (요인을 더 넣는 식은 0.5%p 이상 좋아야 채택)
      let best = null;
      [['prod'], ['op'], ['op', 'prod']].forEach(base => [false, true].forEach(h => { const feats = h ? base.concat(['hdd']) : base;
        if (h && rows.some(r => r.hdd === null)) return; const X = rows.map(r => feats.map(f => r[f])), c = UT.ols(X, by); if (!c || c.some(v => v < 0)) return;
        const sc = err(X, c) + 0.005 * (feats.length - 1); if (!best || sc < best.sc) best = { feats, c, e: err(X, c), sc }; }));
      if (!best) return null;
      const F = best.feats.concat(['grest']), coef = best.c.concat([1]);
      const prep = r => { if (r.grest === undefined) r.grest = gasRestMJ(r, avgRest); return r; };
      const pred = r => F.reduce((a, f, i) => a + coef[i] * r[f], 0);
      rows.forEach(prep);
      const ys = rows.map(r => r.gas), mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      const ssr = rows.reduce((a, r) => a + (r.gas - pred(r)) ** 2, 0), sst = ys.reduce((a, v) => a + (v - mean) ** 2, 0);
      return { gasBoiler: true, feats: F, coef, n: rows.length, r2: sst ? 1 - ssr / sst : null, hdd: best.feats.includes('hdd'),
        mape: rows.reduce((a, r) => a + Math.abs(pred(r) - r.gas) / r.gas, 0) / rows.length * 100, boilerMape: best.e * 100, prep,
        predict: r => { prep(r); return F.every(f => r[f] !== null && r[f] !== undefined) ? Math.max(0, pred(r)) : null; } };
    }
    function fitElecHall(months) {
      const prep = r => {
        if (r.ym && r.wwk === undefined) { r.wwk = wwKwh(r.ym); r.hvk = meterKwh(r.ym, 'elec_hvac_kwh'); r.eq = equipKwh(r.ym, ['생산동', '기타']); }
        if (r.ym && r.tmean === undefined) r.tmean = UT.monthWeather(r.ym, TEMPS || {}).tmean;
        return r;
      };
      const rows = months.filter(ym => ym >= HVAC_FULL_FROM).map(ym => prep(monthRow(ym))).filter(r => r.elec !== null && r.elec !== undefined && r.prod && r.wwk !== null && r.hvk !== null);
      if (rows.length < 4) return null;
      const hall = rows.map(r => r.elec - r.wwk - r.hvk - r.eq);
      const err = f => rows.reduce((a, r, i) => a + Math.abs(f(r) - hall[i]) / hall[i], 0) / rows.length;
      let A = 0, C = 0, W = 0, Tb = null; const co = UT.ols(rows.map(r => [r.days, r.prod]), hall);
      if (co && co[0] >= 0 && co[1] >= 0) { A = co[0]; C = co[1]; }
      else { const a1 = UT.ols(rows.map(r => [r.days]), hall); A = a1 ? Math.max(0, a1[0]) : 0; }
      // 기온 몫: 넣어서 오차가 0.3%p 넘게 줄면 씀 (계수는 모두 0 이상)
      if (rows.length >= 5) { let best = err(r => A * r.days + C * r.prod) - 0.003;
        for (let tb = 5; tb <= 22; tb++) { const ws = rows.map(r => warmSum(r.ym, tb)); if (ws.some(v => v === null)) continue;
          const c3 = UT.ols(rows.map((r, i) => [r.days, r.prod, ws[i]]), hall); if (!c3 || c3.some(v => v < 0)) continue;
          const e = rows.reduce((a, r, i) => a + Math.abs(c3[0] * r.days + c3[1] * r.prod + c3[2] * ws[i] - hall[i]) / hall[i], 0) / rows.length;
          if (e < best) { best = e; A = c3[0]; C = c3[1]; W = c3[2]; Tb = tb; } } }
      // 추운 몫 (현장 온수 = 전기보일러, 계량기 없음): 추운 달이 2개 이상 기준에 있을 때만, 넣어서 오차가 0.3%p 넘게 줄면 씀
      let K = 0, Tc = null;
      if (rows.length >= 5) { let best = err(r => A * r.days + C * r.prod + (Tb === null ? 0 : W * warmSum(r.ym, Tb))) - 0.003;
        const wsB = rows.map(r => Tb === null ? 0 : warmSum(r.ym, Tb));
        for (let tc = 0; tc <= Math.min(Tb === null ? 18 : Tb, 18); tc++) { const cs = rows.map(r => coldSum(r.ym, tc)); if (cs.some(v => v === null) || cs.filter(v => v >= 50).length < 2) continue;
          const X = rows.map((r, i) => Tb === null ? [r.days, r.prod, cs[i]] : [r.days, r.prod, wsB[i], cs[i]]), c4 = UT.ols(X, hall); if (!c4 || c4.some(v => v < 0)) continue;
          const e = rows.reduce((a, r, i) => a + Math.abs(X[i].reduce((s2, x, j) => s2 + x * c4[j], 0) - hall[i]) / hall[i], 0) / rows.length;
          if (e < best) { best = e; A = c4[0]; C = c4[1]; if (Tb !== null) W = c4[2]; K = c4[c4.length - 1]; Tc = tc; } } }
      const prep0 = prep, prepT = r => { prep0(r); if (r.ym && r.wx === undefined) r.wx = Tb === null ? 0 : warmSum(r.ym, Tb); if (r.ym && r.cx === undefined) r.cx = Tc === null ? 0 : coldSum(r.ym, Tc); return r; };
      rows.forEach(prepT);
      const F = ['days', 'prod', 'wx', 'cx', 'wwk', 'hvk', 'eq'];
      const pred = r => A * r.days + C * r.prod + W * r.wx + K * r.cx + r.wwk + r.hvk + r.eq;
      const ys = rows.map(r => r.elec), mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      const ssr = rows.reduce((a, r) => a + (r.elec - pred(r)) ** 2, 0), sst = ys.reduce((a, v) => a + (v - mean) ** 2, 0);
      const hp = r => A * r.days + C * r.prod + W * r.wx + K * r.cx;
      const hm = hall.reduce((a, b) => a + b, 0) / hall.length, hsr = rows.reduce((a, r, i) => a + (hall[i] - hp(r)) ** 2, 0), hst = hall.reduce((a, v) => a + (v - hm) ** 2, 0);
      const coldMonths = rows.filter(r => coldSum(r.ym, 10) >= 50).length;
      return { hall: true, feats: F, coef: [A, C, W, K, 1, 1, 1], Tb, Tc, coldMonths, n: rows.length, months: rows.map(r => r.ym), r2: sst ? 1 - ssr / sst : null, hallR2: hst ? 1 - hsr / hst : null,
        mape: rows.reduce((a, r) => a + Math.abs(pred(r) - r.elec) / r.elec, 0) / rows.length * 100,
        hallMape: rows.reduce((a, r, i) => a + Math.abs(hp(r) - hall[i]) / hall[i], 0) / rows.length * 100,
        prep: prepT, ww: fitWW(months),
        predict: r => { prepT(r); return F.every(f => r[f] !== null && r[f] !== undefined) ? Math.max(0, pred(r)) : null; } };
    }
    function fitElecIdle(months) {
      const idle = UT.fitIdleBase(idlePoints(months)); if (!idle) return null;
      const prep = r => {
        if (r.ym && r.wwk === undefined) { r.wwk = wwKwh(r.ym); r.hvk = meterKwh(r.ym, 'elec_hvac_kwh'); r.eq = equipKwh(r.ym, ['생산동', '기타']); }
        if (r.wx === undefined && r.ym) { const o = wxOf(r.ym, idle); r.wx = o.wx; r.tmean = o.tmean; if (o.guess) r.wxGuess = true; }
        return r;
      };
      const rows = months.map(ym => prep(monthRow(ym))).filter(r => r.elec !== null && r.elec !== undefined && r.op !== null && r.prod && r.wx !== null && r.wwk !== null && r.hvk !== null);
      if (rows.length < 4) return null;
      const ex = rows.map(r => r.elec - r.wwk - r.hvk - r.eq - idle.a * r.days - r.wx);
      let B = 0, C = 0, co = UT.ols(rows.map(r => [r.op, r.prod]), ex);
      if (co && co[0] >= 0 && co[1] >= 0) { B = co[0]; C = co[1]; }
      else { const b1 = UT.ols(rows.map(r => [r.op]), ex), c1 = UT.ols(rows.map(r => [r.prod]), ex);
        const e = f => rows.reduce((a, r, i) => a + (ex[i] - f(r)) ** 2, 0);
        if (b1 && (!c1 || e(r => b1[0] * r.op) <= e(r => c1[0] * r.prod))) B = Math.max(0, b1[0]); else if (c1) C = Math.max(0, c1[0]); }
      const F = ['days', 'op', 'prod', 'wx', 'wwk', 'hvk', 'eq'];
      const pred = r => idle.a * r.days + r.wx + B * r.op + C * r.prod + r.wwk + r.hvk + r.eq;
      const ys = rows.map(r => r.elec), mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      const ssr = rows.reduce((a, r) => a + (r.elec - pred(r)) ** 2, 0), sst = ys.reduce((a, v) => a + (v - mean) ** 2, 0);
      return { idle, feats: F, coef: [idle.a, B, C, 1, 1, 1, 1], n: rows.length, r2: sst ? 1 - ssr / sst : null,
        mape: rows.reduce((a, r) => a + Math.abs(pred(r) - r.elec) / r.elec, 0) / rows.length * 100, prep, ww: fitWW(months),
        predict: r => { prep(r); return F.every(f => r[f] !== null && r[f] !== undefined) ? Math.max(0, pred(r)) : null; } };
    }

    // =====================================================================
    // 설비 운전 이력 (부하 변경) — 구역·설비별로 '이 날부터 하루 몇 kW × 몇 시간'
    //  저장: 연 설정 9999-00 의 equip
    // =====================================================================
    const EQ_DEFAULT = [
      { d: '2026-06-04', area: '폐수동', name: '터보블로워', kw: 11.2, hours: 16, note: '배관 분리, 2대 모두 20분 가동·40분 정지' },
      { d: '2026-07-14', area: '폐수동', name: '터보블로워', kw: 11.2, hours: 24, note: '자동밸브 설치, 1대 24시간 (집수·유량조·슬러지저류조 24시간, 폭기조 밸브로 10분/50분)' }
    ];
    const equipList = () => { const e = (YEARDATA[9999] || {}).equip; return Array.isArray(e) ? e : EQ_DEFAULT; };
    // 그 날 그 설비의 하루 전력 (가장 최근 이력)
    function equipDay(ds, areas) {
      const by = {};
      equipList().filter(x => x.d <= ds && (!areas || areas.includes(x.area))).sort((a, b) => a.d < b.d ? -1 : 1).forEach(x => { by[x.area + '|' + x.name] = x; });
      return Object.values(by).reduce((a, x) => a + (Number(x.kw) || 0) * (Number(x.hours) || 0), 0);
    }
    function equipKwh(ym, areas) { let s = 0; for (let d = 1; d <= UT.daysIn(ym); d++) s += equipDay(UT.dateStr(ym, d), areas); return s; }

    // ---- 폐수동 전력: 기본(날수) + 블로워(운전 이력) + 방류량 + 슬러지 처리량 ----
    let WWD = null; // 다온산업 장부 { d: {sludge_out, sludge_gen} }
    let WWNOTE = []; // 환경일지 · 폐수장 특이사항 (env_settings.wwnote)
    async function loadWWD() { if (WWD) return; try { const { data } = await sb.from('env_settings').select('value').eq('key', 'wwnote').maybeSingle(); WWNOTE = ((data && data.value && data.value.notes) || []).slice().sort((a, b) => a.d < b.d ? -1 : 1); } catch (e) { WWNOTE = []; }
      try { const rows = await fetchAll('ww_daily', 'd, sludge_out, sludge_gen', 'd'); WWD = {}; rows.forEach(r => { WWD[r.d] = r; }); } catch (e) { WWD = {}; } }
    function meterKwh(ym, k) {
      const v = UT.effective(ym, MONTHLY, DAILY, {})[k];
      if (v !== null && v !== undefined && v !== '' && !isNaN(v)) return Number(v);
      if (ym < thisYm) return null; // 지난 달인데 기록 없음
      // 앞으로의 달(목표·계획): 공조냉동은 기온 따라 크게 달라서 기온 식으로, 폐수동은 지금 부하 수준(최근 일일 검침)으로
      // (앞으로 계획된 설비 증설·운전 변경은 목표·예산 ④ 「계획 부하 변동」에서 따로 더함 — 특이사항은 실제 있었던 일만)
      if (k === 'elec_hvac_kwh') { const m = hvacPlanModel(); if (m) { const w = m.Tb === null ? 0 : warmSum(ym, m.Tb); if (w !== null) return m.A * UT.daysIn(ym) + m.W * w; } }
      if (k === 'elec_ww_kwh') { const r = wwPlanRate(); if (r) return r.perDay * UT.daysIn(ym); }
      const l = []; let x = UT.prevYm(thisYm);
      for (let i = 0; i < 6 && l.length < 3; i++, x = UT.prevYm(x)) { const w = UT.effective(x, MONTHLY, DAILY, {})[k]; if (w) l.push(Number(w) / UT.daysIn(x)); }
      return l.length ? l.reduce((a, b) => a + b, 0) / l.length * UT.daysIn(ym) : null; // 계획(앞으로의 달): 최근 3개월 하루 평균
    }
    function wwKwh(ym) { return meterKwh(ym, 'elec_ww_kwh'); }
    // 공조냉동 계획용 식: 공조냉동 = 하루 기본 A × 날수 + W × 더운 정도(Tb℃ 넘는 기온 합) — 계량이 나뉜 달(26년 3월~)로 맞춤, Tb는 가장 잘 맞는 값
    let HVAC_PM = null, HVAC_PM_KEY = '';
    function hvacPlanModel() {
      const ms = []; for (let ym = HVAC_FULL_FROM; ym < thisYm; ym = UT.nextYm(ym)) { const v = UT.effective(ym, MONTHLY, DAILY, {}).elec_hvac_kwh; if (v !== null && v !== undefined && v !== '' && !isNaN(v)) ms.push([ym, Number(v)]); }
      const key = ms.map(x => x.join(':')).join(',') + (TEMPS ? 1 : 0); if (key === HVAC_PM_KEY) return HVAC_PM; HVAC_PM_KEY = key; HVAC_PM = null;
      if (ms.length < 4) return null;
      let best = null; const ys = ms.map(x => x[1]);
      const c0 = UT.ols(ms.map(x => [UT.daysIn(x[0])]), ys); if (c0) { const e = ms.reduce((t, x, i) => t + (ys[i] - c0[0] * UT.daysIn(x[0])) ** 2, 0); best = { A: c0[0], W: 0, Tb: null, e }; }
      for (let Tb = 0; Tb <= 22; Tb++) { const X = ms.map(x => [UT.daysIn(x[0]), warmSum(x[0], Tb)]); if (X.some(r => r[1] === null)) continue; const c = UT.ols(X, ys); if (!c || c.some(v => v < 0)) continue;
        const e = X.reduce((t, r, i) => t + (ys[i] - c[0] * r[0] - c[1] * r[1]) ** 2, 0); if (!best || e < best.e) best = { A: c[0], W: c[1], Tb, e }; }
      if (best) best.mape = ms.reduce((t, x, i) => t + Math.abs(best.A * UT.daysIn(x[0]) + best.W * (best.Tb === null ? 0 : warmSum(x[0], best.Tb)) - ys[i]) / ys[i], 0) / ms.length * 100;
      return (HVAC_PM = best);
    }
    // 폐수동 계획용 하루 전력: 설비검침 폐수전력 지침으로 최근 60일 평균 (그 사이 ⚡ 폐수동 부하 변동이 있었으면 그날 이후만) × 배율
    function wwPlanRate() {
      const ds = Object.keys(DAILY).filter(d => DAILY[d] && DAILY[d].ww_power !== null && DAILY[d].ww_power !== undefined && DAILY[d].ww_power !== '').sort(); if (ds.length < 2) return null;
      const last = ds[ds.length - 1]; let from = UT.addDays(last, -60);
      const ch = equipList().filter(x => x.area === '폐수동' && x.d > from && x.d <= last).sort((a, b) => a.d < b.d ? 1 : -1)[0]; if (ch) from = ch.d;
      const first = ds.find(d => d >= from); if (!first || first >= last) return null;
      const n = (new Date(last) - new Date(first)) / 864e5; if (n < 7) return null;
      const ct = Number(UT.effective(last.slice(0, 7), MONTHLY, DAILY, {}).elec_ww_ct) || 40;
      return { perDay: (Number(DAILY[last].ww_power) - Number(DAILY[first].ww_power)) * ct / n, from: first, to: last, change: ch || null };
    }
    function wwKwhOld(ym) {
      const v = UT.effective(ym, MONTHLY, DAILY, {}).elec_ww_kwh;
      if (v !== null && v !== undefined && v !== '' && !isNaN(v)) return Number(v);
      // 기록 없는 달(계획 등): 최근 3개월 하루 평균 × 날수
      const l = []; let x = UT.prevYm(ym < thisYm ? ym : thisYm);
      for (let i = 0; i < 6 && l.length < 3; i++, x = UT.prevYm(x)) { const w = UT.effective(x, MONTHLY, DAILY, {}).elec_ww_kwh; if (w) l.push(Number(w) / UT.daysIn(x)); }
      return l.length ? l.reduce((a, b) => a + b, 0) / l.length * UT.daysIn(ym) : null;
    }
    function wwRow(ym) {
      const s = S(ym), flow = s.ww && s.ww.flow !== undefined ? s.ww.flow : null;
      let sl = 0, sc = 0, sg = 0, gc = 0; for (let d = 1; d <= UT.daysIn(ym); d++) { const r = (WWD || {})[UT.dateStr(ym, d)]; if (r && r.sludge_out !== null && r.sludge_out !== undefined) { sl += Number(r.sludge_out) || 0; sc++; } if (r && r.sludge_gen !== null && r.sludge_gen !== undefined) { sg += Number(r.sludge_gen) || 0; gc++; } }
      return { ym, days: UT.daysIn(ym), kwh: (() => { const v = UT.effective(ym, MONTHLY, DAILY, {}).elec_ww_kwh; return v === null || v === undefined || v === '' ? null : Number(v); })(),
        blower: equipKwh(ym, ['폐수동']), flow: flow === null || flow === undefined ? null : Number(flow), sludge: sc >= UT.daysIn(ym) * 0.5 ? sl : null, sludgeGen: gc ? sg : null, genDays: gc };
    }
    function fitWW(months) {
      const rows = months.map(wwRow).filter(r => r.kwh !== null && r.flow !== null);
      if (rows.length < 4) return null;
      const useS = rows.every(r => r.sludge !== null);
      const X = r => useS ? [r.days, r.flow, r.sludge] : [r.days, r.flow];
      const y = rows.map(r => r.kwh - r.blower);
      let co = UT.ols(rows.map(X), y);
      if (!co) return null;
      if (co.slice(1).some(c => c < 0)) { co = UT.ols(rows.map(r => [r.days]), y); if (!co) return null; co = [co[0], 0, 0]; }
      const a = co[0], b = co[1] || 0, c = useS ? (co[2] || 0) : 0;
      const pred = r => a * r.days + r.blower + b * r.flow + c * (r.sludge || 0);
      return { a, b, c, useS, n: rows.length, pred, mape: rows.reduce((t, r) => t + Math.abs(pred(r) - r.kwh) / r.kwh, 0) / rows.length * 100 };
    }

    let NORMALS = null;
    const normals = () => (NORMALS = NORMALS || UT.weatherNormals(TEMPS || {}));
    // 실적 평가: 그 달 실제 생산량·기온으로 예상 → 실제와 비교
    function evalMonth(y, ym, uk, models, t) {
      const mdl = models[uk]; if (!mdl) return null;
      const r = monthRow(ym); if (r[uk] === null || !r.prod) return null;
      if (r.hdd === null) { const nm = normals()[Number(ym.slice(5))]; if (nm) { r.hdd = nm.hdd; r.cdd = nm.cdd; } }
      const exp = mdl.predict(r); if (exp === null || !exp) return null;
      const rate = rateOf(t, uk);
      return { exp, target: rate === null ? null : exp * (1 - rate / 100), act: r[uk], save: (1 - r[uk] / exp) * 100, rate, cost: r[uk + '_cost'] };
    }
    // 실적 평가 (다른 화면에서도 씀): 그 해 목표 기준
    function evalFor(ym, uk) {
      const y = Number(ym.slice(0, 4)), t = tgt(y); if (!t.rate) return null;
      if (!t._models) Object.defineProperty(t, '_models', { value: fitModels(t, y), enumerable: false, writable: true });
      return evalMonth(y, ym, uk, t._models, t);
    }
    const judge = e => !e || e.rate === null ? '' : (e.save >= e.rate ? `<span class="ok">✔ 달성</span>` : `<span class="ng">✖ 미달</span>`);
    const saveTxt = v => v === null || v === undefined || isNaN(v) ? '-' : (v >= 0 ? `<span class="down">${nf1.format(v)}% 절감</span>` : `<span class="up">${nf1.format(-v)}% 초과</span>`);

    async function renderTargets(keepDraft) {
      if (!targetY) targetY = Number(thisYm.slice(5)) >= 10 ? Number(thisYm.slice(0, 4)) + 1 : Number(thisYm.slice(0, 4));
      try { await loadTemps(); } catch (e) { TEMPS = TEMPS || {}; }
      document.getElementById('target-year').textContent = `${targetY}년`;
      targetDraft = keepDraft || JSON.parse(JSON.stringify(tgt(targetY))); targetDirty = !!keepDraft;
      if (!keepDraft || !targetOrig) targetOrig = JSON.parse(JSON.stringify(tgt(targetY)));
      targetDraft.rate = targetDraft.rate || {};
      if (!PRODD && ['elec', 'gas'].some(uk => (pickOf(targetDraft, uk) || []).some(f => PICK_PROD[f]))) { try { await loadProdDaily(); } catch (e) { } }
      const ro = !isAdmin(); document.getElementById('target-save').hidden = ro; document.getElementById('target-fill').hidden = true;
      const y = targetY, t = targetDraft, models = fitModels(t, y), base = baseMonths(t, y);
      const unitOf = k => UT.UTILS.find(u => u.k === k).unit;

      // 1) 기준선
      const cands = []; for (let ym = UT.ym(y - 2, 1); ym <= UT.ym(y, 12) && ym <= lastCompleteYm(); ym = UT.nextYm(ym)) { const sx = S(ym); if (sx.production && sx.elec.usage) cands.push(ym); }
      const lk = isLocked(t), roB = ro || lk;
      let h = lk ? `<div class="lockbar on">🔒 <b>${y}년 목표 식 확정</b> ${Portal.tip('lock')} · ${esc(t.lock.at || '')} ${esc(t.lock.by || '')} · 기준 달 ${base[0].slice(2).replace('-', '.')} ~ ${base[base.length - 1].slice(2).replace('-', '.')} (${base.length}개) — 전기·가스 지표와 계수가 고정되어 데이터가 쌓이거나 고쳐져도 목표가 바뀌지 않습니다.${ad0() ? ' <button class="btn secondary small" onclick="unlockTargets()">확정 풀기</button>' : ''}</div>`
        : `<div class="lockbar">⚠ <b>아직 확정 전</b> ${Portal.tip('lock')} — 지금은 기준 달이 늘거나(전년 달이 마감될 때마다) 고지서 값이 고쳐지면 지표·계수가 다시 계산됩니다. 지표를 정했으면 확정해 두세요.${ad0() ? ' <button class="btn small" onclick="lockTargets()">🔒 이 식으로 목표 확정</button>' : ''}</div>`;
      if (y === pickYear()) h += `<div class="std-row">${stdBadgeHtml('elec', 'target')}${stdBadgeHtml('gas', 'target')}</div>`;
      h += `<div class="hint" style="margin-bottom:6px">기준으로 삼은 달 (${lk ? '확정되어 바꿀 수 없음' : `눌러서 넣기/빼기${ro ? ' — 관리자만' : ''}`}) · 원육 투입이 아주 적었던 가동 초기 달은 자동으로 빠집니다.</div><div class="chips">` +
        cands.map(ym => `<button class="chip ${base.includes(ym) ? 'on' : ''}" ${roB ? 'disabled' : `onclick="toggleBase('${ym}')"`}>${ym.slice(2).replace('-', '.')}</button>`).join('') + '</div>';
      const MAIN = ['elec', 'gas'], tgHead = `<table class="t tg" style="margin-top:10px;width:100%"><colgroup><col style="width:90px"><col><col style="width:80px"><col style="width:90px"></colgroup><tr><th class="l">항목</th><th class="l">예상 사용량 식 (기준 달 ${base.length}개로 계산)</th><th>맞는 정도</th><th>월 평균 오차</th></tr>`;
      const tgRow = u => { const m = models[u.k]; if (!m) return `<tr><td class="l"><b>${u.name}</b></td><td class="l hint" colspan="3">기준 달이 부족해 계산할 수 없습니다</td></tr>`;
          const fc = v => Math.abs(v) >= 100 ? f0(v) : Number(v.toPrecision(3)).toLocaleString('ko-KR');
          const note = (f, v) => f === 'hdd' ? (v < 0 ? ' <span class="hint">(추울수록 덜 씀)</span>' : ' <span class="hint">(추울수록 더 씀)</span>') : f === 'cdd' ? (v < 0 ? ' <span class="hint">(더울수록 덜 씀)</span>' : ' <span class="hint">(더울수록 더 씀)</span>') : '';
          const parts = m.pick ? `<b>${PICK_U[u.k].part}</b> (${m.locked ? '🔒 확정한 식' : '고른 지표'}) = ${m.feats.map((f, i) => `${facName(f)} ${facUnit(f) ? facUnit(f) + '당 ' : ''}<b>${fc(m.coef[i])}</b>`).join(' &nbsp;+&nbsp; ')} &nbsp;+&nbsp; ${u.k === 'elec' ? '폐수동·공조냉동 계량기 실측 &nbsp;+&nbsp; 부하 변동' : '식당 가스 실측'} <span class="hint">(${PICK_U[u.k].part}만 따로 맞춘 오차 ±${nf1.format(m.partMape)}% · 자동 식이었으면 ±${m.autoMape === null || m.autoMape === undefined ? '-' : nf1.format(m.autoMape)}%)</span>`
            : m.hall ? `생산동 하루 기본 <b>${fc(m.coef[0])}</b> × 달력 날수 &nbsp;+&nbsp; 원육 1kg당 <b>${fc(m.coef[1])}</b> &nbsp;+&nbsp; ${m.Tb !== null ? `더운 몫 <span class="hint">(하루 평균기온 ${m.Tb}℃ 넘는 1℃마다 <b>${fc(m.coef[2])}</b> — 계량기 없는 칠러·실외기 등)</span> &nbsp;+&nbsp; ` : ''}${m.Tc !== null ? `추운 몫 <span class="hint">(하루 평균기온 ${m.Tc}℃ 아래 1℃마다 <b>${fc(m.coef[3])}</b> — 현장 온수 전기보일러)</span> &nbsp;+&nbsp; ` : `<span class="hint">추운 몫(전기보일러): 기준 달에 추운 달이 ${m.coldMonths}개뿐이라 아직 계산 안 함 — 겨울 달이 2개 이상 들어오면 자동으로 들어감</span> &nbsp;+&nbsp; `}폐수동·공조냉동 계량기 실측 &nbsp;+&nbsp; 부하 변동 <span class="hint">(${m.months[0].slice(2).replace('-', '.')}~${m.months[m.months.length - 1].slice(2).replace('-', '.')} ${m.n}개월 · 생산동만 따로 맞춘 오차 ±${nf1.format(m.hallMape)}%)</span>`
            : m.gasBoiler ? `<b>보일러</b>(스팀 → 자숙탱크·레토르트) = ${m.feats.filter(f => f !== 'grest').map(f => `${UT.FEAT_LABEL[f]} <b>${fc(m.coef[m.feats.indexOf(f)])}</b>`).join(' &nbsp;+&nbsp; ')} &nbsp;+&nbsp; 식당 가스 실측 <span class="hint">(기숙사 — 통제 밖이라 그대로 더함 · 보일러만 따로 맞춘 오차 ±${nf1.format(m.boilerMape)}%${m.hdd ? '' : ' · 난방도일은 넣어도 오차가 줄지 않아 뺌 (난방용 가스 없음)'})</span>`
            : m.idle ? `휴무일 하루 기본 <b>${fc(m.coef[0])}</b> × 달력 날수 &nbsp;+&nbsp; 생산일 1일당 <b>${fc(m.coef[1])}</b> &nbsp;+&nbsp; 원육 1kg당 <b>${fc(m.coef[2])}</b> &nbsp;+&nbsp; ${m.idle.b || m.idle.c ? `기온 영향 <span class="hint">(평균기온 ${m.idle.Tb}℃ 넘는 1℃마다 하루 <b>${fc(m.idle.b)}</b>${m.idle.c ? `, ${m.idle.Tc}℃ 아래 1℃마다 하루 <b>${fc(m.idle.c)}</b>` : ''})</span> &nbsp;+&nbsp;` : ''} 폐수동·공조냉동 (계량기 실측) &nbsp;+&nbsp; 부하 변동 (생산동·기타)`
            : m.feats.map((f, i) => `${UT.FEAT_LABEL[f]} <b>${fc(m.coef[i])}</b>${note(f, m.coef[i])}`).join(' &nbsp;+&nbsp; ');
          const ex = exclOf(t, u.k), exHtml = `<div class="tg-excl">이 항목 기준 달 <span class="hint">(빨간 줄 = 뺌 · 눌러서 바꾸기)</span>: ${base.map(ym => { const auto = u.k === 'elec' && (m.hall || m.pick) && ym < HVAC_FULL_FROM;
            return `<button class="chip mini ${ex.includes(ym) || auto ? 'off' : ''}" ${ro || auto || (lk && MAIN.includes(u.k)) ? 'disabled' : `onclick="toggleExcl('${u.k}','${ym}')"`} title="${auto ? '공조냉동·폐수동 검침이 나뉘기 전이라 자동으로 뺌' : ex.includes(ym) ? '빠짐 — 눌러서 다시 넣기' : '들어감 — 눌러서 빼기'}">${ym.slice(2).replace('-', '.')}</button>`; }).join('')}${u.k === 'elec' && (m.hall || m.pick) && base.some(ym => ym < HVAC_FULL_FROM) ? ' <span class="hint">← 26.1~2월: 공조·폐수 검침 분리 전이라 자동 제외</span>' : ''}${ex.length && EXCL_WHY[u.k] && !Array.isArray((t.excl || {})[u.k]) ? ` <span class="hint">← 기본: ${EXCL_WHY[u.k]}</span>` : ''}${m.hddDropped ? ' <span class="hint">· 난방도일은 오차가 줄지 않아 뺌</span>' : ''}</div>`;
          return `<tr><td class="l"><i class="dot" style="background:${u.color}"></i><b>${u.name}</b> <span class="hint">${u.unit}</span></td><td class="l">${parts.split(' &nbsp;+&nbsp; ').map((x, i) => (i ? '<span class="plus">+</span> ' : '') + x).join('<br>')}${exHtml}</td><td>${m.r2 === null ? '-' : nf0.format(m.r2 * 100) + '%'}</td><td>${m.mape < 8 ? '<span class="ok">' : m.mape < 15 ? '<span>' : '<span class="ng">'}±${nf1.format(m.mape)}%</span></td></tr>`; };
      h += tgHead + UT.UTILS.filter(u => MAIN.includes(u.k)).map(tgRow).join('') + '</table>';
      h += `<div class="story" style="margin-top:10px">아래에서 고른 지표로 ①의 식이 바뀌고, ②③④ 목표·평가·계획이 모두 그 식으로 계산됩니다. 지표는 <a href="#" onclick="switchTab('period');return false">지표 분석 → 구성별 비교</a>에서 상관계수를 보면서 고를 수도 있습니다.</div>` + pickBoxHtml('elec', 'target') + pickBoxHtml('gas', 'target');
      h += `<details class="fold" style="margin-top:6px"><summary class="hint">용수·폐수 기준선 (참고 — 금액이 작아 관리 대상 아님)</summary>${tgHead}${UT.UTILS.filter(u => !MAIN.includes(u.k)).map(tgRow).join('')}</table></details>`;
      h += `<details class="fold" style="margin-top:4px"><summary class="hint">식에 쓴 말 설명 (생산일·난방도일·맞는 정도 등)</summary><div class="hint" style="margin-top:6px">생산일 = 보일러 가스를 하루 50㎥ 넘게 쓴 날 수 (스팀보일러는 생산하는 날만 돌기 때문 · 월간입력 '생산일수'로 직접 고칠 수 있음). 가스는 보일러 스팀(자숙탱크·레토르트)만 생산일·원육으로 계산하고 식당 가스는 실측 그대로 (난방용 가스 없음). 전기는 생산동 기본(달력 날수)·원육·더운 몫(칠러·실외기)·추운 몫(현장 온수 전기보일러, 겨울 자료가 쌓이면)으로 계산. 난방도일 = 하루 평균기온이 18℃보다 낮은 만큼의 한 달 합, 냉방도일 = 24℃보다 높은 만큼의 합 (설비검침 최저·최고온도의 평균으로 계산). 맞는 정도는 100%에 가까울수록, 월 평균 오차는 작을수록 믿을 만합니다.</div></details>`;
      // 계산 근거: 기준 달마다 (요인 × 계수) 더한 값 vs 실제
      const brows = base.map(monthRow);
      const FL = { days: '달력 날수', op: '생산일', prod: '원육 투입(kg)', hdd: '난방도일', cdd: '냉방도일', wx: '기온 영향(kWh)', cx: '추운 몫', wwk: '폐수동 실측(kWh)', hvk: '공조냉동 실측(kWh)', eq: '부하 변동(kWh)', grest: '식당 가스 실측(MJ)' };
      h += UT.UTILS.filter(u => MAIN.includes(u.k)).map(u => { const m = models[u.k]; if (!m) return '';
        if (m.pick) { const fc2 = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
          return `<details class="tg-whyd"><summary>${u.name} — 고른 지표 계수가 어떻게 나왔는지 보기 (기준 달 ${m.n}개)</summary><table class="t tg-why"><tr><th class="l">기준 달</th>${m.feats.map((f, i) => `<th>${facName(f)}<br><span class="hint">× ${fc2(m.coef[i])}</span></th>`).join('')}<th>${PICK_U[u.k].part} 식</th><th>${PICK_U[u.k].part} 실제</th><th>+ 실측 그대로</th><th>전체 식</th><th>전체 실제</th><th>차이</th></tr>` +
            m.rows.map(r => `<tr><td class="l">${r.ym.slice(2).replace('-', '.')}</td>${r.x.map((v, i) => `<td>${fc2(v)}<br><span class="hint">→ ${f0(v * m.coef[i])}</span></td>`).join('')}<td><b>${f0(r.pp)}</b></td><td>${f0(r.y)}</td><td>${f0(r.fixed)}</td><td><b>${f0(r.pred)}</b></td><td>${f0(r.all)}</td><td>${(r.pred / r.all - 1) * 100 >= 0 ? '+' : ''}${nf1.format((r.pred / r.all - 1) * 100)}%</td></tr>`).join('') + '</table></details>'; }
        const fc = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
        const used = brows.map(r => m.prep ? m.prep({ ...r }) : r).filter(r => r[u.k] !== null && r[u.k] !== undefined && m.feats.every(f => r[f] !== null && r[f] !== undefined));
        const fz = m.feats.filter(f => !(m.hall && ((f === 'wx' && m.Tb === null) || (f === 'cx' && m.Tc === null))));
        let t2 = `<table class="t tg-why"><tr><th class="l">기준 달</th>${fz.map(f => `<th>${f === 'wx' && m.hall ? `기온 ${m.Tb ?? '-'}℃ 넘는 합 (℃·일)` : f === 'cx' ? `기온 ${m.Tc}℃ 아래 합 (℃·일)` : FL[f]}<br><span class="hint">${f === 'wx' && !m.hall ? '휴무일 식으로 날마다 합' : (f === 'wwk' || f === 'hvk' || f === 'grest') ? '계량기 그대로' : f === 'eq' ? '운전 이력 합' : '× ' + fc(m.coef[m.feats.indexOf(f)])}</span></th>`).join('')}<th>식으로 계산한 값</th><th>실제 사용량</th><th>차이</th></tr>`;
        used.forEach(r => { const parts = m.feats.map((f, i) => m.coef[i] * r[f]), sum = parts.reduce((a, b) => a + b, 0), err = r[u.k] ? (sum / r[u.k] - 1) * 100 : null;
          t2 += `<tr><td class="l">${r.ym.slice(2).replace('-', '.')}</td>${fz.map(f => { const i = m.feats.indexOf(f); return `<td>${['wwk', 'hvk', 'eq', 'grest'].includes(f) || (f === 'wx' && !m.hall) ? '' : fc(r[f]) + '<br>'}<span class="hint">→ ${f0(parts[i])}</span></td>`; }).join('')}<td><b>${f0(sum)}</b></td><td>${f0(r[u.k])}</td><td>${err === null ? '-' : (err >= 0 ? '+' : '') + nf1.format(err) + '%'}</td></tr>`; });
        t2 += '</table>';
        return `<details class="tg-whyd"><summary>${u.name} — 계수가 어떻게 나왔는지 보기 (기준 달 ${used.length}개)</summary>
          <div class="hint" style="margin:6px 0">각 달의 실제 사용량을 <b>${m.feats.map(f => FL[f].replace('(kg)', '')).join(' · ')}</b> 덩어리로 나눴을 때, 모든 기준 달에서 <b>식으로 계산한 값과 실제 사용량의 차이가 가장 작아지는 계수</b>를 찾은 것입니다 (최소제곱법 — 엑셀 추세선·LINEST와 같은 방법). 아래 표의 회색 숫자 = 그 요인 × 계수, 더하면 '식으로 계산한 값'.</div>${t2}</details>`; }).join('');
      if (models.elec && models.elec.idle) h += idleDetail(models.elec.idle);
      document.getElementById('tg-model').innerHTML = h;

      // 2) 절감률
      const rateIn = u => `<label><i class="dot" style="background:${u.color}"></i>${u.name}
        ${ro ? `<b>${rateOf(t, u.k) ?? '-'}%</b>` : `<input type="number" step="0.1" data-rate="${u.k}" value="${rateOf(t, u.k) ?? ''}" placeholder="예: 3"> %`}</label>`;
      document.getElementById('tg-rate').innerHTML = `<div class="rate-grid">` + UT.UTILS.filter(u => MAIN.includes(u.k)).map(rateIn).join('') +
        (ro ? '' : `<button class="btn secondary" onclick="setAllRates()">모두 같은 값으로</button>`) + `</div>` +
        `<details class="fold" style="margin-top:6px" ${UT.UTILS.some(u => !MAIN.includes(u.k) && rateOf(t, u.k) !== null) ? '' : ''}><summary class="hint">용수·폐수 절감률 (참고)</summary><div class="rate-grid" style="margin-top:6px">${UT.UTILS.filter(u => !MAIN.includes(u.k)).map(rateIn).join('')}</div></details>`;
      document.querySelectorAll('#tg-rate input[data-rate]').forEach(el => el.addEventListener('change', () => {
        const k = el.dataset.rate; if (el.value.trim() === '') delete targetDraft.rate[k]; else targetDraft.rate[k] = Number(el.value);
        targetDirty = true; renderTargets(targetDraft);
      }));

      renderKpiReview(t, y);
      // 3) 실적 평가
      document.getElementById('target-chips').innerHTML = UT.UTILS.map(u => `<button class="chip ${targetUtil === u.k ? 'on' : ''}" onclick="targetUtil='${u.k}';renderTargets(targetDirty ? targetDraft : undefined)">${u.name}</button>`).join('');
      const uk = targetUtil, U = UT.UTILS.find(u => u.k === uk), last = lastCompleteYm();
      const ev = Array.from({ length: 12 }, (_, i) => { const ym = UT.ym(y, i + 1); return ym > last ? null : evalMonth(y, ym, uk, models, t); });
      const sumE = list => { const l = list.filter(Boolean); if (!l.length) return null; const exp = l.reduce((a, e) => a + e.exp, 0), act = l.reduce((a, e) => a + e.act, 0); return { exp, act, target: l.every(e => e.target !== null) ? l.reduce((a, e) => a + e.target, 0) : null, save: (1 - act / exp) * 100, rate: rateOf(t, uk), n: l.length }; };
      const er = (label, e, cls = '') => `<tr class="${cls}"><td class="l">${label}</td><td>${e && e.op !== undefined ? f0(e.op) : ''}</td><td>${e ? f0(e.prod ?? '') : ''}</td><td>${e ? f0(e.exp) : '-'}</td><td>${e && e.target !== null ? f0(e.target) : '-'}</td><td>${e ? f0(e.act) : '-'}</td><td>${e ? saveTxt(e.save) : '-'}</td><td>${e ? judge(e) : ''}</td></tr>`;
      let ht = `<table class="t"><tr><th class="l">월</th><th>생산일</th><th>원육 투입량 (kg)</th><th>예상 사용량</th><th>목표 사용량</th><th>실제 사용량</th><th>예상 대비</th><th>판정</th></tr>`;
      for (let q = 0; q < 4; q++) {
        for (let i = q * 3; i < q * 3 + 3; i++) { const e = ev[i]; if (e) { e.prod = S(UT.ym(y, i + 1)).production; e.op = UT.opDays(DAILY, UT.ym(y, i + 1), MONTHLY); } ht += er(`${i + 1}월`, e); }
        const qs = sumE(ev.slice(q * 3, q * 3 + 3)); if (qs) { const l = ev.slice(q * 3, q * 3 + 3).filter(Boolean); qs.prod = l.reduce((a, e) => a + e.prod, 0); qs.op = l.reduce((a, e) => a + e.op, 0); }
        ht += er(`<b>${QN[q]}</b>${qs && qs.n < 3 ? ` <span class="hint">(${qs.n}개월)</span>` : ''}`, qs, 'qrow');
      }
      const ys = sumE(ev); if (ys) { ys.prod = ev.filter(Boolean).reduce((a, e) => a + e.prod, 0); ys.op = ev.filter(Boolean).reduce((a, e) => a + e.op, 0); }
      ht += er(`<b>${y}년 누적</b>${ys ? ` <span class="hint">(${ys.n}개월)</span>` : ''}`, ys, 'sum') + '</table>';
      ht += `<div class="hint" style="margin-top:6px">단위: ${U.unit}. 예상 사용량 = 그 달 실제 원육 투입량·날씨를 위 식에 넣은 값. 예상보다 목표 절감률 이상 덜 썼으면 달성입니다. 마감 안 된 달은 비워 둡니다.</div>`;
      document.getElementById('target-table').innerHTML = ht;
      // 전 항목 요약
      document.getElementById('tg-summary').innerHTML = `<table class="t"><tr><th class="l">항목</th><th>목표 절감률</th><th>${y}년 누적 예상</th><th>누적 실제</th><th>예상 대비</th><th>판정</th></tr>` +
        UT.UTILS.map(u => { const l = Array.from({ length: 12 }, (_, i) => { const ym = UT.ym(y, i + 1); return ym > last ? null : evalMonth(y, ym, u.k, models, t); }); const e = sumE(l); if (e) e.rate = rateOf(t, u.k);
          return `<tr><td class="l"><i class="dot" style="background:${u.color}"></i>${u.name} <span class="hint">${u.unit}</span></td><td>${rateOf(t, u.k) === null ? '-' : rateOf(t, u.k) + '%'}</td><td>${e ? f0(e.exp) : '-'}</td><td>${e ? f0(e.act) : '-'}</td><td>${e ? saveTxt(e.save) : '-'}</td><td>${e ? judge(e) : ''}</td></tr>`; }).join('') + '</table>';

      // 차트: 예상 vs 목표 vs 실제 (월별)
      if (window.Chart) mkChart('chart-target', { type: 'bar', data: { labels: monthLabels, datasets: [
        { type: 'line', label: '예상 사용량', data: ev.map(e => e ? e.exp : null), borderColor: '#888', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 2 },
        { type: 'line', label: '목표', data: ev.map(e => e && e.target !== null ? e.target : null), borderColor: '#d93025', borderDash: [2, 3], borderWidth: 1.5, pointRadius: 0 },
        { label: '실제', data: ev.map(e => e ? e.act : null), backgroundColor: ev.map(e => !e ? U.color : e.target !== null && e.act > e.target ? '#e8a09a' : U.color), maxBarThickness: 30 }
      ] }, options: (() => { const o = baseOpts(U.unit); o.plugins.legend.display = true; o.plugins.tooltip.callbacks.label = c => ` ${c.dataset.label}: ${f0(c.raw)} ${U.unit}`; return o; })() });

      // 4) 연간 계획표
      renderPlan(models);
    }
    const ad0 = () => isAdmin();
    function toggleBase(ym) { if (isLocked(targetDraft)) return;
      const y = targetY, cur = baseMonths(targetDraft, y);
      targetDraft.base = cur.includes(ym) ? cur.filter(x => x !== ym) : [...cur, ym].sort();
      targetDirty = true; renderTargets(targetDraft);
    }
    function setAllRates() {
      const v = prompt('모든 항목의 절감률(%)을 몇으로 할까요?', '3'); if (v === null || isNaN(Number(v))) return;
      UT.UTILS.forEach(u => targetDraft.rate[u.k] = Number(v)); targetDirty = true; renderTargets(targetDraft);
    }
    function fillTargets() { }
    async function saveTargets() {
      try {
        const latest = (await freshYear(targetY)).targets || {};
        const data = merge3(targetOrig || {}, JSON.parse(JSON.stringify(targetDraft)), latest); // 내가 바꾼 칸만 덮음 (그 사이 다른 사람이 고른 지표 등은 유지)
        await saveYear(targetY, { targets: data }); targetOrig = null;
        targetDirty = false; document.getElementById('target-note').textContent = '저장했습니다.';
        renderTargets();
      } catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    function renderTargetChart() { renderTargets(targetDirty ? targetDraft : undefined); }

    // ---------------- 연간 계획표 (생산계획 × 평년 날씨 → 월별·분기별 목표 사용량·비용) ----------------
    function planProd(t, y, m) {
      const v = (t.plan_prod || {})[m]; if (v !== undefined && v !== null && v !== '') return Number(v);
      return null;
    }
    function planOp(t, y, m) { // 계획 가동일: 입력값 → 없으면 그 달 평일 수
      const v = (t.plan_op || {})[m]; if (v !== undefined && v !== null && v !== '') return Number(v);
      return UT.weekdays(UT.ym(y, m));
    }
    function priceOf(y, uk, m) { // 단가: 전년 같은 달, 없으면 기준 달 평균
      const s = S(UT.ym(y - 1, m)); const p = ratio(s[uk].cost, s[uk].usage); if (p) return p;
      const b = baseMonths(targetDraft, y).map(S); const c = b.reduce((a, x) => a + (x[uk].cost || 0), 0), u = b.reduce((a, x) => a + (x[uk].usage || 0), 0);
      return u ? c / u : null;
    }
    // ---- 계획 부하 변동 (목표·예산 전용): 내년에 늘거나 줄 설비 부하 → 연간 계획표의 예상 사용량에 더함 ----
    //  targets.planLoads = [{ from:'YYYY-MM-DD', area:'공조냉동'|'폐수동'|'생산동·기타'|'보일러', name, kw, hours, m3, note }]
    const PL_AREAS = ['공조냉동', '폐수동', '생산동·기타', '보일러'];
    function planAdd(t, y, m, uk) { // 그 달에 더할 양 (전기 kWh, 가스 MJ)
      const ym = UT.ym(y, m), L = (t.planLoads || []).filter(x => x.from && (uk === 'gas' ? x.area === '보일러' : x.area !== '보일러')); let s2 = 0;
      const heat = Number(UT.effective(lastCompleteYm(), MONTHLY, DAILY, {}).gas_heat) || 43;
      L.forEach(x => { let n = 0; for (let d = 1; d <= UT.daysIn(ym); d++) if (UT.dateStr(ym, d) >= x.from && (!x.to || UT.dateStr(ym, d) <= x.to)) n++;
        s2 += n * (uk === 'gas' ? (Number(x.m3) || 0) * heat : (Number(x.kw) || 0) * (Number(x.hours) || 0)); });
      return s2;
    }
    function planLoadsHtml(t, y) {
      const L = t.planLoads || [], ro = !isAdmin(), yr = uk => { let a = 0; for (let m = 1; m <= 12; m++) a += planAdd(t, y, m, uk); return a; };
      const inp = (i, k, v, w, type = 'text') => ro ? esc(v ?? '') : `<input class="pli" data-i="${i}" data-k="${k}" type="${type}" value="${esc(v ?? '')}" style="width:${w}">`;
      return `<div class="card-sub" style="margin-bottom:10px"><b>📌 계획 부하 변동</b> ${Portal.tip('planload')} <span class="hint">— ${y}년에 늘거나 줄 설비 (예: 냉동기 증설, 블로워 24시간 운전, 야간 가동). 시작일부터 하루 양 × 날수가 아래 계획표의 예상 사용량에 더해짐 · 줄면 kW나 ㎥를 − 로</span>
        ${L.length ? `<div class="tbl-wrap" style="margin-top:6px"><table class="t"><tr><th>시작일</th><th>끝 (없으면 연말까지)</th><th>구역</th><th class="l">설비·내용</th><th>대당 kW × 대수</th><th>하루 가동시간</th><th>가스 ㎥/일<br><span class="hint">보일러만</span></th><th>하루 양</th>${ro ? '' : '<th></th>'}</tr>` +
          L.map((x, i) => `<tr><td>${inp(i, 'from', x.from, '130px', 'date')}</td><td>${inp(i, 'to', x.to, '130px', 'date')}</td><td>${ro ? esc(x.area) : `<select class="pli" data-i="${i}" data-k="area">${PL_AREAS.map(a => `<option ${x.area === a ? 'selected' : ''}>${a}</option>`).join('')}</select>`}</td>
            <td class="l">${inp(i, 'name', x.name, '100%')}</td><td>${x.area === '보일러' ? '-' : inp(i, 'kw', x.kw, '70px', 'number')}</td><td>${x.area === '보일러' ? '-' : inp(i, 'hours', x.hours, '60px', 'number')}</td><td>${x.area === '보일러' ? inp(i, 'm3', x.m3, '70px', 'number') : '-'}</td>
            <td>${x.area === '보일러' ? `${f0(Number(x.m3) || 0)} ㎥` : `${f0((Number(x.kw) || 0) * (Number(x.hours) || 0))} kWh`}</td>${ro ? '' : `<td><button class="chip" onclick="plDel(${i})">삭제</button></td>`}</tr>`).join('') + '</table></div>' : `<div class="hint" style="margin-top:4px">계획된 부하 변동 없음</div>`}
        <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${ro ? '' : '<button class="btn secondary small" onclick="plAdd()">+ 계획 추가</button>'}${L.length ? `<span class="hint">→ ${y}년 더해지는 양: 전기 <b>${f0(yr('elec'))} kWh</b> · 가스 <b>${f0(yr('gas'))} MJ</b> (목표·예산 저장 버튼으로 같이 저장)</span>` : ''}</div></div>`;
    }
    function plAdd() { targetDraft.planLoads = (targetDraft.planLoads || []).concat([{ from: UT.dateStr(UT.ym(targetY, 1), 1), area: '공조냉동', name: '', kw: 0, hours: 0 }]); targetDirty = true; renderTargets(targetDraft); }
    function plDel(i) { if (!confirm('이 계획을 지울까요?')) return; targetDraft.planLoads.splice(i, 1); targetDirty = true; renderTargets(targetDraft); }
    function renderPlan(models) {
      const y = targetY, t = targetDraft, ro = !isAdmin(), nm = normals();
      let h = `<div class="toolbar no-print" style="margin-bottom:8px">${ro ? '' : `<button class="btn secondary" onclick="fillPlanProd('prev')">전년 실적으로 원육 투입 계획 채우기</button>
        <button class="btn secondary" onclick="fillPlanProd('total')">연간 총량 넣고 나누기</button>`}<span class="hint">원육 투입 계획(kg)과 생산일(기본 = 평일 수, 공휴일 등은 고쳐 넣기)을 넣으면 평년 기온으로 월별 예상·목표 사용량과 비용이 계산됩니다. 비용 = 목표 사용량 × 전년 같은 달 단가.</span></div>`;
      h += `<div class="tbl-wrap"><table class="t plan"><tr><th class="l">월</th><th>원육 투입 계획 (kg)</th><th>생산일</th>${UT.UTILS.map(u => `<th>${u.name} 목표<br><span class="hint">${u.unit}</span></th>`).join('')}${UT.UTILS.map(u => `<th>${u.name} 비용</th>`).join('')}<th>목표 비용 합계</th></tr>`;
      const tot = { prod: 0, cost: 0 }; UT.UTILS.forEach(u => { tot[u.k] = 0; tot[u.k + 'c'] = 0; });
      const rows = [];
      for (let m = 1; m <= 12; m++) {
        const p = planProd(t, y, m), w = nm[m];
        const r = { m, prod: p, op: planOp(t, y, m) };
        let costSum = p === null ? null : 0;
        UT.UTILS.forEach(u => {
          const mdl = models[u.k];
          const exp0 = (mdl && p !== null && w) ? mdl.predict({ ym: UT.ym(y, m), days: UT.daysIn(UT.ym(y, m)), op: r.op, prod: p, hdd: w.hdd, cdd: w.cdd, plan: true }) : null;
          const exp = exp0 === null ? null : exp0 + ((u.k === 'elec' || u.k === 'gas') ? planAdd(t, y, m, u.k) : 0); // + 계획 부하 변동
          const rate = rateOf(t, u.k);
          r[u.k] = exp === null ? null : exp * (1 - (rate || 0) / 100);
          const pr = priceOf(y, u.k, m);
          r[u.k + 'c'] = r[u.k] === null || !pr ? null : r[u.k] * pr;
          if (costSum !== null) costSum = r[u.k + 'c'] === null ? null : costSum + r[u.k + 'c'];
        });
        r.cost = costSum; rows.push(r);
      }
      const line = (label, r, cls = '', edit = false) => `<tr class="${cls}"><td class="l">${label}</td><td>${edit && !ro ? `<input type="number" data-pm="${r.m}" value="${r.prod ?? ''}" style="width:96px">` : f0(r.prod)}</td><td>${edit && !ro ? `<input type="number" data-po="${r.m}" value="${r.op ?? ''}" style="width:54px">` : f0(r.op)}</td>` +
        UT.UTILS.map(u => `<td>${f0(r[u.k])}</td>`).join('') + UT.UTILS.map(u => `<td>${r[u.k + 'c'] === null ? '-' : man(r[u.k + 'c'])}</td>`).join('') + `<td><b>${r.cost === null ? '-' : man(r.cost)}</b></td></tr>`;
      const sum = list => { const o = { op: list.reduce((a, r) => a + (r.op || 0), 0), prod: list.every(r => r.prod !== null) ? list.reduce((a, r) => a + r.prod, 0) : null, cost: list.every(r => r.cost !== null) ? list.reduce((a, r) => a + r.cost, 0) : null };
        UT.UTILS.forEach(u => { o[u.k] = list.every(r => r[u.k] !== null) ? list.reduce((a, r) => a + r[u.k], 0) : null; o[u.k + 'c'] = list.every(r => r[u.k + 'c'] !== null) ? list.reduce((a, r) => a + r[u.k + 'c'], 0) : null; }); return o; };
      for (let q = 0; q < 4; q++) { rows.slice(q * 3, q * 3 + 3).forEach(r => h += line(`${r.m}월`, r, '', true)); h += line(`<b>${QN[q]}</b>`, sum(rows.slice(q * 3, q * 3 + 3)), 'qrow'); }
      h += line(`<b>${y}년 합계</b>`, sum(rows), 'sum') + '</table></div>';
      document.getElementById('tg-plan').innerHTML = planLoadsHtml(t, y) + h;
      document.querySelectorAll('#tg-plan .pli').forEach(el => el.addEventListener('change', () => { const x = targetDraft.planLoads[el.dataset.i], k = el.dataset.k;
        x[k] = ['kw', 'hours', 'm3'].includes(k) ? (el.value === '' ? 0 : Number(el.value)) : el.value; targetDirty = true; renderTargets(targetDraft); }));
      document.querySelectorAll('#tg-plan input[data-po]').forEach(el => el.addEventListener('change', () => {
        targetDraft.plan_op = targetDraft.plan_op || {};
        if (el.value.trim() === '') delete targetDraft.plan_op[el.dataset.po]; else targetDraft.plan_op[el.dataset.po] = Number(el.value);
        targetDirty = true; renderTargets(targetDraft);
      }));
      document.querySelectorAll('#tg-plan input[data-pm]').forEach(el => el.addEventListener('change', () => {
        targetDraft.plan_prod = targetDraft.plan_prod || {};
        if (el.value.trim() === '') delete targetDraft.plan_prod[el.dataset.pm]; else targetDraft.plan_prod[el.dataset.pm] = Number(el.value);
        targetDirty = true; renderTargets(targetDraft);
      }));
    }
    function fillPlanProd(mode) {
      const y = targetY; targetDraft.plan_prod = {};
      if (mode === 'prev') { targetDraft.plan_op = {}; for (let m = 1; m <= 12; m++) { const ym = UT.ym(y - 1, m), p = S(ym).production; if (p) { targetDraft.plan_prod[m] = Math.round(p); targetDraft.plan_op[m] = UT.opDays(DAILY, ym, MONTHLY); } } }
      else { const v = Number(prompt(`${y}년 연간 원육 투입 계획 총량(kg)은? (월 날수 비율로 나눕니다)`, '')); if (!v) return;
        for (let m = 1; m <= 12; m++) targetDraft.plan_prod[m] = Math.round(v * UT.daysIn(UT.ym(y, m)) / (y % 4 === 0 ? 366 : 365)); }
      targetDirty = true; renderTargets(targetDraft);
    }

    // =====================================================================
    // 원인 분석
    // =====================================================================
    let TEMPS = null;
    async function loadTemps() {
      if (TEMPS) return;
      const rows = await fetchAll('meter_daily', 'd, temp_min, temp_max', 'd');
      TEMPS = {}; rows.forEach(r => { if (r.temp_min !== null && r.temp_max !== null) TEMPS[r.d] = (Number(r.temp_min) + Number(r.temp_max)) / 2; });
      await loadWWD();
    }
    let causeDays = 120, causeUtil = 'elec', causeYm = null, causeCmp = 'prev';
    function shiftCauseMonth(d) { causeYm = d > 0 ? UT.nextYm(causeYm) : UT.prevYm(causeYm); renderCause(); }
    // 그 달 이상 사용일 (과다만)
    function monthAnoms(ym, uk) {
      const first = UT.dateStr(ym, 1), last0 = UT.dateStr(ym, UT.daysIn(ym)), y1 = UT.addDays(todayStr, -1);
      const last = last0 < y1 ? last0 : y1; if (first > last) return [];
      return UT.anomalies(DAILY, first, last, { ratio: 1.4 }).filter(a => a.u === uk && a.kind === '과다');
    }
    // 하루 단위(가스 ㎥) → 월 단위(가스 MJ) 환산
    function dailyToMonthly(ym, uk, v) {
      if (uk !== 'gas') return v;
      const m = UT.effective(ym, MONTHLY, DAILY, {}); const h = Number(m.gas_heat) || 42.5, c = Number(m.gas_boiler_corr) || 1;
      return v * h * c;
    }
    // =====================================================================
    // 📐 기준 식 — 지표 분석 · 원인 찾기 · 목표·예산이 모두 같은 식을 씀 (전기·가스)
    //   순서: 🔒 확정한 식 → 직접 고른 지표 → 자동 식 · 연도 = 지금 목표를 세우는 해 (pickYear)
    // =====================================================================
    const STD_CACHE = {};
    function stdInfo(uk) { // 같은 조건이면 다시 계산하지 않음 (기준 식 계산이 무거워서 — 하루 식이 날마다 부르면 화면이 느려짐)
      const y0 = pickYear(), t0 = tgt(y0), key = uk + '|' + y0 + '|' + JSON.stringify([t0.pick, t0.lock, t0.base, t0.excl]) + '|' + (PRODD ? 1 : 0) + (TEMPS ? 1 : 0) + (BT ? 1 : 0) + '|' + Object.keys(MONTHLY).length + '|' + JSON.stringify((YEARDATA[9999] || {}).equip || []);
      if (STD_CACHE[key] !== undefined) return STD_CACHE[key];
      Object.keys(STD_CACHE).forEach(k => { if (k.startsWith(uk + '|')) delete STD_CACHE[k]; });
      return (STD_CACHE[key] = stdInfo0(uk));
    }
    function stdInfo0(uk) {
      const y = pickYear(), t = tgt(y), ms = fitModels(t, y), m = ms[uk]; if (!m) return null;
      const L = lockOf(t, uk), pk = (ms._pick || {})[uk], src = m.locked ? 'lock' : m.pick && !m.auto ? 'pick' : 'auto';
      const sp = m.pick ? { feats: m.feats, coef: m.coef } : lockSpec(m, uk, t, y);
      return { y, t, m, src, feats: sp ? sp.feats : null, coef: sp ? sp.coef : null, pickErr: pk && (pk.err || pk.neg) ? (pk.err || '마이너스 계수') : null, lockAt: L ? (t.lock.at || '') : '' };
    }
    function stdBadgeHtml(uk, where) {
      if (uk !== 'elec' && uk !== 'gas') return '';
      const I = stdInfo(uk), U = PICK_U[uk]; if (!I) return `<div class="std-badge"><b>📐 ${U.name} 기준 식</b> <span class="hint">아직 만들 수 없음 (기준 달 부족)</span></div>`;
      const cf = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
      const srcT = I.src === 'lock' ? `🔒 확정한 식 (${esc(I.lockAt)})` : I.src === 'pick' ? '직접 고른 지표' : '자동 식 (확정 전 — 데이터가 쌓이면 바뀔 수 있음)';
      const b = baseFor(I.t, I.y, uk);
      const fml = I.feats ? I.feats.map((f, i) => `${facName(f)} ${facUnit(f) ? facUnit(f) + '당 ' : ''}<b>${cf(I.coef[i])}</b>`).join(' + ') : '휴무일 기준 예비 식';
      const go = where === 'period' ? '' : ` · <a href="#" onclick="switchTab('period');setTimeout(()=>{const e=document.getElementById('ind-body');if(e)e.scrollIntoView({behavior:'smooth',block:'center'})},600);return false">지표 바꾸기 (지표 분석)</a>`;
      const planTxt = where === 'target' ? `<div class="hint" style="margin-top:2px">📌 내년에 설비 증설·운전시간 변경 계획이 있으면 아래 ④ 연간 계획표 위 「계획 부하 변동」에 적으면 목표에 더해집니다 (특이사항은 실제 있었던 일만).</div>` : '';
      return `<div class="std-badge"><b>📐 ${I.y}년 ${U.name} 기준 식</b> ${Portal.tip('std')} <span class="std-src ${I.src}">${srcT}</span><div>${U.part} = ${fml} ${uk === 'gas' ? ' <span class="hint">+ 식당 가스 (실측)</span>' : ' <span class="hint">(파워플래너 전체 — 생산동·폐수동·공조냉동 모두)</span>'}</div>
        <div class="hint">기준 달 ${b.length ? `${b[0].slice(2).replace('-', '.')} ~ ${b[b.length - 1].slice(2).replace('-', '.')} (${b.length}개월)` : '-'} · 월 평균 오차 ±${nf1.format(I.m.mape || 0)}%${I.pickErr ? ` · <span class="warn">고른 지표는 ${esc(I.pickErr)}라 자동 식 사용</span>` : ''} — 지표 분석에서 고른 이 식으로 <b>목표·예산</b>이 계산됩니다${go}</div>${planTxt}</div>`;
    }
    // 증감 원인 나누기 — 기준 식(확정 → 고른 지표 → 자동)으로
    function decompose(ym, ym0, uk) {
      const I = (uk === 'elec' || uk === 'gas') ? stdInfo(uk) : null;
      if (I && I.m && I.m.pick && !(uk === 'elec' && (ym < HVAC_FULL_FROM || ym0 < HVAC_FULL_FROM))) return decomposePick(ym, ym0, uk, I);
      const y = I ? I.y : Number(ym.slice(0, 4)), t = tgt(y);
      const models = fitModels(t, y, true), mdl = models[uk];
      const r = monthRow(ym), r0 = monthRow(ym0);
      const fill = x => { if (x.hdd === null) { const nm = normals()[Number(x.ym.slice(5))]; if (nm) { x.hdd = nm.hdd; x.cdd = nm.cdd; x.wxGuess = true; } } };
      fill(r); fill(r0);
      const act = r[uk], act0 = r0[uk];
      if (act === null || act0 === null || act === undefined || act0 === undefined) return { err: '두 달 중 사용량이 없는 달이 있습니다.' };
      const out = { act, act0, diff: act - act0, r, r0, mdl, parts: [] };
      if (!mdl) { out.err = '예상 사용량 식을 만들 기준 달이 부족합니다 (목표·예산 탭 ①).'; return out; }
      if (mdl.prep) { mdl.prep(r); mdl.prep(r0); }
      const miss = mdl.feats.filter(f => r[f] === null || r[f] === undefined || r0[f] === null || r0[f] === undefined || (f === 'prod' && (!r.prod || !r0.prod)));
      if (miss.length) { out.err = `${miss.includes('prod') ? '원육 투입량' : '기온'} 기록이 없는 달이 있어 요인별로 나눌 수 없습니다. (가동 초기 달이면 비교 달을 '전월'로 바꿔 보세요)`; out.mdl = null; return out; }
      const grp = { days: '달력 날수', op: '생산일', prod: '원육 투입량', hdd: '날씨 (기온)', cdd: '날씨 (기온)', wx: '날씨 (기온)', cx: '날씨 (기온)', wwk: '폐수동 (실측)', hvk: '공조냉동 (실측)', eq: '부하 변동 (생산동·기타)', grest: '식당 가스 (실측)' };
      const by = {};
      out.coef = Object.fromEntries(mdl.feats.map((f, i) => [f, mdl.coef[i]]));
      mdl.feats.forEach((f, i) => { if (r[f] === null || r0[f] === null) return; const v = mdl.coef[i] * (r[f] - r0[f]); by[grp[f]] = (by[grp[f]] || 0) + v; });
      const explained = Object.values(by).reduce((a, b) => a + b, 0);
      // 이상 사용일: 평소보다 더 쓴 양 (이번 달 − 비교 달)
      const an = monthAnoms(ym, uk), an0 = monthAnoms(ym0, uk);
      const ex = list => list.reduce((s2, a) => s2 + dailyToMonthly(ym, uk, a.v - (a.base || 0)), 0);
      const anomPart = ex(an) - ex(an0);
      const rest = out.diff - explained - anomPart;
      out.parts = ['폐수동 (실측)', '공조냉동 (실측)', '식당 가스 (실측)', '부하 변동 (생산동·기타)', '생산일', '달력 날수', '원육 투입량', '날씨 (기온)'].filter(g => g in by && !(g === '부하 변동 (생산동·기타)' && Math.abs(by[g]) < 0.5)).map(g => [g, by[g]]).concat([['이상 사용일', anomPart], ['운전·관리 차이', rest]]);
      out.an = an; out.an0 = an0; out.explained = explained; out.rest = rest;
      return out;
    }
    // 기준 식이 「고른 지표/확정」일 때: 지표마다 계수 × (이번 달 − 비교 달)
    function decomposePick(ym, ym0, uk, I) {
      const m = I.m, F = m.feats, r = monthRow(ym), r0 = monthRow(ym0), act = r[uk], act0 = r0[uk];
      if (act === null || act0 === null || act === undefined || act0 === undefined) return { err: '두 달 중 사용량이 없는 달이 있습니다.' };
      const out = { act, act0, diff: act - act0, r, r0, mdl: m, parts: [], pickMode: true, std: I };
      const x1 = F.map(f => facOf(ym, f)), x0 = F.map(f => facOf(ym0, f)), bad = F.filter((f, i) => [x1[i], x0[i]].some(v => v === null || v === undefined || isNaN(v)));
      if (bad.length) { out.err = `${bad.map(facName).join(', ')} 자료가 없는 달이 있어 요인별로 나눌 수 없습니다. (비교 달을 바꿔 보세요)`; out.mdl = null; return out; }
      const by = [];
      if (uk === 'elec') { [r, r0].forEach(x => { x.wwk = wwKwh(x.ym) || 0; x.hvk = meterKwh(x.ym, 'elec_hvac_kwh') || 0; x.eq = equipKwh(x.ym, ['생산동', '기타']); });
        by.push(['폐수동 (실측)', r.wwk - r0.wwk], ['공조냉동 (실측)', r.hvk - r0.hvk]); if (Math.abs(r.eq - r0.eq) >= 0.5) by.push(['부하 변동 (생산동·기타)', r.eq - r0.eq]); }
      else { [r, r0].forEach(x => { x.grest = gasRestMJ({ ym: x.ym, days: UT.daysIn(x.ym) }, null) || 0; }); by.push(['식당 가스 (실측)', r.grest - r0.grest]); }
      out.fac = F.map((f, i) => ({ f, x0: x0[i], x1: x1[i], c: m.coef[i], v: m.coef[i] * (x1[i] - x0[i]) }));
      out.fac.forEach(o => by.push([facName(o.f), o.v]));
      const explained = by.reduce((a, b) => a + b[1], 0);
      const an = monthAnoms(ym, uk), an0 = monthAnoms(ym0, uk), ex = list => list.reduce((s2, a) => s2 + dailyToMonthly(ym, uk, a.v - (a.base || 0)), 0);
      const anomPart = ex(an) - ex(an0), rest = out.diff - explained - anomPart;
      out.parts = by.concat([['이상 사용일', anomPart], ['운전·관리 차이', rest]]); out.an = an; out.an0 = an0; out.explained = explained; out.rest = rest;
      return out;
    }
    function causeSentences(ym, ym0, uk, D, short) {
      if (D.pickMode) return causeSentencesPick(ym, ym0, uk, D);
      const U = UT.UTILS.find(u => u.k === uk), un = U.unit, fx = v => `${v >= 0 ? '+' : '−'}${f0(Math.abs(v))} ${un}`;
      const ml = x => `${Number(x.slice(5))}월`, cmpName = ym0.slice(0, 4) === ym.slice(0, 4) ? ml(ym0) : `작년 ${ml(ym0)}`;
      const pct = D.act0 ? D.diff / D.act0 * 100 : null;
      const lead = `${ml(ym)} ${U.name} 사용량은 <b>${f0(D.act)} ${un}</b>로 ${cmpName}(${f0(D.act0)})보다 <b class="${D.diff > 0 ? 'up' : 'down'}">${f0(Math.abs(D.diff))} ${un}${pct !== null ? ` (${nf1.format(Math.abs(pct))}%)` : ''} ${D.diff > 0 ? '늘었습니다' : '줄었습니다'}</b>.`;
      if (D.err && !D.mdl) return { lead, rows: [], concl: D.err, plain: `${ml(ym)} ${U.name}: ${cmpName} 대비 ${D.diff >= 0 ? '+' : '−'}${f0(Math.abs(D.diff))} ${un}` };
      const r = D.r, r0 = D.r0, rows = [], P = Object.fromEntries(D.parts);
      const pd = x => x.op ? x[uk] / x.op : null;
      const opInfo = `생산일 ${r0.op}일 → ${r.op}일 (${r.op - r0.op >= 0 ? '+' : '−'}${Math.abs(r.op - r0.op)}일)`;
      // 계산식 보여주기: 차이 × 예상식 계수
      const C = D.coef || {}, sg = v => (v >= 0 ? '+' : '−'), cf = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
      const calc = (f, d, du, per) => C[f] === undefined ? '' : `<br><span class="calc">= ${sg(d)}${cf(Math.abs(d))}${du} × ${cf(C[f])} ${un}/${per || du.trim()}</span>`;
      const pdSrc = x => { const m = MONTHLY[x.ym] || {}; return m.prod_days !== undefined && m.prod_days !== null && m.prod_days !== '' ? '생산팀 기록' : '보일러 가스로 추정'; };
      const srcTxt = pdSrc(r) === pdSrc(r0) ? pdSrc(r) : `${pdSrc(r0)} → ${pdSrc(r)}`;
      // 실측 계량기 줄: 실측 차이 + 부하 변동 사항 + 일지 값 (예상 kWh 계산은 하지 않음)
      const mnote = k => [r0, r].map(x => { const n = (UT.effective(x.ym, MONTHLY, DAILY, {})._note || {})[k]; return n ? `<br><span class="hint" style="color:#b26a00">· ${Number(x.ym.slice(5))}월: ${esc(n)}</span>` : ''; }).join('');
      const perDay = (v, x) => v === null || v === undefined ? '-' : f0(v / x.days);
      const evs = area => { const from = UT.dateStr(r0.ym, 1), to = UT.dateStr(r.ym, UT.daysIn(r.ym));
        const l = equipList().filter(x => x.area === area && x.d >= from && x.d <= to).sort((p, q) => p.d < q.d ? -1 : 1);
        return l.length ? l.map(x => `<br><span class="calc">· ${Number(x.d.slice(5, 7))}/${Number(x.d.slice(8))} ${esc(x.name)}${x.note ? ': ' + esc(x.note) : ''}</span>`).join('') : `<br><span class="hint">· 이 기간 부하 변동 사항 없음</span>`; };
      const wwn = () => { const from = UT.dateStr(r0.ym, 1), to = UT.dateStr(r.ym, UT.daysIn(r.ym)), l = WWNOTE.filter(x => x.d >= from && x.d <= to);
        return l.length ? l.map(x => `<br><span class="calc" style="color:#6a3d9a">· 폐수장 ${Number(x.d.slice(5, 7))}/${Number(x.d.slice(8))} [${esc(x.cat || '기타')}] ${esc(x.text)}${x.act ? ' → ' + esc(x.act) : ''}</span>`).join('') : ''; };
      if ('폐수동 (실측)' in P) {
        const a = wwRow(r.ym), b = wwRow(r0.ym);
        const j = [b.flow !== null && a.flow !== null ? `방류량 ${f0(b.flow)} → ${f0(a.flow)} ㎥` : '', b.sludgeGen !== null && a.sludgeGen !== null ? `슬러지 발생량 ${f0(b.sludgeGen)} → ${f0(a.sludgeGen)} kg (탈수기 가동 기준)` : ''].filter(Boolean).join(', ');
        rows.push(['폐수동 (실측)', `폐수동 계량기 ${f0(r0.wwk)} → ${f0(r.wwk)} ${un} (하루 ${perDay(r0.wwk, r0)} → ${perDay(r.wwk, r)})${mnote('elec_ww_kwh')}${evs('폐수동')}${wwn()}${j ? `<br><span class="hint">· 일지: ${j}</span>` : ''}`, P['폐수동 (실측)']]);
      }
      if ('공조냉동 (실측)' in P) rows.push(['공조냉동 (실측)', `냉동·냉장·공조 계량기 12개 합 ${f0(r0.hvk)} → ${f0(r.hvk)} ${un} (하루 ${perDay(r0.hvk, r0)} → ${perDay(r.hvk, r)})${mnote('elec_hvac_kwh')}${evs('공조냉동')}`, P['공조냉동 (실측)']]);
      if ('식당 가스 (실측)' in P) rows.push(['식당 가스 (실측)', `식당(기숙사) 가스 ${f0(r0.grest)} → ${f0(r.grest)} ${un} · 보일러와 따로 계량 — 생산과 관계없어 실측 그대로`, P['식당 가스 (실측)']]);
      if ('부하 변동 (생산동·기타)' in P) rows.push(['부하 변동 (생산동·기타)', `특이사항 탭에 ⚡ 부하 변동으로 적은 생산동·기타 부하 ${f0(r0.eq)} → ${f0(r.eq)} ${un}${evs('생산동')}`, P['부하 변동 (생산동·기타)']]);
      if ('생산일' in P) rows.push(['생산일', `${opInfo} · ${srcTxt}${calc('op', r.op - r0.op, '일')}`, P['생산일']]);
      if ('달력 날수' in P) rows.push(['달력 날수', `${r0.days}일 → ${r.days}일 · ${(D.mdl.idle || D.mdl.hall) && uk === 'elec' ? '원육 양과 관계없는 생산동 고정분의 하루 평균 (쉬는 날 대기전력 + 생산일 기본 부하)' : '냉동·공조처럼 매일 도는 몫'}${calc('days', r.days - r0.days, '일', D.mdl.idle ? '일 (휴무일 기본)' : '')}`, P['달력 날수']]);
      rows.push(['원육 투입량', `${f0(r0.prod)} → ${f0(r.prod)} kg (${r.prod - r0.prod >= 0 ? '+' : '−'}${f0(Math.abs(r.prod - r0.prod))})${calc('prod', r.prod - r0.prod, 'kg')}`, P['원육 투입량'] || 0]);
      const wf = D.mdl.feats.find(f => f === 'hdd' || f === 'cdd');
      if (wf) rows.push(['날씨 (기온)', `${wf === 'cdd' ? '냉방도일' : '난방도일'} ${f0(r0[wf])} → ${f0(r[wf])} (${Math.abs(r[wf] - r0[wf]) < 0.5 ? (r[wf] < 0.5 ? (wf === 'cdd' ? '둘 다 냉방 필요 없는 날씨' : '둘 다 난방 필요 없는 날씨') : '비슷함') : wf === 'cdd' ? (r[wf] > r0[wf] ? '더 더움' : '덜 더움') : (r[wf] > r0[wf] ? '더 추움' : '덜 추움')})${r.wxGuess || r0.wxGuess ? ' · 기온 기록 부족해 평년값 사용' : ''}${calc(wf, r[wf] - r0[wf], '', wf === 'cdd' ? '냉방도일' : '난방도일')}`, P['날씨 (기온)'] || 0]);
      if (D.mdl.hall && (D.mdl.Tb !== null || D.mdl.Tc !== null) && uk === 'elec') rows.push(['날씨 (기온)', `평균기온 ${r0.tmean == null ? '-' : nf1.format(r0.tmean) + '℃'} → ${r.tmean == null ? '-' : nf1.format(r.tmean) + '℃'}${D.mdl.Tb !== null ? ` · 생산동 계량기 없는 냉방(칠러·실외기 등) 몫<br><span class="calc">= ${D.mdl.Tb}℃ 넘는 기온 합 ${f0(r0.wx)} → ${f0(r.wx)} (℃·일) × ${cf(D.mdl.coef[2])} kWh</span>` : ''}${D.mdl.Tc !== null ? `<br>· 현장 온수 전기보일러 몫<br><span class="calc">= ${D.mdl.Tc}℃ 아래 기온 합 ${f0(r0.cx)} → ${f0(r.cx)} (℃·일) × ${cf(D.mdl.coef[3])} kWh</span>` : ''}<br><span class="hint">· 냉동·냉장·공조 12곳은 위 공조냉동 실측에 들어 있습니다</span>`, P['날씨 (기온)'] || 0]);
      else if (((D.mdl.idle && !(D.mdl.idle.b || D.mdl.idle.c)) || D.mdl.hall) && uk === 'elec') rows.push(['날씨 (기온)', `평균기온 ${r0.tmean == null ? '-' : nf1.format(r0.tmean) + '℃'} → ${r.tmean == null ? '-' : nf1.format(r.tmean) + '℃'}<br><span class="hint">· 기온에 따른 차이는 위 공조냉동 실측에 들어 있습니다 (계량기 없는 나머지 부하는 기온과 관계없이 일정)</span>`, 0]);
      else if (D.mdl.idle) rows.push(['날씨 (기온)', `평균기온 ${r0.tmean == null ? '-' : nf1.format(r0.tmean) + '℃'} → ${r.tmean == null ? '-' : nf1.format(r.tmean) + '℃'} · 실외기 등 기온 영향 ${f0(r0.wx)} → ${f0(r.wx)} ${un}${r.wxGuess || r0.wxGuess ? ' · 기온 기록 부족해 평년값 사용' : ''}<br><span class="calc">= 휴무일 식(${D.mdl.idle.Tb}℃ 넘는 1℃마다 하루 ${cf(D.mdl.idle.b)} ${un}${D.mdl.idle.c ? `, ${D.mdl.idle.Tc}℃ 아래 1℃마다 하루 ${cf(D.mdl.idle.c)}` : ''})으로 날마다 계산해 더한 차이</span>`, P['날씨 (기온)'] || 0]);
      rows.push(['이상 사용일', `이번 ${D.an.length}일 / 비교 달 ${D.an0.length}일`, P['이상 사용일']]);
      rows.push(['운전·관리 차이', '위 요인을 모두 뺀 나머지 = 실제로 아끼거나 더 쓴 몫', D.rest, true]);
      let ref = '';
      const tol = D.mdl.mape || 5, restPct = D.act ? D.rest / D.act * 100 : 0;
      const big = rows.filter(x => !x[3]).filter(x => Math.abs(x[2]) > 0.5).sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, 2);
      let concl = big.length ? `가장 크게 작용한 건 <b>${big.map(x => `${x[0]}(${fx(x[2])})`).join(', ')}</b>입니다. ` : '';
      concl += Math.abs(restPct) <= tol ? `${uk === 'elec' ? '실측(폐수동·공조냉동)·' : ''}생산일·원육·날씨·이상 사용일을 빼면 운전·관리 차이는 ${fx(D.rest)} (${nf1.format(restPct)}%)로 <b>예상 오차(±${nf1.format(tol)}%) 안 — 큰 변화 없음</b>.`
        : D.rest < 0 ? `그걸 빼고도 <b class="down">${f0(-D.rest)} ${un} (${nf1.format(-restPct)}%) 덜 썼습니다 → 실제 절감</b>으로 볼 수 있습니다.`
        : `그걸 빼고도 <b class="up">${f0(D.rest)} ${un} (${nf1.format(restPct)}%) 더 썼습니다 → 원인 확인 필요</b> (설비 운전시간·누수·미차단 등).`;
      const plain = `${ml(ym)} ${U.name}: ${cmpName} 대비 ${D.diff >= 0 ? '+' : '−'}${f0(Math.abs(D.diff))} ${un}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${nf1.format(pct)}%)` : ''} — ` +
        rows.filter(x => Math.abs(x[2]) >= 0.5).map(x => `${x[0]} ${fx(x[2])}`).join(', ');
      const fu = v => fU(v, uk);
      const p1 = pd(r), p0 = pd(r0), u1 = r.prod ? r[uk] / r.prod : null, u0 = r0.prod ? r0[uk] / r0.prod : null;
      const per = `<div class="cz-per"><span>생산일 하루당 <b>${p0 === null ? '-' : f0(p0)} → ${p1 === null ? '-' : f0(p1)}</b> ${un} ${pctTxt(p1, p0)}</span><span>원육 kg당 <b>${u0 === null ? '-' : fu(u0)} → ${u1 === null ? '-' : fu(u1)}</b> ${un} ${pctTxt(u1, u0)}</span>` +
        (!('생산일' in P) ? `<span class="hint">${opInfo} — ${uk === 'elec' && D.mdl.hall ? '전기는 생산일 대신 원육 투입량으로 계산합니다 (생산일이 늘면 원육도 같이 늘어 둘 다 넣으면 같은 몫을 두 번 셈)' : `${U.name}는 생산일보다 달력 날수 영향이 커서 날수로 계산합니다`}</span>` : '') + `</div>`;
      concl = per + concl;
      if (ref) concl += `<div class="hint" style="margin-top:6px">${ref}</div>`;
      concl += `<div class="hint" style="margin-top:4px">※ ${uk === 'elec' ? '폐수동·공조냉동은 계량기 실측, ' : ''}생산일·날수·원육·날씨 몫은 목표·예산 탭 ①의 예상 사용량 식(월 평균 오차 ±${nf1.format(tol)}%)으로 계산한 추정값입니다.</div>`;
      return { lead, rows, concl, plain };
    }
    function causeSentencesPick(ym, ym0, uk, D) {
      const U = UT.UTILS.find(u => u.k === uk), un = U.unit, fx = v => `${v >= 0 ? '+' : '−'}${f0(Math.abs(v))} ${un}`;
      const ml = x => `${Number(x.slice(5))}월`, cmpName = ym0.slice(0, 4) === ym.slice(0, 4) ? ml(ym0) : `작년 ${ml(ym0)}`, pct = D.act0 ? D.diff / D.act0 * 100 : null;
      const lead = `${ml(ym)} ${U.name} 사용량은 <b>${f0(D.act)} ${un}</b>로 ${cmpName}(${f0(D.act0)})보다 <b class="${D.diff > 0 ? 'up' : 'down'}">${f0(Math.abs(D.diff))} ${un}${pct !== null ? ` (${nf1.format(Math.abs(pct))}%)` : ''} ${D.diff > 0 ? '늘었습니다' : '줄었습니다'}</b>.`;
      if (D.err && !D.mdl) return { lead, rows: [], concl: D.err, plain: `${ml(ym)} ${U.name}: ${cmpName} 대비 ${D.diff >= 0 ? '+' : '−'}${f0(Math.abs(D.diff))} ${un}` };
      const r = D.r, r0 = D.r0, P = Object.fromEntries(D.parts), rows = [];
      const cf = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR'), fv = (v, f) => { const d = (PE_FAC.find(z => z[0] === f) || [])[3]; return Math.abs(v) >= 100 || d === 0 ? f0(v) : nf1.format(v); };
      const perDay = (v, x) => v === null || v === undefined ? '-' : f0(v / UT.daysIn(x.ym));
      if ('폐수동 (실측)' in P) rows.push(['폐수동 (실측)', `폐수동 계량기 ${f0(r0.wwk)} → ${f0(r.wwk)} ${un} (하루 ${perDay(r0.wwk, r0)} → ${perDay(r.wwk, r)})`, P['폐수동 (실측)']]);
      if ('공조냉동 (실측)' in P) rows.push(['공조냉동 (실측)', `냉동·냉장·공조 계량기 합 ${f0(r0.hvk)} → ${f0(r.hvk)} ${un} (하루 ${perDay(r0.hvk, r0)} → ${perDay(r.hvk, r)})`, P['공조냉동 (실측)']]);
      if ('부하 변동 (생산동·기타)' in P) rows.push(['부하 변동 (생산동·기타)', `특이사항 ⚡ 부하 변동 ${f0(r0.eq)} → ${f0(r.eq)} ${un}`, P['부하 변동 (생산동·기타)']]);
      if ('식당 가스 (실측)' in P) rows.push(['식당 가스 (실측)', `식당(기숙사) 가스 ${f0(r0.grest)} → ${f0(r.grest)} ${un} · 실측 그대로`, P['식당 가스 (실측)']]);
      D.fac.forEach(o => { const u = facUnit(o.f), d = o.x1 - o.x0; rows.push([facName(o.f), `${fv(o.x0, o.f)} → ${fv(o.x1, o.f)} ${u} (${d >= 0 ? '+' : '−'}${fv(Math.abs(d), o.f)})<br><span class="calc">= ${d >= 0 ? '+' : '−'}${fv(Math.abs(d), o.f)} ${u} × ${cf(o.c)} ${un}/${u || '단위'}</span>`, o.v]); });
      rows.push(['이상 사용일', `이번 ${D.an.length}일 / 비교 달 ${D.an0.length}일`, P['이상 사용일']]);
      rows.push(['운전·관리 차이', '위 요인을 모두 뺀 나머지 = 실제로 아끼거나 더 쓴 몫', D.rest, true]);
      const tol = D.mdl.mape || 5, restPct = D.act ? D.rest / D.act * 100 : 0;
      const big = rows.filter(x => !x[3]).filter(x => Math.abs(x[2]) > 0.5).sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, 2);
      let concl = big.length ? `가장 크게 작용한 건 <b>${big.map(x => `${x[0]}(${fx(x[2])})`).join(', ')}</b>입니다. ` : '';
      concl += Math.abs(restPct) <= tol ? `기준 식으로 설명되는 몫과 이상 사용일을 빼면 운전·관리 차이는 ${fx(D.rest)} (${nf1.format(restPct)}%)로 <b>예상 오차(±${nf1.format(tol)}%) 안 — 큰 변화 없음</b>.`
        : D.rest < 0 ? `그걸 빼고도 <b class="down">${f0(-D.rest)} ${un} (${nf1.format(-restPct)}%) 덜 썼습니다 → 실제 절감</b>으로 볼 수 있습니다.` : `그걸 빼고도 <b class="up">${f0(D.rest)} ${un} (${nf1.format(restPct)}%) 더 썼습니다 → 원인 확인 필요</b> (설비 운전시간·누수·미차단 등).`;
      concl += `<div class="hint" style="margin-top:4px">※ 지표 몫은 📐 기준 식(${D.std.src === 'lock' ? '확정한 식' : '직접 고른 지표'}, 월 평균 오차 ±${nf1.format(tol)}%)으로 계산한 추정값입니다.</div>`;
      const plain = `${ml(ym)} ${U.name}: ${cmpName} 대비 ${D.diff >= 0 ? '+' : '−'}${f0(Math.abs(D.diff))} ${un}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${nf1.format(pct)}%)` : ''} — ` + rows.filter(x => Math.abs(x[2]) >= 0.5).map(x => `${x[0]} ${fx(x[2])}`).join(', ');
      return { lead, rows, concl, plain };
    }
    // 원인 찾기 ①: 이번 달과 비교 달의 실제 값 (추정·몫 나누기 없음)
    function causeFacts(ym, ym0, uk) {
      const U = UT.UTILS.find(u => u.k === uk), a = S(ym), b = S(ym0), un = U.unit;
      const w1 = UT.monthWeather(ym, TEMPS || {}), w0 = UT.monthWeather(ym0, TEMPS || {}), r1 = peRow(ym), r0 = peRow(ym0);
      const op1 = UT.opDays(DAILY, ym, MONTHLY), op0 = UT.opDays(DAILY, ym0, MONTHLY);
      const rows = [];
      const add = (n, v0, v1, u, d = 0, key) => { if ((v0 === null || v0 === undefined) && (v1 === null || v1 === undefined)) return; rows.push({ n, v0, v1, u, d, key }); };
      add(`<b>${U.name} 사용량</b>`, a && b ? b[uk].usage : null, a[uk].usage, un, 0, true);
      if (uk === 'elec') { add('· 폐수동 (계량기)', wwKwh(ym0), wwKwh(ym), 'kWh'); add('· 공조냉동 (계량기)', meterKwh(ym0, 'elec_hvac_kwh'), meterKwh(ym, 'elec_hvac_kwh'), 'kWh');
        const h0 = r0.c.hall, h1 = r1.c.hall; add('· 생산동 (전체 − 폐수동 − 공조냉동)', h0, h1, 'kWh'); }
      if (uk === 'gas') { add('· 보일러', r0.c.gb, r1.c.gb, 'MJ'); add('· 식당', r0.c.gr, r1.c.gr, 'MJ'); }
      add(`${U.name} 비용`, b[uk].cost, a[uk].cost, '원');
      add('원육 투입량', b.production, a.production, 'kg');
      add('완제품 중량', r0.f.pkg, r1.f.pkg, 'kg'); add('포장 생산량 (완제품 EA)', r0.f.ea, r1.f.ea, 'EA');
      add('생산일수', op0, op1, '일'); add('달력 날수', UT.daysIn(ym0), UT.daysIn(ym), '일');
      add('평균기온', w0.tmean, w1.tmean, '℃', 1);
      if (uk === 'gas') { add('보일러 켠 시간', r0.f.boilH, r1.f.boilH, 'h', 1); add('레토르트 회차', r0.f.retN, r1.f.retN, '회'); }
      const per = (x, d) => x.usage && d ? x.usage / d : null;
      add(`원육 kg당 ${un}`, b.production ? b[uk].usage / b.production : null, a.production ? a[uk].usage / a.production : null, `${un}/kg`, 3);
      add(`생산일 하루당 ${un}`, per(b[uk], op0), per(a[uk], op1), un);
      const fmt = (v, d) => v === null || v === undefined || isNaN(v) ? '-' : d ? v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }) : f0(v);
      const html = `<table class="t" style="width:100%"><tr><th class="l">항목</th><th>${ymLabel(ym0)}</th><th>${ymLabel(ym)}</th><th>차이</th><th>%</th></tr>` +
        rows.map(r => { const ok = r.v0 !== null && r.v0 !== undefined && r.v1 !== null && r.v1 !== undefined && !isNaN(r.v0) && !isNaN(r.v1), dd = ok ? r.v1 - r.v0 : null, pc = ok && r.v0 && r.u !== '℃' ? dd / Math.abs(r.v0) * 100 : null;
          return `<tr${r.key ? ' style="font-weight:600;background:#f6f8fb"' : ''}><td class="l">${r.n}</td><td>${fmt(r.v0, r.d)} <span class="hint">${r.u}</span></td><td>${fmt(r.v1, r.d)} <span class="hint">${r.u}</span></td><td class="${dd > 0 ? 'up' : dd < 0 ? 'down' : ''}">${dd === null ? '-' : (dd > 0 ? '+' : dd < 0 ? '−' : '') + fmt(Math.abs(dd), r.d)}</td><td class="${pc > 0 ? 'up' : pc < 0 ? 'down' : ''}">${pc === null ? '' : (pc >= 0 ? '+' : '') + nf1.format(pc) + '%'}</td></tr>`; }).join('') +
        `</table><div class="hint" style="margin-top:6px">추정 없이 두 달의 실제 값만 나란히 봅니다. 사용량이 바뀐 만큼 원육·생산일·기온·계량기 구성 중 무엇이 같이 바뀌었는지 보고, 아래 ② 튄 날 · ③ 특이사항으로 원인을 찾아 ④에 정리하세요.</div>`;
      const pct = a[uk].usage && b[uk].usage ? (a[uk].usage / b[uk].usage - 1) * 100 : null;
      const plain = `${Number(ym.slice(5))}월 ${U.name}: ${ymLabel(ym0)} 대비 ${a[uk].usage !== null && b[uk].usage !== null ? `${a[uk].usage - b[uk].usage >= 0 ? '+' : '−'}${f0(Math.abs(a[uk].usage - b[uk].usage))} ${un}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${nf1.format(pct)}%)` : ''}` : '-'}` +
        ` · 원육 ${b.production && a.production ? `${a.production - b.production >= 0 ? '+' : '−'}${f0(Math.abs(a.production - b.production))}kg` : '-'} · 생산일 ${op0 !== null && op1 !== null ? `${op1 - op0 >= 0 ? '+' : '−'}${Math.abs(op1 - op0)}일` : '-'} · 평균기온 ${w0.tmean !== null && w1.tmean !== null ? `${nf1.format(w0.tmean)} → ${nf1.format(w1.tmean)}℃` : '-'}`;
      return { html, plain };
    }
    async function renderCause() {
      if (!window.Chart) return;
      try { await loadTemps(); } catch (e) { TEMPS = {}; }
      if (!causeYm) causeYm = lastCompleteYm();
      const ym = causeYm, y = Number(ym.slice(0, 4)), ym0 = causeCmp === 'prev' ? UT.prevYm(ym) : UT.ym(y - 1, Number(ym.slice(5)));
      document.getElementById('cause-month').textContent = ymLabel(ym);
      try { const cn = document.getElementById('cz-notes'); if (cn) cn.innerHTML = causeNotesHtml(ym, ym0, causeUtil); } catch (e) { }
      document.getElementById('cause-chips').innerHTML = UT.UTILS.map(u => `<button class="chip ${causeUtil === u.k ? 'on' : ''}" onclick="causeUtil='${u.k}';renderCause()">${u.name}</button>`).join('') +
        ' &nbsp; 비교: ' + [['prev', '전월'], ['ly', '작년 같은 달']].map(([k, n]) => `<button class="chip ${causeCmp === k ? 'on' : ''}" onclick="causeCmp='${k}';renderCause()">${n}</button>`).join('');
      const uk = causeUtil, U = UT.UTILS.find(u => u.k === uk);
      { const sb2 = document.getElementById('cz-std'); if (sb2) sb2.innerHTML = ''; }
      // ① 무엇이 달라졌나 — 추정 없이 실제 값만 비교 (사용량·생산·기온)
      const F = causeFacts(ym, ym0, uk);
      document.getElementById('cz-title').textContent = `① ${U.name} — ${ymLabel(ym)} vs ${ymLabel(ym0)} 무엇이 달라졌나`;
      document.getElementById('cz-text').innerHTML = F.html;
      const cb = document.getElementById('chart-cz'); if (cb) cb.closest('.chart-box').hidden = true;

      // 이상 사용일 + 메모
      const W = ['일', '월', '화', '수', '목', '금', '토'];
      const an = monthAnoms(ym, uk), DU = UT.DAILY_UTILS.find(u => u.k === uk);
      document.getElementById('cz-anom').innerHTML = !DU ? '' : !an.length ? `<div class="empty">${ymLabel(ym)}에 ${U.name} 이상 사용일이 없습니다 👍</div>` :
        `<table class="t"><tr><th>날짜</th><th>그날 사용량</th><th>평소</th><th>더 쓴 양</th><th class="l">구분</th><th class="l" style="min-width:240px">원인·조치 메모</th></tr>` +
        an.map(a => `<tr><td>${a.d.slice(5).replace('-', '/')} (${W[new Date(a.d + 'T00:00:00').getDay()]})</td><td>${f1(a.v)} ${DU.unit}</td><td>${a.base === null ? '-' : f1(a.base)}</td><td class="up">+${f1(a.v - (a.base || 0))} ${DU.unit}</td>
          <td class="l">${a.work ? '생산일 과다' : '쉬는 날 사용'}</td><td class="l">${isAdmin() ? `<input class="anom-note" data-d="${a.d}" data-u="${a.u}" value="${esc(anomNote(a.d, a.u))}" placeholder="원인·조치를 적어 주세요">` : esc(anomNote(a.d, a.u)) || '-'}</td></tr>`).join('') + '</table>' +
        (uk === 'gas' ? '<div class="hint" style="margin-top:4px">가스 하루 사용량은 ㎥, 위 계산에서는 열량(MJ)으로 바꿔 합칩니다.</div>' : '');
      bindAnomNotes('#cz-anom');

      // 이 달 원인 정리 (월간보고서 코멘트와 같은 칸)
      const cmt = (yd(y).comments || {})[ym] || '';
      document.getElementById('cz-memo').innerHTML = isAdmin()
        ? `<textarea id="cz-memo-ta" class="cz-memo-ta" placeholder="예) 9월 전기: 냉방 부하 감소로 −6,000kWh, 원육 투입 증가 +2,800kWh. 운전·관리 차이 +600kWh는 오차 범위.">${esc(cmt)}</textarea>
           <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn secondary" onclick="czAutoText()">✍ 4개 항목 자동 문장 넣기</button><button class="btn" onclick="czSaveMemo()">저장</button><span class="hint" id="cz-memo-st"></span></div>`
        : `<div style="white-space:pre-wrap">${esc(cmt) || '<span class="hint">-</span>'}</div>`;

      // ② 어느 날이 튀었나: 고른 달·유틸리티의 일별 그래프 + 최근 이상일 목록
      if (UT.DAILY_UTILS.some(u => u.k === uk)) anomUtil = uk; if (PD_UTIL[uk]) pdUtil = uk; anomMonth = ym; renderAnomaly();
      dcYm = ym; dcU = uk; const dcf = document.getElementById('dc-fold'); if (dcf && dcf.open) renderDayCmp();
      renderCauseRef();
    }
    // ---- 설비 운전 이력 편집 ----
    let EQ_EDIT = null;
    function renderEquip() {
      const el = document.getElementById('cz-equip'); if (!el) return;
      const ro = !isAdmin(); EQ_EDIT = EQ_EDIT || JSON.parse(JSON.stringify(equipList()));
      const ym = causeYm, inM = x => (x.d || '').slice(0, 7) === ym || x._new;
      const all = EQ_EDIT.map((x, i) => ({ x, i })).sort((a, b) => a.x.d < b.x.d ? 1 : -1);
      const rows = eqShowAll ? all : all.filter(o => inM(o.x));
      const inp = (i, k, v, w, type = 'text') => ro ? esc(v ?? '') : `<input class="eqi" data-i="${i}" data-k="${k}" type="${type}" value="${esc(v ?? '')}" style="width:${w}">`;
      const head = `<div style="margin-bottom:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${eqShowAll ? '전체' : ymLabel(ym)}</b> <span class="hint">${eqShowAll ? `${all.length}건` : `이 달에 있었던 부하 변동 ${rows.length}건 (전체 ${all.length}건)`}</span>
        <button class="chip ${eqShowAll ? '' : 'on'}" onclick="eqShowAll=false;renderEquip()">이 달만</button><button class="chip ${eqShowAll ? 'on' : ''}" onclick="eqShowAll=true;renderEquip()">전체 보기</button></div>`;
      el.innerHTML = head + (!rows.length ? `<div class="empty">${ymLabel(ym)}에 적어 둔 부하 변동 사항이 없습니다.</div>` : '') + `<table class="t" ${rows.length ? '' : 'hidden'}><tr><th>시작일</th><th>구역</th><th class="l">설비</th><th>대당 kW</th><th>하루 가동시간 합<br><span class="hint">대수 × 시간</span></th><th>하루 전력</th><th class="l">내용</th>${ro ? '' : '<th></th>'}</tr>` +
        rows.map(({ x, i }) => `<tr><td>${inp(i, 'd', x.d, '120px', 'date')}</td><td>${ro ? esc(x.area) : `<select class="eqi" data-i="${i}" data-k="area">${['폐수동', '공조냉동', '생산동', '기타'].map(a => `<option ${x.area === a ? 'selected' : ''}>${a}</option>`).join('')}</select>`}</td>
          <td class="l">${inp(i, 'name', x.name, '120px')}</td><td>${inp(i, 'kw', x.kw, '60px')}</td><td>${inp(i, 'hours', x.hours, '60px')}</td><td>${f0((Number(x.kw) || 0) * (Number(x.hours) || 0))} kWh</td>
          <td class="l">${inp(i, 'note', x.note, '100%')}</td>${ro ? '' : `<td><button class="chip" onclick="eqDel(${i})">삭제</button></td>`}</tr>`).join('') + '</table>' +
        (ro ? '' : `<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><button class="btn secondary" onclick="eqAdd()">+ 이력 추가</button><button class="btn" onclick="eqSave()">저장</button><span class="hint" id="eq-st"></span></div>`) +
        `<div class="hint" style="margin-top:6px">폐수동·공조냉동은 계량기로 실측하므로 원인 찾기에 <b>그 기간에 있었던 변동 내용만 코멘트</b>로 붙습니다. 생산동·기타(계량기 없는 곳)는 kW × 하루 가동시간이 전기 원인 찾기의 '부하 변동' 줄로 계산에 들어갑니다. 같은 구역·설비는 가장 최근 시작일 줄이 적용됩니다. 대당 kW 계산: 3상 380V × 전류(A) × 1.732 × 0.85 ÷ 1000.</div>`;
      el.querySelectorAll('.eqi').forEach(e => e.addEventListener('change', () => { const x = EQ_EDIT[e.dataset.i], k = e.dataset.k; x[k] = (k === 'kw' || k === 'hours') ? Number(e.value) : e.value; document.getElementById('eq-st').textContent = '저장하지 않음'; }));
    }
    let eqShowAll = false;
    function eqAdd() { const d = todayStr.slice(0, 7) === causeYm ? todayStr : causeYm + '-01'; EQ_EDIT.push({ d, area: '생산동', name: '', kw: 0, hours: 0, note: '', _new: true }); renderEquip(); }
    function eqDel(i) { if (!confirm('이 이력을 지울까요?')) return; EQ_EDIT.splice(i, 1); renderEquip(); }
    async function eqSave() {
      try { await saveYear(9999, { equip: EQ_EDIT.filter(x => x.d && x.name).map(({ _new, ...x }) => x) }); EQ_EDIT = null; resetCache && resetCache(); Object.keys(YEARDATA).forEach(y => { const t = YEARDATA[y] && YEARDATA[y].targets; if (t) delete t._models; }); await renderCause(); const st = document.getElementById('eq-st'); if (st) st.textContent = '저장됨 ✓'; }
      catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    function czAutoText() {
      const ym = causeYm, y = Number(ym.slice(0, 4)), ym0 = causeCmp === 'prev' ? UT.prevYm(ym) : UT.ym(y - 1, Number(ym.slice(5)));
      const lines = UT.UTILS.map(u => { if (S(ym)[u.k].usage === null) return null; const F = causeFacts(ym, ym0, u.k);
        const notes = monthAnoms(ym, u.k).map(a => anomNote(a.d, a.u)).filter(Boolean);
        return '· ' + F.plain + (notes.length ? ` (이상 사용: ${notes.join(' / ')})` : ''); }).filter(Boolean);
      const ta = document.getElementById('cz-memo-ta');
      ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + lines.join('\n');
      document.getElementById('cz-memo-st').textContent = '문장을 넣었습니다. 고친 뒤 [저장]을 누르세요.';
    }
    async function czSaveMemo() {
      const ym = causeYm, y = Number(ym.slice(0, 4));
      try { await saveYear(y, { comments: { ...(yd(y).comments || {}), [ym]: document.getElementById('cz-memo-ta').value } }); document.getElementById('cz-memo-st').textContent = '저장됨 ✓ (월간보고서에 반영)'; }
      catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    // 참고 그래프 (기존 3개)
    function renderCauseRef() {
      const du = UT.DAILY_UTILS.find(u => u.k === causeUtil) || UT.DAILY_UTILS[0], U = du, causeYear = Number(causeYm.slice(0, 4));
      document.getElementById('cz-days').textContent = causeDays + '일';
      const pts = [];
      for (let i = causeDays; i >= 1; i--) {
        const ds = UT.addDays(todayStr, -i);
        if (UT.isWeekend(ds) || TEMPS[ds] === undefined) continue;
        const v = UT.dailyUsage(DAILY, ds)[U.k];
        if (v !== null && v >= 0) pts.push({ x: Math.round(TEMPS[ds] * 10) / 10, y: v, d: ds });
      }
      const lr = UT.linreg(pts.map(p => [p.x, p.y]));
      const xs = pts.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
      mkChart('chart-temp', { type: 'scatter', data: { datasets: [
        { label: '평일', data: pts, backgroundColor: U.color + 'aa', pointRadius: 4 },
        ...(lr ? [{ type: 'line', label: '추세', data: [{ x: x0, y: lr.a * x0 + lr.b }, { x: x1, y: lr.a * x1 + lr.b }], borderColor: '#333', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 }] : [])
      ] }, options: (() => { const o = baseOpts(`${U.unit}/일`); o.scales.x = { type: 'linear', title: { display: true, text: '평균기온 (℃)', color: '#888' }, grid: { color: '#f3f4f6' } }; o.interaction = { mode: 'nearest', intersect: true };
        o.plugins.tooltip.callbacks.label = c => c.raw.d ? ` ${c.raw.d.slice(5)} · ${c.raw.x}℃ · ${f1(c.raw.y)} ${U.unit}` : ''; return o; })() });
      const strength = lr ? (lr.r2 >= 0.5 ? '뚜렷함' : lr.r2 >= 0.25 ? '보통' : '약함 — 기온보다 다른 요인이 큼') : '';
      document.getElementById('temp-note').innerHTML = !lr ? '기온 기록이 부족합니다. (설비검침의 최저·최고온도 사용)' :
        `읽는 법: 오른쪽(더운 날)으로 갈수록 점이 위에 있으면 더울수록 더 쓴다는 뜻.<br>→ 기온이 1℃ ${lr.a < 0 ? '내려가면' : '올라가면'} ${U.name}를 하루 약 <b>${f1(Math.abs(lr.a))} ${U.unit}</b> 더 씁니다 (관련성 ${strength}).`;
      const months = []; for (let ym = UT.ym(causeYear - 1, 1); ym <= UT.ym(causeYear, 12) && ym <= thisYm; ym = UT.nextYm(ym)) months.push(ym);
      const ck = causeUtil, mp = months.map(ym => { const s = S(ym); return { ym, x: s.production, y: ratio(s[ck].usage, s.production) }; }).filter(p => p.x && p.y);
      const lr2 = UT.linreg(mp.map(p => [p.x, p.y]));
      const unit2 = `${UT.UTILS.find(u => u.k === ck).unit}/kg`, UC = UT.UTILS.find(u => u.k === ck);
      mkChart('chart-produnit', { type: 'scatter', data: { datasets: [
        { label: `${causeYear - 1}년`, data: mp.filter(p => p.ym < `${causeYear}`), backgroundColor: '#a3a29d', pointRadius: 5 },
        { label: `${causeYear}년`, data: mp.filter(p => p.ym >= `${causeYear}`), backgroundColor: UC.color, pointRadius: 6 }
      ] }, options: (() => { const o = baseOpts(unit2); o.scales.x = { type: 'linear', title: { display: true, text: '원육 투입량 (kg)', color: '#888' }, grid: { color: '#f3f4f6' } }; o.plugins.legend.display = true; o.interaction = { mode: 'nearest', intersect: true };
        o.plugins.tooltip.callbacks.label = c => ` ${c.raw.ym} · 원육 ${f0(c.raw.x)}kg · ${fU(c.raw.y, ck)} ${unit2}`; return o; })() });
      document.getElementById('produnit-note').innerHTML = !lr2 ? '원육 투입량을 넣은 달이 부족합니다.' :
        `읽는 법: 오른쪽(원육 많이 넣은 달)으로 갈수록 점이 아래로 내려가면, 많이 넣을수록 kg당 덜 쓴다는 뜻.<br>→ 원육을 많이 넣은 달일수록 kg당 사용량이 ${lr2.a < 0 ? '<b>낮아집니다</b> (기본으로 쓰는 양이 나뉘기 때문)' : '<b>높아집니다</b>'}. 비슷한 원육 투입량인데 혼자 위에 떠 있는 점은 낭비를 의심해 볼 달입니다.`;
      const ms = yearMonths(causeYear), es = ms.map(ym => { const s = S(ym); const m = s.m || {}; const tot = s.elec.usage; const hv = Number(m.elec_hvac_kwh) || null, ww = Number(m.elec_ww_kwh) || null; return { tot, hv, ww, etc: tot ? Math.max(0, tot - (hv || 0) - (ww || 0)) : null }; });
      mkChart('chart-elecmix', { type: 'bar', data: { labels: monthLabels, datasets: [
        { label: '공조냉동', data: es.map(e => e.hv), backgroundColor: '#5b8def', stack: 'e', maxBarThickness: 34 },
        { label: '폐수동', data: es.map(e => e.ww), backgroundColor: '#eda100', stack: 'e', maxBarThickness: 34 },
        { label: '그 외 (생산·기타)', data: es.map(e => e.etc), backgroundColor: '#c8ccd2', stack: 'e', maxBarThickness: 34 }
      ] }, options: (() => { const o = baseOpts('kWh'); o.scales.x.stacked = true; o.scales.y.stacked = true; o.plugins.legend.display = true;
        o.plugins.tooltip.callbacks.label = c => { const t = es[c.dataIndex].tot; return ` ${c.dataset.label}: ${f0(c.raw)} kWh${t ? ` (${nf1.format(c.raw / t * 100)}%)` : ''}`; }; return o; })() });
    }

    // =====================================================================
    // 이상 사용 감지
    // =====================================================================
    let anomDays = 60, anomSpan = 1, anomTblU = 'all', anomRatio = 1.4, anomUtil = 'all', anomList = [], anomMonth = null;
    function renderAnomaly() {
      setTimeout(renderProdCompare, 0);
      // 기간 = 원인 찾기 맨 위에서 고른 달 (또는 그 달까지 3개월) — 진행 중인 달은 어제까지
      const am = anomMonth || causeYm || lastCompleteYm(), yst = UT.addDays(todayStr, -1), mEnd = UT.dateStr(am, UT.daysIn(am));
      let fm = am; for (let i = 1; i < anomSpan; i++) fm = UT.prevYm(fm);
      const to = mEnd > yst ? yst : mEnd, from = UT.dateStr(fm, 1);
      anomList = UT.anomalies(DAILY, from, to, { ratio: anomRatio }).reverse();
      document.getElementById('anom-chips').innerHTML =
        [['all', '전체'], ...UT.DAILY_UTILS.map(u => [u.k, u.name])].map(([k, n]) => `<button class="chip ${anomTblU === k ? 'on' : ''}" onclick="anomTblU='${k}';renderAnomaly()">${n} ${k === 'all' ? anomList.length : anomList.filter(a => a.u === k).length}</button>`).join('') +
        ' &nbsp; ' + [[1, ymLabel(am)], [3, `${Number(UT.prevYm(UT.prevYm(am)).slice(5))}~${Number(am.slice(5))}월 (3개월)`]].map(([n, l]) => `<button class="chip ${anomSpan === n ? 'on' : ''}" onclick="anomSpan=${n};renderAnomaly()">${l}</button>`).join('') +
        ' &nbsp; 평소보다 ' + [1.2, 1.3, 1.4, 1.5, 1.7, 2].map(r => `<button class="chip ${anomRatio === r ? 'on' : ''}" onclick="anomRatio=${r};renderAnomaly()" title="그날 사용량이 평소의 ${r}배를 넘으면 이상 사용일">+${Math.round((r - 1) * 100)}%</button>`).join('') + ' <span class="hint">넘게 쓴 날</span>';
      const list = anomList.filter(a => anomTblU === 'all' || a.u === anomTblU);
      const W = ['일', '월', '화', '수', '목', '금', '토'];
      document.getElementById('anom-table').innerHTML = !list.length ? `<div class="empty">${from.slice(5).replace('-', '/')} ~ ${to.slice(5).replace('-', '/')}에 평소보다 크게 많이 쓴 날이 없습니다 👍</div>` :
        `<table class="t"><tr><th>날짜</th><th>항목</th><th>그날 사용량</th><th>평소<br><span class="hint">최근 4주 같은 종류 날 중앙값</span></th><th>차이</th><th class="l">구분</th><th class="l" style="min-width:220px">원인·조치 메모${isAdmin() ? ' <span class="hint">(입력하면 자동 저장)</span>' : ''}</th><th></th></tr>` +
        list.map(a => { const u = UT.DAILY_UTILS.find(x => x.k === a.u); const wd = new Date(a.d + 'T00:00:00').getDay();
          return `<tr class="anom-row" onclick="anomFocus='${a.d}';goCause('${a.d}','${a.u}')" title="이 날이 있는 달로 위 그래프·원인을 바꿉니다"><td>${a.d.slice(5).replace('-', '/')} (${W[wd]})</td><td class="l"><i class="dot" style="background:${u.color}"></i>${u.name}</td><td>${f1(a.v)} ${u.unit}</td><td>${a.base === null ? '-' : f1(a.base) + ' ' + u.unit}</td>
            <td>${a.kind !== '과다' ? '-' : a.pct === null ? '<span class="up">평소 0</span>' : `<span class="up">+${nf0.format(a.pct)}%</span>`}</td><td class="l">${a.kind === '지침 오류' ? '<span class="ng">지침 확인 필요 (다음날 지침이 더 작음)</span>' : (a.work ? '생산일 과다 사용' : '쉬는 날 사용 (누수·미차단 확인)')}</td>
            <td class="l" onclick="event.stopPropagation()">${isAdmin() ? `<input class="anom-note" data-d="${a.d}" data-u="${a.u}" value="${esc(anomNote(a.d, a.u))}" placeholder="예) 자숙기 세척 / 누수 확인 → 밸브 교체">` : esc(anomNote(a.d, a.u)) || '<span class="hint">-</span>'}</td>
            <td onclick="event.stopPropagation()"><button class="chip" title="이 날이 그 달 사용량에 얼마나 영향을 줬는지" onclick="goCause('${a.d}','${a.u}')">${Number(a.d.slice(5, 7))}월 원인 찾기 →</button></td></tr>`; }).join('') + '</table>';
      bindAnomNotes('#anom-table');
      renderAnomChart();
    }
    // 이상감지 메모: 연 설정(YYYY-00)의 anom_notes 에 "날짜|항목" 키로 저장
    function anomNote(d, u) { return ((yd(Number(d.slice(0, 4))).anom_notes || {})[d + '|' + u]) || ''; }
    async function saveAnomNote(el) {
      const d = el.dataset.d, u = el.dataset.u, y = Number(d.slice(0, 4)), v = el.value.trim();
      if (v === anomNote(d, u)) { if (v) el.classList.add('saved'); return; }
      const notes = { ...(yd(y).anom_notes || {}) };
      if (v) notes[d + '|' + u] = v; else delete notes[d + '|' + u];
      try { await saveYear(y, { anom_notes: notes }); el.classList.toggle('saved', !!v); }
      catch (e) { alert('메모 저장 실패: ' + errMsg(e)); }
    }
    function bindAnomNotes(sel) {
      document.querySelectorAll(sel + ' .anom-note').forEach(el => {
        let t = null;
        const go = () => { clearTimeout(t); t = null; saveAnomNote(el); };
        el.addEventListener('input', () => { el.classList.remove('saved'); clearTimeout(t); t = setTimeout(go, 1200); });
        el.addEventListener('change', go);
        el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
      });
    }
    // 이상감지 → 그 달 원인분석으로
    function goCause(d, u) { causeYm = d.slice(0, 7); causeUtil = u; switchTab('cause'); setTimeout(() => { const e = document.getElementById('cz-day'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200); }
    let anomFocus = null;
    function renderAnomChart() {
      if (!window.Chart) return;
      const uk = anomUtil === 'all' ? 'elec' : anomUtil, U = UT.DAILY_UTILS.find(u => u.k === uk);
      const to = UT.addDays(todayStr, -1), days = [];
      if (anomMonth) { for (let d = 1; d <= UT.daysIn(anomMonth); d++) { const ds = UT.dateStr(anomMonth, d); if (ds <= to) days.push(ds); } }
      else for (let i = anomDays - 1; i >= 0; i--) days.push(UT.addDays(to, -i));
      document.getElementById('anom-chart-title').textContent = `${U.name} 일 사용량 (${U.unit})${anomMonth ? ' · ' + ymLabel(anomMonth) : ''}`;
      const vals = days.map(d => UT.dailyUsage(DAILY, d)[uk]);
      const base = days.map(d => UT.baseline(DAILY, d, uk));
      const flagged = new Set(anomList.filter(a => a.u === uk).map(a => a.d));
      mkChart('chart-anom', { type: 'bar', data: { labels: days.map(d => d.slice(5).replace('-', '/')), datasets: [
        { label: '사용량', data: vals, backgroundColor: days.map(d => flagged.has(d) ? '#d93025' : (d === anomFocus ? '#333' : U.color + 'aa')), maxBarThickness: 18 },
        { type: 'line', label: '평소', data: base, borderColor: '#333', borderDash: [4, 3], borderWidth: 1.5, pointRadius: 0, stepped: false }
      ] }, options: (() => { const o = baseOpts(U.unit); o.plugins.legend.display = true; o.scales.x.ticks.maxRotation = 0; o.scales.x.ticks.autoSkip = true;
        o.plugins.tooltip.callbacks.label = c => ` ${c.dataset.label}: ${f1(c.raw)} ${U.unit}`; return o; })() });
    }

    // =====================================================================
    // 월간 보고서 (A4 한 장)
    // =====================================================================
    let brYm = null;
    function shiftBriefMonth(d) { brYm = d > 0 ? UT.nextYm(brYm) : UT.prevYm(brYm); renderBrief(); }
    function renderBrief() {
      if (!brYm) brYm = UT.prevYm(thisYm);
      document.getElementById('brief-month').textContent = ymLabel(brYm);
      const y = Number(brYm.slice(0, 4)), m = Number(brYm.slice(5));
      const fc = FC(brYm);
      const s = fc || S(brYm), prev = S(UT.prevYm(brYm)), ly = S(UT.ym(y - 1, m));
      const yt = ytd(y, brYm);
      const uc = x => ratio(x.total, x.production);
      const tile = (lab, val, sub) => `<div class="br-kpi"><div class="l">${lab}</div><div class="v">${val}</div><div class="s">${sub}</div></div>`;
      let h = `<div class="br-head"><div><div class="br-title">${y}년 ${m}월 유틸리티 사용 현황</div><div class="hint">${esc(Portal.config.PLANT_NAME)} ${esc(Portal.config.TEAM_NAME || "")} · 작성 ${todayStr}${fc ? ' · <b>월말 예측값</b>' : (s.status === '가마감' ? ' · 일부 가마감(고지서 전)' : '')}</div></div>
        <table class="br-sign"><tr><td>작성</td><td>검토</td><td>승인</td></tr><tr><td></td><td></td><td></td></tr></table></div>`;
      h += `<div class="br-kpis">` +
        tile('유틸리티 총비용', man(s.total), `전월 ${pctTxt(s.total, prev.total)} · 전년 ${pctTxt(s.total, ly.total)}`) +
        tile('원육 투입량', `${f0(s.production)} kg`, `전월 ${pctTxt(s.production, prev.production)} · 전년 ${pctTxt(s.production, ly.production)}`) +
        tile('원육 kg당 비용', `${f0(uc(s))} 원/kg`, `전월 ${pctTxt(uc(s), uc(prev))} · 전년 ${pctTxt(uc(s), uc(ly))}`) +
        tile(`${y}년 누적 (1~${m}월)`, man(yt.total), `원단위 ${f0(ratio(yt.total, yt.production))} 원/kg`) +
        `</div>`;
      h += `<table class="t br-t"><tr><th class="l">항목</th><th>사용량</th><th>비용 (원)</th><th>원단위</th><th>전월 대비<br><span class="hint">원단위</span></th><th>전년 동월 대비<br><span class="hint">원단위</span></th><th>예상 사용량<br><span class="hint">원육·기온 반영</span></th><th>예상 대비<br><span class="hint">목표 절감률</span></th><th>상태</th></tr>` +
        UT.UTILS.map(u => { const un = ratio(s[u.k].usage, s.production), e = fc ? null : evalFor(brYm, u.k);
          return `<tr><td class="l"><i class="dot" style="background:${u.color}"></i><b>${u.name}</b></td><td>${f0(s[u.k].usage)} ${u.unit}</td><td>${f0(s[u.k].cost)}</td><td>${fU(un, u.k)} <span class="hint">${u.unit}/kg</span></td>
            <td>${pctTxt(un, ratio(prev[u.k].usage, prev.production))}</td><td>${pctTxt(un, ratio(ly[u.k].usage, ly.production))}</td><td>${e ? f0(e.exp) : '-'}</td><td>${e ? saveTxt(e.save) + (e.rate !== null ? `<br><span class="hint">목표 ${e.rate}%</span> ${judge(e)}` : '') : '-'}</td><td>${s[u.k].status ? `<span class="st st-${s[u.k].status}">${s[u.k].status}</span>` : ''}</td></tr>`; }).join('') +
        `<tr class="sum"><td class="l">합계</td><td></td><td>${f0(s.total)}</td><td>${f0(uc(s))} <span class="hint">원/kg</span></td><td>${pctTxt(uc(s), uc(prev))}</td><td>${pctTxt(uc(s), uc(ly))}</td><td></td><td></td><td></td></tr></table>`;
      h += `<div class="br-charts"><div><div class="br-ct">월별 비용 (천원)</div><div class="br-box"><canvas id="br-cost"></canvas></div></div><div><div class="br-ct">원육 kg당 비용 (원/kg) · 전년 비교</div><div class="br-box"><canvas id="br-unit"></canvas></div></div></div>`;
      // 이상 사용 요약
      const first = UT.dateStr(brYm, 1), last = UT.dateStr(brYm, UT.daysIn(brYm));
      const an = UT.anomalies(DAILY, first, last < todayStr ? last : UT.addDays(todayStr, -1), { ratio: 1.4 }).filter(a => a.kind === '과다');
      h += `<div class="br-sec">이상 사용 (평소보다 40% 이상 많이 쓴 날)</div><div class="br-txt">${!an.length ? '없음' :
        UT.DAILY_UTILS.map(u => { const l = an.filter(a => a.u === u.k); return l.length ? `${u.name} ${l.length}건 (${l.slice(0, 4).map(a => a.d.slice(8) + '일 ' + (a.pct === null ? '(평소 0)' : '+' + nf0.format(a.pct) + '%')).join(', ')}${l.length > 4 ? ' …' : ''})` : ''; }).filter(Boolean).join(' / ')}` +
        (() => { const ns = an.filter(a => anomNote(a.d, a.u)); return ns.length ? '<br>' + ns.map(a => `· ${Number(a.d.slice(5, 7))}/${Number(a.d.slice(8))} ${UT.DAILY_UTILS.find(u => u.k === a.u).name}: ${esc(anomNote(a.d, a.u))}`).join('<br>') : ''; })() + `</div>`;
      const cmt = (yd(y).comments || {})[brYm] || '';
      h += `<div class="br-sec">특이사항 및 조치 계획</div>` + (isAdmin()
        ? `<textarea id="br-comment" class="br-comment" placeholder="예) 9월 가스 사용 증가: 자숙 설비 증설 시운전 영향 / 10월 보일러 공기비 조정 예정">${esc(cmt)}</textarea><div class="no-print" style="text-align:right;margin-top:4px"><button class="btn secondary" onclick="saveBriefComment()">코멘트 저장</button> <span class="hint" id="br-cmt-st"></span></div><div class="print-only br-txt" id="br-comment-print">${esc(cmt)}</div>`
        : `<div class="br-txt" style="min-height:40px;white-space:pre-wrap">${esc(cmt) || '-'}</div>`);
      document.getElementById('brief-sheet').innerHTML = h;
      const ta = document.getElementById('br-comment'); if (ta) ta.addEventListener('input', () => { document.getElementById('br-comment-print').textContent = ta.value; });
      // 차트
      if (!window.Chart) return;
      const ms = yearMonths(y), cs = ms.map(ym => ym === brYm && fc ? fc : S(ym)), ps = yearMonths(y - 1).map(S);
      mkChart('br-cost', { type: 'bar', data: { labels: monthLabels, datasets: UT.UTILS.map(u => ({ label: u.name, data: cs.map(x => x[u.k].cost === null ? null : x[u.k].cost / 1000), backgroundColor: u.color, stack: 'c', maxBarThickness: 22 })) },
        options: (() => { const o = baseOpts(''); o.scales.x.stacked = o.scales.y.stacked = true; o.plugins.legend.display = true; o.plugins.legend.labels = { boxWidth: 10, font: { size: 10 } }; o.scales.x.ticks.font = { size: 10 }; o.scales.y.ticks.font = { size: 10 }; return o; })() });
      mkChart('br-unit', { type: 'line', data: { labels: monthLabels, datasets: [
        { label: `${y}년`, data: cs.map(uc), borderColor: '#333', backgroundColor: '#333', borderWidth: 2, pointRadius: 3 },
        { label: `${y - 1}년`, data: ps.map(uc), borderColor: '#a3a29d', backgroundColor: '#a3a29d', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 2 },
      ] }, options: (() => { const o = baseOpts(''); o.plugins.legend.display = true; o.plugins.legend.labels = { boxWidth: 10, font: { size: 10 } }; o.scales.x.ticks.font = { size: 10 }; o.scales.y.ticks.font = { size: 10 }; return clipAxis(o, cs.map(uc), ps.map(uc)); })() });
    }
    async function saveBriefComment() {
      const y = Number(brYm.slice(0, 4));
      try { await saveYear(y, { comments: { ...(yd(y).comments || {}), [brYm]: document.getElementById('br-comment').value } }); document.getElementById('br-cmt-st').textContent = '저장됨 ✓'; }
      catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }


    // =====================================================================
    // 차트 크게 보기 (차트를 누르면 큰 창 + 값 표)
    // =====================================================================
    const CHART_CFG = {};
    function cloneCfg(v) { // 함수는 그대로, 객체·배열만 복사
      if (Array.isArray(v)) return v.map(cloneCfg);
      if (v && typeof v === 'object' && !(v instanceof Date)) { const o = {}; for (const k in v) o[k] = cloneCfg(v[k]); return o; }
      return v;
    }
    let zoomChart = null, zoomId = null, zoomLabels = true;
    // 차트에 수치 표시 (크게 보기 화면)
    let ZUNIT = ''; // 크게 보기 단위 (원단위면 전기·가스 1자리, 용수·폐수 3자리)
    const zUnitKg = () => /\/kg$/.test(ZUNIT) && !/^원/.test(ZUNIT);
    const zfmtFor = vals => { if (zUnitKg()) return v => fU(v, ZUNIT); const mx = Math.max(0, ...vals.filter(v => v !== null && v !== undefined && isFinite(v)).map(v => Math.abs(v))); return mx >= 100 ? (v => f0(v)) : mx >= 1 ? (v => nf1.format(v)) : (v => Number(v).toFixed(3)); };
    const ZLABEL = {
      id: 'zlabels',
      afterDatasetsDraw(chart, a, opt) {
        if (!opt || !opt.on) return;
        const g = chart.ctx, sets = chart.data.datasets;
        const n = (chart.data.labels || []).length;
        if (!n || n > 40 || chart.config.type === 'scatter') return;
        g.save(); g.textAlign = 'center'; g.font = '600 12px "Pretendard", "Malgun Gothic", sans-serif';
        const stacked = chart.options.scales && chart.options.scales.y && chart.options.scales.y.stacked;
        const tot = {}, top = {};
        sets.forEach((d, di) => {
          const meta = chart.getDatasetMeta(di); if (meta.hidden || !chart.isDatasetVisible(di)) return;
          const isLine = (d.type || chart.config.type) === 'line';
          if (isLine && d.pointRadius === 0) return; // 계획선 등
          const vals = (d.data || []).map(v => v === null || v === undefined ? null : Number(v)), fmt = zfmtFor(vals);
          meta.data.forEach((el, i) => {
            const v = vals[i]; if (v === null || isNaN(v)) return;
            if (!isLine && stacked) {
              tot[i] = (tot[i] || 0) + v; top[i] = Math.min(top[i] ?? Infinity, el.y);
              const h = Math.abs(el.base - el.y); if (h < 16) return;
              g.fillStyle = '#fff'; g.font = '11px "Malgun Gothic", sans-serif'; g.fillText(fmt(v), el.x, (el.y + el.base) / 2 + 4); return;
            }
            const main = di === 0;
            g.font = main ? '700 13px "Malgun Gothic", sans-serif' : '11px "Malgun Gothic", sans-serif';
            g.fillStyle = main ? '#222' : '#8a8f98';
            const y = isLine ? (main ? el.y - 12 : el.y + 19) : el.y - 6;
            g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(fmt(v), el.x, y);
            g.fillText(fmt(v), el.x, y);
          });
        });
        if (stacked) { const fmt = zfmtFor(Object.values(tot)); g.font = '700 13px "Malgun Gothic", sans-serif'; g.fillStyle = '#222'; Object.keys(tot).forEach(i => { const el = chart.getDatasetMeta(0).data[i] || {}; g.fillText(fmt(tot[i]), el.x, top[i] - 6); }); }
        g.restore();
      }
    };
    // 아래 값 표의 월 칸을 그래프 x축 위치와 맞춤
    const ZSUMW = 78;
    function alignZoomTable(chart) {
      const t = document.querySelector('#zoom-table table.t.zal'); if (!t || !chart.scales.x) return;
      const xs = chart.scales.x, n = (chart.data.labels || []).length, W = chart.width;
      const cw = xs.width / n;
      const cols = [xs.left, ...Array(n).fill(cw), (W - xs.right) / 2, (W - xs.right) / 2];
      t.style.width = W + 'px';
      t.querySelector('colgroup').innerHTML = cols.map(w => `<col style="width:${w}px">`).join('');
    }
    const ZALIGN = { id: 'zalign', afterLayout(chart) { requestAnimationFrame(() => alignZoomTable(chart)); } };
    function toggleZoomLabels() { zoomLabels = !zoomLabels; if (zoomId) openZoom(zoomId); }
    function openZoom(id) {
      const cfg = CHART_CFG[id]; if (!cfg) return;
      zoomId = id;
      const card = document.getElementById(id).closest('.card');
      const h3 = card ? card.querySelector('h3') : null;
      const unit = (((cfg.options || {}).scales || {}).y || {}).title ? cfg.options.scales.y.title.text || '' : '';
      ZUNIT = unit;
      const ttl = h3 ? (h3.childNodes[0].textContent || '').trim() || h3.textContent.trim().split('\n')[0] : '';
      let ttl2 = ttl;
      if (id === 'chart-util') { const U = UT.UTILS.find(u => u.k === utilSel); ttl2 = `${U.name} ${{ usage: '사용량', unit: '원단위 (원육 kg당 사용량)', cost: '비용' }[metricSel]}`; }
      document.getElementById('zoom-title').textContent = ttl2 + (unit ? ` (단위: ${unit})` : '');
      const c = cloneCfg(cfg);
      c.options = c.options || {}; c.options.maintainAspectRatio = false; c.options.animation = false;
      c.options.plugins = c.options.plugins || {}; c.options.plugins.legend = { ...(c.options.plugins.legend || {}), display: true, position: 'top' };
      c.options.plugins.zlabels = { on: zoomLabels };
      const aligned = c.type !== 'scatter' && (c.data.labels || []).length > 0 && (c.data.labels || []).length <= 40;
      c.options.layout = { padding: { top: 24, left: 4, right: aligned ? ZSUMW * 2 + 8 : 12 } }; // 오른쪽 = 표의 합계·평균 칸 자리
      if (c.options.scales && c.options.scales.x && c.type !== 'scatter') c.options.scales.x.offset = true; // 첫·끝 점 수치가 잘리지 않게
      c.plugins = [...(c.plugins || []), ZLABEL, ...(aligned ? [ZALIGN] : [])];
      // 수치가 위로 잘리지 않게 위쪽 여유
      document.getElementById('zoom').hidden = false;
      if (zoomChart) zoomChart.destroy();
      zoomChart = new Chart(document.getElementById('zoom-canvas'), c);
      const btn = document.getElementById('zoom-lbl'); btn.textContent = zoomLabels ? '수치 숨기기' : '수치 보이기';
      // 전월 대비 (월별 차트일 때: 첫 번째 항목의 마지막 달 vs 그 전 달)
      const labels = cfg.data.labels || [], ds0 = (cfg.data.datasets || [])[0];
      let sum = '';
      if (labels.length === 12 && /월$/.test(labels[0]) && ds0) {
        const stackedC = cfg.options && cfg.options.scales && cfg.options.scales.y && cfg.options.scales.y.stacked;
        const vals = stackedC ? labels.map((_, i) => { const xs = cfg.data.datasets.map(d => d.data[i]).filter(v => v !== null && v !== undefined); return xs.length ? xs.reduce((a, b) => a + Number(b), 0) : null; }) : ds0.data.map(v => v === null || v === undefined ? null : Number(v));
        const yy = Number((dashYm || thisYm).slice(0, 4));
        let i = -1; vals.forEach((v, k) => { const ym = UT.ym(yy, k + 1); if (v !== null && !isNaN(v) && !(ym >= thisYm && !UT.monthComplete(DAILY, ym))) i = k; }); // 진행 중인 달은 빼고 비교
        if (i > 0 && vals[i - 1]) {
          const fmt = zfmtFor(vals), p = (vals[i] / vals[i - 1] - 1) * 100;
          sum = `▶ 전월 대비 증감률 · ${labels[i]} ${fmt(vals[i])}${unit ? ' ' + unit : ''} (${labels[i - 1]} ${fmt(vals[i - 1])}) : <b class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '+' : ''}${nf1.format(p)}% ${p > 0 ? '증가' : '감소'}</b>`;
        }
      }
      document.getElementById('zoom-sum').innerHTML = sum;
      // 값 표 (kg당·㎥당처럼 비율 값은 합계가 의미 없어 '-')
      const isRatio = /\//.test(unit) || /%/.test(unit);
      const ds = (cfg.data.datasets || []).filter(d => d.label);
      let h = '';
      if (cfg.type === 'scatter' || (ds[0] && ds[0].data && ds[0].data[0] && typeof ds[0].data[0] === 'object')) {
        h = '<div class="hint">점 그래프는 점에 마우스를 올리면 값이 보입니다.</div>';
      } else {
        const fmt = v => v === null || v === undefined || isNaN(v) ? '-' : zUnitKg() ? fU(v, ZUNIT) : (Math.abs(v) >= 100 ? f0(v) : f2(v));
        h = `<table class="t zal"><colgroup></colgroup><tr><th class="l">구분</th>${labels.map(l => `<th>${esc(l)}</th>`).join('')}<th>합계</th><th>평균</th></tr>` +
          ds.map(d => { const vals = (d.data || []).map(x => x === null || x === undefined ? null : Number(x)); const ok = vals.filter(x => x !== null && !isNaN(x));
            return `<tr><td class="l">${esc(d.label)}</td>${vals.map(v => `<td>${fmt(v)}</td>`).join('')}<td>${ok.length && !isRatio ? fmt(ok.reduce((a, b) => a + b, 0)) : '-'}</td><td>${ok.length ? fmt(ok.reduce((a, b) => a + b, 0) / ok.length) : '-'}</td></tr>`; }).join('') + '</table>';
      }
      document.getElementById('zoom-table').innerHTML = h;
      if (zoomChart) alignZoomTable(zoomChart);
    }
    function closeZoom() { document.getElementById('zoom').hidden = true; if (zoomChart) { zoomChart.destroy(); zoomChart = null; } }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('zoom').hidden) closeZoom(); });
    document.addEventListener('click', e => {
      const box = e.target.closest('.chart-box'); if (!box || box.closest('#zoom')) return;
      const cv = box.querySelector('canvas'); if (cv && CHART_CFG[cv.id]) openZoom(cv.id);
    });

    // =====================================================================
    // 기간 비교: 일별 / 주별 / 월별 / 분기별 + 전년 같은 기간
    // =====================================================================
    let perGran = 'month', perUtil = 'elec', perMetric = 'usage', perN = { day: 60, week: 26, month: 24, quarter: 8 };
    const isoWeekStart = ds => { const d = new Date(ds + 'T00:00:00'); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return ymd(d); };
    const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    function dayVal(ds, uk) { const u = UT.dailyUsage(DAILY, ds)[uk]; return u === null || u < 0 ? null : u; }
    function sumDays(from, n, uk) { let s = 0, c = 0; for (let i = 0; i < n; i++) { const v = dayVal(UT.addDays(from, i), uk); if (v !== null) { s += v; c++; } } return c ? { v: s, c } : null; }
    function monthVal(ym, uk, metric) {
      const s = S(ym); const x = s[uk];
      if (metric === 'usage') return x.usage; if (metric === 'cost') return x.cost === null ? null : x.cost / 1000; // 천원
      return ratio(x.usage, s.production);
    }
    // 선택 기간 (null = 최근 기본 개수)
    const perSel = { day: null, week: null, month: null, quarter: null };
    function perLastDay() { // 마지막으로 사용량이 계산되는 날 (다음날 검침이 있어야 함)
      let last = UT.addDays(todayStr, -1);
      for (let i = 0; i < 7 && dayVal(last, 'elec') === null && dayVal(last, perUtil) === null; i++) last = UT.addDays(last, -1);
      return last;
    }
    const qKey = (y, q) => `${y}-${q}`;
    const qOfYm = ym => [Number(ym.slice(0, 4)), Math.ceil(Number(ym.slice(5)) / 3)];
    const qNext = ([y, q]) => q === 4 ? [y + 1, 1] : [y, q + 1];
    const qPrev = ([y, q]) => q === 1 ? [y - 1, 4] : [y, q - 1];
    function perDefault(g) {
      const n = perN[g], last = perLastDay();
      if (g === 'day') return { from: UT.addDays(last, -(n - 1)), to: last };
      if (g === 'week') { const w = isoWeekStart(last); return { from: UT.addDays(w, -7 * (n - 1)), to: w }; }
      if (g === 'month') { let ym = thisYm; for (let i = 0; i < n - 1; i++) ym = UT.prevYm(ym); return { from: ym, to: thisYm }; }
      let q = qOfYm(thisYm); const to = q; for (let i = 0; i < n - 1; i++) q = qPrev(q); return { from: qKey(...q), to: qKey(...to) };
    }
    const PER_MAX = { day: 400, week: 160, month: 120, quarter: 40 };
    function perRange() { return perSel[perGran] || perDefault(perGran); }
    const PER_CMP = { day: ['전년 같은 요일', '전월 같은 요일'], week: ['전년 같은 주', '전주'], month: ['전년 동월', '전월'], quarter: ['전년 동분기', '전분기'] };
    let perLine = 'both';
    function periodSeries() {
      const uk = perUtil, metric = perMetric, out = [];
      const last = perLastDay(), { from, to } = perRange();
      if (perGran === 'day') {
        const end = to > last ? last : to, multiYear = from.slice(0, 4) !== end.slice(0, 4);
        for (let ds = from, i = 0; ds <= end && i < PER_MAX.day; ds = UT.addDays(ds, 1), i++) { const ly = UT.addDays(ds, -364); // 364일 전 = 같은 요일
          out.push({ label: `${multiYear ? ds.slice(2, 4) + '/' : ''}${ds.slice(5).replace('-', '/')}(${'일월화수목금토'[new Date(ds + 'T00:00:00').getDay()]})`, cur: dayVal(ds, uk), prev: dayVal(ly, uk), prior: dayVal(UT.addDays(ds, -28), uk), prevLabel: ly, d: [ds, ly, UT.addDays(ds, -28)] }); }
      } else if (perGran === 'week') {
        const multiYear = from.slice(0, 4) !== to.slice(0, 4);
        for (let ws = isoWeekStart(from), i = 0; ws <= isoWeekStart(to) && ws <= last && i < PER_MAX.week; ws = UT.addDays(ws, 7), i++) { const lws = UT.addDays(ws, -364);
          const days = Math.min(7, (new Date(last + 'T00:00:00') - new Date(ws + 'T00:00:00')) / 864e5 + 1);
          const c = sumDays(ws, days, uk), p = sumDays(lws, days, uk), pw = sumDays(UT.addDays(ws, -7), days, uk); // 전주도 같은 날수만큼
          out.push({ label: `${multiYear ? ws.slice(2, 4) + '/' : ''}${ws.slice(5).replace('-', '/')}~`, cur: c && c.v, prev: p && p.v, prior: pw && pw.v, partial: days < 7, prevLabel: lws, w: [ws, lws, UT.addDays(ws, -7)], days }); }
      } else if (perGran === 'month') {
        for (let ym = from, i = 0; ym <= to && ym <= thisYm && i < PER_MAX.month; ym = UT.nextYm(ym), i++) { const ly = UT.ym(Number(ym.slice(0, 4)) - 1, Number(ym.slice(5)));
          out.push({ label: ym.slice(2).replace('-', '.'), cur: monthVal(ym, uk, metric), prev: monthVal(ly, uk, metric), prior: monthVal(UT.prevYm(ym), uk, metric), partial: ym === thisYm && !UT.monthComplete(DAILY, ym), m: [ym, ly, UT.prevYm(ym)] }); }
      } else {
        const qv = (y, q) => { const ms = [1, 2, 3].map(k => UT.ym(y, (q - 1) * 3 + k)).filter(ym => ym <= thisYm); if (!ms.length) return null;
          if (metric === 'unit') { const u = ms.reduce((a, ym) => a + (S(ym)[perUtil].usage || 0), 0), p = ms.reduce((a, ym) => a + (S(ym).production || 0), 0); return p ? u / p : null; }
          const v = ms.map(ym => monthVal(ym, uk, metric)).filter(x => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
        const [cy, cq] = qOfYm(thisYm);
        let q = from.split('-').map(Number); const tq = to.split('-').map(Number);
        for (let i = 0; (q[0] < tq[0] || (q[0] === tq[0] && q[1] <= tq[1])) && (q[0] < cy || (q[0] === cy && q[1] <= cq)) && i < PER_MAX.quarter; q = qNext(q), i++) {
          const [y, qq] = q; const pq = qPrev([y, qq]); out.push({ label: `${String(y).slice(2)}년 ${qq}분기`, cur: qv(y, qq), prev: qv(y - 1, qq), prior: qv(pq[0], pq[1]), partial: y === cy && qq === cq });
        }
      }
      return out;
    }
    // 기간 입력칸
    function perRangeHtml() {
      const { from, to } = perRange(), g = perGran;
      let inp;
      if (g === 'day' || g === 'week') inp = `<input type="date" id="per-from" value="${from}" max="${todayStr}"> ~ <input type="date" id="per-to" value="${to}" max="${todayStr}">`;
      else if (g === 'month') inp = `<input type="month" id="per-from" value="${from}" max="${thisYm}"> ~ <input type="month" id="per-to" value="${to}" max="${thisYm}">`;
      else {
        const [cy, cq] = qOfYm(thisYm), opts = []; let q = [2023, 1];
        const first = Object.keys(MONTHLY).sort()[0]; if (first) q = [Number(first.slice(0, 4)) - 1, 1];
        for (; q[0] < cy || (q[0] === cy && q[1] <= cq); q = qNext(q)) opts.push(qKey(...q));
        const sel = (id, v) => `<select id="${id}">${opts.map(o => `<option value="${o}" ${o === v ? 'selected' : ''}>${o.slice(0, 4)}년 ${o.slice(5)}분기</option>`).join('')}</select>`;
        inp = sel('per-from', from) + ' ~ ' + sel('per-to', to);
      }
      const quick = { day: [[30, '30일'], [60, '60일'], [90, '90일'], [365, '1년']], week: [[13, '13주'], [26, '26주'], [52, '52주']], month: [[12, '12개월'], [24, '24개월'], [36, '36개월']], quarter: [[4, '4분기'], [8, '8분기'], [12, '12분기']] }[g];
      return `<span class="per-range">기간 ${inp} <button class="chip" onclick="perApplyRange()">보기</button> &nbsp;최근 ` +
        quick.map(([n, t]) => `<button class="chip ${!perSel[g] && perN[g] === n ? 'on' : ''}" onclick="perN.${g}=${n};perSel.${g}=null;renderPeriod()">${t}</button>`).join('') + `</span>`;
    }
    function perApplyRange() {
      let from = document.getElementById('per-from').value, to = document.getElementById('per-to').value;
      if (!from || !to) return alert('시작과 끝을 모두 고르세요.');
      if (from > to) [from, to] = [to, from];
      // 너무 길면 줄이기
      const g = perGran, max = PER_MAX[g];
      let cnt = 0;
      if (g === 'day') cnt = (new Date(to) - new Date(from)) / 864e5 + 1;
      else if (g === 'week') cnt = (new Date(isoWeekStart(to)) - new Date(isoWeekStart(from))) / (7 * 864e5) + 1;
      else if (g === 'month') cnt = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
      else cnt = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 4 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
      if (cnt > max) alert(`한 번에 최대 ${max}개 ${{ day: '일', week: '주', month: '개월', quarter: '분기' }[g]}까지 볼 수 있어 앞쪽 ${max}개만 보여줍니다.`);
      perSel[g] = { from: g === 'week' ? isoWeekStart(from) : from, to: g === 'week' ? isoWeekStart(to) : to };
      renderPeriod();
    }
    // 생산 안 한 날 (생산 대시보드 일별 실적 — 전처리 원육 투입이 없는 날). 실적 자료가 시작되기 전 날짜는 판단 안 함
    let perProdTried = false;
    let prodRange = null; // [처음, 마지막] 실적 날짜 — 이 범위 밖(아직 안 올라온 최근 날짜 등)은 판단 안 함
    function prodState(ds) { if (!PRODD) return null; if (!prodRange) { const k = Object.keys(PRODD).filter(d => PRODD[d].rm > 0).sort(); prodRange = k.length ? [k[0], k[k.length - 1]] : ['9', '0']; }
      if (ds < prodRange[0] || ds > prodRange[1]) return null; const p = PRODD[ds]; return p && p.rm > 0 ? 'on' : 'off'; }
    function prodDays(ws, n) { let k = 0, known = 0; for (let i = 0; i < n; i++) { const st = prodState(UT.addDays(ws, i)); if (st) { known++; if (st === 'on') k++; } } return known ? k : null; }
    // 사용량 출처: 월·분기 = 고지서 확정이면 고지서, 아니면 검침(일일값) 합산
    function perSrc(ym, uk) { const st = S(ym)[uk].status; return st === '확정' ? 'bill' : st ? 'daily' : null; }
    const PER_SRC_TXT = { elec: ['고지서 사용량', '파워플래너 일일값 합산'], gas: ['고지서 사용량', '가스 일일 검침 합산'], water: ['고지서 사용량', '용수 일일 검침 합산'], ww: ['고지서 발생량', '폐수 일일 검침 합산'] };
    function renderPeriod() {
      if (!document.getElementById('chart-period')) return; // 기간 비교 화면은 뺌 (현황 「항목별 추이」와 같은 내용)
      if (!window.Chart) return;
      setTimeout(renderPerElec, 0);
      if ((perGran === 'day' || perGran === 'week') && !PRODD && !perProdTried) { perProdTried = true; loadProdDaily().then(() => { if (document.getElementById('tab-period').classList.contains('active')) renderPeriod(); }).catch(() => {}); }
      if ((perGran === 'day' || perGran === 'week') && perMetric !== 'usage') perMetric = 'usage';
      const U = UT.UTILS.find(u => u.k === perUtil), DU = UT.DAILY_UTILS.find(u => u.k === perUtil);
      document.getElementById('per-chips').innerHTML =
        [['day', '일별'], ['week', '주별'], ['month', '월별'], ['quarter', '분기별']].map(([k, n]) => `<button class="chip ${perGran === k ? 'on' : ''}" onclick="perGran='${k}';renderPeriod()">${n}</button>`).join('') + ' &nbsp; ' +
        UT.UTILS.map(u => `<button class="chip ${perUtil === u.k ? 'on' : ''}" onclick="perUtil='${u.k}';renderPeriod()">${u.name}</button>`).join('') + ' &nbsp; ' +
        [['usage', '사용량'], ['cost', '비용'], ['unit', '원단위']].map(([k, n]) => `<button class="chip ${perMetric === k ? 'on' : ''}" ${(perGran === 'day' || perGran === 'week') && k !== 'usage' ? 'disabled title="일·주 단위는 사용량만 (비용·원육 투입량은 월 단위로만 있음)"' : ''} onclick="perMetric='${k}';renderPeriod()">${n}</button>`).join('');
      document.getElementById('per-range').innerHTML = perRangeHtml();
      const daily = perGran === 'day' || perGran === 'week';
      const unit = perMetric === 'cost' ? '천원' : perMetric === 'unit' ? `${U.unit}/kg` : (daily ? DU.unit : U.unit);
      const ser = periodSeries();
      const gName = { day: '일별', week: '주별', month: '월별', quarter: '분기별' }[perGran];
      const rg = ser.length ? ` (${ser[0].label} ~ ${ser[ser.length - 1].label})` : '';
      const [nLy, nPr] = PER_CMP[perGran];
      document.getElementById('per-title').textContent = `${U.name} ${gName} ${perMetric === 'usage' ? '사용량' : perMetric === 'cost' ? '비용' : '원단위'} — ${nLy}·${nPr} 비교${rg}`;
      document.getElementById('per-note').innerHTML = (perGran === 'day' ? '전년 같은 요일 = 364일 전 (52주 전), 전월 같은 요일 = 28일 전 (4주 전) — 둘 다 요일을 맞춤. ' : perGran === 'week' ? '주 = 월요일 시작. 전년 같은 주 = 52주 전 (요일 맞춤), 전주 = 바로 앞 주. 이번 주는 어제까지만, 비교도 같은 날수만큼. ' : perGran === 'month' ? '전년 동월 = 작년 같은 달, 전월 = 바로 앞 달 (달력 기준이라 요일은 맞추지 않음). ' : '전년 동분기 = 작년 같은 분기, 전분기 = 바로 앞 분기. ') +
        (daily && perUtil === 'gas' ? '가스 일·주 단위는 ㎥(월·분기는 MJ). ' : '') + '옅은 막대 = 아직 진행 중인 기간.' +
        `<br><b>사용량 기준</b>: ${daily ? `${perUtil === 'elec' ? '한전 파워플래너 일일값' : '설비검침 일일 지침 차 (그날 아침 → 다음날 아침)'}${perGran === 'week' ? ' 7일 합' : ''}` : `${PER_SRC_TXT[perUtil][0]} (고지서를 아직 안 넣은 달은 ${PER_SRC_TXT[perUtil][1]} — 표에 「일일합산」 표시)`}` +
        (daily ? ` · <span class="noprod">생산 없음</span> = 생산 대시보드 일별 실적에 원육 투입이 없는 날${PRODD ? '' : ' (실적 불러오는 중…)'}` : '') +
        ` &nbsp; 그래프 비교선: ` + [['both', '둘 다'], ['ly', nLy], ['prior', nPr]].map(([k, n]) => `<button class="chip ${perLine === k ? 'on' : ''}" onclick="perLine='${k}';renderPeriod()">${n}</button>`).join('');
      const pr = perGran === 'day' ? 0 : 3;
      const lines = [];
      if (perLine !== 'prior') lines.push({ type: 'line', label: nLy, data: ser.map(s => s.prev), borderColor: '#a3a29d', backgroundColor: '#a3a29d', borderDash: [5, 4], borderWidth: 2, pointRadius: pr, order: 1 });
      if (perLine !== 'ly') lines.push({ type: 'line', label: nPr, data: ser.map(s => s.prior), borderColor: '#e08a1e', backgroundColor: '#e08a1e', borderDash: [2, 3], borderWidth: 2, pointRadius: pr, order: 1 });
      mkChart('chart-period', { type: 'bar', data: { labels: ser.map(s => s.label), datasets: [
        { label: '이번', data: ser.map(s => s.cur), backgroundColor: ser.map(s => s.partial ? U.color + '66' : U.color), maxBarThickness: 26, order: 2 }, ...lines
      ] }, options: (() => { const o = baseOpts(unit); o.plugins.legend.display = true; o.scales.x.ticks.maxRotation = 0; o.scales.x.ticks.autoSkip = true;
        o.plugins.tooltip.callbacks.label = c => ` ${c.dataset.label}: ${perMetric === 'unit' ? fU(c.raw, perUtil) : f0(c.raw)} ${unit}`;
        o.plugins.tooltip.callbacks.footer = items => { const i = items[0].dataIndex, s = ser[i], pc = (a, b) => a !== null && b ? `${((a / b - 1) * 100).toFixed(1)}%` : '-';
          const np = s.d ? [0, 1, 2].filter(k => prodState(s.d[k]) === 'off').map(k => ['이번', nLy, nPr][k]) : [];
          return s.cur === null ? '' : `${nLy} 대비 ${pc(s.cur, s.prev)} · ${nPr} 대비 ${pc(s.cur, s.prior)}${np.length ? `\n생산 없음: ${np.join(', ')}` : ''}`; }; return o; })() });
      // 표 (최근 것부터)
      const fmt = v => v === null || v === undefined ? '-' : (perMetric === 'unit' ? fU(v, perUtil) : f0(v));
      const okLy = ser.filter(s => s.cur !== null && s.prev !== null && !s.partial), okPr = ser.filter(s => s.cur !== null && s.prior !== null && s.prior !== undefined && !s.partial);
      const sm = (l, k) => l.reduce((a, s) => a + s[k], 0);
      document.getElementById('per-table').innerHTML = `<table class="t"><tr><th class="l">기간</th><th>이번</th><th>${nLy}</th><th>${nLy} 대비</th><th>${nPr}</th><th>${nPr} 대비</th></tr>` +
        ser.slice().reverse().map(s => { const tag = i => { // i: 0 이번, 1 전년, 2 전월/전주
            if (s.d) return prodState(s.d[i]) === 'off' ? ' <span class="noprod">생산 없음</span>' : '';
            if (s.w) { const k = prodDays(s.w[i], s.days); return k === null ? '' : ` <span class="hint">생산 ${k}일</span>`; }
            if (s.m && perMetric !== 'unit') { const sr = perSrc(s.m[i], perUtil); return sr === 'daily' ? ' <span class="srcd">일일합산</span>' : ''; }
            return ''; };
          return `<tr${s.partial ? ' class="hint"' : ''}><td class="l">${esc(s.label)}${s.partial ? ' (진행 중)' : ''}</td><td><b>${fmt(s.cur)}</b>${tag(0)}</td><td>${fmt(s.prev)}${tag(1)}</td><td>${pctTxt(s.cur, s.prev)}</td><td>${fmt(s.prior)}${tag(2)}</td><td>${pctTxt(s.cur, s.prior)}</td></tr>`; }).join('') +
        (perMetric !== 'unit' && (okLy.length || okPr.length) ? `<tr class="sum"><td class="l">합계 <span class="hint">(진행 중 제외, 비교값 있는 기간만)</span></td><td></td><td>${okLy.length ? `${fmt(sm(okLy, 'cur'))} vs ${fmt(sm(okLy, 'prev'))}` : '-'}</td><td>${okLy.length ? pctTxt(sm(okLy, 'cur'), sm(okLy, 'prev')) : ''}</td><td>${okPr.length ? `${fmt(sm(okPr, 'cur'))} vs ${fmt(sm(okPr, 'prior'))}` : '-'}</td><td>${okPr.length ? pctTxt(sm(okPr, 'cur'), sm(okPr, 'prior')) : ''}</td></tr>` : '') + '</table>' +
        `<div class="hint" style="margin-top:6px">단위: ${unit}. 증감 ▲ = 더 씀(빨강), ▼ = 덜 씀(초록).</div>`;
    }


    // =====================================================================
    // 지출결의 자료: 유틸별 [지출결의 입력사항 · 추가의견 문구 · 원육 사용량당 그래프] → 그룹웨어에 붙여넣기
    // =====================================================================
    let exYm = null, exUtil = 'elec', exChartKind = 'unit', exChart = null;
    const EX_NAME = { elec: '전력', gas: '가스', water: '용수', ww: '폐수' };
    const exUW = uk => uk === 'ww' ? '발생량' : '사용량'; // 폐수는 발생량
    const EX_BILL = { elec: '전기요금', gas: '도시가스요금', water: '상수도요금', ww: '하수도(폐수)요금' };
    function shiftExMonth(d) { exYm = d > 0 ? UT.nextYm(exYm) : UT.prevYm(exYm); renderExpense(); }
    // "32,596천원 ~ 전월대비 : 345천원(-1.0%)감소."
    function exCmp(cur, prev, fmt, unit) {
      if (cur === null || cur === undefined || isNaN(cur)) return '-';
      let t = `${fmt(cur)}${unit}`;
      if (prev === null || prev === undefined || isNaN(prev) || !prev) return t + '.';
      const d = cur - prev, p = d / prev * 100, pt = (p >= 0 ? '+' : '-') + Math.abs(p).toFixed(1);
      return `${t} ~ 전월대비 : ${fmt(Math.abs(d))}${unit}(${pt}%)${Math.abs(d) < 1e-9 ? '동일' : d > 0 ? '증가' : '감소'}.`;
    }
    const exF = d => v => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
    function exLines(ym) {
      const s = S(ym), p = S(UT.prevYm(ym)), uk = exUtil, N = EX_NAME[uk], U = UT.UTILS.find(u => u.k === uk);
      const c = s[uk], c0 = p[uk], dn = UT.daysIn(ym), dn0 = UT.daysIn(UT.prevYm(ym));
      const ud = uk === 'water' || uk === 'ww' ? 3 : 1;
      const L = [];
      const k1 = v => v === null || v === undefined ? null : Math.round(v / 1000);
      if (uk === 'water') { // 용수: 지로 안내 문구 (사용 기간 = 전월 12일 ~ 이번 달 11일 검침, 지로는 다음 달분)
        const yy = x => x.slice(2, 4), mm = x => x.slice(5, 7), g = UT.nextYm(ym), a = UT.prevYm(ym);
        L.push(`※ 지로는 ${yy(g)}년 ${mm(g)}월분 : 용수 사용 기간 = ${yy(a)}년 ${mm(a)}월 12일 ~ ${yy(ym)}년 ${mm(ym)}월 11일 (실적은 ${mm(ym)}월로 적용).`);
        L.push('※ 구경 40A + 50A 합산하여 지출결의 작성. (수치 비교도 합산량으로 적용)');
        L.push('※ 익산시 상수도 급수조례 제27조에 의거 2개 이상의 수도계량기 장치 시 사용량을 합산하여 계산. (7월 고지분부터 적용)');
        L.push('    -. 40A + 50A 사용량 합산하여 40A 고지서 사용량에 적용, 50A 고지서에는 구경요금만 부과');
      }
      L.push(`1. ${N} 비용 = ${exCmp(c.cost, c0.cost, v => exF(0)(v / 1000), '천원')}`);
      L.push(`2. ${N} ${exUW(uk)} = ${exCmp(c.usage, c0.usage, exF(0), U.unit)}`);
      const sub = [];
      // 일평균: 일일 사용량(전기는 한전 파워플래너 값)을 그 달 날짜별로 평균. 일일 값이 모자라면 월 사용량 ÷ 날수
      const dayAvg = (x, cx) => { let t = 0, n = 0; for (let d = 1; d <= UT.daysIn(x); d++) { const v = (UT.dailyUsage(DAILY, UT.dateStr(x, d)) || {})[uk]; if (v !== null && v !== undefined && !isNaN(v)) { t += Number(v); n++; } }
        return uk === 'elec' && n >= UT.daysIn(x) * 0.9 ? t / n : (cx.usage === null ? null : cx.usage / UT.daysIn(x)); };
      if (uk === 'gas') { // 가스: 매일 가스검침 중 보일러만(식당은 기숙사라 통제 밖), 보일러를 쓴 날(0 초과)만 평균
        const ga = x => { let t = 0, n = 0; for (let d = 1; d <= UT.daysIn(x); d++) { const v = UT.diffReading(DAILY, UT.dateStr(x, d), ['gas_boiler']); if (v !== null && v !== undefined && !isNaN(v) && v > 0) { t += Number(v); n++; } } return n ? { v: t / n, n } : { v: null, n: 0 }; };
        const a1 = ga(ym), a0 = ga(UT.prevYm(ym));
        sub.push(`일평균 보일러 가스사용량(가동일 ${a1.n}일) = ${exCmp(a1.v, a0.v, exF(1), '㎥')}`);
      } else sub.push(`일평균 ${N} ${exUW(uk)} = ${exCmp(dayAvg(ym, c), dayAvg(UT.prevYm(ym), c0), exF(1), U.unit)}`);
      if (uk === 'elec') {
        const ww = meterKwh(ym, 'elec_ww_kwh'), ww0 = meterKwh(UT.prevYm(ym), 'elec_ww_kwh'), hv = meterKwh(ym, 'elec_hvac_kwh'), hv0 = meterKwh(UT.prevYm(ym), 'elec_hvac_kwh');
        if (ww !== null && hv !== null && c.usage !== null) {
          const pr = c.usage - ww - hv, pr0 = (c0.usage !== null && ww0 !== null && hv0 !== null) ? c0.usage - ww0 - hv0 : null;
          sub.push(`생산 전력 사용량 = ${exCmp(pr, pr0, exF(0), 'kWh')}`);
          sub.push(`폐수처리장 전력 사용량 = ${exCmp(ww, ww0, exF(0), 'kWh')}`);
          sub.push(`공조냉동 전력 사용량 = ${exCmp(hv, hv0, exF(0), 'kWh')}`);
        }
      } else if (uk === 'gas') {
        sub.push(`가스 사용량(㎥) = ${exCmp(c.m3, c0.m3, exF(0), '㎥')}`);
        const g = gasSplit(s), g0 = gasSplit(p), f = (a, n) => (a.find(x => x.name === n) || {}).m3;
        ['보일러', '식당'].forEach(n => { if (f(g, n) !== undefined) sub.push(`${n} 가스 사용량 = ${exCmp(f(g, n), f(g0, n), exF(0), '㎥')}`); });
      } else if (uk === 'water') {
        const u4 = x => x.w40 ? x.w40.usage : null, u5 = x => x.w50 ? x.w50.usage : null;
        if (u4(c) !== null) sub.push(`40A 사용량 = ${exCmp(u4(c), u4(c0), exF(0), '㎥')}`);
        if (u5(c) !== null) sub.push(`50A 사용량 = ${exCmp(u5(c), u5(c0), exF(0), '㎥')}`);
      }
      const GA = '가나다라마바사아';
      if (uk === 'elec') sub.forEach((t, i) => L.push(`  ${GA[i]}. ${t}`)); // 가스·용수·폐수는 세부 항목 없이 1~4번만
      L.push(`3. 원육 사용량당 비용 = ${exCmp(ratio(c.cost, s.production), ratio(c0.cost, p.production), exF(1), '원/kg')}`);
      L.push(`4. 원육 사용량당 ${N}${exUW(uk)} = ${exCmp(ratio(c.usage, s.production), ratio(c0.usage, p.production), exF(ud), `${U.unit}/kg`)}`);
      return { lines: L, s, c };
    }
    // 지출결의 입력사항 줄: [상세내용, 공급가액, 부가세, 합계]
    function exRows(ym, s) {
      const y = ym.slice(0, 4), m = ym.slice(5), tag = `2공장 ${EX_BILL[exUtil]}_${y}년${m}월`, raw = MONTHLY[ym] || {};
      if (exUtil === 'elec') {
        const ep = elecParts(s); if (!ep) return [];
        const sup = ep.total - ep.vat - ep.fund - (ep.late || 0);
        return [[tag, sup, ep.vat, ep.total - ep.fund - (ep.late || 0)], [`2공장 전기요금_공통전력기금_${y}년${m}월`, ep.fund, 0, ep.fund], ...(ep.late ? [[`2공장 전기요금_연체료_${y}년${m}월`, ep.late, 0, ep.late]] : [])];
      }
      if (exUtil === 'gas') {
        // 계산이 고지서와 맞으면(10원 미만 절사 차이만) 고지서 소계 그대로 + 원단위 절사 한 줄
        const g = s.gas.calc;
        if (g && s.gas.status === '확정' && Math.abs(Math.floor((((g.boiler || {}).total || 0) + ((g.rest || {}).total || 0)) / 10) * 10 - s.gas.cost) < 1) {
          const L = [['보일러', g.boiler], ['식당', g.rest]].filter(([, x]) => x).map(([n, x]) => [`2공장 도시가스요금_${n}_${y}년${m}월`, x.cost + x.fee, x.vat, x.total]);
          const cut = s.gas.cost - L.reduce((a, r) => a + r[3], 0);
          if (cut) { L[0][1] += cut; L[0][3] += cut; L.cut = cut; } // 원단위 절사는 보일러 공급가액에서 뺌
          return L;
        }
        return gasSplit(s).map(x => [`2공장 도시가스요금_${x.name}_${y}년${m}월`, x.exvat, x.total - x.exvat, x.total]);
      }
      if (exUtil === 'water') return [['40A', s.water.w40cost], ['50A', s.water.w50cost]].filter(x => x[1]).map(([n, v]) => [`2공장 상수도요금_${n}_${y}년${m}월`, v, 0, v]);
      const ff = Number(raw.ww_facility_fee) || 0, fi = Number(raw.ww_improve_fee) || 0;
      if (ff || fi) return [['시설사용료', ff], ['개선부담금', fi]].filter(x => x[1]).map(([n, v]) => [`2공장 폐수_${n}_${y}년${m}월`, v, 0, v]);
      return s.ww.cost ? [[tag, s.ww.cost, 0, s.ww.cost]] : [];
    }
    function renderExpense() {
      if (!exYm) exYm = UT.prevYm(thisYm);
      document.getElementById('ex-month').textContent = ymLabel(exYm);
      const U = UT.UTILS.find(u => u.k === exUtil), N = EX_NAME[exUtil];
      document.getElementById('ex-utils').innerHTML = UT.UTILS.map(u => `<button class="chip ${u.k === exUtil ? 'on' : ''}" onclick="exUtil='${u.k}';renderExpense()">${u.name}</button>`).join('');
      const { lines, s, c } = exLines(exYm), rows = exRows(exYm, s);
      const st = c.status;
      let h = st !== '확정' ? `<div class="fc-note">⚠ ${ymLabel(exYm)} ${U.name}는 <b>${st || '자료 없음'}</b> 상태입니다. 고지서를 넣어 확정한 뒤 쓰세요.</div>` : '';
      const tot = rows.reduce((a, r) => [a[0] + (r[1] || 0), a[1] + (r[2] || 0), a[2] + (r[3] || 0)], [0, 0, 0]);
      h += `<div class="card"><h3>지출결의 입력사항 <span class="sub">숫자를 누르면 복사됩니다</span></h3>
        <div class="tbl-wrap"><table class="t"><tr><th class="l">상세내용</th><th>공급가액</th><th>부가세</th><th>합계</th></tr>
        ${rows.map(r => `<tr><td class="l ex-cp" onclick="exCopy(this.textContent,this)">${esc(r[0])}</td>${[1, 2, 3].map(i => `<td class="ex-cp" onclick="exCopy('${r[i] || 0}',this)">${f0(r[i] || 0)}</td>`).join('')}</tr>`).join('')}
        ${rows.length > 1 ? `<tr class="sum"><td class="l">지출결의계</td>${tot.map(v => `<td class="ex-cp" onclick="exCopy('${v}',this)">${f0(v)}</td>`).join('')}</tr>` : ''}</table></div>
        <div class="hint">${exUtil === 'elec' ? '공급가액 = 청구액 − 부가세 − 전력기금 (원단위 절사 반영). 전력기금은 부가세 없이 따로 한 줄.' : exUtil === 'gas' ? (rows.cut ? `※ 보일러 공급가액·합계는 원단위절사 ${f0(rows.cut)}원이 포함된 금액입니다 (고지서 보일러 소계 ${f0(rows[0][3] - rows.cut)}원).` : s.gas.status === '확정' && s.gas.calc ? '보일러·식당은 고지서 소계 그대로입니다.' : '보일러·식당은 검침 비율대로 고지서 금액을 나눈 값입니다 (월간입력 가스 칸을 고지서대로 넣으면 고지서 소계 그대로 나옵니다).') : ''}</div></div>`;
      h += `<div class="card"><h3>추가의견 <span class="sub">고쳐서 쓸 수 있습니다</span></h3>
        <textarea id="ex-text" class="ex-text" rows="${lines.length + 1}">${esc(lines.join('\n'))}</textarea>
        <div class="toolbar" style="margin-top:6px"><button class="btn" onclick="exCopy(document.getElementById('ex-text').value,this)">📋 추가의견 복사</button><span class="hint">전월(${ymLabel(UT.prevYm(exYm))})과 비교 · 비용은 부가세 포함 청구액 기준</span></div></div>`;
      h += `<div class="card"><h3>그래프 <span class="sub">그림 복사 후 그룹웨어 「캡쳐자료」 칸에 붙여넣기</span></h3>
        <div class="toolbar"><span class="chips"><button class="chip ${exChartKind === 'unit' ? 'on' : ''}" onclick="exChartKind='unit';renderExpense()">원육 사용량당 ${N}${exUW(exUtil)}</button><button class="chip ${exChartKind === 'ucost' ? 'on' : ''}" onclick="exChartKind='ucost';renderExpense()">원육 사용량당 ${N} 비용</button><button class="chip ${exChartKind === 'usage' ? 'on' : ''}" onclick="exChartKind='usage';renderExpense()">${N} ${exUW(exUtil)}</button></span>
          <button class="btn" onclick="exCopyImg(this)">🖼 그림 복사</button><button class="btn secondary" onclick="exSaveImg()">💾 그림 저장</button></div>
        <div class="ex-chart"><canvas id="ex-canvas" width="900" height="460"></canvas></div></div>`;
      document.getElementById('ex-body').innerHTML = h;
      exDraw();
    }
    function exDraw() {
      const y = Number(exYm.slice(0, 4)), mEnd = Number(exYm.slice(5)), U = UT.UTILS.find(u => u.k === exUtil), N = EX_NAME[exUtil];
      const ud = exUtil === 'water' || exUtil === 'ww' ? 3 : 1;
      const K = { unit: { t: `원육 사용량당 ${N}${exUW(exUtil)}`, u: `${U.unit}/kg`, d: ud, f: s => ratio(s[exUtil].usage, s.production) },
        ucost: { t: `원육 사용량당 ${N} 비용`, u: '원/kg', d: 1, f: s => ratio(s[exUtil].cost, s.production) },
        usage: { t: `${N} ${exUW(exUtil)}`, u: U.unit, d: 0, f: s => s[exUtil].usage } }[exChartKind];
      const vals = Array.from({ length: 12 }, (_, i) => i < mEnd ? K.f(S(UT.ym(y, i + 1))) : null);
      const fmt = exF(K.d), i = mEnd - 1, pv = i > 0 ? vals[i - 1] : null, cv = vals[i];
      const chg = cv !== null && pv ? (cv / pv - 1) * 100 : null;
      const BG = { id: 'exbg', beforeDraw(ch) { const g = ch.ctx; g.save(); g.fillStyle = '#fff'; g.fillRect(0, 0, ch.width, ch.height); g.restore(); } };
      const LB = { id: 'exlb', afterDatasetsDraw(ch) {
        const g = ch.ctx, meta = ch.getDatasetMeta(0); g.save(); g.textAlign = 'center'; g.font = '600 12px "Malgun Gothic", sans-serif'; g.fillStyle = '#222';
        meta.data.forEach((el, k) => { if (vals[k] === null) return; g.fillText(fmt(vals[k]), el.x, el.y - 12); });
        g.textAlign = 'left'; g.font = '700 14px "Malgun Gothic", sans-serif'; g.fillStyle = '#111'; const x0 = ch.chartArea.right - 270;
        g.fillText('▶ 전월대비 증감률', x0, ch.chartArea.top + 16);
        if (chg !== null) { g.font = '700 13px "Malgun Gothic", sans-serif'; g.fillStyle = '#e00000'; g.fillText(`• ${String(mEnd).padStart(2, '0')}월 = ${fmt(cv)} ${K.u} : ${chg > 0 ? '+' : ''}${chg.toFixed(1)}% ${chg > 0 ? '증가' : '감소'}`, x0, ch.chartArea.top + 38); }
        g.restore(); } };
      if (exChart) exChart.destroy();
      exChart = new Chart(document.getElementById('ex-canvas'), {
        type: 'line', plugins: [BG, LB],
        data: { labels: Array.from({ length: 12 }, (_, k) => `${k + 1}월`), datasets: [{ label: `${String(y).slice(2)}년`, data: vals, borderColor: '#e00000', backgroundColor: '#ffe500', pointBorderColor: '#e00000', pointBackgroundColor: '#ffe500', pointRadius: 6, pointBorderWidth: 3, borderWidth: 3, spanGaps: false }] },
        options: { responsive: false, animation: false, layout: { padding: { top: 10, right: 16 } },
          plugins: { title: { display: true, text: K.t, align: 'start', font: { size: 20, weight: '700' }, color: '#111', padding: { bottom: 14 } }, legend: { display: true, position: 'top' }, tooltip: { enabled: false } },
          scales: { y: { beginAtZero: true, grace: '15%', title: { display: true, text: `(단위: ${K.u})` }, ticks: { callback: v => exF(K.d === 3 ? 3 : K.d)(v) } }, x: { grid: { display: false } } } }
      });
    }
    async function exCopy(t, el) {
      try { await navigator.clipboard.writeText(String(t).trim()); } catch (e) { const ta = document.createElement('textarea'); ta.value = String(t).trim(); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      if (el) { el.classList.add('ex-done'); setTimeout(() => el.classList.remove('ex-done'), 900); }
    }
    async function exCopyImg(btn) {
      const cv = document.getElementById('ex-canvas');
      try {
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        btn.textContent = '✓ 복사됨'; setTimeout(() => btn.textContent = '🖼 그림 복사', 1200);
      } catch (e) { alert('이 브라우저에서는 그림 복사가 안 됩니다. [그림 저장]으로 받아서 붙여넣으세요.'); }
    }
    function exSaveImg() {
      const a = document.createElement('a'); a.href = document.getElementById('ex-canvas').toDataURL('image/png');
      a.download = `${exYm}_${EX_NAME[exUtil]}_${{ unit: '원육사용량당사용량', ucost: '원육사용량당비용', usage: '사용량' }[exChartKind]}.png`; a.click();
    }

    // =====================================================================
    // 유틸리티별 상세 내역 (엑셀 전기상세·연료상세·용수상세·폐수상세 탭처럼) — 분석 탭 유틸 칸을 누르면 열림
    // =====================================================================
    let CMP_SHOW = { prev: true, ly: true };
    try { const v = JSON.parse(localStorage.getItem('ut_cmp_show') || 'null'); if (v) CMP_SHOW = Object.assign(CMP_SHOW, v); } catch (e) { }
    function setCmpShow(k) { CMP_SHOW[k] = !CMP_SHOW[k]; try { localStorage.setItem('ut_cmp_show', JSON.stringify(CMP_SHOW)); } catch (e) { } renderYearTable(); if (!document.getElementById('udet').hidden) renderUDet(); }
    const cmpChips = () => `<span class="chips no-print"><button class="chip ${CMP_SHOW.prev ? 'on' : ''}" onclick="setCmpShow('prev')">전월대비</button><button class="chip ${CMP_SHOW.ly ? 'on' : ''}" onclick="setCmpShow('ly')">전년동월대비</button></span>`;
    let udUtil = 'elec', udYear = null, udRows = [];
    function openUDet(uk) { udUtil = uk; udYear = Number((dashYm || thisYm).slice(0, 4)); document.getElementById('udet').hidden = false; renderUDet(); }
    function closeUDet() { document.getElementById('udet').hidden = true; }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('udet') && !document.getElementById('udet').hidden) closeUDet(); });
    const fxd = d => v => v === null || v === undefined || isNaN(v) ? '-' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const fmax = d => v => v === null || v === undefined || isNaN(v) ? '-' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d });
    const UD_SUM = [['sumTotal', '유틸리티 총비용'], ['sumProd', '원육 투입량'], ['sumUnit', '원육 kg당 비용']];
    function udSpec(uk) {
      const r0 = (l, f, fmt = f0, o = {}) => ({ l, f, fmt, ...o });
      if (uk === 'sumTotal') return [{ grp: '1) 유틸리티 총비용' },
        r0('합계 (VAT 포함)', s => s.total, f0, { sum: true, b: true, cmp: true, prov: s => s.status === '가마감' }),
        r0('VAT 별도', s => s.exvat, f0, { sum: true, cmp: true }), r0('부가세', s => s.total === null || s.exvat === null ? null : s.total - s.exvat, f0, { sum: true }),
        { grp: '2) 유틸별 비용 (VAT 포함)' },
        ...UT.UTILS.flatMap(u => [r0(`${u.name}`, s => s[u.k].cost, f0, { sum: true, b: true, cmp: true, prov: s => s[u.k].status === '가마감' }), r0(`  ${u.name} 비중 (%)`, s => ratio(s[u.k].cost, s.total) === null ? null : ratio(s[u.k].cost, s.total) * 100, fxd(1))]),
        { grp: '3) 참고 (합계 제외)' }, r0('폐수 위탁처리비', s => s.ww.outsource, f0, { sum: true }), r0('슬러지처리비', s => s.ww.sludge, f0, { sum: true })];
      if (uk === 'sumProd') return [{ grp: '1) 원육 투입량' },
        r0('원육 투입량 (kg)', s => s.production, f0, { sum: true, b: true, cmp: true }),
        r0('생산일수 (일)', s => { const v = (s.m || {}).prod_days ?? (MONTHLY[s.ym] || {}).prod_days; return v === undefined || v === null || v === '' ? null : Number(v); }, f0, { sum: true, cmp: true }),
        r0('생산일 하루당 원육 (kg/일)', s => { const v = (s.m || {}).prod_days ?? (MONTHLY[s.ym] || {}).prod_days; return v ? ratio(s.production, Number(v)) : null; }, f0, { cmp: true }),
        r0('달력 하루당 원육 (kg/일)', s => s.production ? s.production / UT.daysIn(s.ym) : null, f0, { cmp: true }),
        { grp: '2) 원육 투입량 기준 사용량' },
        ...UT.UTILS.map(u => r0(`${u.name} 원육 kg당 사용량 (${u.unit}/kg)`, s => ratio(s[u.k].usage, s.production), v => fU(v, u.k), { cmp: true }))];
      if (uk === 'sumUnit') return [{ grp: '1) 원육 kg당 비용 (원/kg)' },
        r0('합계', s => ratio(s.total, s.production), fxd(1), { b: true, cmp: true, prov: s => s.status === '가마감' }),
        ...UT.UTILS.map(u => r0(u.name, s => ratio(s[u.k].cost, s.production), fxd(1), { cmp: true, prov: s => s[u.k].status === '가마감' })),
        { grp: '2) 원육 kg당 사용량' },
        ...UT.UTILS.map(u => r0(`${u.name} (${u.unit}/kg)`, s => ratio(s[u.k].usage, s.production), v => fU(v, u.k), { cmp: true })),
        { grp: '3) 계산 근거' }, r0('유틸리티 합계 (원)', s => s.total, f0, { sum: true }), r0('원육 투입량 (kg)', s => s.production, f0, { sum: true })];
      const M = (s, k) => { const v = (s.m || {})[k]; return v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v); };
      const E = s => s.elec.calc || null, G = s => s.gas.calc || null;
      const nz = v => v === null || v === undefined ? null : v;
      const r = (l, f, fmt = f0, o = {}) => ({ l, f, fmt, ...o });
      const prodRows = [{ grp: '원육 투입량 기준' }, r('원육 투입량 (kg)', s => s.production, f0, { cmp: true, sum: true }),
        r('원육 kg당 비용 (원/kg)', s => ratio(s[uk].cost, s.production), fxd(1), { cmp: true }),
        r(`원육 kg당 사용량 (${UT.UTILS.find(u => u.k === uk).unit}/kg)`, s => ratio(s[uk].usage, s.production), v => fU(v, uk), { cmp: true })];
      if (uk === 'elec') return [
        { grp: '1) 비용' },
        r('기본요금', s => nz(E(s) && E(s).base), f0, { sum: true, cmp: true }), r('전력량요금', s => nz(E(s) && E(s).energy), f0, { sum: true }),
        r('기후환경요금', s => nz(E(s) && E(s).climate), f0, { sum: true }), r('연료비조정액', s => nz(E(s) && E(s).fuel), f0, { sum: true }),
        r('지상역률료', s => nz(E(s) && E(s).pfFee), f0, { sum: true }), r('진상역률료', s => nz(E(s) && E(s).leadFee), f0, { sum: true }), r('정산 요금', s => nz(E(s) && E(s).settlement), f0, { sum: true }),
        r('전기요금계', s => nz(E(s) && E(s).subtotal), f0, { sum: true, b: true }), r('부가가치세', s => nz(E(s) && E(s).vat), f0, { sum: true }), r('연체료', s => nz(E(s) && E(s).late), f0, { sum: true }),
        r('전력기금', s => nz(E(s) && E(s).fund), f0, { sum: true }), r('원단위 절사', s => E(s) ? s.elec.cost - (E(s).subtotal + E(s).vat + E(s).fund + E(s).late) : null, f0, { sum: true }),
        r('당월요금계', s => s.elec.cost, f0, { sum: true, b: true, cmp: true, prov: s => s.elec.status === '가마감' }), r('부가세 별도', s => s.elec.exvat, f0, { sum: true }),
        r('kWh당 전기요금 (원)', s => ratio(s.elec.cost, s.elec.usage), fxd(1), { cmp: true }),
        { grp: '2) 사용량' },
        r('요금적용 전력 (kW)', s => M(s, 'elec_contract_kw'), f0), r('최대 전력 (kW)', s => s.elec.maxKw, fmax(1)),
        r('사용량 (kWh)', s => s.elec.usage, f0, { sum: true, b: true, cmp: true }),
        r('경부하', s => M(s, 'elec_kwh_light'), f0, { sum: true }), r('중간부하', s => M(s, 'elec_kwh_mid'), f0, { sum: true }), r('최대부하', s => M(s, 'elec_kwh_peak'), f0, { sum: true }),
        r('주말 경부하 할인', s => M(s, 'elec_wkd_kwh_light'), f0, { sum: true }), r('주말 중간부하 할인', s => M(s, 'elec_wkd_kwh_mid'), f0, { sum: true }),
        { grp: '3) 단가' },
        r('기본요금 (원/kW)', s => M(s, 'elec_base_rate'), f0), r('경부하 (원/kWh)', s => M(s, 'elec_rate_light'), fmax(2)), r('중간부하', s => M(s, 'elec_rate_mid'), fmax(2)), r('최대부하', s => M(s, 'elec_rate_peak'), fmax(2)),
        r('주말 경부하 할인', s => M(s, 'elec_wkd_rate_light'), fmax(2)), r('주말 중간부하 할인', s => M(s, 'elec_wkd_rate_mid'), fmax(2)),
        r('지상역률', s => M(s, 'elec_pf'), fmax(2)), r('진상역률', s => M(s, 'elec_pf_lead'), fmax(2)),
        ...prodRows];
      if (uk === 'gas') {
        const part = (n, k, hk, ck) => [{ grp: n },
          r('계', s => { const x = G(s) && G(s)[k]; return x ? x.total : null; }, f0, { sum: true, b: true }),
          r('가스사용료', s => { const x = G(s) && G(s)[k]; return x ? x.cost : null; }, f0, { sum: true }),
          r('부가세', s => { const x = G(s) && G(s)[k]; return x ? x.vat : null; }, f0, { sum: true }),
          r('보정기교체', s => { const x = G(s) && G(s)[k]; return x ? x.fee : null; }, f0, { sum: true }),
          r('청구량 (MJ)', s => { const x = G(s) && G(s)[k]; return x ? x.mj : null; }, fxd(4), { sum: true }),
          r('사용량 (㎥)', s => { const x = G(s) && G(s)[k]; return x ? x.m3 : null; }, fxd(4), { sum: true }),
          r('전월지침 (㎥)', s => M(s, k === 'boiler' ? 'gas_boiler_prev' : 'gas_rest_prev'), fxd(0)), r('당월지침 (㎥)', s => M(s, k === 'boiler' ? 'gas_boiler_cur' : 'gas_rest_cur'), fxd(0)),
          r('보정계수', s => M(s, ck), fmax(6)), r('열량계수 (MJ/㎥)', s => M(s, hk) ?? M(s, 'gas_heat'), fxd(4))];
        return [{ grp: '1) 비용' },
          r('비용 총계 (VAT 포함)', s => s.gas.cost, f0, { sum: true, b: true, cmp: true, prov: s => s.gas.status === '가마감' }),
          r('공급가액 (VAT 별도)', s => s.gas.exvat, f0, { sum: true }),
          r('부가세', s => s.gas.cost === null || s.gas.exvat === null ? null : s.gas.cost - s.gas.exvat, f0, { sum: true }),
          r('원단위 절사', s => { const g = G(s); return g && s.gas.status === '확정' ? s.gas.cost - (((g.boiler || {}).total || 0) + ((g.rest || {}).total || 0)) : null; }, f0, { sum: true }),
          r('실행 단가 (원/MJ)', s => ratio(s.gas.exvat, s.gas.usage), fxd(2), { cmp: true }),
          { grp: '2) 사용량' }, r('사용량 (MJ)', s => s.gas.usage, f0, { sum: true, b: true, cmp: true }), r('사용량 (㎥)', s => s.gas.m3, fxd(1), { sum: true, cmp: true }),
          ...part('관류보일러', 'boiler', 'gas_heat', 'gas_boiler_corr'), ...part('식당', 'rest', 'gas_rest_heat', 'gas_rest_corr'),
          { grp: '3) 단가' }, r('단가 (원/MJ)', s => M(s, 'gas_price'), fxd(4), { cmp: true }),
          ...prodRows];
      }
      if (uk === 'water') {
        const tiers = u => { if (u === null || u === undefined) return [null, null, null, null, null]; const t1 = Math.min(u, 50), t2 = Math.min(Math.max(0, u - 50), 50), t3 = Math.min(Math.max(0, u - 100), 200), t4 = Math.min(Math.max(0, u - 300), 700), t5 = Math.max(0, u - 1000); return [t1, t2, t3, t4, t5]; };
        const meter = (n, k, ck) => [{ grp: n },
          r('합계', s => s.water[ck], f0, { sum: true, b: true, cmp: true }),
          r('상수도 금월사용료', s => (s.water[k] || {}).useFee ?? null, f0, { sum: true }), r('상수도 감면', s => (s.water[k] || {}).reduce ?? null, f0, { sum: true }),
          r('구경별요금', s => (s.water[k] || {}).baseFee ?? null, f0, { sum: true }),
          r('물이용 금월사용료', s => (s.water[k] || {}).waterUse ?? null, f0, { sum: true }), r('물이용 감면', s => (s.water[k] || {}).reduce2 ?? null, f0, { sum: true }),
          r('사용량 (㎥)', s => (s.water[k] || {}).usage ?? null, f0, { sum: true, cmp: true }),
          ...['1~50㎥', '51~100㎥', '101~300㎥', '301~1000㎥', '1001㎥~'].map((t, i) => r(`  ${t}`, s => tiers((s.water[k] || {}).usage ?? null)[i], f0, { sum: true }))];
        return [{ grp: '1) 비용 (부가세 없음)' }, r('비용 총계', s => s.water.cost, f0, { sum: true, b: true, cmp: true, prov: s => s.water.status === '가마감' }),
          r('실행 단가 (원/㎥)', s => ratio(s.water.cost, s.water.usage), fxd(1), { cmp: true }),
          { grp: '2) 사용량' }, r('사용량 합계 (㎥)', s => s.water.usage, f0, { sum: true, b: true, cmp: true }),
          ...meter('40A', 'w40', 'w40cost'), ...meter('50A', 'w50', 'w50cost'),
          { grp: '3) 단가' }, ...[['w_rate1', '1~50㎥'], ['w_rate2', '51~100㎥'], ['w_rate3', '101~300㎥'], ['w_rate4', '301~1000㎥'], ['w_rate5', '1001㎥~'], ['w_use_rate', '물이용부담금']].map(([k, t]) => r(`${t} (원/㎥)`, s => M(s, k), f0)),
          r('40A 구경별요금 (원)', s => M(s, 'w40_base_fee'), f0), r('50A 구경별요금 (원)', s => M(s, 'w50_base_fee'), f0),
          ...prodRows];
      }
      return [{ grp: '1) 비용 (부가세 없음)' },
        r('비용 총계', s => s.ww.cost, f0, { sum: true, b: true, cmp: true, prov: s => s.ww.status === '가마감' }),
        r('시설사용료 (기타사용료)', s => M(s, 'ww_facility_fee'), f0, { sum: true }), r('개선부담금', s => M(s, 'ww_improve_fee'), f0, { sum: true }),
        r('실행 단가 (원/㎥)', s => ratio(s.ww.cost, s.ww.usage), fxd(1), { cmp: true }),
        r('위탁처리비 (합계 제외)', s => s.ww.outsource, f0, { sum: true }), r('슬러지처리비 (합계 제외)', s => s.ww.sludge, f0, { sum: true }),
        { grp: '2) 사용량' }, r('발생량 합계 (㎥)', s => s.ww.usage, fxd(1), { sum: true, b: true, cmp: true }),
        r('폐수 발생량', s => s.ww.flow, fxd(1), { sum: true }), r('오수량', s => s.ww.sewage, fxd(1), { sum: true }),
        ...prodRows];
    }
    function renderUDet() {
      const y = udYear, ms = yearMonths(y), cs = ms.map(S), U = UT.UTILS.find(u => u.k === udUtil) || { name: (UD_SUM.find(x => x[0] === udUtil) || [])[1] };
      document.getElementById('udet-title').textContent = `${U.name} 상세 내역 · ${y}년`;
      document.getElementById('udet-utils').innerHTML = UD_SUM.map(([k, n]) => `<button class="chip ${k === udUtil ? 'on' : ''}" onclick="udUtil='${k}';renderUDet()">${n}</button>`).join('') + '<span style="width:8px"></span>' +
        UT.UTILS.map(u => `<button class="chip ${u.k === udUtil ? 'on' : ''}" onclick="udUtil='${u.k}';renderUDet()">${u.name}</button>`).join('');
      document.getElementById('udet-cmp').innerHTML = cmpChips();
      const spec = udSpec(udUtil), rows = [];
      const sumOf = a => a.some(v => v !== null && v !== undefined) ? a.reduce((x, v) => x + (v || 0), 0) : null;
      const avgOf = a => { const v = a.filter(x => x !== null && x !== undefined && !isNaN(x)); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
      spec.forEach(sp => {
        if (sp.grp) { rows.push({ grp: sp.grp }); return; }
        const vals = cs.map(s => { const v = sp.f(s); return v === undefined ? null : v; });
        if (vals.every(v => v === null || v === 0) && !sp.b && !sp.cmp) return; // 한 번도 안 쓴 줄은 숨김
        rows.push({ label: sp.l, vals, fmt: sp.fmt, b: sp.b, sum: sp.sum ? sumOf(vals) : null, avg: avgOf(vals), prov: sp.prov ? cs.map(sp.prov) : null });
        if (sp.cmp) [['prev', '전월대비', ym => UT.prevYm(ym)], ['ly', '전년동월대비', ym => UT.ym(Number(ym.slice(0, 4)) - 1, Number(ym.slice(5)))]].forEach(([k, nm, ref]) => {
          if (!CMP_SHOW[k]) return;
          const d = [], p = [];
          ms.forEach((ym, i) => { if (ym >= thisYm && !UT.monthComplete(DAILY, ym)) { d.push(null); p.push(null); return; }
            const c = vals[i], b = sp.f(S(ref(ym))); if (c === null || c === undefined || isNaN(c) || b === null || b === undefined || isNaN(b)) { d.push(null); p.push(null); return; }
            d.push(c - b); p.push(b ? (c / b - 1) * 100 : null); });
          rows.push({ label: nm, cmp: true, vals: d, pct: p, fmt: sp.fmt });
        });
      });
      udRows = rows;
      let h = `<table class="t ud"><tr><th class="l">구분</th>${monthLabels.map(m => `<th>${m}</th>`).join('')}<th>합계</th><th>평균</th></tr>`;
      rows.forEach(r => {
        if (r.grp) { h += `<tr class="grp"><td colspan="15">${esc(r.grp)}</td></tr>`; return; }
        if (r.cmp) { h += `<tr class="cmp"><td class="l">└ ${esc(r.label)}</td>` + r.vals.map((d, i) => d === null ? '<td class="na">-</td>' : `<td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : d < 0 ? '−' : ''}${r.fmt(Math.abs(d))}${r.pct[i] === null ? '' : `<br><span class="pc">${r.pct[i] >= 0 ? '+' : ''}${nf1.format(r.pct[i])}%</span>`}</td>`).join('') + '<td></td><td></td></tr>'; return; }
        h += `<tr class="${r.b ? 'm1' : ''}"><td class="l">${esc(r.label)}</td>` + r.vals.map((v, i) => `<td class="${v === null ? 'na' : ''} ${r.prov && r.prov[i] ? 'prov' : ''}">${v === null ? '-' : r.fmt(v)}</td>`).join('') +
          `<td>${r.sum === null ? '' : r.fmt(r.sum)}</td><td>${r.avg === null ? '' : r.fmt(r.avg)}</td></tr>`;
      });
      document.getElementById('udet-table').innerHTML = h + '</table>';
    }
    async function downloadUDet() {
      try {
        await ensureXLSX();
        const U = UT.UTILS.find(u => u.k === udUtil) || { name: (UD_SUM.find(x => x[0] === udUtil) || [])[1] }, aoa = [['구분', ...monthLabels, '합계', '평균']];
        const clean = v => (v === null || v === undefined) ? '' : (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
        udRows.forEach(r => {
          if (r.grp) { aoa.push([r.grp]); return; }
          if (r.cmp) { aoa.push([`${r.label} 차이`, ...r.vals.map(clean)]); aoa.push([`${r.label} 증감률(%)`, ...r.pct.map(v => v === null ? '' : Math.round(v * 10) / 10)]); return; }
          aoa.push([r.label, ...r.vals.map(clean), clean(r.sum), clean(r.avg)]);
        });
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `${U.name}상세`);
        XLSX.writeFile(wb, `유틸리티_${U.name}상세_${udYear}.xlsx`);
      } catch (e) { alert('엑셀 만들기 실패: ' + errMsg(e)); }
    }

    // =====================================================================
    // 이상감지 · 생산 실적과 비교 (일별 원인 추정)
    //  생산 대시보드(ssbon-factory) daily_summary 를 읽기 전용(GET)으로 가져와
    //  날마다 '생산량·작업시간·기온으로 본 예상 사용량'과 실제를 비교
    // =====================================================================
    let PRODD = null, pdUtil = 'elec', pdOnlyHigh = true, pdFocus = null;
    let PRODD_P = null;
    // ---- 보일러 켠 시간: 생산 대시보드 공정 원본 기록 (읽기만)
    //      자숙 cooking: date, start, end  ·  레토르트 retort: date, t1(가동 시작) ~ t3(가열 종료) — t3 뒤 냉각·배출은 스팀 안 씀
    //      그날 구간을 모두 모아 겹치는 건 합침 → 켠 시간 = 가장 이른 시작 ~ 가장 늦은 끝, 실제 가동 = 합친 구간 길이 합 (쉬는 틈 뺌)
    //      켠 시각 = 그날 첫 전처리 시작 (전처리 들어가며 켬) — 전처리 기록 없는 날만 첫 자숙 시작으로 대신
    //      끈 시각 = 레토르트 있는 날: 마지막 회차 t4(배출 완료) / 없는 날: 포장 종료 + 1시간 (FC 3kg 장조림 날 + 2시간)
    const PREP_COL = 'preprocess', PACK_COL = 'packing'; // 전처리(회차별 start) · 내포장(호기별 end — 그날 가장 늦은 end) · 외포장은 시각 없음
    let BT = null, BT_ERR = '', RET_FROM = null, COOK_FROM = null, PACK_FROM = null;
    function tMin(v) { const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/); if (!m) return null; const h = Number(m[1]), mi = Number(m[2]); return h < 48 && mi < 60 ? h * 60 + mi : null; }
    async function fsList(col, fields) {
      const base = `https://firestore.googleapis.com/v1/projects/ssbon-factory/databases/(default)/documents/${col}`, mask = fields.map(f => 'mask.fieldPaths=' + f).join('&'), out = []; let tok = '';
      for (let i = 0; i < 60; i++) {
        const r = await fetch(`${base}?pageSize=300&${mask}${tok ? '&pageToken=' + encodeURIComponent(tok) : ''}`, { method: 'GET', cache: 'no-store' });
        if (!r.ok) throw new Error(col + ' HTTP ' + r.status);
        const j = await r.json(); (j.documents || []).forEach(doc => out.push(Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fsVal(v)]))));
        tok = j.nextPageToken; if (!tok) break;
      }
      return out;
    }
    async function loadBoilerTimes() {
      const [ck, rt, pr, pk, op] = await Promise.all([fsList('cooking', ['date', 'start', 'end']), fsList('retort', ['date', 't1', 't3', 't4']),
        PREP_COL ? fsList(PREP_COL, ['date', 'start']) : [], PACK_COL ? fsList(PACK_COL, ['date', 'start', 'end']) : [], fsList('outerpacking', ['date', 'product', 'outerEa', 'innerEa', 'productDefect', 'remainEa', 'remainBoxes', 'outerBoxes', 'sample', 'testRun']).catch(() => null)]);
      const iv = {}, D = d => (iv[d] = iv[d] || { c: [], r: [] }), add = (d, a, b, k) => { if (!d || a === null || b === null) return; if (b < a) b += 1440; if (b - a <= 0 || b - a > 1440) return; D(d)[k].push([a, b]); };
      const minTo = (o, k, v) => { if (v !== null && (o[k] === undefined || v < o[k])) o[k] = v; }, maxTo = (o, k, v) => { if (v !== null && (o[k] === undefined || v > o[k])) o[k] = v; };
      ck.forEach(x => { const d = String(x.date || '').slice(0, 10); add(d, tMin(x.start), tMin(x.end), 'c'); if (d && (!COOK_FROM || d < COOK_FROM)) COOK_FROM = d; });
      rt.forEach(x => { const d = String(x.date || '').slice(0, 10); if (!d) return; D(d).rN = (D(d).rN || 0) + 1; const a = tMin(x.t1); add(d, a, tMin(x.t3), 'r'); let e = tMin(x.t4); if (e !== null && a !== null && e < a) e += 1440; maxTo(D(d), 't4', e); if (!RET_FROM || d < RET_FROM) RET_FROM = d; });
      pr.forEach(x => { const d = String(x.date || '').slice(0, 10); if (d) minTo(D(d), 'prep', tMin(x.start)); });
      pk.forEach(x => { const d = String(x.date || '').slice(0, 10); if (!d) return; const e = tMin(x.end), a = tMin(x.start); maxTo(D(d), 'pack', e);
        if (e !== null) { if (!PACK_FROM || d < PACK_FROM) PACK_FROM = d; if (a !== null) { let b = e; if (b < a) b += 1440; if (b - a > 0 && b - a <= 1440) D(d).pkM = (D(d).pkM || 0) + b - a; } } });
      // 완제품 EA = 외포장 EA + 잔량 (생산 대시보드 월별 현황의 「완제품 EA」와 같은 기준) — 시험 생산은 뺌
      OPD = null; OP_FROM = null;
      if (Array.isArray(op)) { OPD = {}; op.forEach(x => { const d = String(x.date || '').slice(0, 10), n = (Number(x.outerEa) || 0) + (d >= OP_REMAIN_FROM ? (Number(x.remainEa) || 0) : 0); if (!d || x.testRun === true) return; /* 완제품 EA = 외포장 EA (+ 잔량: 5월부터 기록분만 — 3·4월 기록은 외포장 EA에 잔량이 이미 들어 있음, 대시보드와 달마다 맞춰 확인) · 시험 생산은 뺌 */ if (!OP_FROM || d < OP_FROM) OP_FROM = d;
        const name = String(x.product || '').trim() || '기타'; (OPD[d] = OPD[d] || []).push({ name, ea: n, test: x.testRun === true, inner: Number(x.innerEa) || 0, defect: Number(x.productDefect) || 0, remain: Number(x.remainEa) || 0, remainB: Number(x.remainBoxes) || 0, boxes: Number(x.outerBoxes) || 0, outer: Number(x.outerEa) || 0, sample: Number(x.sample) || 0, recs: 1 }); }); }
      return iv;
    }
    let OPD = null, OP_FROM = null; const OP_REMAIN_FROM = '2026-05-01';
    const isFC3 = n => /FC/i.test(n) && /3\s*kg/i.test(n);
    function boilerTime(o, d) {
      const x0 = BT && BT[d], h1 = v => Math.round(v / 6) / 10, sumIv = a => h1(a.reduce((t, m) => t + m[1] - m[0], 0));
      // 검토용 지표: 레토르트 회차·가열 시간 / 자숙 회차·시간 / 내포장 호기×시간 (그 기록이 시작된 뒤 날만)
      if (RET_FROM && d >= RET_FROM) { o.retN = x0 ? (x0.rN || 0) : 0; o.retH = x0 ? sumIv(x0.r) : 0; }
      if (COOK_FROM && d >= COOK_FROM) { o.cookN = x0 ? x0.c.length : 0; o.cookH = x0 ? sumIv(x0.c) : 0; }
      if (PACK_FROM && d >= PACK_FROM) o.packMH = x0 ? h1(x0.pkM || 0) : 0;
      const x = x0; if (!x) return;
      const all = x.c.concat(x.r).sort((p, q) => p[0] - q[0]), mg = [];
      all.forEach(([a, b]) => { const l = mg[mg.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else mg.push([a, b]); });
      o.nCook = x.c.length; o.nRet = x.r.length; o.bSeg = mg;
      if (mg.length) o.runH = Math.round(mg.reduce((t, m) => t + m[1] - m[0], 0) / 6) / 10; // 실가동 = 자숙·레토르트(t1~t3) 합친 구간
      const on = x.prep !== undefined ? x.prep : mg.length ? mg[0][0] : undefined; o.onSrc = x.prep !== undefined ? '전처리' : '첫 자숙';
      o.fc3 = (o.packItems || []).some(it => isFC3(it.name));
      let off; if (x.t4 !== undefined) { off = x.t4; o.offSrc = '레토르트 t4'; } else if (x.pack !== undefined) { off = x.pack + (o.fc3 ? 120 : 60); o.offSrc = `포장 종료 + ${o.fc3 ? 2 : 1}h`; }
      if (on === undefined) return; o.bOn = on;
      if (off === undefined) { o.bMiss = RET_FROM && d >= RET_FROM ? '레토르트 기록 없음 · 포장 종료 시각 필요' : '레토르트 기록 시작 전 · 포장 종료 시각 필요'; return; }
      if (off < on) off += 1440; const h = (off - on) / 60; if (h > 0 && h <= 24) { o.bOff = off; o.boilH = Math.round(h * 10) / 10; }
    }
    const hhmm = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
    function loadProdDaily() { if (PRODD) return Promise.resolve(PRODD); if (!PRODD_P) PRODD_P = loadProdDaily0().catch(e => { PRODD_P = null; throw e; }); return PRODD_P; }
    async function loadProdDaily0() {
      const base = 'https://firestore.googleapis.com/v1/projects/ssbon-factory/databases/(default)/documents/daily_summary';
      const out = {}; let tok = '';
      const btP = loadBoilerTimes().then(v => { BT = v; }).catch(e => { BT_ERR = errMsg(e); });
      for (let i = 0; i < 20; i++) {
        const r = await fetch(`${base}?pageSize=300${tok ? '&pageToken=' + encodeURIComponent(tok) : ''}`, { method: 'GET', cache: 'no-store' });
        if (!r.ok) throw new Error('생산 대시보드 HTTP ' + r.status);
        const j = await r.json();
        (j.documents || []).forEach(doc => {
          const f = Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fsVal(v)]));
          const d = String(f.date || doc.name.split('/').pop()).slice(0, 10);
          const P = n => (f.processes || []).filter(p => p && String(p.process).includes(n));
          const sum = (a, k) => a.reduce((s, p) => s + (Number(p[k]) || 0), 0);
          const all = (f.processes || []).filter(p => p);
          out[d] = { d, rm: sum(P('전처리'), 'inputKg'), prepH: sum(P('전처리'), 'workHours'), steamH: sum(P('자숙'), 'workHours'), steamKg: sum(P('자숙'), 'inputKg'), crushH: sum(P('파쇄'), 'workHours'),
            packH: sum(P('포장'), 'workHours'), ea: Number(f.totalEa) || sum(P('포장'), 'ea'),
            manH: all.reduce((t, p) => t + (Number(p.workers) || 0) * (Number(p.workHours) || 0), 0) };
          const o0 = out[d]; o0.rmParts = {}; P('전처리').forEach(p => { const k = String(p.part || '기타').trim() || '기타'; o0.rmParts[k] = (o0.rmParts[k] || 0) + (Number(p.inputKg) || 0); });
          o0.packItems = P('포장').map(p => ({ name: String(p.part || '').trim(), ea: Number(p.ea) || 0 })).filter(x => x.ea > 0);
          const o = out[d]; o.sumH = o.prepH + o.steamH + o.crushH + o.packH; o.maxH = Math.max(o.prepH, o.steamH, o.crushH, o.packH);
        });
        tok = j.nextPageToken; if (!tok) break;
      }
      await btP;
      // 포장 생산량·완제품 중량 = 외포장 완료 EA (대시보드 월별 현황과 같은 기준) — 외포장 기록이 시작된 날부터. 일별요약의 포장 EA는 참고로 남김
      if (OPD && OP_FROM) { Object.keys(OPD).forEach(d => { if (!out[d]) out[d] = { d, rm: 0, prepH: 0, steamH: 0, steamKg: 0, crushH: 0, packH: 0, ea: 0, manH: 0, rmParts: {}, packItems: [], sumH: 0, maxH: 0, opOnly: true }; });
        const opStart = OP_FROM.slice(0, 7) + '-01'; Object.keys(out).forEach(d => { if (d < opStart) return; const o = out[d], L = (OPD[d] || []).filter(x => x.ea > 0); o.opAll = OPD[d] || []; o.eaDaily = o.ea; o.packItemsDaily = o.packItems; o.packItems = L; o.ea = L.reduce((a, x) => a + x.ea, 0); o.eaSrc = '외포장'; }); }
      Object.keys(out).forEach(d => boilerTime(out[d], d));
      return (PRODD = out);
    }
    const PD_UTIL = {
      elec: { name: '전기', unit: 'kWh', val: ds => (UT.dailyUsage(DAILY, ds) || {}).elec, get feats() { return pdFeats('elec'); } },
      gas: { name: '보일러 가스', unit: '㎥', val: ds => UT.diffReading(DAILY, ds, ['gas_boiler']), get feats() { return pdFeats('gas'); } },
      water: { name: '용수', unit: '㎥', val: ds => (UT.dailyUsage(DAILY, ds) || {}).water, feats: [['prod', '생산한 날'], ['rm', '원육 kg']] },
      ww: { name: '폐수', unit: '㎥', val: ds => (UT.dailyUsage(DAILY, ds) || {}).ww, feats: [['prod', '생산한 날'], ['rm', '원육 kg']] }
    };
    // 일별 예상 식의 요인 = 📐 기준 식의 지표를 하루 단위로 바꾼 것 (달력 날수 → 하루 기본, 생산일수 → 생산한 날, 원육 → 그날 원육 kg …)
    const PD_DEF = { elec: [['prod', '생산한 날'], ['rm', '원육 kg'], ['w18', '더운 정도 (18℃ 넘는 ℃)']], gas: [['steamH', '자숙 작업시간 (h)'], ['ea1k', '포장 1,000EA'], ['c15', '추운 정도 (15℃ 아래 ℃)']] };
    function pdMap(f) {
      if (f === 'days' || f === 'idle') return null; if (f === 'op') return ['prod', '생산한 날']; if (f === 'prod') return ['rm', '원육 kg']; if (f === 'pkg') return ['pkg', '완제품 kg']; if (f === 'ea') return ['ea1k', '포장 1,000EA'];
      if (f === 'steamH') return ['steamH', '자숙 작업시간 (h)']; if (f === 'packH') return ['packH', '포장 작업시간 (h)']; if (f === 'boilH') return ['boilH', '보일러 켠 시간 (h)']; if (f === 'runH') return ['runH', '보일러 실가동 (h)'];
      if (f === 'warm') return ['w5', '더운 정도 (5℃ 넘는 ℃)']; if (/^warmT:/.test(f)) return ['w' + f.slice(6), `더운 정도 (${f.slice(6)}℃ 넘는 ℃)`]; if (/^coldT:/.test(f)) return ['c' + f.slice(6), `추운 정도 (${f.slice(6)}℃ 아래 ℃)`];
      if (f === 'hdd') return ['c18', '추운 정도 (18℃ 아래 ℃)']; if (f === 'hddOn') return ['con', '보일러 켠 날 추운 정도 (18℃ 아래 ℃)'];
      const ex = { retN: '레토르트 회차', retH: '레토르트 가열 (h)', cookN: '자숙 회차', cookH: '자숙 시간 (h)', packMH: '내포장 호기×시간 (h)', manH: '작업 인시', prepH: '전처리 작업시간 (h)', crushH: '파쇄 작업시간 (h)', steamKg: '자숙 투입 kg' };
      return ex[f] ? [f, ex[f]] : null;
    }
    function pdFeats(uk) {
      let I = null; try { I = stdInfo(uk); } catch (e) { }
      if (!I || !I.feats) return PD_DEF[uk]; const out = [['prod', '생산한 날']]; // 생산일엔 켜는 설비 기본 부하가 있어 하루 식엔 늘 넣음 (월 식의 「달력 날수」 고정분에 섞여 있던 몫)
      I.feats.forEach(f => { const m = pdMap(f); if (m && !out.some(x => x[0] === m[0])) out.push(m); });
      return out.length ? out : PD_DEF[uk];
    }
    function pdRow(ds) {
      const p = PRODD[ds], t = (TEMPS || {})[ds], boiler = UT.diffReading(DAILY, ds, ['gas_boiler']);
      const noRec = !p && boiler !== null && boiler > 50; // 보일러는 돌았는데 생산 기록이 없는 날
      const unknown = !p && boiler === null; // 생산 기록도, 보일러 검침도 없는 날 → 판단 안 함
      const on = !!(p && (p.rm > 0 || p.ea > 0)), hasT = t !== undefined && t !== null; // 생산한 날 = 원육 투입 또는 포장한 날 (포장만 한 날도 레토르트·포장기 가동)
      const x = { prod: on ? 1 : 0, rm: p ? p.rm : 0, steamH: p ? p.steamH : 0, packH: p ? p.packH : 0, ea1k: p ? p.ea / 1000 : 0, pkg: on ? pkgDay(p) : 0,
        boilH: on ? (p.boilH === undefined ? null : p.boilH) : 0, runH: on ? (p.runH === undefined ? null : p.runH) : 0, con: !hasT ? null : on ? Math.max(0, 18 - t) : 0 };
      ['retN', 'retH', 'cookN', 'cookH', 'packMH'].forEach(k => { x[k] = on ? (p[k] === undefined ? null : p[k]) : 0; }); ['manH', 'prepH', 'crushH', 'steamKg'].forEach(k => { x[k] = p ? Number(p[k]) || 0 : 0; });
      for (let T = 0; T <= 25; T++) { x['w' + T] = hasT ? Math.max(0, t - T) : null; x['c' + T] = hasT ? Math.max(0, T - t) : null; }
      return { ds, p, x, t, noRec, unknown };
    }
    function pdFit(uk, to) {
      const U0 = PD_UTIL[uk], U = { ...U0, feats: U0.feats }, rows = [];
      for (let i = 1; i <= 120; i++) { const ds = UT.addDays(to, -i + 1), r = pdRow(ds), y = U.val(ds);
        if (y === null || y === undefined || isNaN(y) || r.noRec || r.unknown || U.feats.some(([f]) => r.x[f] === null)) continue; rows.push({ ...r, y }); }
      if (rows.length < 20) return null;
      let feats = U.feats.map(f => f[0]).filter(f => { const v = rows.map(r => r.x[f]); return Math.max(...v) - Math.min(...v) > 1e-9; }), use = rows, co = null; // 값이 다 같은 요인(예: 여름엔 추운 정도가 모두 0)은 뺌
      const tolAbs = ((UT.DAILY_UTILS.find(u => u.k === uk) || {}).minAbs || 1);
      const labels = Object.fromEntries(U.feats);
      // 기온 요인(더운/추운 정도)은 하루 식에 가장 잘 맞는 기준 온도(5~25℃)를 찾아 씀 — 지표 종류는 기준 식과 같고 기준 온도만 하루에 맞춤
      const sse = (fs, rs) => { const c = UT.ols(rs.map(r => [1, ...fs.map(f => r.x[f])]), rs.map(r => r.y)); if (!c || c.slice(1).some(v => v < 0)) return Infinity; return rs.reduce((a, r) => a + (r.y - c[0] - fs.reduce((t2, f, i) => t2 + c[i + 1] * r.x[f], 0)) ** 2, 0); };
      feats.forEach((f, idx) => { const m = f.match(/^([wc])(\d+)$/); if (!m) return; let best = f, bs = sse(feats, rows);
        for (let T = 5; T <= 25; T++) { const k = m[1] + T; if (rows.some(r => r.x[k] === null)) continue; const fs = feats.slice(); fs[idx] = k; const e = sse(fs, rows); if (e < bs) { bs = e; best = k; } }
        if (best !== f) { feats[idx] = best; labels[best] = `${m[1] === 'w' ? '더운' : '추운'} 정도 (${best.slice(1)}℃ ${m[1] === 'w' ? '넘는' : '아래'} ℃)`; } });
      for (let it = 0; it < 6; it++) {
        let c2 = UT.ols(use.map(r => [1, ...feats.map(f => r.x[f])]), use.map(r => r.y));
        while (!c2 && feats.length) { feats = feats.slice(0, -1); c2 = UT.ols(use.map(r => [1, ...feats.map(f => r.x[f])]), use.map(r => r.y)); }
        if (!c2) { if (!co) return null; break; } co = c2;
        const neg = feats.findIndex((f, i) => co[i + 1] < 0);
        if (neg >= 0) { feats = feats.filter((_, i) => i !== neg); continue; }
        // 튀는 날 빼기: 잔차가 중앙값에서 3 × (중앙 절대편차 × 1.48) 넘게 벗어난 날만 (위·아래 똑같이 — 높은 날만 빼서 예상이 낮아지는 것 방지)
        const pr = r => co[0] + feats.reduce((s, f, i) => s + co[i + 1] * r.x[f], 0), med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
        const res = rows.map(r => r.y - pr(r)), mr = med(res), mad = med(res.map(v => Math.abs(v - mr))) * 1.4826;
        const keep = rows.filter((r, i) => Math.abs(res[i] - mr) <= Math.max(3 * mad, tolAbs));
        if (keep.length === use.length || keep.length < 15) break; use = keep;
      }
      const pr = r => Math.max(0, co[0] + feats.reduce((s, f, i) => s + co[i + 1] * r.x[f], 0));
      const prodRows = use.filter(r => r.x.prod), mean = f => prodRows.length ? prodRows.reduce((s, r) => s + r.x[f], 0) / prodRows.length : 0;
      const mape = use.reduce((s, r) => s + Math.abs(r.y - pr(r)), 0) / Math.max(1, use.reduce((s, r) => s + r.y, 0)) * 100; // 전체 사용량 대비 오차
      return { feats, co, pr, labels, mean: Object.fromEntries(feats.map(f => [f, mean(f)])), n: use.length, mape };
    }
    async function renderProdCompare() {
      const el = document.getElementById('pd-body'); if (!el) return;
      if (!PRODD) { el.innerHTML = '<div class="loading">생산 대시보드 일별 실적 불러오는 중...</div>';
        try { await loadProdDaily(); } catch (e) { el.innerHTML = `<div class="empty">생산 대시보드 자료를 읽지 못했습니다: ${esc(errMsg(e))}<br>회사 네트워크에서 firestore.googleapis.com 이 막혀 있을 수 있습니다.</div>`; return; } }
      try { await loadTemps(); } catch (e) { TEMPS = TEMPS || {}; }
      // 기간 = 위에서 고른 달 (원인 찾기 맨 위 ◀ ▶) — 진행 중인 달은 어제까지 · 하루 식은 그 달 마지막 날까지 최근 120일로 맞춤
      const pym = anomMonth || causeYm || lastCompleteYm(), mEnd = UT.dateStr(pym, UT.daysIn(pym)), yst = UT.addDays(todayStr, -1);
      const to = mEnd > yst ? yst : mEnd, from = UT.dateStr(pym, 1), U = { ...PD_UTIL[pdUtil] }, M = pdFit(pdUtil, to);
      const HI_PCT = pdUtil === 'water' || pdUtil === 'ww' ? 0.3 : 0.15; // 용수·폐수는 하루 값이 청소·방류 일정에 따라 크게 흔들려 30%
      const fl = M ? M.labels : Object.fromEntries(U.feats), fmtV = v => v === null || v === undefined ? '-' : f0(v);
      let h = `<div class="toolbar"><span class="chips">${Object.entries(PD_UTIL).map(([k, u]) => `<button class="chip ${k === pdUtil ? 'on' : ''}" onclick="pdUtil='${k}';pdFocus=null;renderProdCompare()">${u.name}</button>`).join('')}</span>
        <b>${ymLabel(pym)}</b> <span class="hint">(위에서 고른 달 · ${from.slice(5).replace('-', '/')} ~ ${to.slice(5).replace('-', '/')})</span>
        <label class="hint"><input type="checkbox" ${pdOnlyHigh ? 'checked' : ''} onchange="pdOnlyHigh=this.checked;renderProdCompare()"> 예상보다 많이 쓴 날만</label></div>`;
      if (!M) { el.innerHTML = h + '<div class="empty">비교할 자료가 아직 부족합니다 (최근 120일 중 생산 실적·검침이 함께 있는 날 20일 이상 필요).</div>'; return; }
      const cf = v => Math.abs(v) < 0.5 && Math.abs(v) > 0 && M.co.indexOf(v) === 0 ? '0' : Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
      h += `<div class="hint" style="margin-bottom:6px">예상 ${U.name} = 하루 기본 <b>${cf(M.co[0])}</b>${M.feats.map((f, i) => ` + ${fl[f]} × <b>${cf(M.co[i + 1])}</b>`).join('')} ${U.unit} <span class="hint">(${to.slice(5).replace('-', '/')}까지 120일 중 ${M.n}일로 맞춤 · 평균 오차 ±${nf1.format(M.mape)}%${U.feats.filter(([f]) => !M.feats.includes(f) && !/^[wc]\d+$/.test(f)).length ? ` · 관련 없게 나온 ${U.feats.filter(([f]) => !M.feats.includes(f) && !/^[wc]\d+$/.test(f)).map(x => x[1]).join(', ')} 은 뺌` : ''})</span></div>`;
      const W = ['일', '월', '화', '수', '목', '금', '토'], minAbs = (UT.DAILY_UTILS.find(u => u.k === pdUtil) || {}).minAbs || 0;
      const rows = []; for (let ds = to; ds >= from; ds = UT.addDays(ds, -1)) { const r = pdRow(ds), y = U.val(ds); if (y === null || y === undefined || isNaN(y)) continue;
        const ok = !r.noRec && !r.unknown && M.feats.every(f => r.x[f] !== null), e = ok ? M.pr(r) : null, d = e === null ? null : y - e;
        const hi = d !== null && d > Math.max(minAbs * 0.5, e * HI_PCT); rows.push({ ...r, y, e, d, hi }); }
      const list = rows.filter(r => !pdOnlyHigh || r.hi || r.noRec);
      h += `<div class="tbl-wrap"><table class="t"><tr><th>날짜</th><th>원육 kg</th><th>자숙 h</th><th>포장 EA</th><th>기온</th><th>실제 ${U.unit}</th><th>예상</th><th>차이</th><th class="l">원인 추정 (평소 생산일과 비교)</th></tr>` +
        (list.length ? list.map(r => {
          const why = r.noRec ? '<span class="up">보일러는 돌았는데 생산 실적이 없음 — 대시보드에서 그 날짜를 열면 생깁니다</span>' : r.unknown ? '<span class="hint">생산 실적·보일러 검침이 아직 없음</span>' : r.e === null ? '-' : (() => {
            const parts = M.feats.filter(f => f !== 'prod').map((f, i) => [fl[f], M.co[M.feats.indexOf(f) + 1] * (r.x[f] - (r.x.prod ? M.mean[f] : 0))]).filter(x => Math.abs(x[1]) >= Math.max(1, r.e * 0.03));
            const txt = parts.map(([n, v]) => `${n.replace(/ \(.*\)/, '')} ${v >= 0 ? '많아' : '적어'} ${v >= 0 ? '+' : '−'}${f0(Math.abs(v))}`).join(', ');
            return (r.x.prod ? (r.p && !(r.p.rm > 0) ? '포장만 한 날' + (txt ? ` · 평소 생산일보다 ${txt}` : '') : txt ? `평소 생산일보다 ${txt}` : '생산 조건은 평소와 비슷') : '생산 없는 날') + (r.hi ? ` · <b class="up">설명 안 되는 +${f0(r.d)} ${U.unit}</b> → 설비 미차단·공회전·누수·특이 작업 확인` : '');
          })();
          const nts = notesIn(r.ds, r.ds, pdUtil === 'gas' ? 'gas' : pdUtil); const ntH = nts.length ? `<br><span class="un-note">📝 ${nts.map(n => `${esc(n.cat)}: ${esc(n.text)}`).join(' / ')}</span>` : '';
          return `<tr class="${r.hi ? 'hl' : ''}"><td>${r.ds.slice(5).replace('-', '/')} (${W[new Date(r.ds + 'T00:00:00').getDay()]})</td><td>${r.p ? f0(r.p.rm) : '-'}</td><td>${r.p ? nf1.format(r.p.steamH) : '-'}</td><td>${r.p ? f0(r.p.ea) : '-'}</td><td>${r.t === undefined || r.t === null ? '-' : nf1.format(r.t) + '℃'}</td>
            <td><b>${fmtV(r.y)}</b></td><td>${fmtV(r.e)}</td><td class="${r.d > 0 ? 'up' : 'down'}">${r.d === null ? '-' : (r.d >= 0 ? '+' : '−') + f0(Math.abs(r.d)) + (r.e && r.e >= Math.max(5, minAbs) ? ` <span class="hint">(${r.d >= 0 ? '+' : ''}${nf1.format(r.d / r.e * 100)}%)</span>` : '')}</td><td class="l">${why}${ntH}</td></tr>`;
        }).join('') : `<tr><td colspan="9" class="empty">${ymLabel(pym)}에 예상보다 크게 많이 쓴 날이 없습니다 👍</td></tr>`) + '</table></div>';
      h += `<div class="hint" style="margin-top:6px">· <b>원인 추정 읽는 법</b>: 「원육 적어 −700」 = 그날 원육이 <b>평소 생산일 평균(${M.mean.rm !== undefined ? f0(M.mean.rm) + 'kg' : '-'})보다 적어서</b> 예상이 700 ${U.unit} 낮게 잡혔다는 뜻 (마이너스 = 그 요인 때문에 덜 써야 정상). 그런데도 실제가 예상보다 많으면 그 차이가 「설명 안 되는」 몫입니다.<br>· 생산 실적은 생산 대시보드 일별 요약(읽기 전용)에서 가져옵니다. 대시보드에서 그 날짜를 한 번도 안 연 날은 실적이 없을 수 있습니다.<br>· 「예상보다 많이 쓴 날」 = 예상보다 ${Math.round(HI_PCT * 100)}% 넘게 더 쓴 날${HI_PCT > 0.15 ? ' (용수·폐수는 청소·방류 일정 때문에 하루 값이 크게 흔들려 30%)' : ''}.${pdUtil === 'ww' ? ' <b>폐수</b> 방류량은 저류조를 거쳐 처리 일정에 따라 나가서 그날 생산과 하루 이상 어긋남 — 하루 단위 비교는 참고만.' : ''} 생산한 날 = 원육을 넣었거나 포장한 날 (포장만 한 날도 레토르트·포장기가 돎). 원인 추정의 ± 값은 그날 원육·작업시간·기온이 평소 생산일과 달라서 생긴 몫이고, 나머지가 설명 안 되는 몫입니다.<br>· 검침 시각(08시) 기준이라 전기(파워플래너, 0~24시)와 하루 정도 어긋날 수 있습니다.</div>`;
      el.innerHTML = h;
    }

    // =====================================================================
    // 유틸리티·생산설비 특이사항 (ut_monthly '9999-00' 줄의 notes) — 원인분석·이상감지에서 같이 보여 줌
    // =====================================================================
    const UN_CATS = ['전기', '가스·보일러', '용수', '폐수', '공조냉동', '공기압축기', '생산설비', '기타'];
    const UN_UTIL_DEF = { '전기': ['elec'], '가스·보일러': ['gas'], '용수': ['water'], '폐수': ['ww'], '공조냉동': ['elec'], '공기압축기': ['elec'], '생산설비': ['elec', 'gas', 'water', 'ww'], '기타': [] };
    let unYm = null, unCat = '', unEditId = null;
    const utNotes = () => (Array.isArray((YEARDATA[9999] || {}).notes) ? YEARDATA[9999].notes : []).slice().sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : (a.at < b.at ? 1 : -1));
    const notesIn = (from, to, uk) => utNotes().filter(n => n.d >= from && n.d <= to && (!uk || (n.utils || []).includes(uk))).sort((a, b) => a.d < b.d ? -1 : 1);
    const unLine = n => `<span class="un-cat">${esc(n.cat)}</span> <b>${Number(n.d.slice(5, 7))}/${Number(n.d.slice(8))}</b> ${n.eq ? `[${esc(n.eq)}] ` : ''}${esc(n.text)}${n.act ? ` <span class="hint">→ ${esc(n.act)}</span>` : ''}`;
    async function unPut(fn) { // 저장 직전 최신 줄을 다시 읽어서 고침
      const { data, error } = await sb.from('ut_monthly').select('data').eq('ym', '9999-00').maybeSingle(); if (error) throw error;
      const cur = (data && data.data) || {}; const notes = fn(Array.isArray(cur.notes) ? cur.notes.slice() : []);
      const nd = { ...cur, notes }; const r = await sb.from('ut_monthly').upsert({ ym: '9999-00', data: nd }, { onConflict: 'ym' }); if (r.error) throw r.error;
      YEARDATA[9999] = nd;
    }
    // ---- 기록 적기 (특이사항 + 부하 변동 한 곳에서) ----
    //  특이사항: ut_monthly 9999-00 notes · 부하 변동(그 날부터 계속되는 운전 변화): 9999-00 equip (원인 찾기·목표 식 계산에 들어감)
    const EQ_AREAS = ['생산동', '폐수동', '공조냉동', '기타'];
    const eqKey = (x, i) => x.id || `eqi${i}|${x.d}|${x.area}|${x.name}`;
    const eqAll = () => equipList().map((x, i) => ({ ...x, _k: eqKey(x, i) }));
    const eqLine = x => `<span class="un-cat eq">⚡ 부하 변동</span> <b>${Number(x.d.slice(5, 7))}/${Number(x.d.slice(8))}</b> [${esc(x.area)}${x.name ? ' · ' + esc(x.name) : ''}] ${esc(x.note || '')} <span class="hint">→ 그날부터 ${nf1.format(Number(x.kw) || 0)}kW × 하루 ${nf1.format(Number(x.hours) || 0)}h = ${f0((Number(x.kw) || 0) * (Number(x.hours) || 0))} kWh/일</span>`;
    function renderNotes() {
      if (!unYm && unYm !== '') unYm = thisYm;
      const ro = !isAdmin(), isEq = typeof unEditId === 'string' && unEditId.startsWith('EQ:');
      const E = unEditId && !isEq ? utNotes().find(n => n.id === unEditId) : null, X = isEq ? eqAll().find(x => x._k === unEditId.slice(3)) : null;
      const utilBox = (n) => UT.UTILS.map(u => `<label class="un-u"><input type="checkbox" class="un-ut" value="${u.k}" ${(n ? (n.utils || []) : UN_UTIL_DEF['전기']).includes(u.k) ? 'checked' : ''}> ${u.name}</label>`).join('');
      const load = !!X || unLoadOn;
      let h = ro ? '' : `<div class="card"><h3>${E || X ? '기록 고치기' : '기록 적기'} <span class="sub">설비·운전에 있었던 일 — 원인 찾기 ③에 그 기간 기록이 나옵니다</span></h3>
        <div class="un-form">
          <label>날짜 <input type="date" id="un-d" value="${esc(E ? E.d : X ? X.d : todayStr)}"></label>
          <label>분류 <select id="un-cat" onchange="unCatChange(this.value)" ${load ? 'disabled' : ''}>${UN_CATS.map(c => `<option ${E && E.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>설비·장소 <input id="un-eq" value="${esc(E ? E.eq || '' : X ? X.name || '' : '')}" placeholder="예: 레토르트 2호기, 터보블로워, 보일러"></label>
          <label class="wide">내용 <textarea id="un-text" rows="2" placeholder="예: 레토르트 2호기 스팀 트랩 누설 / 보일러 2대 → 1대 운전으로 변경">${esc(E ? E.text : X ? X.note || '' : '')}</textarea></label>
          <label class="wide ${load ? 'hidden-f' : ''}">조치 <input id="un-act" value="${esc(E ? E.act || '' : '')}" placeholder="예: 트랩 교체, 타이머 재설정"></label>
          <div class="wide un-loadsw"><label><input type="checkbox" id="un-load" ${load ? 'checked' : ''} ${E || X ? 'disabled' : ''} onchange="unLoadOn=this.checked;unKeepDraft();renderNotes()"> <b>⚡ 이 날부터 설비 운전·부하가 계속 바뀜</b></label>
            <span class="hint">— 한 번 있었던 일(고장·누설·생산 연장)은 체크 안 함 · 그 날부터 쭉 이어지는 변화(설비 추가·운전 대수·가동시간 변경)만 체크</span></div>
          ${load ? `<div class="wide un-loadbox">
            <label>구역 <select id="un-area">${EQ_AREAS.map(a => `<option ${X && X.area === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
            <label>대당 kW <input id="un-kw" type="number" step="0.1" style="width:80px" value="${X ? X.kw ?? '' : ''}"></label>
            <label>하루 가동시간 합 (h) <input id="un-hours" type="number" step="0.5" style="width:80px" value="${X ? X.hours ?? '' : ''}"></label>
            <label class="hint">kW 계산 도우미: 전류 <input id="un-amp" type="number" step="0.1" style="width:64px" oninput="const a=Number(this.value);if(a)document.getElementById('un-kw').value=(a*380*1.732*0.85/1000).toFixed(1)"> A → 3상 380V × 1.732 × 역률 0.85</label>
            <div class="hint" style="flex-basis:100%">· 생산동·기타(계량기 없는 곳)는 kW × 하루 시간이 그날부터 매일 전기 계산(원인 찾기 ①·목표 식)에 더해짐 · 폐수동·공조냉동은 계량기로 재므로 설명으로만 붙음 · 같은 구역·설비는 가장 최근 시작일 기록이 적용 (예: 터보블로워 16h → 24h로 바뀌면 새 날짜로 하나 더 적기) · 가스 쪽 변화(보일러 대수 등)는 kW를 0으로 두고 내용만 적으면 됨</div></div>` : `<div class="wide">관련 유틸리티 <span id="un-utils">${utilBox(E)}</span> <span class="hint">— 체크한 유틸리티의 원인 찾기에 나옵니다</span></div>`}
          <div><button class="btn" onclick="unSave()">${E || X ? '✓ 고친 내용 저장' : '+ 기록 추가'}</button>${E || X ? ` <button class="btn secondary" onclick="unEditId=null;unLoadOn=false;renderNotes()">취소</button>` : ''}</div>
        </div></div>`;
      const inM = d => !unYm || (d || '').slice(0, 7) === unYm;
      const showEq = !unCat || unCat === '⚡';
      const list = (unCat === '⚡' ? [] : utNotes().filter(n => inM(n.d) && (!unCat || n.cat === unCat)).map(n => ({ k: 'n', d: n.d, n })))
        .concat(showEq ? eqAll().filter(x => inM(x.d)).map(x => ({ k: 'e', d: x.d, x })) : [])
        .sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
      h += `<div class="card"><div class="toolbar">
          <div class="month-nav"><button onclick="unShift(-1)">◀</button><span>${unYm ? ymLabel(unYm) : '전체'}</span><button onclick="unShift(1)">▶</button></div>
          <button class="chip ${unYm ? '' : 'on'}" onclick="unYm=unYm?'':thisYm;renderNotes()">전체 기간</button>
          <span class="chips"><button class="chip ${unCat ? '' : 'on'}" onclick="unCat='';renderNotes()">전체</button>${UN_CATS.map(c => `<button class="chip ${unCat === c ? 'on' : ''}" onclick="unCat='${c}';renderNotes()">${c}</button>`).join('')}<button class="chip ${unCat === '⚡' ? 'on' : ''}" onclick="unCat='⚡';renderNotes()">⚡ 부하 변동</button></span>
          <span class="hint">${list.length}건</span></div>` +
        (list.length ? `<div class="tbl-wrap"><table class="t"><tr><th>날짜</th><th>분류</th><th class="l">설비·장소</th><th class="l">내용</th><th class="l">조치 / 부하</th><th>관련</th><th>작성</th>${ro ? '' : '<th></th>'}</tr>` +
          list.map(o => o.k === 'n' ? (n => `<tr><td>${n.d}</td><td><span class="un-cat">${esc(n.cat)}</span></td><td class="l">${esc(n.eq || '')}</td><td class="l un-txt">${esc(n.text)}</td><td class="l un-txt">${esc(n.act || '')}</td>
            <td>${(n.utils || []).map(k => (UT.UTILS.find(u => u.k === k) || {}).name).filter(Boolean).join('·')}</td><td>${esc(n.by || '')}</td>
            ${ro ? '' : `<td><button class="btn secondary small" onclick="unEditId='${n.id}';unLoadOn=false;renderNotes();window.scrollTo(0,0)">고치기</button> <button class="btn danger small" onclick="unDel('${n.id}')">삭제</button></td>`}</tr>`)(o.n)
            : (x => `<tr class="eq-row"><td>${x.d}</td><td><span class="un-cat eq">⚡ 부하 변동</span><div class="hint">${esc(x.area)}</div></td><td class="l">${esc(x.name || '')}</td><td class="l un-txt">${esc(x.note || '')}</td>
            <td class="l">그날부터 ${nf1.format(Number(x.kw) || 0)}kW × ${nf1.format(Number(x.hours) || 0)}h<br><b>${f0((Number(x.kw) || 0) * (Number(x.hours) || 0))} kWh/일</b></td><td>전기</td><td>${esc(x.by || '')}</td>
            ${ro ? '' : `<td><button class="btn secondary small" onclick="unEditId='EQ:${esc(x._k)}';renderNotes();window.scrollTo(0,0)">고치기</button> <button class="btn danger small" onclick="eqDel2('${esc(x._k)}')">삭제</button></td>`}</tr>`)(o.x)).join('') + '</table></div>'
          : `<div class="empty">${unYm ? '이 달에 적은 기록이 없습니다.' : '적은 기록이 없습니다.'}</div>`) + '</div>';
      document.getElementById('notes-body').innerHTML = h;
      if (unYm) causeYm = unYm; else if (!causeYm) causeYm = lastCompleteYm();
    }
    let unLoadOn = false, unDraft = null;
    function unKeepDraft() { const g = id => { const e = document.getElementById(id); return e ? e.value : ''; }; unDraft = { d: g('un-d'), eq: g('un-eq'), text: g('un-text') }; setTimeout(() => { if (!unDraft) return; ['d', 'eq', 'text'].forEach(k => { const e = document.getElementById('un-' + k); if (e && unDraft[k]) e.value = unDraft[k]; }); unDraft = null; }, 0); }
    async function eqPut(fn) { // 부하 변동: 저장 직전 최신 목록을 다시 읽어서 고침
      const cur = await freshYear(9999); const list = (Array.isArray(cur.equip) ? cur.equip : EQ_DEFAULT).map((x, i) => ({ ...x, _k: eqKey(x, i) }));
      const out = fn(list).map(({ _k, _new, ...x }) => x);
      await saveYear(9999, { equip: out }); EQ_EDIT = null; resetCache && resetCache(); resetPickCache();
    }
    async function eqDel2(k) {
      const x = eqAll().find(z => z._k === k); if (!x || !confirm(`${x.d} 부하 변동 「${x.area} ${x.name || ''}」 기록을 지울까요?\n\n지우면 원인 찾기·목표 식 계산에서도 빠집니다.`)) return;
      try { await eqPut(L => L.filter(z => z._k !== k)); } catch (e) { alert('삭제 실패: ' + errMsg(e)); return; }
      renderNotes();
    }
    function unWriteFor(ds) { // 비교표에서 [+ 적기] → 기록 탭 입력칸에 날짜 넣고 내용으로 이동
      unEditId = null; unYm = ds.slice(0, 7); switchTab('notes');
      const d = document.getElementById('un-d'), t = document.getElementById('un-text'); if (!d || !t) return;
      d.value = ds; document.querySelector('#notes-body .card').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => t.focus(), 300);
    }
    function unCatChange(c) { const set = UN_UTIL_DEF[c] || []; document.querySelectorAll('.un-ut').forEach(x => { x.checked = set.includes(x.value); }); }
    function unShift(n) { unYm = n > 0 ? UT.nextYm(unYm || thisYm) : UT.prevYm(unYm || thisYm); renderNotes(); }
    async function unSave() {
      const g = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
      const d = g('un-d'), eq = g('un-eq'), text = g('un-text'), id = unEditId, now = new Date().toISOString();
      const isEq = typeof id === 'string' && id.startsWith('EQ:'), load = isEq || (document.getElementById('un-load') || {}).checked;
      if (load) {
        const area = g('un-area'), kw = Number(g('un-kw')) || 0, hours = Number(g('un-hours')) || 0;
        if (!d || !(eq || text)) { alert('날짜와 설비·장소(또는 내용)를 넣어 주세요.'); return; }
        const rec = { d, area, name: eq, kw, hours, note: text };
        try { await eqPut(L => { if (isEq) { const x = L.find(z => z._k === id.slice(3)); if (x) Object.assign(x, rec, { edited: now }); return L; }
          return L.concat([{ id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...rec, by: (me && (me.name || me.username)) || '', at: now }]); }); }
        catch (e) { alert('저장 실패: ' + errMsg(e)); return; }
        unEditId = null; unLoadOn = false; unYm = d.slice(0, 7); renderNotes(); return;
      }
      const cat = document.getElementById('un-cat').value, act = g('un-act'), utils = [...document.querySelectorAll('.un-ut:checked')].map(x => x.value);
      if (!d || !text) { alert('날짜와 내용을 넣어 주세요.'); return; }
      try {
        await unPut(L => { if (id) { const x = L.find(n => n.id === id); if (x) Object.assign(x, { d, cat, eq, text, act, utils, edited: now }); return L; }
          return L.concat([{ id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), d, cat, eq, text, act, utils, by: (me && (me.name || me.username)) || '', at: now }]); });
      } catch (e) { alert('저장 실패: ' + errMsg(e)); return; }
      unEditId = null; unYm = d.slice(0, 7); renderNotes();
    }
    async function unDel(id) {
      const n = utNotes().find(x => x.id === id); if (!n || !confirm(`${n.d} 「${n.text.slice(0, 30)}」 기록을 지울까요?`)) return;
      try { await unPut(L => L.filter(x => x.id !== id)); } catch (e) { alert('삭제 실패: ' + errMsg(e)); return; }
      renderNotes();
    }
    // 원인분석 카드: 비교 기간(두 달)의 특이사항
    function causeNotesHtml(ym, ym0, uk) {
      const a = ym0 < ym ? ym0 : ym, b = ym0 < ym ? ym : ym0;
      const L = notesIn(UT.dateStr(a, 1), UT.dateStr(b, UT.daysIn(b)), uk);
      const U = UT.UTILS.find(u => u.k === uk), from = UT.dateStr(a, 1), to = UT.dateStr(b, UT.daysIn(b));
      const EQ = uk === 'elec' || uk === 'gas' ? eqAll().filter(x => x.d >= from && x.d <= to && (uk === 'elec' ? Number(x.kw) > 0 || x.area !== '기타' : /보일러|가스|스팀/.test((x.name || '') + (x.note || '')))) : [];
      L.push(...EQ.map(x => ({ d: x.d, _eq: x }))); L.sort((p, q) => p.d < q.d ? -1 : 1);
      return `<h3>③ 그 기간에 무슨 일이 있었나 <span class="sub">${ymLabel(a)} ~ ${ymLabel(b)} · ${U.name} 관련 특이사항 · <a href="#" onclick="switchTab('notes');return false">특이사항</a> 탭에서 적음</span></h3>` +
        (L.length ? (() => { // 이번 달 / 비교 달 / 그 사이로 나눠 보여 줌
          const li = arr => `<ul class="un-list">${arr.map(n => `<li>${n._eq ? eqLine(n._eq) : unLine(n)}</li>`).join('')}</ul>`, mo = x => x.d.slice(0, 7);
          const cur = L.filter(n => mo(n) === ym), cmp = L.filter(n => mo(n) === ym0), mid = L.filter(n => mo(n) !== ym && mo(n) !== ym0);
          const sec = (t, sub, arr) => arr.length ? `<div style="margin:8px 0 2px;font-weight:600;font-size:13px">${t} <span class="hint" style="font-weight:400">${sub}</span></div>${li(arr)}` : '';
          return sec(`이번 달 (${ymLabel(ym)})`, '이 달에 있었던 일', cur) +
            sec(`비교 달 (${ymLabel(ym0)})`, '비교하는 달에 있었던 일', cmp) +
            sec(`그 사이 (${ymLabel(a)} 다음 ~ ${ymLabel(b)} 전)`, '두 달 사이에 바뀐 운전·설비 — 두 달 차이에 영향을 줬을 수 있는 변경', mid) +
            (!cur.length ? `<div class="hint" style="margin-top:6px">이번 달(${ymLabel(ym)})에 적은 ${U.name} 관련 특이사항은 없습니다.</div>` : '');
        })() : `<div class="hint">이 기간에 적은 ${U.name} 관련 특이사항이 없습니다. 원인 확인이 필요하면 <a href="#" onclick="showTabByName('notes');return false">특이사항</a>에 적어 두세요.</div>`);
    }
    function showTabByName(t) { const b = document.querySelector(`.tab-btn[data-tab="${t}"]`); if (b) b.click(); }


    // =====================================================================
    // 이상감지 · 생산 일별 요약과 유틸리티 비교 (원육 부위별 투입·포장 수량·공정별 시간 ↔ 전기·보일러·용수·폐수)
    // =====================================================================
    let dcYm = null, dcU = 'elec', dcP = 'rm', dcRange = 3;
    const dcProdName = (n) => { const a = String(n || '').split('·').map(x => x.trim()).filter(Boolean); return a.length > 1 ? a.slice(1).join(' · ') : (a[0] || '(제품명 없음)'); };
    function pearson(xs, ys) { const n = xs.length; if (n < 3) return null; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
      if (sxx < 1e-9 || syy < 1e-9) return null; return { r: sxy / Math.sqrt(sxx * syy), b: sxy / sxx, a: my - sxy / sxx * mx, n }; }
    const DC_U = [['elec', '전기', 'kWh', '#2a78d6', ds => (UT.dailyUsage(DAILY, ds) || {}).elec], ['gas', '보일러 가스', '㎥', '#eb6834', ds => UT.diffReading(DAILY, ds, ['gas_boiler'])],
      ['water', '용수', '㎥', '#1baf7a', ds => (UT.dailyUsage(DAILY, ds) || {}).water], ['ww', '폐수', '㎥', '#eda100', ds => (UT.dailyUsage(DAILY, ds) || {}).ww]];
    const DC_P = [['rm', '원육 투입 kg'], ['ea', '포장 EA'], ['pkg', '완제품 kg'], ['prepH', '전처리 h'], ['steamH', '자숙 h'], ['crushH', '파쇄 h'], ['packH', '포장 h'], ['boilH', '보일러 켠 시간'], ['runH', '보일러 실가동']];
    // ---------------- 완제품 중량 = 포장 EA × 제품 1개 중량 ----------------
    //  1개 중량: ① 특이사항 탭에서 직접 넣은 g (ut_monthly '9999-00' data.prodG) ② 제품명에 적힌 중량 (130g, 1kg, 70g×3 …)
    const prodGMap = () => ((YEARDATA[9999] || {}).prodG) || {};
    function prodGramAuto(name) {
      const s = dcProdName(name).replace(/,/g, ''); const re = /(\d+(?:\.\d+)?)\s*(kg|g)(?![a-z])/gi; let m, last = null;
      while ((m = re.exec(s))) last = m; if (!last) return null;
      let g = Number(last[1]) * (/kg/i.test(last[2]) ? 1000 : 1);
      const rest = s.slice(last.index + last[0].length), mx = rest.match(/^\s*[x×*X]\s*(\d+)/);
      if (mx && Number(mx[1]) > 1 && Number(mx[1]) <= 50) g *= Number(mx[1]);
      return g > 0 ? g : null;
    }
    function prodGram(name) { const k = dcProdName(name), o = prodGMap()[k]; return o !== undefined && o !== null && o !== '' && Number(o) > 0 ? { g: Number(o), src: 'manual' } : (prodGramAuto(name) ? { g: prodGramAuto(name), src: 'auto' } : null); }
    function pkgOf(p) { // { kg, known(EA), all(EA) }
      if (!p) return { kg: 0, known: 0, all: 0 }; let kg = 0, known = 0, all = 0;
      (p.packItems || []).forEach(x => { all += x.ea; const g = prodGram(x.name); if (g) { kg += x.ea * g.g / 1000; known += x.ea; } });
      if (!all && p.ea) all = p.ea;
      return { kg, known, all };
    }
    const pkgDay = p => { const k = pkgOf(p); return k.all && k.known / k.all >= 0.9 ? k.kg : (k.all ? null : 0); };
    const pval = (p, k) => k === 'pkg' ? pkgDay(p) : k === 'boilH' || k === 'runH' ? (p[k] === undefined ? null : p[k]) : (p[k] || 0);
    let pgOpen = false;
    function prodGHtml() {
      const all = {}; Object.values(PRODD || {}).forEach(p => (p.packItems || []).forEach(x => { const k = dcProdName(x.name); const a = all[k] = all[k] || { ea: 0, last: '', raw: x.name }; a.ea += x.ea; if (p.d > a.last) a.last = p.d; }));
      const ks = Object.keys(all).sort((a, b) => (prodGram(all[a].raw) ? 1 : 0) - (prodGram(all[b].raw) ? 1 : 0) || (all[a].last < all[b].last ? 1 : -1));
      const unk = ks.filter(k => !prodGram(all[k].raw)), ad = isAdmin();
      let h = `<details ${pgOpen || unk.length ? 'open' : ''} ontoggle="pgOpen=this.open" style="margin-top:12px"><summary style="cursor:pointer"><b>제품 1개 중량 (완제품 kg 계산용)</b> ${Portal.tip('pkg')} <span class="hint">제품 ${ks.length}개${unk.length ? ` · <span style="color:var(--red)">중량 모름 ${unk.length}개</span>` : ' · 모두 확인됨'}</span></summary>
        <div class="hint" style="margin:4px 0">완제품 kg = 포장 EA × 1개 중량. 제품명에 「130g」「1kg」「70g×3」처럼 적혀 있으면 자동으로 읽고, 없거나 틀리면 g을 직접 넣으세요 (직접 넣은 값이 우선). 그날 포장 EA의 90% 이상 중량을 알아야 그날 완제품 kg이 나옵니다.</div>
        <div class="tbl-wrap"><table class="t"><tr><th class="l">제품명 (포장 공정)</th><th>누적 EA</th><th>최근 생산</th><th>자동 읽음</th><th>1개 중량 g</th></tr>` +
        ks.map(k => { const a = all[k], au = prodGramAuto(a.raw), mv = prodGMap()[k];
          return `<tr><td class="l">${esc(k)}</td><td>${f0(a.ea)}</td><td>${a.last.slice(2)}</td><td>${au ? f0(au) + ' g' : '<span class="hint">-</span>'}</td>
            <td>${ad ? `<input class="pg-in" data-k="${esc(k)}" inputmode="decimal" style="width:80px" value="${mv ?? ''}" placeholder="${au ? f0(au) : 'g 입력'}">` : (prodGram(a.raw) ? f0(prodGram(a.raw).g) : '<span class="hint">모름</span>')}</td></tr>`; }).join('') + '</table></div>' +
        (ad && ks.length ? `<div class="toolbar" style="margin-top:6px"><button class="btn small" onclick="saveProdG()">✓ 중량 저장</button><span class="hint">비워 두면 자동 읽은 값을 씁니다</span></div>` : '') + '</details>';
      return h;
    }
    async function saveProdG() {
      const m = {}; document.querySelectorAll('.pg-in').forEach(x => { const v = String(x.value).replace(/,/g, '').trim(); if (v !== '' && Number(v) > 0) m[x.dataset.k] = Number(v); });
      try {
        const { data, error } = await sb.from('ut_monthly').select('data').eq('ym', '9999-00').maybeSingle(); if (error) throw error;
        const cur = (data && data.data) || {}, nd = { ...cur, prodG: m };
        const r = await sb.from('ut_monthly').upsert({ ym: '9999-00', data: nd }, { onConflict: 'ym' }); if (r.error) throw r.error;
        YEARDATA[9999] = nd; renderDayCmp(); if (document.getElementById('per-elec')) renderPerElec();
      } catch (e) { alert('저장 실패: ' + errMsg(e)); }
    }
    async function renderDayCmp() {
      const el = document.getElementById('dc-body'); if (!el) return;
      if (!PRODD) { el.innerHTML = '<div class="loading">생산 대시보드 일별 요약 불러오는 중...</div>';
        try { await loadProdDaily(); } catch (e) { el.innerHTML = `<div class="empty">생산 대시보드 자료를 읽지 못했습니다: ${esc(errMsg(e))}</div>`; return; } }
      if (!dcYm) dcYm = thisYm;
      try { await loadTemps(); } catch (e) { TEMPS = TEMPS || {}; }
      const W = ['일', '월', '화', '수', '목', '금', '토'], n = UT.daysIn(dcYm), nh = v => v ? nf1.format(v) : '';
      const rows = []; for (let i = 1; i <= n; i++) { const ds = UT.dateStr(dcYm, i); if (ds > todayStr) break; const p = PRODD[ds] || null; rows.push({ ds, p, u: DC_U.map(u => u[4](ds)) }); }
      const uv = v => v === null || v === undefined || isNaN(v) ? '<span class="hint">-</span>' : (Math.abs(v) >= 100 ? f0(v) : nf1.format(v));
      const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
      let h = `<div class="toolbar"><div class="month-nav"><button onclick="dcYm=UT.prevYm(dcYm);renderDayCmp()">◀</button><span>${ymLabel(dcYm)}</span><button onclick="dcYm=UT.nextYm(dcYm);renderDayCmp()">▶</button></div>
        <span class="hint">그래프: </span><span class="chips">${DC_U.map(u => `<button class="chip ${dcU === u[0] ? 'on' : ''}" onclick="dcU='${u[0]}';renderDayCmp()">${u[1]}</button>`).join('')}</span>
        <span class="hint">와 </span><span class="chips">${DC_P.map(x => `<button class="chip ${dcP === x[0] ? 'on' : ''}" onclick="dcP='${x[0]}';renderDayCmp()">${x[1]}</button>`).join('')}</span></div>
        <div class="chart-box" style="height:260px"><canvas id="dc-chart"></canvas></div>
        <div class="tbl-wrap" style="margin-top:10px"><table class="t dc-t"><tr><th rowspan="2">날짜</th><th colspan="2">전처리 원육 투입</th><th rowspan="2" class="l">포장 제품 · EA</th><th rowspan="2">완제품<br><span class="hint">kg</span></th><th colspan="4">공정별 작업시간 (h)</th><th rowspan="2">보일러 켠 시간<br><span class="hint">자숙·레토르트 ${Portal.tip('boilh')}</span></th><th colspan="4">유틸리티 사용량</th><th rowspan="2" class="l">특이사항</th></tr>
        <tr><th class="l">부위</th><th>kg</th><th>전처리</th><th>자숙</th><th>파쇄</th><th>포장</th>${DC_U.map(u => `<th>${u[1]}<br><span class="hint">${u[2]}</span></th>`).join('')}</tr>` +
        rows.map(r => { const p = r.p, w = new Date(r.ds + 'T00:00:00').getDay(), parts = p ? Object.entries(p.rmParts || {}) : [];
          const items = p && p.packItems && p.packItems.length ? p.packItems.map(x => `${x.name} ${f0(x.ea)}`).join('\n') : '';
          return `<tr class="${!p ? 'dc-off' : ''}"><td>${Number(r.ds.slice(8))}일 (<span class="${w === 0 ? 'dc-sun' : w === 6 ? 'dc-sat' : ''}">${W[w]}</span>)</td>
            <td class="l">${parts.length ? parts.map(([k]) => esc(k)).join('<br>') : (p ? '' : '<span class="hint">생산 없음</span>')}</td><td>${parts.length ? parts.map(([, v]) => f0(v)).join('<br>') : ''}</td>
            <td class="l dc-pack">${p && p.packItems && p.packItems.length ? (() => { const m = {}; p.packItems.forEach(x => { const k = dcProdName(x.name); m[k] = (m[k] || 0) + x.ea; }); const e = Object.entries(m);
              return e.map(([k, v]) => `<div><span class="dc-pn">${esc(k)}</span> <b>${f0(v)}</b></div>`).join('') + (e.length > 1 ? `<div class="hint">계 ${f0(p.ea)}</div>` : ''); })() : (p && p.ea ? f0(p.ea) : '')}</td>
            <td>${p && (p.ea || (p.packItems || []).length) ? (() => { const k = pkgOf(p); return k.known ? `${f0(k.kg)}${k.known < k.all ? `<div class="hint" title="중량 모르는 제품 EA가 있음">${Math.round(k.known / k.all * 100)}%만</div>` : ''}` : '<span class="hint">?</span>'; })() : ''}</td>
            <td>${p ? nh(p.prepH) : ''}</td><td>${p ? nh(p.steamH) : ''}</td><td>${p ? nh(p.crushH) : ''}</td><td>${p ? nh(p.packH) : ''}</td><td class="dc-bh">${p && p.rm > 0 ? (p.boilH !== undefined ? `<b>${nf1.format(p.boilH)}h</b><div class="hint" title="켠 시각: ${p.onSrc} · 끈 시각: ${p.offSrc}">${hhmm(p.bOn)}~${hhmm(p.bOff)}</div>${p.runH !== undefined ? `<div class="hint" title="자숙·레토르트(가동 시작~가열 종료) 구간을 합치고 사이 쉬는 틈을 뺀 시간">실가동 ${nf1.format(p.runH)}h</div>` : ''}` : p.bOn !== undefined ? `<span class="hint" title="${p.bMiss || ''}">${hhmm(p.bOn)}~?${p.runH !== undefined ? `<br>실가동 ${nf1.format(p.runH)}h` : ''}</span>` : `<span class="hint" title="자숙·레토르트 기록 없음">-</span>`) : ''}</td>${r.u.map(uv).map(x => `<td>${x}</td>`).join('')}<td class="l dc-note">${notesIn(r.ds, r.ds).map(n => `<div><span class="un-cat">${esc(n.cat)}</span> ${esc(n.text)}</div>`).join('')}${isAdmin() ? `<button class="btn secondary small" onclick="unWriteFor('${r.ds}')">+ 적기</button>` : ''}</td></tr>`; }).join('') +
        (() => { const pd = rows.filter(r => r.p && r.p.rm > 0), np = pd.length;
          const tot = `<tr class="dc-sum"><td>합계</td><td class="l">${(() => { const t = {}; pd.forEach(r => Object.entries(r.p.rmParts || {}).forEach(([k, v]) => { t[k] = (t[k] || 0) + v; })); return Object.keys(t).map(esc).join('<br>'); })()}</td>
            <td>${(() => { const t = {}; pd.forEach(r => Object.entries(r.p.rmParts || {}).forEach(([k, v]) => { t[k] = (t[k] || 0) + v; })); return Object.values(t).map(f0).join('<br>'); })()}</td>
            <td class="l dc-pack">${(() => { const m = {}; rows.filter(r => r.p).forEach(r => (r.p.packItems || []).forEach(x => { const k = dcProdName(x.name); m[k] = (m[k] || 0) + x.ea; })); return Object.entries(m).map(([k, v]) => `<div><span class="dc-pn">${esc(k)}</span> <b>${f0(v)}</b></div>`).join(''); })()}<div>계 ${f0(sum(r => r.p && r.p.ea))}</div></td><td>${f0(sum(r => r.p ? pkgOf(r.p).kg : 0))}</td>${['prepH', 'steamH', 'crushH', 'packH'].map(k => `<td>${nf1.format(sum(r => r.p && r.p[k]))}</td>`).join('')}<td>${nf1.format(sum(r => r.p && r.p.boilH))}</td>${DC_U.map((u, i) => `<td>${f0(sum(r => r.u[i]))}</td>`).join('')}<td></td></tr>`;
          const avg = (f, rs) => { const v = rs.map(f).filter(x => x !== null && x !== undefined && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
          const off = rows.filter(r => !r.p);
          const a1 = `<tr class="dc-sum"><td>생산일 평균<br><span class="hint">${np}일</span></td><td></td><td>${np ? f0(sum(r => r.p && r.p.rm) / np) : ''}</td><td>${np ? f0(sum(r => r.p && r.p.ea) / np) : ''}</td><td>${np ? f0(sum(r => r.p ? pkgOf(r.p).kg : 0) / np) : ''}</td>${['prepH', 'steamH', 'crushH', 'packH'].map(k => `<td>${np ? nf1.format(sum(r => r.p && r.p[k]) / np) : ''}</td>`).join('')}<td>${(() => { const b = pd.filter(r => r.p.boilH !== undefined); return b.length ? nf1.format(b.reduce((t, r) => t + r.p.boilH, 0) / b.length) : ''; })()}</td>${DC_U.map((u, i) => `<td>${uv(avg(r => r.u[i], pd))}</td>`).join('')}<td></td></tr>`;
          const a2 = `<tr class="dc-sum"><td>쉬는 날 평균<br><span class="hint">${off.length}일</span></td><td colspan="9"></td>${DC_U.map((u, i) => `<td>${uv(avg(r => r.u[i], off))}</td>`).join('')}<td></td></tr>`;
          return tot + a1 + a2; })() + '</table></div>' +
        (() => { // 이 달 제품별 완제품 EA·중량 — 생산 대시보드 월별 현황 「제품별 생산 현황」과 맞춰 보기용
          const m = {}; rows.forEach(r => (r.p && (r.p.opAll || r.p.packItems) || []).forEach(x => { const k = dcProdName(x.name), o = (m[k] = m[k] || { ea: 0, test: 0, inner: 0, defect: 0, remain: 0, remainB: 0, boxes: 0, outer: 0, sample: 0, n: 0 }); o.ea += x.ea; if (x.test) o.test += x.ea; ['inner', 'defect', 'remain', 'remainB', 'boxes', 'outer', 'sample'].forEach(q => { o[q] += x[q] || 0; }); o.n += x.recs || 0; }));
          const L = Object.entries(m).sort((a, b) => b[1].ea - a[1].ea); if (!L.length) return '';
          const tot = L.reduce((a, [k, o]) => { const g = prodGram(k); a.ea += o.ea; a.kg += g ? o.ea * g.g / 1000 : 0; return a; }, { ea: 0, kg: 0 });
          return `<details class="fold" style="margin-top:8px"><summary><b>${ymLabel(dcYm)} 제품별 완제품 EA·중량</b> <span class="hint">— 생산 대시보드 월별 현황 「제품별 생산 현황」과 맞춰 보기 (외포장 완료 기준)</span></summary>
            <div class="tbl-wrap" style="margin-top:6px"><table class="t"><tr><th class="l">제품</th><th>완제품 EA<br><span class="hint">외포장 (+ 잔량, 5월~)</span></th><th>1개 중량</th><th>완제품 중량 (kg)</th><th>기록 수</th><th>외포장 EA</th><th>외포장 박스</th><th>잔량 EA</th><th>잔량 박스</th><th>내포장 EA</th><th>불량</th><th>샘플</th></tr>` +
            L.map(([k, o]) => { const g = prodGram(k); return `<tr><td class="l">${esc(k)}${o.test ? ` <span class="hint">(시험 생산 ${f0(o.test)} 포함)</span>` : ''}</td><td>${f0(o.ea)}</td><td>${g ? f0(g.g) + 'g' : '<span class="warn">?</span>'}</td><td>${g ? nf1.format(o.ea * g.g / 1000) : '-'}</td><td>${o.n}</td><td>${f0(o.outer)}</td><td>${f0(o.boxes)}</td><td>${f0(o.remain)}</td><td>${f0(o.remainB)}</td><td>${f0(o.inner)}</td><td>${f0(o.defect)}</td><td>${f0(o.sample)}</td></tr>`; }).join('') +
            `<tr class="dc-sum"><td class="l">합계</td><td>${f0(tot.ea)}</td><td></td><td>${nf1.format(tot.kg)}</td><td colspan="8"></td></tr></table></div></details>`; })() +
        `<div class="hint" style="margin-top:4px">생산 자료는 생산 대시보드 일별 요약(읽기만). 원육 kg은 그날 전처리 투입량이고 월 공식값(원육 투입량)과는 마지막 수정분만큼 다를 수 있습니다. 포장 제품·EA는 <b>완제품 EA = 외포장 EA + 잔량</b>(26년 5월부터, 3·4월은 외포장 EA만) 기준(생산 대시보드 월별 현황의 「완제품 EA」와 같음, 시험 생산 제외)입니다. 완제품 kg = 포장 EA × 제품 1개 중량 (아래 「제품 1개 중량」 표). 사용량은 그날 아침 → 다음날 아침 검침 차이입니다 (전기는 파워플래너 일별값). <b>보일러 켠 시간</b> = 첫 전처리 시작 ~ 레토르트 마지막 회차 배출 완료(t4) · 레토르트 없는 날은 내포장 마지막 종료 + 1시간 (FC 3kg + 2시간). <b>실가동</b> = 자숙·레토르트(가동 시작~가열 종료) 구간을 합치고 사이 틈을 뺀 시간. 「~?」는 끈 시각을 아직 못 정한 날.</div>` + (BT_ERR ? `<div class="hint" style="color:#b3261e;margin-top:4px">⚠ 자숙·레토르트 기록을 읽지 못해 보일러 켠 시간을 계산하지 못했습니다: ${esc(BT_ERR)}</div>` : '');
      h += prodGHtml() + dcCorrHtml();
      el.innerHTML = h;
      const U = DC_U.find(u => u[0] === dcU), PP = DC_P.find(x => x[0] === dcP);
      mkChart('dc-chart', { data: { labels: rows.map(r => Number(r.ds.slice(8)) + '일'), datasets: [
          { type: 'bar', label: `${U[1]} ${U[2]}`, data: rows.map(r => r.u[DC_U.indexOf(U)]), backgroundColor: U[3] + 'bb', yAxisID: 'y', order: 2 },
          { type: 'line', label: PP[1], data: rows.map(r => r.p ? pval(r.p, dcP) : 0), borderColor: '#333', backgroundColor: '#333', pointRadius: 3, borderWidth: 1.5, yAxisID: 'y2', order: 1 }] },
        options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } },
          scales: { y: { beginAtZero: true, title: { display: true, text: U[2] } }, y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: PP[1] } } } } });
    }

    // 연관성(상관계수) — 생산한 날만, 기간 끝 = 선택한 달 말일
    function dcCorrHtml() {
      const end = UT.dateStr(dcYm, UT.daysIn(dcYm)) > todayStr ? UT.addDays(todayStr, -1) : UT.dateStr(dcYm, UT.daysIn(dcYm));
      let st = dcYm; for (let i = 1; i < dcRange; i++) st = UT.prevYm(st); const from = UT.dateStr(st, 1);
      const days = []; for (let ds = from; ds <= end; ds = UT.addDays(ds, 1)) { const p = PRODD[ds]; if (p && p.rm > 0) days.push({ ds, p, t: (TEMPS || {})[ds], u: DC_U.map(u => u[4](ds)) }); }
      const cols = [...DC_P, ['temp', '평균기온 ℃']], xv = (d, k) => k === 'temp' ? (d.t === undefined || d.t === null ? null : d.t) : pval(d.p, k);
      const M = DC_U.map((u, ui) => cols.map(([k]) => { const v = days.filter(d => d.u[ui] !== null && d.u[ui] !== undefined && !isNaN(d.u[ui]) && xv(d, k) !== null); return pearson(v.map(d => xv(d, k)), v.map(d => d.u[ui])); }));
      const lvl = r => { const a = Math.abs(r); return a >= 0.7 ? '강함' : a >= 0.4 ? '보통' : a >= 0.2 ? '약함' : '거의 없음'; };
      const bg = r => { const a = Math.min(1, Math.abs(r)); return r >= 0 ? `rgba(42,120,214,${(a * 0.75).toFixed(2)})` : `rgba(217,48,37,${(a * 0.6).toFixed(2)})`; };
      const unitX = { rm: 'kg', pkg: 'kg', ea: 'EA', prepH: 'h', steamH: 'h', crushH: 'h', packH: 'h', boilH: 'h', runH: 'h', temp: '℃' }, per = { rm: 1000, pkg: 1000, ea: 10000, temp: 1 };
      const slope = (c, k, u) => { const m = per[k] || 1, v = c.b * m; return `${unitX[k] === 'h' ? '1h' : k === 'temp' ? '1℃' : (m === 1000 ? '1,000' : '10,000') + unitX[k]}당 ${v >= 0 ? '+' : ''}${Math.abs(v) >= 100 ? f0(v) : nf1.format(v)} ${u[2]}`; };
      // 생산 항목끼리의 연관 (서로 같이 움직이면 어느 게 진짜 원인인지 구분 어려움)
      const PX = cols.map(([k]) => cols.map(([k2]) => { const v = days.filter(d => xv(d, k) !== null && xv(d, k2) !== null); return pearson(v.map(d => xv(d, k)), v.map(d => xv(d, k2))); }));
      let h = `<h4 style="margin:18px 0 6px">하루 단위 연관성 (상관계수 r) ${Portal.tip('rday')} <span class="hint">점 하나 = 생산한 하루 · ${days.length}일 · ${from} ~ ${end} — 지표 분석의 r(점 하나 = 한 달)과는 다른 값</span></h4>
        <div class="toolbar"><span class="chips">${[[1, '이 달'], [3, '최근 3개월'], [6, '최근 6개월'], [12, '최근 1년']].map(([n, l]) => `<button class="chip ${dcRange === n ? 'on' : ''}" onclick="dcRange=${n};renderDayCmp()">${l}</button>`).join('')}</span></div>`;
      if (days.length < 8) return h + '<div class="empty">생산한 날이 8일 이상 있어야 계산합니다. 기간을 늘려 보세요.</div>';
      h += `<div class="tbl-wrap"><table class="t dc-corr"><tr><th></th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr>` +
        DC_U.map((u, ui) => `<tr><th>${u[1]}</th>${M[ui].map((c, ci) => c === null ? '<td class="hint">-</td>' :
          `<td style="background:${bg(c.r)};cursor:pointer" title="${u[1]} ↔ ${cols[ci][1]} · ${c.n}일\n${slope(c, cols[ci][0], u)} (단순 기울기)\n누르면 위 그래프가 이 조합으로 바뀝니다" onclick="${cols[ci][0] === 'temp' ? '' : `dcU='${u[0]}';dcP='${cols[ci][0]}';renderDayCmp();document.getElementById('dc-chart').scrollIntoView({behavior:'smooth',block:'center'})`}">
            <b>${c.r.toFixed(2)}</b><div class="dc-lv">${lvl(c.r)}</div><div class="dc-sl">${slope(c, cols[ci][0], u)}</div></td>`).join('')}</tr>`).join('') + '</table></div>';
      // 유틸별 가장 관련 큰 항목 요약
      h += '<ul class="un-list" style="margin-top:8px">' + DC_U.map((u, ui) => { const c = M[ui].map((c, i) => ({ c, i })).filter(x => x.c).sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r));
        if (!c.length) return `<li>${u[1]}: 계산할 자료 부족</li>`; const t = c[0], t2 = c[1];
        return `<li><b>${u[1]}</b> — ${cols[t.i][1]}과(와) 가장 관련 큼 (r ${t.c.r.toFixed(2)}, ${lvl(t.c.r)}: ${slope(t.c, cols[t.i][0], u)})${t2 ? `, 다음 ${cols[t2.i][1]} (r ${t2.c.r.toFixed(2)})` : ''}${Math.abs(t.c.r) < 0.4 ? ' → 생산량보다는 기본 부하·날씨·운전 방식 영향이 큰 편' : ''}</li>`; }).join('') + '</ul>';
      h += `<details style="margin-top:8px"><summary class="hint" style="cursor:pointer">생산 항목끼리 얼마나 같이 움직이는지 보기 (서로 r 0.8 이상이면 둘 중 어느 쪽이 원인인지 구분하기 어려움)</summary>
        <div class="tbl-wrap"><table class="t dc-corr"><tr><th></th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr>${cols.map((c, i) => `<tr><th>${c[1]}</th>${PX[i].map((x, j) => i === j ? '<td class="hint">—</td>' : x === null ? '<td class="hint">-</td>' : `<td style="background:${bg(x.r)}">${x.r.toFixed(2)}</td>`).join('')}</tr>`).join('')}</table></div></details>
        <div class="hint" style="margin-top:6px">• <b>상관계수 r</b>: −1 ~ 1. 1에 가까울수록 그 항목이 많은 날 사용량도 많음, 0이면 관계 없음, 음수면 반대로 움직임. 0.7 이상 강함 · 0.4~0.7 보통 · 0.2~0.4 약함.<br>
        • <b>기울기</b>: 그 항목만 놓고 봤을 때 1단위 늘면 사용량이 평균 얼마 늘었는지 (다른 항목 영향이 섞여 있음). r²(= r×r)는 사용량 차이 중 그 항목으로 설명되는 비율입니다 (예: r 0.8 → 64%).<br>
        • 생산한 날만 계산합니다 (쉬는 날을 넣으면 '생산했냐 안 했냐' 차이 때문에 모든 항목이 높게 나옴). 상관이 높아도 원인이라는 증거는 아니고, 원육·시간·EA는 서로 같이 움직이므로 위 '생산 항목끼리' 표도 같이 보세요.</div>`;
      return h;
    }

    // =====================================================================
    // 기간비교 · 전력 구성별 비교 (월별): 생산동·폐수동·공조냉동 전력 ↔ 원육·포장 EA·기온·생산일수 등
    //   생산동 = 고지서(없으면 파워플래너 합산) 전체 − 폐수동 계량 − 공조냉동 계량 12곳
    // =====================================================================
    let peUtil = 'elec', peComp = 'hall', peFac = 'prod', pePerDay = false, peStack = false, peN = 12, peRatio = true;
    // 유틸리티별 구성 (막대) · 단위 · 비교 인자 (선)
    const PE_U = {
      elec: { name: '전기', unit: 'kWh', comps: [['hall', '생산동', '#2a78d6'], ['ww', '폐수동', '#eda100'], ['hv', '공조냉동', '#1baf7a'], ['all', '전기 전체', '#555']], stack: ['hall', 'ww', 'hv'],
        get facs() { return FACS_U.elec; },
        note: '공조냉동·폐수동 계량이 나뉜 26년 3월부터 구성별 값이 나옵니다 · 생산동 = 전체 − 폐수동 − 공조냉동' },
      gas: { name: '가스', unit: 'MJ', comps: [['gb', '보일러 (스팀)', '#eb6834'], ['gr', '식당 (기숙사)', '#c9a227'], ['gall', '가스 전체', '#555']], stack: ['gb', 'gr'],
        get facs() { return FACS_U.gas; },
        note: '보일러 스팀 = 자숙탱크·레토르트 · 보일러·식당은 고지서(없으면 검침) 계량 지침으로 나눈 열량(MJ) · 난방도일 = 하루 평균기온이 18℃보다 낮은 만큼의 합 (난방용 가스는 없지만 급수 온도·배관 열손실 영향 확인용)' },
      water: { name: '용수', unit: '㎥', comps: [['wall', '용수 (40A+50A)', '#1baf7a']], stack: null,
        facs: ['prod', 'ea', 'pkg', 'op', 'idle', 'tmean', 'steamH', 'flow', 'days'],
        note: '용수 월 사용량은 고지서 검침 기간(전월 12일~당월 11일) 기준이라 생산·기온과 반 달쯤 어긋납니다' },
      ww: { name: '폐수', unit: '㎥', comps: [['wwall', '폐수 발생량', '#eda100']], stack: null,
        facs: ['prod', 'ea', 'pkg', 'op', 'idle', 'tmean', 'steamH', 'sludge', 'days'],
        note: '폐수 발생량 = 방류 유량계 (고지서 값이 있으면 그 값)' } };
    const PE_COMP_ALL = Object.values(PE_U).flatMap(u => u.comps);
    const PE_FAC = [
      ['prod', '원육 투입량', 'kg', 0], ['ea', '포장 생산량', 'EA', 0], ['pkg', '완제품 중량', 'kg', 0], ['tmean', '평균기온', '℃', 1], ['warm', '더운 정도 (5℃ 넘는 기온 합)', '℃·일', 0],
      ['op', '생산일수', '일', 0], ['days', '달력 날수', '일', 0], ['idle', '쉬는 날 수', '일', 0],
      ['steamH', '자숙 작업시간', 'h', 0], ['packH', '포장 작업시간', 'h', 0], ['flow', '폐수 방류량', '㎥', 0], ['sludge', '슬러지 발생량', 'kg', 0], ['gas', '보일러 가스', '㎥', 0], ['hdd', '추운 정도 (난방도일)', '℃·일', 0], ['boilH', '보일러 켠 시간', 'h', 0], ['runH', '보일러 실가동 시간', 'h', 0], ['hddOn', '보일러 켠 날 난방도일', '℃·일', 0],
      ['retN', '레토르트 회차 수', '회', 0], ['retH', '레토르트 가열 시간', 'h', 0], ['cookN', '자숙 회차 수', '회', 0], ['cookH', '자숙 시간 (회차 합)', 'h', 0], ['packMH', '내포장 호기×시간', 'h', 0],
      ['manH', '작업 인시 (인원×시간)', '인시', 0], ['prepH', '전처리 작업시간', 'h', 0], ['crushH', '파쇄 작업시간', 'h', 0], ['steamKg', '자숙 투입량', 'kg', 0]];
    const PE_PERDAY_FAC = { prod: 1, ea: 1, pkg: 1, steamH: 1, packH: 1, flow: 1, sludge: 1, gas: 1, boilH: 1, runH: 1, retN: 1, retH: 1, cookN: 1, cookH: 1, packMH: 1, manH: 1, prepH: 1, crushH: 1, steamKg: 1 }; // 하루당으로 바꿀 때 같이 나누는 인자
    // 맨 위 기간비교에서 고른 기간을 월 단위로 바꿔서 씀 (일·주는 그 날짜가 속한 달, 분기는 그 분기의 달) — 아직 안 끝난 달은 뺌
    function peMonths() {
      const { from, to } = perRange(), last = lastCompleteYm();
      let a, b; if (perGran === 'quarter') { const [y1, q1] = from.split('-').map(Number), [y2, q2] = to.split('-').map(Number); a = UT.ym(y1, (q1 - 1) * 3 + 1); b = UT.ym(y2, q2 * 3); } else { a = from.slice(0, 7); b = to.slice(0, 7); }
      if (b > last) b = last; const out = []; for (let ym = a; ym <= b && out.length < 60; ym = UT.nextYm(ym)) out.push(ym);
      return out.length >= 2 ? out : (() => { const o = []; let ym = last; for (let i = 0; i < 12; i++) { o.unshift(ym); ym = UT.prevYm(ym); } return o; })();
    }
    function peRow(ym) {
      const s = S(ym), all = s.elec.usage, ww = wwKwh(ym), hv = meterKwh(ym, 'elec_hvac_kwh'), days = UT.daysIn(ym), op = UT.opDays(DAILY, ym, MONTHLY);
      const hall = all !== null && ww !== null && hv !== null && ym >= HVAC_FULL_FROM ? all - ww - hv : null;
      let ea = 0, sh = 0, ph = 0, pn = 0, gas = 0, gn = 0, pk = 0, pkKn = 0, pkAll = 0, bh = 0, bhN = 0, rh = 0, rmN = 0, hOn = 0, hOnN = 0; const EX = { retN: [0, 0], retH: [0, 0], cookN: [0, 0], cookH: [0, 0], packMH: [0, 0] };
      for (let d = 1; d <= days; d++) { const ds = UT.dateStr(ym, d), p = PRODD && PRODD[ds]; if (p) { ea += p.ea || 0; sh += p.steamH || 0; ph += p.packH || 0; pn++; if (p.rm > 0) { rmN++; if (p.boilH !== undefined) { bh += p.boilH; rh += p.runH; bhN++; } } Object.keys(EX).forEach(k => { if (p[k] !== undefined) { EX[k][0] += p[k]; EX[k][1]++; } }); const k = pkgOf(p); pk += k.kg; pkKn += k.known; pkAll += k.all; }
        const g = UT.diffReading(DAILY, ds, ['gas_boiler']); if (g !== null && g >= 0) { gas += g; gn++; const tt = (TEMPS || {})[ds]; if (g <= 50) hOnN++; else if (tt !== null && tt !== undefined && !isNaN(tt)) { hOn += Math.max(0, 18 - tt); hOnN++; } } }
      const sumP = k => { let t = 0; for (let d = 1; d <= days; d++) { const p = PRODD && PRODD[UT.dateStr(ym, d)]; if (p) t += Number(p[k]) || 0; } return t; };
      const w = wwRow(ym), tm = UT.monthWeather(ym, TEMPS || {}).tmean;
      const gc = s.gas.calc, wt = UT.monthWeather(ym, TEMPS || {});
      return { ym, c: { hall, ww: ym >= HVAC_FULL_FROM ? ww : null, hv: ym >= HVAC_FULL_FROM ? hv : null, all,
          gb: gc && gc.boiler ? gc.boiler.mj : null, gr: gc ? (gc.rest ? gc.rest.mj : 0) : null, gall: s.gas.usage, wall: s.water.usage, wwall: s.ww.usage },
        f: { hdd: wt.hdd, prod: s.production, ea: pn ? ea : null, pkg: pn && pkAll && pkKn / pkAll >= 0.9 ? pk : null, tmean: tm, warm: warmSum(ym, 5), op, days, idle: op === null ? null : days - op, steamH: pn ? sh : null, packH: pn ? ph : null, flow: w.flow, sludge: w.sludgeGen, gas: gn >= days * 0.8 ? gas : null, boilH: rmN && bhN >= rmN * 0.9 ? bh : null, runH: rmN && bhN >= rmN * 0.9 ? rh : null, hddOn: TEMPS && hOnN >= days * 0.8 ? hOn : null, ...Object.fromEntries(Object.entries(EX).map(([k, [v, n]]) => [k, pn && n >= pn * 0.9 ? v : null])), manH: pn ? sumP('manH') : null, prepH: pn ? sumP('prepH') : null, crushH: pn ? sumP('crushH') : null, steamKg: pn ? sumP('steamKg') : null } };
    }
    async function renderPerElec() {
      const el = document.getElementById('per-elec'); if (!el || !window.Chart) return;
      const need = []; if (!PRODD) need.push(loadProdDaily().catch(() => {})); if (!WWD) need.push(loadWWD()); if (!TEMPS) need.push(loadTemps().catch(() => {}));
      if (need.length) { el.innerHTML = '<div class="loading">생산 실적·기온·폐수 장부 불러오는 중...</div>'; await Promise.all(need); }
      const PU = PE_U[peUtil], PE_COMP = PU.comps, FACS = PU.facs.map(k => PE_FAC.find(f => f[0] === k)).filter(Boolean); // 순서도 지표 고르기와 같게
      if (!PE_COMP.some(c => c[0] === peComp)) peComp = PE_COMP[0][0]; if (!PU.facs.includes(peFac)) peFac = PU.facs[0]; if (!PU.stack) peStack = false;
      const ms = peMonths(), rows = ms.map(peRow), C = PE_COMP.find(x => x[0] === peComp), F = PE_FAC.find(x => x[0] === peFac);
      const cv = (r, k) => { const v = r.c[k]; return v === null || v === undefined ? null : (pePerDay ? v / r.f.days : v); };
      const fv = (r, k) => { const v = r.f[k]; return v === null || v === undefined ? null : (pePerDay && PE_PERDAY_FAC[k] ? v / r.f.days : v); };
      const cu = pePerDay ? PU.unit + '/일' : PU.unit, fu = pePerDay && PE_PERDAY_FAC[F[0]] ? F[2] + '/일' : F[2];
      // 원단위 = 막대 사용량 ÷ 고른 인자 (한 달 전체 값끼리 나눔 · 평균기온은 0·음수가 있어 뺌)
      const RT_OK = F[0] !== 'tmean', rtMul = F[0] === 'ea' ? 1000 : 1, rtU = `${PU.unit}/${F[0] === 'ea' ? '1,000EA' : F[2]}`;
      const rt = (r, k) => { const c = r.c[k], f = r.f[F[0]]; return !RT_OK || c === null || c === undefined || !f || f <= 0 ? null : c / f * rtMul; };
      const rtFmt = v => v === null ? '-' : Math.abs(v) >= 100 ? f0(v) : Math.abs(v) >= 1 ? nf2.format(v) : Number(v.toPrecision(3)).toLocaleString('ko-KR');
      const fmtF = (v, k) => { if (v === null || v === undefined) return '-'; const f = PE_FAC.find(x => x[0] === k); const d = pePerDay && PE_PERDAY_FAC[k] ? (k === 'steamH' || k === 'packH' ? 1 : 0) : f[3]; return v.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d }); };
      let h = `<div class="toolbar"><span class="chips">${Object.entries(PE_U).map(([k, u]) => `<button class="chip ${peUtil === k ? 'on' : ''}" onclick="peUtil='${k}';renderPerElec()"><b>${u.name}</b></button>`).join('')}</span></div>
        <div class="toolbar"><span class="hint">${PU.name} (막대)</span><span class="chips">${PE_COMP.map(([k, n]) => `<button class="chip ${peComp === k && !peStack ? 'on' : ''}" onclick="peComp='${k}';peStack=false;renderPerElec()">${n}</button>`).join('')}${PU.stack ? `<button class="chip ${peStack ? 'on' : ''}" onclick="peStack=true;renderPerElec()">구성 쌓아 보기</button>` : ''}</span>
          <label class="hint"><input type="checkbox" ${pePerDay ? 'checked' : ''} onchange="pePerDay=this.checked;renderPerElec()"> 하루당으로 보기 (날수 차이 없앰)</label>
          <span class="hint">기간: <b>${ms[0].slice(2).replace('-', '.')} ~ ${ms[ms.length - 1].slice(2).replace('-', '.')}</b> (${ms.length}개월 · 맨 위 기간 설정을 따름, 진행 중인 달 제외)</span></div>
        <div class="toolbar"><span class="hint">비교할 것 (선) ${Portal.tip('degday')}</span><span class="chips">${FACS.map(([k, n]) => `<button class="chip ${peFac === k ? 'on' : ''}" onclick="peFac='${k}';renderPerElec()">${n}</button>`).join('')}</span>${RT_OK && !peStack ? ` <label class="hint"><input type="checkbox" ${peRatio ? 'checked' : ''} onchange="peRatio=this.checked;renderPerElec()"> 원단위 선도 보기 (${C[1]} ÷ ${F[1].replace(/ \(.*\)/, '')})</label>${Portal.tip('unit')}` : ''}</div>
        <div class="chart-box" style="height:300px"><canvas id="chart-pe"></canvas></div>`;
      // 연관성 (상관계수 r) — 마감된 달끼리
      const r2 = (xs, ys) => { const p = xs.map((x, i) => [x, ys[i]]).filter(([a, b]) => a !== null && b !== null && a !== undefined && b !== undefined); if (p.length < 4) return null; const pr = pearson(p.map(x => x[0]), p.map(x => x[1])); return pr ? { r: pr.r, n: p.length } : null; };
      const bg = r => { const a = Math.min(1, Math.abs(r)); return r >= 0 ? `rgba(42,120,214,${(a * 0.7).toFixed(2)})` : `rgba(217,48,37,${(a * 0.55).toFixed(2)})`; };
      h += `<h4 style="margin:12px 0 4px">어떤 게 같이 움직이나 (월별 상관계수 r) ${Portal.tip('r')} <span class="hint">1에 가까울수록 같이 늘고 줄어듦 · 칸을 누르면 그래프가 그 조합으로 바뀜${pePerDay ? ' · 하루당 기준' : ''}</span></h4>
        <div class="tbl-wrap"><table class="t dc-corr"><tr><th></th>${FACS.map(f => `<th>${f[1].replace(/ \(.*\)/, '')}</th>`).join('')}</tr>` +
        PE_COMP.map(([k, n]) => `<tr><th>${n}</th>${FACS.map(([fk]) => { const c = r2(rows.map(r => cv(r, k)), rows.map(r => fv(r, fk)));
          return c ? `<td style="background:${bg(c.r)};cursor:pointer" title="${n} ↔ ${PE_FAC.find(x => x[0] === fk)[1]} · ${c.n}개월" onclick="peComp='${k}';peFac='${fk}';peStack=false;renderPerElec()"><b>${c.r.toFixed(2)}</b></td>` : '<td class="hint">-</td>'; }).join('')}</tr>`).join('') + '</table></div>';
      h += `<div class="hint" style="margin-top:4px">· ${PU.note} · 포장 생산량·작업시간은 생산 대시보드 일별 실적 합, 완제품 중량 = 포장 EA × 제품 1개 중량 (원인 찾기 → 생산 일별 요약과 비교 → 「제품 1개 중량」 표), 생산일수는 월간입력(생산팀 값)·없으면 보일러 가스로 추정 · 달이 적을 때(4~6개월) r은 참고만 하세요.</div>`;

      // 표
      h += `<div class="tbl-wrap" style="margin-top:8px"><table class="t"><tr><th>월</th>${PE_COMP.map(c => `<th>${c[1]}<br><span class="hint">${cu}</span></th>`).join('')}<th>${F[1]}<br><span class="hint">${fu}</span></th>${RT_OK ? `<th>${C[1]} ÷ ${F[1].replace(/ \(.*\)/, '')}<br><span class="hint">${rtU}</span></th>` : ''}${F[0] === 'pkg' ? '<th>완제품 ÷ 원육<br><span class="hint">수율</span></th>' : ''}</tr>` +
        rows.slice().reverse().map(r => `<tr><td>${r.ym.slice(2).replace('-', '.')}</td>${PE_COMP.map(([k]) => `<td>${cv(r, k) === null ? '<span class="hint">-</span>' : f0(cv(r, k))}</td>`).join('')}<td><b>${fmtF(fv(r, F[0]), F[0])}</b></td>${RT_OK ? `<td>${rtFmt(rt(r, peComp))}</td>` : ''}${F[0] === 'pkg' ? `<td>${r.f.pkg && r.f.prod ? nf1.format(r.f.pkg / r.f.prod * 100) + '%' : '-'}</td>` : ''}</tr>`).join('') + '</table></div>';
      el.innerHTML = h;
      const labels = rows.map(r => r.ym.slice(2).replace('-', '.'));
      const bars = peStack ? PE_COMP.filter(c => PU.stack.includes(c[0])).map(([k, n, col]) => ({ type: 'bar', label: n, data: rows.map(r => cv(r, k)), backgroundColor: col + 'cc', stack: 's', yAxisID: 'y', order: 2 }))
        : [{ type: 'bar', label: C[1] + ' ' + cu, data: rows.map(r => cv(r, peComp)), backgroundColor: C[2] + 'bb', yAxisID: 'y', order: 2 }];
      const showRt = RT_OK && peRatio && !peStack;
      const rtDs = showRt ? [{ type: 'line', label: `원단위 ${C[1]} ÷ ${F[1].replace(/ \(.*\)/, '')} (${rtU})`, data: rows.map(r => rt(r, peComp)), borderColor: '#6a3d9a', backgroundColor: '#6a3d9a', borderWidth: 2, borderDash: [6, 3], pointRadius: 3, pointStyle: 'rectRot', yAxisID: 'y3', order: 0, spanGaps: true }] : [];
      mkChart('chart-pe', { data: { labels, datasets: [...bars, { type: 'line', label: F[1] + ' ' + fu, data: rows.map(r => fv(r, F[0])), borderColor: '#e0482b', backgroundColor: '#e0482b', borderWidth: 2, pointRadius: 3, yAxisID: 'y2', order: 1, spanGaps: true }, ...rtDs] },
        options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: peStack }, y: { stacked: peStack, beginAtZero: true, title: { display: true, text: cu } }, y2: { position: 'right', beginAtZero: F[0] !== 'tmean', grid: { drawOnChartArea: false }, title: { display: true, text: fu } },
            y3: { display: showRt, position: 'right', beginAtZero: false, grace: '10%', grid: { drawOnChartArea: false }, title: { display: true, text: '원단위 ' + rtU, color: '#6a3d9a' }, ticks: { color: '#6a3d9a' } } } } });
    }
