// =====================================================================
// 유틸리티 요금·사용량 계산 (엑셀 "유틸리티 비용 상세" 파일과 같은 계산식)
// =====================================================================
(function (root) {
  const UT = {};

  // ---------------- 입력 항목 정의 ----------------
  // carry: 값이 없으면 이전 달 값을 그대로 씀 (단가·계수처럼 자주 안 바뀌는 값)
  UT.FIELDS = [
    { g: '원육 투입', k: 'production_kg', label: '원육 투입량', unit: 'kg' },
    { g: '원육 투입', k: 'prod_days', label: '생산일수', unit: '일', hint: '[생산팀 실적 가져오기]로 채우기 · 비우면 보일러 가스를 하루 50㎥ 넘게 쓴 날로 추정' },

    { g: '전기', k: 'elec_kwh_light', label: '경부하 사용량', unit: 'kWh', hint: '비우면 일별 사용량 × 전월 비율로 추정' },
    { g: '전기', k: 'elec_kwh_mid', label: '중간부하 사용량', unit: 'kWh' },
    { g: '전기', k: 'elec_kwh_peak', label: '최대부하 사용량', unit: 'kWh' },
    { g: '전기', k: 'elec_max_kw', label: '최대 전력', unit: 'kW', hint: '비우면 일별 최대수요 중 최댓값' },
    { g: '전기', k: 'elec_contract_kw', label: '요금적용 전력', unit: 'kW', hint: '비우면 max(전월 요금적용전력, 이번 달 최대전력)' },
    { g: '전기', k: 'elec_pf', label: '지상역률', unit: '', hint: '예: 0.93' },
    { g: '전기', k: 'elec_pf_lead', label: '진상역률', unit: '', carry: true },
    { g: '전기', k: 'elec_late_fee', label: '연체료', unit: '원' },
    { g: '전기', k: 'elec_settlement', label: '정산 요금', unit: '원', hint: '고지서에 있을 때만 (차감은 − 로)' },
    { g: '전기', k: 'elec_ww_kwh', label: '폐수동 전력량', unit: 'kWh', hint: '비우면 설비검침 폐수전력 지침 (다음달 1일 − 이달 1일) × 배율' },
    { g: '전기', k: 'elec_ww_ct', label: '폐수동 계량기 배율', unit: '배', carry: true, def: 40 },
    { g: '전기', k: 'elec_hvac_kwh', label: '공조냉동 전력량', unit: 'kWh', hint: '비우면 설비검침 냉동·냉장·공조 12개 계량기 합 (다음달 1일 − 이달 1일)' },

    { g: '전기 단가', k: 'elec_season', label: '계절', unit: '', carry: true, text: true },
    { g: '전기 단가', k: 'elec_base_rate', label: '기본요금 단가', unit: '원/kW', carry: true },
    { g: '전기 단가', k: 'elec_rate_light', label: '경부하 단가', unit: '원/kWh', carry: true },
    { g: '전기 단가', k: 'elec_rate_mid', label: '중간부하 단가', unit: '원/kWh', carry: true },
    { g: '전기 단가', k: 'elec_rate_peak', label: '최대부하 단가', unit: '원/kWh', carry: true },
    { g: '전기 단가', k: 'elec_climate_rate', label: '기후환경요금 단가', unit: '원/kWh', carry: true, def: 9 },
    { g: '전기 단가', k: 'elec_fuel_rate', label: '연료비조정 단가', unit: '원/kWh', carry: true, def: 5 },

    { g: '전기 주말 할인', k: 'elec_wkd_kwh_light', label: '주말 경부하 할인 사용량', unit: 'kWh', hint: '고지서/파워플래너 값 (해당 계절만)' },
    { g: '전기 주말 할인', k: 'elec_wkd_kwh_mid', label: '주말 중간부하 할인 사용량', unit: 'kWh' },
    { g: '전기 주말 할인', k: 'elec_wkd_rate_light', label: '주말 경부하 할인 단가', unit: '원/kWh', carry: true },
    { g: '전기 주말 할인', k: 'elec_wkd_rate_mid', label: '주말 중간부하 할인 단가', unit: '원/kWh', carry: true },

    { g: '전기 (요금 바뀐 달만)', k: 'elec_kwh_light2', label: '경부하 사용량 (변경 후)', unit: 'kWh' },
    { g: '전기 (요금 바뀐 달만)', k: 'elec_kwh_mid2', label: '중간부하 사용량 (변경 후)', unit: 'kWh' },
    { g: '전기 (요금 바뀐 달만)', k: 'elec_kwh_peak2', label: '최대부하 사용량 (변경 후)', unit: 'kWh' },
    { g: '전기 (요금 바뀐 달만)', k: 'elec_rate_light2', label: '경부하 단가 (변경 후)', unit: '원/kWh' },
    { g: '전기 (요금 바뀐 달만)', k: 'elec_rate_mid2', label: '중간부하 단가 (변경 후)', unit: '원/kWh' },
    { g: '전기 (요금 바뀐 달만)', k: 'elec_rate_peak2', label: '최대부하 단가 (변경 후)', unit: '원/kWh' },

    { g: '가스', k: 'gas_boiler_cur', label: '보일러 당월지침', unit: '㎥', hint: '비우면 말일 자체검침값' },
    { g: '가스', k: 'gas_boiler_prev', label: '보일러 전월지침', unit: '㎥', hint: '비우면 전월 당월지침' },
    { g: '가스', k: 'gas_rest_cur', label: '식당 당월지침', unit: '㎥', hint: '비우면 말일 자체검침값' },
    { g: '가스', k: 'gas_rest_prev', label: '식당 전월지침', unit: '㎥', hint: '비우면 전월 당월지침' },
    { g: '가스', k: 'gas_heat', label: '열량계수 (보일러)', unit: 'MJ/㎥', carry: true },
    { g: '가스', k: 'gas_rest_heat', label: '열량계수 (식당)', unit: 'MJ/㎥', carry: true },
    { g: '가스', k: 'gas_price', label: '단가', unit: '원/MJ', carry: true },
    { g: '가스', k: 'gas_boiler_corr', label: '보정계수 (보일러)', unit: '', carry: true, def: 1 },
    { g: '가스', k: 'gas_rest_corr', label: '보정계수 (식당)', unit: '', carry: true, def: 0.992 },
    { g: '가스', k: 'gas_corrector_fee', label: '보정기교체비 (보일러)', unit: '원' },
    { g: '가스', k: 'gas_rest_corrector_fee', label: '보정기교체비 (식당)', unit: '원' },

    { g: '용수', k: 'w_combined', label: '고지서 방식', unit: '', carry: true, text: true, options: ['따로', '합산'], def: '따로', hint: '합산 = 40A 고지서에 50A 사용량까지 포함 (50A는 구경별 요금만)' },
    { g: '용수', k: 'w40_usage', label: '40A 고지서 사용량', unit: '㎥', hint: '비우면 11일 지침 − 전월 11일 지침' },
    { g: '용수', k: 'w50_usage', label: '50A 고지서 사용량', unit: '㎥', hint: '비우면 11일 지침 − 전월 11일 지침' },
    { g: '용수 단가', k: 'w40_base_fee', label: '40A 구경별 요금', unit: '원', carry: true, def: 9000 },
    { g: '용수 단가', k: 'w50_base_fee', label: '50A 구경별 요금', unit: '원', carry: true, def: 15000 },
    { g: '용수 단가', k: 'w_rate1', label: '1~50㎥ 단가', unit: '원/㎥', carry: true },
    { g: '용수 단가', k: 'w_rate2', label: '51~100㎥ 단가', unit: '원/㎥', carry: true },
    { g: '용수 단가', k: 'w_rate3', label: '101~300㎥ 단가', unit: '원/㎥', carry: true },
    { g: '용수 단가', k: 'w_rate4', label: '301~1000㎥ 단가', unit: '원/㎥', carry: true },
    { g: '용수 단가', k: 'w_rate5', label: '1001㎥~ 단가', unit: '원/㎥', carry: true },
    { g: '용수 단가', k: 'w_use_rate', label: '물이용부담금 단가', unit: '원/㎥', carry: true },

    { g: '폐수', k: 'ww_flow', label: '2공장 폐수 발생량', unit: '㎥', hint: '비우면 말일 유량계 지침 − 전월 말일 지침' },
    { g: '폐수', k: 'ww_sewage', label: '2공장 오수량', unit: '㎥', hint: '고지서 값' },
    { g: '폐수', k: 'ww_facility_fee', label: '시설사용료 (기타사용료)', unit: '원', hint: '고지서 오면 입력 → 확정' },
    { g: '폐수', k: 'ww_improve_fee', label: '개선부담금', unit: '원', hint: '고지서 오면 입력 → 확정' },
    { g: '폐수', k: 'ww_outsource_fee', label: '위탁처리비', unit: '원' },
    { g: '폐수', k: 'ww_sludge_fee', label: '슬러지처리비', unit: '원' },
    { g: '폐수', k: 'cluster_water_reading', label: '클러스터 상수도 검침값', unit: '㎥', hint: '폐수 담당자가 보내주는 값' },
    { g: '폐수', k: 'cluster_ww_reading', label: '클러스터 폐수 검침값', unit: '㎥', hint: '폐수 담당자가 보내주는 값' },

    { g: '고지서 실제 금액', k: 'elec_bill_total', label: '전기 청구액 (부가세 포함)', unit: '원', hint: '입력하면 확정' },
    { g: '고지서 실제 금액', k: 'elec_bill_exvat', label: '전기 부가세 별도 금액', unit: '원' },
    { g: '고지서 실제 금액', k: 'gas_bill_total', label: '가스 청구액 (부가세 포함)', unit: '원', hint: '입력하면 확정' },
    { g: '고지서 실제 금액', k: 'gas_bill_exvat', label: '가스 공급가액', unit: '원' },
    { g: '고지서 실제 금액', k: 'w40_bill', label: '용수 40A 청구액', unit: '원', hint: '입력하면 확정' },
    { g: '고지서 실제 금액', k: 'w50_bill', label: '용수 50A 청구액', unit: '원', hint: '입력하면 확정' },

    { g: '계획(목표)', k: 'plan_elec_cost', label: '전기 비용 목표', unit: '원' },
    { g: '계획(목표)', k: 'plan_elec_usage', label: '전기 사용량 목표', unit: 'kWh' },
    { g: '계획(목표)', k: 'plan_gas_cost', label: '가스 비용 목표', unit: '원' },
    { g: '계획(목표)', k: 'plan_gas_usage', label: '가스 사용량 목표', unit: 'MJ' },
    { g: '계획(목표)', k: 'plan_water_cost', label: '용수 비용 목표', unit: '원' },
    { g: '계획(목표)', k: 'plan_water_usage', label: '용수 사용량 목표', unit: '㎥' },
    { g: '계획(목표)', k: 'plan_ww_cost', label: '폐수 비용 목표', unit: '원' },
    { g: '계획(목표)', k: 'plan_ww_usage', label: '폐수 발생량 목표', unit: '㎥' }
  ];
  UT.FIELD = Object.fromEntries(UT.FIELDS.map(f => [f.k, f]));

  UT.UTILS = [
    { k: 'elec', name: '전기', unit: 'kWh', color: '#2a78d6' },
    { k: 'gas', name: '가스', unit: 'MJ', color: '#eb6834' },
    { k: 'water', name: '용수', unit: '㎥', color: '#1baf7a' },
    { k: 'ww', name: '폐수', unit: '㎥', color: '#eda100' }
  ];

  // ---------------- 날짜 도우미 ----------------
  const pad2 = n => String(n).padStart(2, '0');
  UT.ym = (y, m) => `${y}-${pad2(m)}`;
  UT.prevYm = ym => { let [y, m] = ym.split('-').map(Number); m--; if (!m) { m = 12; y--; } return UT.ym(y, m); };
  UT.nextYm = ym => { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return UT.ym(y, m); };
  UT.daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  UT.dateStr = (ym, d) => `${ym}-${pad2(d)}`;

  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  const has = v => num(v) !== null;
  const trunc10 = x => Math.trunc(x / 10) * 10;            // ROUNDDOWN(x,-1)
  const rd4 = x => Math.floor(x * 10000 + 1e-7) / 10000;   // ROUNDDOWN(x,4)

  // 일별 검침: 그 날짜(포함) 이전의 가장 가까운 지침 (최대 7일 전까지)
  UT.readingOnOrBefore = (daily, dateStr, key, maxBack = 7) => {
    const d0 = new Date(dateStr + 'T00:00:00');
    for (let i = 0; i <= maxBack; i++) {
      const d = new Date(d0); d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const r = daily[k];
      if (r && has(r[key]) && Number(r[key]) > 0) return Number(r[key]);
    }
    return null;
  };

  // 계속 도는 설비 계량기의 '그 날 08시 지침' — 그 날 값이 없으면 앞뒤 실제 검침값 사이를 날짜 비율로 나눔(보간)
  //  휴일에 복사해 넣은 값(같은 값이 이어짐)은 마지막 날 하나만 실제 검침으로 봄
  //  반환: { v, exact, from, to, gap }
  UT.readingInterp = (daily, ds, key, win = 40) => {
    const pts = [];
    for (let i = -win; i <= win; i++) { const d = addDays(ds, i), r = daily[d]; if (r && has(r[key]) && Number(r[key]) > 0) pts.push([d, Number(r[key])]); }
    const real = pts.filter((p, i) => !(pts[i + 1] && pts[i + 1][1] === p[1])); // 같은 값이 이어지면 마지막 날만
    const ex = real.find(p => p[0] === ds); if (ex) return { v: ex[1], exact: true };
    const before = real.filter(p => p[0] < ds).pop(), after = real.find(p => p[0] > ds);
    if (!before || !after) return before ? { v: before[1], exact: false, from: before[0], to: null } : null;
    const dd = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
    const gap = dd(before[0], after[0]), k = dd(before[0], ds) / gap;
    return { v: before[1] + (after[1] - before[1]) * k, exact: false, from: before[0], to: after[0], gap };
  };

  // 한 달 일별 집계 (사용량 = 다음날 지침 − 당일 지침)
  UT.dailyStats = (daily, ym) => {
    const n = UT.daysIn(ym);
    const out = { elec_kwh: 0, elec_peak: null, elec_days: 0 };
    for (let d = 1; d <= n; d++) {
      const r = daily[UT.dateStr(ym, d)];
      if (!r) continue;
      if (has(r.elec_kwh)) { out.elec_kwh += Number(r.elec_kwh); out.elec_days++; }
      if (has(r.elec_peak_kw)) out.elec_peak = Math.max(out.elec_peak ?? 0, Number(r.elec_peak_kw));
    }
    for (const key of ['gas_boiler', 'gas_rest', 'water_40a', 'water_50a', 'wastewater']) {
      const first = UT.readingOnOrBefore(daily, UT.dateStr(ym, 1), key, 0);
      const next = UT.readingOnOrBefore(daily, UT.dateStr(UT.nextYm(ym), 1), key, 0);
      out[key] = (first !== null && next !== null) ? next - first : null;
    }
    return out;
  };

  // ---------------- 실제 계산에 쓸 입력값 정리 (빈 칸 → 이전 달 값 / 일별 검침값) ----------------
  // monthly: { 'YYYY-MM': {..입력..} }, daily: { 'YYYY-MM-DD': {..검침..} }
  UT.effective = (ym, monthly, daily, _cache = {}) => {
    if (_cache[ym]) return _cache[ym];
    const raw = monthly[ym] || {};
    const m = { ...raw };
    const src = {}; // 값이 어디서 왔는지 (입력/전월/자동)
    Object.keys(raw).forEach(k => { if (raw[k] !== null && raw[k] !== '') src[k] = '입력'; });

    // 이전 달 값 이어받기 (최대 24개월 전까지)
    UT.FIELDS.filter(f => f.carry).forEach(f => {
      if (m[f.k] !== undefined && m[f.k] !== null && m[f.k] !== '') return;
      let p = ym;
      for (let i = 0; i < 24; i++) {
        p = UT.prevYm(p);
        const pv = (monthly[p] || {})[f.k];
        if (pv !== undefined && pv !== null && pv !== '') { m[f.k] = pv; src[f.k] = '전월'; return; }
      }
      if (f.def !== undefined) { m[f.k] = f.def; src[f.k] = '기본값'; }
    });

    const n = UT.daysIn(ym);
    const lastDay = UT.dateStr(ym, n);
    const prevYm = UT.prevYm(ym);
    const prevLast = UT.dateStr(prevYm, UT.daysIn(prevYm));
    const auto = (k, v) => { if (raw._imported) return; if (!has(m[k]) && v !== null && v !== undefined && !isNaN(v)) { m[k] = v; src[k] = '자동'; } };

    // 가스 지침
    auto('gas_boiler_cur', UT.readingOnOrBefore(daily, lastDay, 'gas_boiler'));
    auto('gas_rest_cur', UT.readingOnOrBefore(daily, lastDay, 'gas_rest'));
    const hasPrevData = Object.keys(monthly).some(k => k < ym) || Object.keys(daily).some(k => k < ym + '-01');
    if (!has(m.gas_boiler_prev) || !has(m.gas_rest_prev)) {
      const pe = hasPrevData ? UT.effective(prevYm, monthly, daily, _cache) : {};
      auto('gas_boiler_prev', num(pe.gas_boiler_cur));
      auto('gas_rest_prev', num(pe.gas_rest_cur));
    }
    // 용수: 11일 지침 차이
    const r11 = key => {
      const a = UT.readingOnOrBefore(daily, UT.dateStr(ym, 11), key, 3);
      const b = UT.readingOnOrBefore(daily, UT.dateStr(prevYm, 11), key, 3);
      return (a !== null && b !== null) ? Math.max(0, a - b) : null;
    };
    if (m.w_combined === '합산') {
      const a = r11('water_40a'), b = r11('water_50a');
      if (a !== null || b !== null) {
        auto('w40_usage', (a || 0) + (b || 0));
        auto('w50_usage', 0);
      }
    } else {
      auto('w40_usage', r11('water_40a'));
      auto('w50_usage', r11('water_50a'));
    }
    // 폐수: 말일 지침 차이
    {
      const a = UT.readingOnOrBefore(daily, lastDay, 'wastewater');
      const b = UT.readingOnOrBefore(daily, prevLast, 'wastewater');
      auto('ww_flow', (a !== null && b !== null) ? Math.round((a - b) * 100) / 100 : null);
    }
    // 전기
    const ds = UT.dailyStats(daily, ym);
    m._daily = ds;
    auto('elec_max_kw', ds.elec_peak);
    if (!has(m.elec_contract_kw)) {
      const pe = hasPrevData ? UT.effective(prevYm, monthly, daily, _cache) : {};
      const cand = [num(pe.elec_contract_kw), has(m.elec_max_kw) ? Math.round(Number(m.elec_max_kw)) : null].filter(v => v !== null);
      if (cand.length) auto('elec_contract_kw', Math.max(...cand));
    }
    if (!has(m.elec_kwh_light) && !has(m.elec_kwh_mid) && !has(m.elec_kwh_peak) && ds.elec_kwh > 0) {
      // 시간대별 사용량이 없으면 일별 합계를 전월 비율로 나눔
      const pr = monthly[prevYm] || {};
      let l = num(pr.elec_kwh_light), md = num(pr.elec_kwh_mid), p = num(pr.elec_kwh_peak);
      if (!(l && md && p)) { l = 0.35; md = 0.4; p = 0.25; }
      const t = l + md + p;
      auto('elec_kwh_light', Math.round(ds.elec_kwh * l / t * 100) / 100);
      auto('elec_kwh_mid', Math.round(ds.elec_kwh * md / t * 100) / 100);
      auto('elec_kwh_peak', Math.round(ds.elec_kwh * p / t * 100) / 100);
    }
    // 폐수동·공조냉동 전력: 설비점검일지 지침 (다음달 1일 − 이달 1일, 1일 값이 없으면 그 전 가장 가까운 날)
    {
      const d1 = UT.dateStr(ym, 1), n1 = UT.dateStr(UT.nextYm(ym), 1);
      const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
      const notes = [];
      const diff = key => {
        const a = UT.readingInterp(daily, n1, key), b = UT.readingInterp(daily, d1, key);
        if (!a || !b || a.v < b.v) return null;
        [[d1, b], [n1, a]].forEach(([d, r]) => { if (!r.exact) notes.push(r.to ? `${md(d)} 지침은 ${md(r.from)}·${md(r.to)} 검침값 사이를 날짜 비율로 나눠 추정${r.gap > 7 ? ` (검침 간격 ${r.gap}일 — 정확도 낮음)` : ''}` : `${md(d)} 이후 검침값이 없어 ${md(r.from)} 값 사용`); });
        return a.v - b.v;
      };
      m._note = m._note || {};
      const w = diff('ww_power');
      auto('elec_ww_kwh', w === null ? null : Math.round(w * (num(m.elec_ww_ct) || 40) * 10) / 10);
      if (!has(raw.elec_ww_kwh) && notes.length) m._note.elec_ww_kwh = notes.splice(0).join(' / ');
      notes.length = 0;
      const h = diff('hvac_power');
      auto('elec_hvac_kwh', h === null ? null : Math.round(h * 10) / 10);
      if (!has(raw.elec_hvac_kwh) && notes.length) m._note.elec_hvac_kwh = notes.join(' / ');
    }
    m._src = src;
    _cache[ym] = m;
    return m;
  };

  // ---------------- 전기 ----------------
  UT.calcElec = m => {
    const v = k => num(m[k]) || 0;
    const kwh = v('elec_kwh_light') + v('elec_kwh_mid') + v('elec_kwh_peak') + v('elec_kwh_light2') + v('elec_kwh_mid2') + v('elec_kwh_peak2');
    if (!kwh) return null;
    const base = v('elec_base_rate') * v('elec_contract_kw');
    const energy =
      Math.floor(v('elec_kwh_light') * v('elec_rate_light') + v('elec_kwh_light2') * v('elec_rate_light2')) +
      Math.floor(v('elec_kwh_mid') * v('elec_rate_mid') + v('elec_kwh_mid2') * v('elec_rate_mid2')) +
      Math.floor(v('elec_kwh_peak') * v('elec_rate_peak') + v('elec_kwh_peak2') * v('elec_rate_peak2')) -
      Math.floor(v('elec_wkd_kwh_light') * v('elec_wkd_rate_light')) - Math.floor(v('elec_wkd_kwh_mid') * v('elec_wkd_rate_mid')); // 고지서: 기본·할인 금액을 각각 원 미만 절사
    const climate = kwh * (has(m.elec_climate_rate) ? Number(m.elec_climate_rate) : 9);
    const fuel = kwh * (has(m.elec_fuel_rate) ? Number(m.elec_fuel_rate) : 5);
    let pfFee = 0;
    if (has(m.elec_pf)) {
      const pf = Number(m.elec_pf);
      const rate = pf < 0.92 ? Math.min(0.92 - pf, 0.32) : (pf > 0.92 ? -Math.min(pf - 0.92, 5) : 0);
      pfFee = Math.trunc(base * rate * 0.2);
    }
    let leadFee = 0;
    if (has(m.elec_pf_lead)) {
      const lp = Number(m.elec_pf_lead);
      leadFee = Math.trunc(energy * (lp < 0.95 ? 0.95 - lp : 0) * 0.2);
    }
    const subtotal = base + energy + climate + fuel + pfFee + leadFee + v('elec_settlement');
    const vat = Math.round(subtotal * 0.1);
    const fund = trunc10(subtotal * 0.027);
    const late = v('elec_late_fee');
    const total = Math.floor((subtotal + vat + late + fund) / 10) * 10;
    const exvat = subtotal + late + fund;
    return { kwh, base, energy, climate, fuel, pfFee, leadFee, settlement: v('elec_settlement'), subtotal, vat, fund, late, total, exvat };
  };

  // ---------------- 가스 ----------------
  UT.calcGas = m => {
    const one = (cur, prev, corr, heat, fee) => {
      if (!has(cur) || !has(prev)) return null;
      const m3 = (Number(cur) - Number(prev)) * (has(corr) ? Number(corr) : 1);
      const mj = rd4(m3 * (num(heat) || 0));
      const cost = Math.floor(mj * (num(m.gas_price) || 0));
      const f = num(fee) || 0;
      const vat = Math.floor((cost + f) * 0.1);
      return { m3, mj, cost, fee: f, vat, total: cost + vat + f };
    };
    const b = one(m.gas_boiler_cur, m.gas_boiler_prev, m.gas_boiler_corr, m.gas_heat, m.gas_corrector_fee);
    const r = one(m.gas_rest_cur, m.gas_rest_prev, m.gas_rest_corr, has(m.gas_rest_heat) ? m.gas_rest_heat : m.gas_heat, m.gas_rest_corrector_fee);
    if (!b && !r) return null;
    const z = { m3: 0, mj: 0, cost: 0, fee: 0, vat: 0, total: 0 };
    const B = b || z, R = r || z;
    return {
      boiler: b, rest: r,
      m3: B.m3 + R.m3, mj: B.mj + R.mj,
      total: Math.floor((B.total + R.total) / 10) * 10,
      exvat: B.cost + B.fee + R.cost + R.fee
    };
  };

  // ---------------- 용수 (계량기 1개) ----------------
  UT.calcWaterMeter = (usage, baseFee, m) => {
    if (!has(usage)) return null;
    const u = Number(usage);
    const t1 = u > 50 ? 50 : u;
    const t2 = u > 100 ? 50 : Math.max(0, u - t1);
    const t3 = u > 300 ? 200 : Math.max(0, u - t1 - t2);
    const t4 = u > 1000 ? 700 : Math.max(0, u - t1 - t2 - t3);
    const t5 = Math.max(0, u - t1 - t2 - t3 - t4);
    const r = k => num(m[k]) || 0;
    const useFee = t1 * r('w_rate1') + t2 * r('w_rate2') + t3 * r('w_rate3') + t4 * r('w_rate4') + t5 * r('w_rate5');
    const reduce = Math.max(-5000, -trunc10(useFee / 100));
    const waterUse = u * r('w_use_rate');
    const reduce2 = -trunc10(waterUse / 100);
    const total = useFee + reduce + (num(baseFee) || 0) + waterUse + reduce2;
    return { usage: u, useFee, reduce, baseFee: num(baseFee) || 0, waterUse, reduce2, total };
  };

  // ---------------- 한 달 요약 ----------------
  // 반환: { elec:{usage,cost,exvat,status,calc,...}, gas, water, ww, total, exvat, production }
  UT.summary = (ym, monthly, daily, cache = {}) => {
    const m = UT.effective(ym, monthly, daily, cache);
    const raw = monthly[ym] || {};
    const out = { ym, m, production: num(m.production_kg) };

    // 전기
    const e = UT.calcElec(m);
    const eBill = num(raw.elec_bill_total);
    out.elec = {
      usage: e ? e.kwh : (m._daily.elec_kwh || null),
      calc: e,
      cost: eBill ?? (e ? e.total : null),
      exvat: has(raw.elec_bill_exvat) ? Number(raw.elec_bill_exvat) : (eBill !== null && e ? Math.round(eBill * e.exvat / e.total) : (e ? e.exvat : null)),
      status: eBill !== null ? '확정' : (e ? '가마감' : null),
      maxKw: num(m.elec_max_kw)
    };
    // 가스
    const g = UT.calcGas(m);
    const gBill = num(raw.gas_bill_total);
    out.gas = {
      usage: g ? g.mj : null, m3: g ? g.m3 : null,
      calc: g,
      cost: gBill ?? (g ? g.total : null),
      exvat: has(raw.gas_bill_exvat) ? Number(raw.gas_bill_exvat) : (gBill !== null && g ? Math.round(gBill / 1.1) : (g ? g.exvat : null)),
      status: gBill !== null ? '확정' : (g ? '가마감' : null)
    };
    // 용수 (40A + 50A, 부가세 없음)
    const w4 = UT.calcWaterMeter(m.w40_usage, m.w40_base_fee, m);
    const w5 = UT.calcWaterMeter(m.w50_usage, m.w50_base_fee, m);
    const w4c = has(raw.w40_bill) ? Number(raw.w40_bill) : (w4 ? w4.total : null);
    const w5c = has(raw.w50_bill) ? Number(raw.w50_bill) : (w5 ? w5.total : null);
    const wConfirmed = has(raw.w40_bill) || has(raw.w50_bill);
    out.water = {
      usage: (w4 || w5) ? (w4 ? w4.usage : 0) + (w5 ? w5.usage : 0) : null,
      w40: w4, w50: w5, w40cost: w4c, w50cost: w5c,
      cost: (w4c === null && w5c === null) ? null : (w4c || 0) + (w5c || 0),
      status: wConfirmed ? '확정' : ((w4 || w5) ? '가마감' : null)
    };
    out.water.exvat = out.water.cost;
    // 폐수 (부가세 없음)
    const flow = num(m.ww_flow), sew = num(m.ww_sewage);
    const wwM3 = (flow === null && sew === null) ? null : (flow || 0) + (sew || 0);
    const fees = has(raw.ww_facility_fee) || has(raw.ww_improve_fee);
    let wwCost = null, wwStatus = null;
    if (fees) { wwCost = (num(raw.ww_facility_fee) || 0) + (num(raw.ww_improve_fee) || 0); wwStatus = '확정'; }
    else if (wwM3) {
      // 고지서 전: 발생량 × 전월 실행단가
      const p = UT.summary(UT.prevYm(ym), monthly, daily, cache);
      if (p.ww && p.ww.cost && p.ww.usage) { wwCost = wwM3 * (p.ww.cost / p.ww.usage); wwStatus = '가마감'; }
    }
    out.ww = { usage: wwM3, flow, sewage: sew, cost: wwCost, exvat: wwCost, status: wwStatus,
      outsource: num(m.ww_outsource_fee), sludge: num(m.ww_sludge_fee) };

    const parts = UT.UTILS.map(u => out[u.k]);
    out.total = parts.some(p => p.cost !== null) ? parts.reduce((s, p) => s + (p.cost || 0), 0) : null;
    out.exvat = parts.some(p => p.exvat !== null) ? parts.reduce((s, p) => s + (p.exvat || 0), 0) : null;
    const withData = parts.filter(p => p.status);
    out.status = !withData.length ? null : (withData.every(p => p.status === '확정') ? '확정' : '가마감');
    // 이산화탄소 (전기 0.4594 tCO2/MWh, 가스 38.9 MJ/N㎥ × 15.31 tC/TJ × 44/12)
    out.co2 = {
      elec: out.elec.usage ? out.elec.usage * (num(m.co2_elec) || 0.4594) / 1000 : null,
      gas: out.gas.m3 ? out.gas.m3 * 38.9 * 15.31 / 1e6 * 44 / 12 : null
    };
    return out;
  };

  // =====================================================================
  // 일별 사용량 (이상 감지·원인 분석용) — 그날 사용량 = 다음날 지침 − 그날 지침
  // =====================================================================
  const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  UT.addDays = addDays;
  const diffReading = (daily, ds, keys) => {
    const a = daily[ds], b = daily[addDays(ds, 1)];
    if (!a || !b) return null;
    let s = 0;
    for (const k of keys) { if (!has(a[k]) || !has(b[k])) return null; s += Number(b[k]) - Number(a[k]); }
    return Math.round(s * 1000) / 1000;
  };
  UT.DAILY_UTILS = [
    { k: 'elec', name: '전기', unit: 'kWh', color: '#2a78d6', minAbs: 300 },
    { k: 'gas', name: '가스', unit: '㎥', color: '#eb6834', minAbs: 40 },
    { k: 'water', name: '용수', unit: '㎥', color: '#1baf7a', minAbs: 5 },
    { k: 'ww', name: '폐수', unit: '㎥', color: '#eda100', minAbs: 5 }
  ];
  UT.dailyUsage = (daily, ds) => {
    const r = daily[ds] || {};
    return {
      elec: has(r.elec_kwh) ? Number(r.elec_kwh) : null,
      gas: diffReading(daily, ds, ['gas_boiler', 'gas_rest']) ?? diffReading(daily, ds, ['gas_boiler']),
      water: diffReading(daily, ds, ['water_40a', 'water_50a']),
      ww: diffReading(daily, ds, ['wastewater'])
    };
  };
  const median = arr => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const isWeekend = ds => { const w = new Date(ds + 'T00:00:00').getDay(); return w === 0 || w === 6; };
  UT.isWeekend = isWeekend;

  // 가동일 판단: 그날 전기 사용량이 최근 평일 중앙값의 60% 이상이면 '가동일' (주말 특근·평일 휴무 반영), 전기값 없으면 달력 기준
  UT.isWorkDay = (daily, ds) => {
    const r = daily[ds];
    if (r && has(r.elec_kwh)) {
      const s = [];
      for (let i = 1; i <= 35 && s.length < 15; i++) { const d2 = addDays(ds, -i); const x = daily[d2]; if (!isWeekend(d2) && x && has(x.elec_kwh)) s.push(Number(x.elec_kwh)); }
      const m = median(s);
      if (m) return Number(r.elec_kwh) >= m * 0.6;
    }
    return !isWeekend(ds);
  };
  // 이상 사용: 같은 종류의 날(가동일/쉬는 날) 최근 4주 중앙값보다 40% 이상 + 최소량 이상 많으면 '과다', 음수면 '지침 오류'
  UT.anomalies = (daily, from, to, opt = {}) => {
    const ratio = opt.ratio || 1.4;
    const cu = {}, cw = {};
    const U = ds => (cu[ds] = cu[ds] || UT.dailyUsage(daily, ds));
    const W = ds => (ds in cw ? cw[ds] : (cw[ds] = UT.isWorkDay(daily, ds)));
    const out = [];
    for (let ds = from; ds <= to; ds = addDays(ds, 1)) {
      const cur = U(ds), wk = W(ds);
      UT.DAILY_UTILS.forEach(u => {
        const v = cur[u.k]; if (v === null) return;
        if (v < 0) { out.push({ d: ds, u: u.k, v, base: null, kind: '지침 오류', work: wk }); return; }
        const sample = [];
        for (let i = 1; i <= 28; i++) { const d2 = addDays(ds, -i); if (W(d2) !== wk) continue; const x = U(d2)[u.k]; if (x !== null && x >= 0) sample.push(x); }
        if (sample.length < 3) return;
        const base = median(sample);
        if (base > 0 ? (v > base * ratio && v - base >= u.minAbs) : v >= u.minAbs * 2) out.push({ d: ds, u: u.k, v, base, kind: '과다', work: wk, pct: base ? (v / base - 1) * 100 : null });
      });
    }
    return out;
  };
  UT.baseline = (daily, ds, uk) => {
    const wk = UT.isWorkDay(daily, ds), sample = [];
    for (let i = 1; i <= 28; i++) { const d2 = addDays(ds, -i); if (UT.isWorkDay(daily, d2) !== wk) continue; const x = UT.dailyUsage(daily, d2)[uk]; if (x !== null && x >= 0) sample.push(x); }
    return sample.length >= 3 ? median(sample) : null;
  };

  // 직선 맞추기 (원인 분석: 기울기·결정계수)
  UT.linreg = pts => {
    const n = pts.length; if (n < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    pts.forEach(([x, y]) => { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; });
    const den = n * sxx - sx * sx; if (!den) return null;
    const a = (n * sxy - sx * sy) / den, b = (sy - a * sx) / n;
    const r = (n * sxy - sx * sy) / Math.sqrt(den * (n * syy - sy * sy) || 1);
    return { a, b, r2: r * r };
  };

  // =====================================================================
  // 월말 예측: 이달 지금까지의 검침 추세로 월 전체 사용량 추정 → 같은 요금식으로 금액 계산
  // =====================================================================
  UT.monthComplete = (daily, ym) => !!(daily[UT.dateStr(UT.nextYm(ym), 1)] && has(daily[UT.dateStr(UT.nextYm(ym), 1)].gas_boiler));
  UT.forecast = (ym, monthly, daily, asOf) => {
    const n = UT.daysIn(ym), d1 = UT.dateStr(ym, 1), dEnd = UT.dateStr(ym, n);
    if (asOf < d1) return null;
    const lastObs = asOf > dEnd ? dEnd : asOf;
    // 전기: 평일·주말 평균 × 남은 날
    let wd = [], we = [], sum = 0, obs = 0;
    for (let d = 1; d <= n; d++) {
      const ds = UT.dateStr(ym, d); if (ds > lastObs) break;
      const r = daily[ds]; if (!r || !has(r.elec_kwh)) continue;
      const v = Number(r.elec_kwh); sum += v; obs++; (isWeekend(ds) ? we : wd).push(v);
    }
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const aWd = avg(wd) ?? avg(we), aWe = avg(we) ?? (aWd !== null ? aWd * 0.6 : null);
    let elec = null;
    if (obs) {
      elec = sum;
      for (let d = 1; d <= n; d++) { const ds = UT.dateStr(ym, d); const r = daily[ds]; if (r && has(r.elec_kwh) && ds <= lastObs) continue; elec += isWeekend(ds) ? aWe : aWd; }
    }
    // 지침 항목: (최근 지침 − 1일 지침) ÷ 지난 날수 × 월 날수
    const rate = key => {
      const a = UT.readingOnOrBefore(daily, d1, key, 3);
      let lastD = null, b = null;
      for (let ds = UT.dateStr(UT.nextYm(ym), 1); ds >= d1; ds = addDays(ds, -1)) { if (ds > addDays(lastObs, 1)) continue; const r = daily[ds]; if (r && has(r[key]) && Number(r[key]) > 0) { lastD = ds; b = Number(r[key]); break; } }
      if (a === null || b === null || lastD <= d1) return null;
      const days = (new Date(lastD + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / 864e5;
      return Math.max(0, (b - a) / days * n);
    };
    let seen = null; for (let ds = lastObs; ds >= d1; ds = addDays(ds, -1)) { if (daily[ds] && (has(daily[ds].elec_kwh) || has(daily[ds].gas_boiler))) { seen = ds; break; } }
    return { asOf: seen || lastObs, days: obs, n, elec_kwh: elec, gas_boiler: rate('gas_boiler'), gas_rest: rate('gas_rest'), w40: rate('water_40a'), w50: rate('water_50a'), ww: rate('wastewater') };
  };
  UT.forecastSummary = (ym, monthly, daily, asOf) => {
    const f = UT.forecast(ym, monthly, daily, asOf); if (!f) return null;
    const raw = { ...(monthly[ym] || {}) };
    const eff = UT.effective(ym, monthly, daily, {});
    const ov = {};
    const set = (k, v) => { if (v !== null && v !== undefined && !has(raw[k])) ov[k] = Math.round(v * 100) / 100; };
    if (f.elec_kwh && !has(raw.elec_kwh_light) && !has(raw.elec_kwh_mid) && !has(raw.elec_kwh_peak)) {
      const pr = monthly[UT.prevYm(ym)] || {};
      let l = num(pr.elec_kwh_light), md = num(pr.elec_kwh_mid), p = num(pr.elec_kwh_peak);
      if (!(l && md && p)) { l = 0.35; md = 0.4; p = 0.25; }
      const t = l + md + p;
      set('elec_kwh_light', f.elec_kwh * l / t); set('elec_kwh_mid', f.elec_kwh * md / t); set('elec_kwh_peak', f.elec_kwh * p / t);
    }
    if (f.gas_boiler !== null && has(eff.gas_boiler_prev)) set('gas_boiler_cur', Number(eff.gas_boiler_prev) + f.gas_boiler);
    if (f.gas_rest !== null && has(eff.gas_rest_prev)) set('gas_rest_cur', Number(eff.gas_rest_prev) + f.gas_rest);
    if (eff.w_combined === '합산') { if (f.w40 !== null || f.w50 !== null) { set('w40_usage', (f.w40 || 0) + (f.w50 || 0)); set('w50_usage', 0); } }
    else { set('w40_usage', f.w40); set('w50_usage', f.w50); }
    set('ww_flow', f.ww);
    const mon = { ...monthly, [ym]: { ...raw, ...ov } };
    const s = UT.summary(ym, mon, daily, {});
    s.forecast = f;
    // 고지서로 확정된 항목은 그대로, 나머지는 '예측'
    UT.UTILS.forEach(u => { if (s[u.k].status && s[u.k].status !== '확정') s[u.k].status = '예측'; });
    const st = UT.UTILS.map(u => s[u.k].status).filter(Boolean);
    s.status = st.length && st.every(x => x === '확정') ? '확정' : '예측';
    return s;
  };

  // =====================================================================
  // 기준선(예상 사용량) — 사용량 = a×날수 + b×생산량 (+ c×난방도일 / 냉방도일)
  // =====================================================================
  UT.HDD_BASE = 18; UT.CDD_BASE = 24;   // 평균기온 18℃ 아래는 난방, 24℃ 위는 냉방
  UT.MODEL_FEATS = { elec: ['days', 'op', 'prod', 'cdd'], gas: ['op', 'prod', 'hdd'], water: ['days', 'prod', 'hdd'], ww: ['days', 'prod', 'hdd'] };
  UT.FEAT_LABEL = { wx: '기온 영향(휴무일 실측)', days: '달력 하루당 기본', op: '생산일 1일당', prod: '원육 1kg당', hdd: '난방도일 1당', cdd: '냉방도일 1당' };
  // 그 달의 날수·난방도일·냉방도일 (temps: { 'YYYY-MM-DD': 평균기온 }) — 기온 빠진 날은 비율로 보정
  UT.monthWeather = (ym, temps) => {
    const n = UT.daysIn(ym); let hdd = 0, cdd = 0, cnt = 0, ts = 0;
    for (let d = 1; d <= n; d++) { const t = temps[UT.dateStr(ym, d)]; if (t === undefined || t === null) continue; cnt++; ts += t; hdd += Math.max(0, UT.HDD_BASE - t); cdd += Math.max(0, t - UT.CDD_BASE); }
    if (cnt < n * 0.6) return { days: n, hdd: null, cdd: null, tmean: null };
    return { days: n, hdd: hdd * n / cnt, cdd: cdd * n / cnt, tmean: ts / cnt };
  };
  // 그 달 생산일 수: 월간입력 '생산일수'가 있으면 그 값, 없으면 보일러 가스를 쓴 날(하루 50㎥ 넘게) — 가스 검침이 빠진 달은 전기로 판단
  UT.opDays = (daily, ym, monthly) => {
    const ov = monthly && monthly[ym] && monthly[ym].prod_days;
    if (ov !== undefined && ov !== null && ov !== '' && !isNaN(Number(ov))) return Number(ov);
    const n = UT.daysIn(ym); let g = 0, seen = 0, w = 0;
    for (let d = 1; d <= n; d++) { const ds = UT.dateStr(ym, d); const u = UT.dailyUsage(daily, ds); if (u.gas !== null) { seen++; if (u.gas > 50) g++; } if (UT.isWorkDay(daily, ds)) w++; }
    return seen >= n * 0.8 ? Math.round(g * n / seen) : w;
  };
  // 평일 수 (계획용 기본값)
  UT.weekdays = ym => { let c = 0; for (let d = 1; d <= UT.daysIn(ym); d++) if (!isWeekend(UT.dateStr(ym, d))) c++; return c; };
  // 평년값: 같은 달(1~12월)의 여러 해 평균
  UT.weatherNormals = temps => {
    const by = {};
    Object.keys(temps).forEach(ds => { const ym = ds.slice(0, 7); by[ym] = true; });
    const acc = {};
    Object.keys(by).forEach(ym => { const w = UT.monthWeather(ym, temps); if (w.hdd === null) return; const m = Number(ym.slice(5)); (acc[m] = acc[m] || []).push(w); });
    const out = {};
    for (let m = 1; m <= 12; m++) { const a = acc[m]; out[m] = a ? { hdd: a.reduce((s, w) => s + w.hdd, 0) / a.length, cdd: a.reduce((s, w) => s + w.cdd, 0) / a.length, tmean: a.reduce((s, w) => s + w.tmean, 0) / a.length, years: a.length } : null; }
    return out;
  };
  // 최소제곱 (작은 연립방정식)
  UT.ols = (X, y) => {
    const k = X[0].length, A = Array.from({ length: k }, () => Array(k + 1).fill(0));
    X.forEach((row, i) => { for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += row[a] * row[b]; A[a][k] += row[a] * y[i]; } });
    for (let c = 0; c < k; c++) {
      let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map((row, i) => row[k] / row[i]);
  };
  // rows: [{ ym, days, prod, hdd, cdd, y }]
  UT.fitBaseline = (rows, feats) => {
    const ok = rows.filter(r => r.y !== null && r.y !== undefined && feats.every(f => r[f] !== null && r[f] !== undefined));
    let use = feats;
    if (ok.length < feats.length + 2) use = feats.slice(0, 2);
    const ok2 = rows.filter(r => r.y !== null && r.y !== undefined && use.every(f => r[f] !== null && r[f] !== undefined));
    if (ok2.length < use.length + 1) return null;
    const coef = UT.ols(ok2.map(r => use.map(f => r[f])), ok2.map(r => r.y));
    if (!coef) return null;
    const pred = r => use.reduce((s, f, i) => s + coef[i] * r[f], 0);
    const ys = ok2.map(r => r.y), mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    const ssr = ok2.reduce((s, r) => s + (r.y - pred(r)) ** 2, 0), sst = ys.reduce((s, v) => s + (v - mean) ** 2, 0);
    const mape = ok2.reduce((s, r) => s + Math.abs(pred(r) - r.y) / (r.y || 1), 0) / ok2.length * 100;
    return { feats: use, coef, r2: sst ? 1 - ssr / sst : null, mape, n: ok2.length, predict: r => use.every(f => r[f] !== null && r[f] !== undefined) ? Math.max(0, pred(r)) : null };
  };

  // =====================================================================
  // 휴무일(생산 없는 날) 전기 기준선: 하루 전기 = 기본 + 더운 만큼 + 추운 만큼
  //   v = a + b×max(0, T−Tb) + c×max(0, Tc−T)   (T = 그날 평균기온)
  //   튀는 날(예상보다 ±20% 넘게 다른 날: 공사·특이사항 등)은 빼고 다시 계산
  // =====================================================================
  UT.fitIdleBase = pts => {
    pts = pts.filter(p => p.v > 0 && p.t !== null && p.t !== undefined && isFinite(p.t));
    if (pts.length < 10) return null;
    const fitWith = (Tb, Tc, useHeat, flat) => {
      const cols = p => flat ? [1] : useHeat ? [1, Math.max(0, p.t - Tb), Math.max(0, Tc - p.t)] : [1, Math.max(0, p.t - Tb)];
      let use = pts, coef = null;
      for (let it = 0; it < 3; it++) {
        coef = UT.ols(use.map(cols), use.map(p => p.v)); if (!coef) return null;
        const pr = p => cols(p).reduce((a, x, i) => a + x * coef[i], 0);
        const keep = pts.filter(p => Math.abs(p.v - pr(p)) <= 0.2 * pr(p));
        if (keep.length === use.length || keep.length < 8) break;
        use = keep;
      }
      if (coef.some((c, i) => i > 0 && c < 0)) return null;
      const pr = p => cols(p).reduce((a, x, i) => a + x * coef[i], 0);
      // 비교 기준: 모든 날의 오차 (튀는 날은 25%까지만 반영) — 날을 많이 빼서 오차가 작아 보이는 식을 고르지 않도록
      const err = pts.reduce((a, p) => a + Math.min(0.25, Math.abs(p.v - pr(p)) / p.v), 0) / pts.length;
      const mape = use.reduce((a, p) => a + Math.abs(p.v - pr(p)) / p.v, 0) / use.length;
      return { a: coef[0], b: flat ? 0 : coef[1], Tb, c: useHeat ? coef[2] : 0, Tc, err, mape, used: use, pr };
    };
    let best = fitWith(15, 0, false, true); // 기온과 상관없는 경우 (평균만)
    if (best) best.err += 0.002; // 기온 식이 조금이라도 더 잘 맞으면 그쪽을 씀
    for (let Tb = 6; Tb <= 22; Tb++) {
      const f1 = fitWith(Tb, 0, false); if (f1 && (!best || f1.err < best.err - 1e-9)) best = f1;
      for (let Tc = -4; Tc < Math.min(Tb, 10); Tc++) { const f = fitWith(Tb, Tc, true); if (f && (!best || f.err < best.err - 0.002)) best = f; }
    }
    if (!best) return null;
    const ext = t => best.b * Math.max(0, t - best.Tb) + best.c * Math.max(0, best.Tc - t);
    const usedSet = new Set(best.used.map(p => p.d));
    return { a: best.a, b: best.b, Tb: best.Tb, c: best.c, Tc: best.Tc, mape: best.mape * 100, n: best.used.length,
      ext, base: t => best.a + ext(t), pts, excluded: pts.filter(p => !usedSet.has(p.d)) };
  };

  root.UT = UT;
})(typeof window !== 'undefined' ? window : globalThis);
