    // =====================================================================
    // 연도별 설정 (목표·보고서 코멘트): ut_monthly 의 'YYYY-00' 줄에 저장
    // =====================================================================
    let YEARDATA = {};   // { 2027: { targets: {...}, comments: { '2027-01': '...' } } }
    const yd = y => YEARDATA[y] || {};
    const tgt = y => yd(y).targets || {};
    async function saveYear(y, patch) {
      const data = { ...yd(y), ...patch };
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
    let targetY = null, targetDraft = {}, targetDirty = false, targetUtil = 'elec';
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
    function fitModels(t, y) {
      const rows = baseMonths(t, y).map(monthRow), out = {};
      UT.UTILS.forEach(u => { out[u.k] = UT.fitBaseline(rows.map(r => ({ ...r, y: r[u.k] })), UT.MODEL_FEATS[u.k]); });
      const em = fitElecIdle(baseMonths(t, y)); if (em) out.elec = em;
      return out;
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
      { d: '2025-01-01', area: '폐수동', name: '터보블로워', kw: 11.2, hours: 8, note: '1대 20분 가동·40분 정지 (380V·20A ≈ 11.2kW)' },
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
      const l = []; let x = UT.prevYm(thisYm);
      for (let i = 0; i < 6 && l.length < 3; i++, x = UT.prevYm(x)) { const w = UT.effective(x, MONTHLY, DAILY, {})[k]; if (w) l.push(Number(w) / UT.daysIn(x)); }
      return l.length ? l.reduce((a, b) => a + b, 0) / l.length * UT.daysIn(ym) : null; // 계획(앞으로의 달): 최근 3개월 하루 평균
    }
    function wwKwh(ym) { return meterKwh(ym, 'elec_ww_kwh'); }
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
      targetDraft.rate = targetDraft.rate || {};
      const ro = !isAdmin(); document.getElementById('target-save').hidden = ro; document.getElementById('target-fill').hidden = true;
      const y = targetY, t = targetDraft, models = fitModels(t, y), base = baseMonths(t, y);
      const unitOf = k => UT.UTILS.find(u => u.k === k).unit;

      // 1) 기준선
      const cands = []; for (let ym = UT.ym(y - 2, 1); ym <= UT.ym(y, 12) && ym <= lastCompleteYm(); ym = UT.nextYm(ym)) { const sx = S(ym); if (sx.production && sx.elec.usage) cands.push(ym); }
      let h = `<div class="hint" style="margin-bottom:6px">기준으로 삼은 달 (눌러서 넣기/빼기${ro ? ' — 관리자만' : ''}) · 원육 투입이 아주 적었던 가동 초기 달은 자동으로 빠집니다.</div><div class="chips">` +
        cands.map(ym => `<button class="chip ${base.includes(ym) ? 'on' : ''}" ${ro ? 'disabled' : `onclick="toggleBase('${ym}')"`}>${ym.slice(2).replace('-', '.')}</button>`).join('') + '</div>';
      h += `<table class="t tg" style="margin-top:10px"><tr><th class="l">항목</th><th class="l">예상 사용량 식 (기준 달 ${base.length}개로 계산)</th><th>맞는 정도</th><th>월 평균 오차</th></tr>` +
        UT.UTILS.map(u => { const m = models[u.k]; if (!m) return `<tr><td class="l"><b>${u.name}</b></td><td class="l hint" colspan="3">기준 달이 부족해 계산할 수 없습니다</td></tr>`;
          const fc = v => Math.abs(v) >= 100 ? f0(v) : Number(v.toPrecision(3)).toLocaleString('ko-KR');
          const note = (f, v) => f === 'hdd' ? (v < 0 ? ' <span class="hint">(추울수록 덜 씀)</span>' : ' <span class="hint">(추울수록 더 씀)</span>') : f === 'cdd' ? (v < 0 ? ' <span class="hint">(더울수록 덜 씀)</span>' : ' <span class="hint">(더울수록 더 씀)</span>') : '';
          const parts = m.idle ? `휴무일 하루 기본 <b>${fc(m.coef[0])}</b> × 달력 날수 &nbsp;+&nbsp; 생산일 1일당 <b>${fc(m.coef[1])}</b> &nbsp;+&nbsp; 원육 1kg당 <b>${fc(m.coef[2])}</b> &nbsp;+&nbsp; ${m.idle.b || m.idle.c ? `기온 영향 <span class="hint">(평균기온 ${m.idle.Tb}℃ 넘는 1℃마다 하루 <b>${fc(m.idle.b)}</b>${m.idle.c ? `, ${m.idle.Tc}℃ 아래 1℃마다 하루 <b>${fc(m.idle.c)}</b>` : ''})</span> &nbsp;+&nbsp;` : ''} 폐수동·공조냉동 (계량기 실측) &nbsp;+&nbsp; 부하 변동 (생산동·기타)`
            : m.feats.map((f, i) => `${UT.FEAT_LABEL[f]} <b>${fc(m.coef[i])}</b>${note(f, m.coef[i])}`).join(' &nbsp;+&nbsp; ');
          return `<tr><td class="l"><i class="dot" style="background:${u.color}"></i><b>${u.name}</b> <span class="hint">${u.unit}</span></td><td class="l">${parts}</td><td>${m.r2 === null ? '-' : nf0.format(m.r2 * 100) + '%'}</td><td>${m.mape < 8 ? '<span class="ok">' : m.mape < 15 ? '<span>' : '<span class="ng">'}±${nf1.format(m.mape)}%</span></td></tr>`; }).join('') + '</table>';
      h += `<div class="hint" style="margin-top:6px">생산일 = 보일러 가스를 하루 50㎥ 넘게 쓴 날 수 (스팀보일러는 생산하는 날만 돌기 때문 · 월간입력 '생산일수'로 직접 고칠 수 있음). 가스는 생산일로, 전기는 달력 날수(냉동·공조 등 매일 도는 몫)와 생산일(생산설비 몫)을 함께 써서 계산. 난방도일 = 하루 평균기온이 18℃보다 낮은 만큼의 합, 냉방도일 = 24℃보다 높은 만큼의 합 (설비검침 최저·최고온도로 계산). 맞는 정도는 100%에 가까울수록, 월 평균 오차는 작을수록 믿을 만합니다.</div>`;
      // 계산 근거: 기준 달마다 (요인 × 계수) 더한 값 vs 실제
      const brows = base.map(monthRow);
      const FL = { days: '달력 날수', op: '생산일', prod: '원육 투입(kg)', hdd: '난방도일', cdd: '냉방도일', wx: '기온 영향(kWh)', wwk: '폐수동 실측(kWh)', hvk: '공조냉동 실측(kWh)', eq: '부하 변동(kWh)' };
      h += UT.UTILS.map(u => { const m = models[u.k]; if (!m) return '';
        const fc = v => Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
        const used = brows.map(r => m.prep ? m.prep({ ...r }) : r).filter(r => r[u.k] !== null && r[u.k] !== undefined && m.feats.every(f => r[f] !== null && r[f] !== undefined));
        let t2 = `<table class="t tg-why"><tr><th class="l">기준 달</th>${m.feats.map(f => `<th>${FL[f]}<br><span class="hint">${f === 'wx' ? '휴무일 식으로 날마다 합' : (f === 'wwk' || f === 'hvk') ? '계량기 그대로' : f === 'eq' ? '운전 이력 합' : '× ' + fc(m.coef[m.feats.indexOf(f)])}</span></th>`).join('')}<th>식으로 계산한 값</th><th>실제 사용량</th><th>차이</th></tr>`;
        used.forEach(r => { const parts = m.feats.map((f, i) => m.coef[i] * r[f]), sum = parts.reduce((a, b) => a + b, 0), err = r[u.k] ? (sum / r[u.k] - 1) * 100 : null;
          t2 += `<tr><td class="l">${r.ym.slice(2).replace('-', '.')}</td>${m.feats.map((f, i) => `<td>${['wx', 'wwk', 'hvk', 'eq'].includes(f) ? '' : fc(r[f]) + '<br>'}<span class="hint">→ ${f0(parts[i])}</span></td>`).join('')}<td><b>${f0(sum)}</b></td><td>${f0(r[u.k])}</td><td>${err === null ? '-' : (err >= 0 ? '+' : '') + nf1.format(err) + '%'}</td></tr>`; });
        t2 += '</table>';
        return `<details class="tg-whyd"><summary>${u.name} — 계수가 어떻게 나왔는지 보기 (기준 달 ${used.length}개)</summary>
          <div class="hint" style="margin:6px 0">각 달의 실제 사용량을 <b>${m.feats.map(f => FL[f].replace('(kg)', '')).join(' · ')}</b> 덩어리로 나눴을 때, 모든 기준 달에서 <b>식으로 계산한 값과 실제 사용량의 차이가 가장 작아지는 계수</b>를 찾은 것입니다 (최소제곱법 — 엑셀 추세선·LINEST와 같은 방법). 아래 표의 회색 숫자 = 그 요인 × 계수, 더하면 '식으로 계산한 값'.</div>${t2}</details>`; }).join('');
      if (models.elec && models.elec.idle) h += idleDetail(models.elec.idle);
      document.getElementById('tg-model').innerHTML = h;

      // 2) 절감률
      document.getElementById('tg-rate').innerHTML = `<div class="rate-grid">` + UT.UTILS.map(u => `<label><i class="dot" style="background:${u.color}"></i>${u.name}
        ${ro ? `<b>${rateOf(t, u.k) ?? '-'}%</b>` : `<input type="number" step="0.1" data-rate="${u.k}" value="${rateOf(t, u.k) ?? ''}" placeholder="예: 3"> %`}</label>`).join('') +
        (ro ? '' : `<button class="btn secondary" onclick="setAllRates()">모두 같은 값으로</button>`) + `</div>`;
      document.querySelectorAll('#tg-rate input[data-rate]').forEach(el => el.addEventListener('change', () => {
        const k = el.dataset.rate; if (el.value.trim() === '') delete targetDraft.rate[k]; else targetDraft.rate[k] = Number(el.value);
        targetDirty = true; renderTargets(targetDraft);
      }));

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
    function toggleBase(ym) {
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
        const data = JSON.parse(JSON.stringify(targetDraft));
        await saveYear(targetY, { targets: data });
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
          const exp = (mdl && p !== null && w) ? mdl.predict({ ym: UT.ym(y, m), days: UT.daysIn(UT.ym(y, m)), op: r.op, prod: p, hdd: w.hdd, cdd: w.cdd }) : null;
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
      document.getElementById('tg-plan').innerHTML = h;
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
    // 증감 원인 나누기
    function decompose(ym, ym0, uk) {
      const y = Number(ym.slice(0, 4)), t = tgt(y);
      const models = fitModels(t, y), mdl = models[uk];
      const r = monthRow(ym), r0 = monthRow(ym0);
      const fill = x => { if (x.hdd === null) { const nm = normals()[Number(x.ym.slice(5))]; if (nm) { x.hdd = nm.hdd; x.cdd = nm.cdd; x.wxGuess = true; } } };
      fill(r); fill(r0);
      const act = r[uk], act0 = r0[uk];
      if (act === null || act0 === null || act === undefined || act0 === undefined) return { err: '두 달 중 사용량이 없는 달이 있습니다.' };
      const out = { act, act0, diff: act - act0, r, r0, mdl, parts: [] };
      if (!mdl) { out.err = '예상 사용량 식을 만들 기준 달이 부족합니다 (목표 탭 ①).'; return out; }
      if (mdl.prep) { mdl.prep(r); mdl.prep(r0); }
      const miss = mdl.feats.filter(f => r[f] === null || r[f] === undefined || r0[f] === null || r0[f] === undefined || (f === 'prod' && (!r.prod || !r0.prod)));
      if (miss.length) { out.err = `${miss.includes('prod') ? '원육 투입량' : '기온'} 기록이 없는 달이 있어 요인별로 나눌 수 없습니다. (가동 초기 달이면 비교 달을 '전월'로 바꿔 보세요)`; out.mdl = null; return out; }
      const grp = { days: '달력 날수', op: '생산일', prod: '원육 투입량', hdd: '날씨 (기온)', cdd: '날씨 (기온)', wx: '날씨 (기온)', wwk: '폐수동 (실측)', hvk: '공조냉동 (실측)', eq: '부하 변동 (생산동·기타)' };
      const by = {};
      out.coef = Object.fromEntries(mdl.feats.map((f, i) => [f, mdl.coef[i]]));
      mdl.feats.forEach((f, i) => { if (r[f] === null || r0[f] === null) return; const v = mdl.coef[i] * (r[f] - r0[f]); by[grp[f]] = (by[grp[f]] || 0) + v; });
      const explained = Object.values(by).reduce((a, b) => a + b, 0);
      // 이상 사용일: 평소보다 더 쓴 양 (이번 달 − 비교 달)
      const an = monthAnoms(ym, uk), an0 = monthAnoms(ym0, uk);
      const ex = list => list.reduce((s2, a) => s2 + dailyToMonthly(ym, uk, a.v - (a.base || 0)), 0);
      const anomPart = ex(an) - ex(an0);
      const rest = out.diff - explained - anomPart;
      out.parts = ['폐수동 (실측)', '공조냉동 (실측)', '부하 변동 (생산동·기타)', '생산일', '달력 날수', '원육 투입량', '날씨 (기온)'].filter(g => g in by && !(g === '부하 변동 (생산동·기타)' && Math.abs(by[g]) < 0.5)).map(g => [g, by[g]]).concat([['이상 사용일', anomPart], ['운전·관리 차이', rest]]);
      out.an = an; out.an0 = an0; out.explained = explained; out.rest = rest;
      return out;
    }
    function causeSentences(ym, ym0, uk, D, short) {
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
      if ('부하 변동 (생산동·기타)' in P) rows.push(['부하 변동 (생산동·기타)', `부하 변동 사항에 적은 생산동·기타 부하 ${f0(r0.eq)} → ${f0(r.eq)} ${un}${evs('생산동')}`, P['부하 변동 (생산동·기타)']]);
      if ('생산일' in P) rows.push(['생산일', `${opInfo} · ${srcTxt}${calc('op', r.op - r0.op, '일')}`, P['생산일']]);
      if ('달력 날수' in P) rows.push(['달력 날수', `${r0.days}일 → ${r.days}일 · ${D.mdl.idle && uk === 'elec' ? '조명·사무실·계량기 없는 설비처럼 매일 도는 기본 부하' : '냉동·공조처럼 매일 도는 몫'}${calc('days', r.days - r0.days, '일', D.mdl.idle ? '일 (휴무일 기본)' : '')}`, P['달력 날수']]);
      rows.push(['원육 투입량', `${f0(r0.prod)} → ${f0(r.prod)} kg (${r.prod - r0.prod >= 0 ? '+' : '−'}${f0(Math.abs(r.prod - r0.prod))})${calc('prod', r.prod - r0.prod, 'kg')}`, P['원육 투입량'] || 0]);
      const wf = D.mdl.feats.find(f => f === 'hdd' || f === 'cdd');
      if (wf) rows.push(['날씨 (기온)', `${wf === 'cdd' ? '냉방도일' : '난방도일'} ${f0(r0[wf])} → ${f0(r[wf])} (${Math.abs(r[wf] - r0[wf]) < 0.5 ? (r[wf] < 0.5 ? (wf === 'cdd' ? '둘 다 냉방 필요 없는 날씨' : '둘 다 난방 필요 없는 날씨') : '비슷함') : wf === 'cdd' ? (r[wf] > r0[wf] ? '더 더움' : '덜 더움') : (r[wf] > r0[wf] ? '더 추움' : '덜 추움')})${r.wxGuess || r0.wxGuess ? ' · 기온 기록 부족해 평년값 사용' : ''}${calc(wf, r[wf] - r0[wf], '', wf === 'cdd' ? '냉방도일' : '난방도일')}`, P['날씨 (기온)'] || 0]);
      if (D.mdl.idle && !(D.mdl.idle.b || D.mdl.idle.c) && uk === 'elec') rows.push(['날씨 (기온)', `평균기온 ${r0.tmean == null ? '-' : nf1.format(r0.tmean) + '℃'} → ${r.tmean == null ? '-' : nf1.format(r.tmean) + '℃'}<br><span class="hint">· 기온에 따른 차이는 위 공조냉동 실측에 들어 있습니다 (계량기 없는 나머지 부하는 기온과 관계없이 일정)</span>`, 0]);
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
        (!('생산일' in P) ? `<span class="hint">${opInfo} — ${U.name}는 생산일보다 달력 날수 영향이 커서 날수로 계산합니다</span>` : '') + `</div>`;
      concl = per + concl;
      if (ref) concl += `<div class="hint" style="margin-top:6px">${ref}</div>`;
      concl += `<div class="hint" style="margin-top:4px">※ ${uk === 'elec' ? '폐수동·공조냉동은 계량기 실측, ' : ''}생산일·날수·원육·날씨 몫은 목표 탭 ①의 예상 사용량 식(월 평균 오차 ±${nf1.format(tol)}%)으로 계산한 추정값입니다.</div>`;
      return { lead, rows, concl, plain };
    }
    async function renderCause() {
      if (!window.Chart) return;
      try { await loadTemps(); } catch (e) { TEMPS = {}; }
      if (!causeYm) causeYm = lastCompleteYm();
      const ym = causeYm, y = Number(ym.slice(0, 4)), ym0 = causeCmp === 'prev' ? UT.prevYm(ym) : UT.ym(y - 1, Number(ym.slice(5)));
      document.getElementById('cause-month').textContent = ymLabel(ym);
      document.getElementById('cause-chips').innerHTML = UT.UTILS.map(u => `<button class="chip ${causeUtil === u.k ? 'on' : ''}" onclick="causeUtil='${u.k}';renderCause()">${u.name}</button>`).join('') +
        ' &nbsp; 비교: ' + [['prev', '전월'], ['ly', '작년 같은 달']].map(([k, n]) => `<button class="chip ${causeCmp === k ? 'on' : ''}" onclick="causeCmp='${k}';renderCause()">${n}</button>`).join('');
      const uk = causeUtil, U = UT.UTILS.find(u => u.k === uk);
      const D = decompose(ym, ym0, uk);
      document.getElementById('cz-title').textContent = `${U.name} 사용량이 왜 ${D.diff > 0 ? '늘었나' : '줄었나'} — ${ymLabel(ym)} vs ${ymLabel(ym0)}`;
      const T = D.act !== undefined ? causeSentences(ym, ym0, uk, D) : null;
      const fx = v => `${v >= 0 ? '+' : '−'}${f0(Math.abs(v))}`;
      document.getElementById('cz-text').innerHTML = !T ? `<div class="empty">${esc(D.err || '자료가 없습니다.')}</div>` :
        `<div class="lead">${T.lead}</div>` + (T.rows.length ? `<table>${T.rows.map(x => `<tr class="${x[3] ? 'key' : ''}"><td><b>${x[0]}</b><div class="hint">${x[1]}</div></td><td class="v ${x[2] > 0.5 ? 'up' : x[2] < -0.5 ? 'down' : ''}">${fx(x[2])} ${U.unit}</td></tr>`).join('')}</table>` : '') +
        `<div class="concl">${T.concl}</div>`;
      // 폭포 그래프: 비교 달 → 요인들 → 이번 달
      if (T && T.rows.length) {
        const labels = [ymLabel(ym0).replace('년 ', '.').replace('월', ''), ...D.parts.map(p => p[0]), ymLabel(ym).replace('년 ', '.').replace('월', '')];
        const bars = []; let run = D.act0; bars.push([0, D.act0]);
        D.parts.forEach(p => { bars.push([run, run + p[1]].sort((a, b) => a - b)); run += p[1]; });
        bars.push([0, D.act]);
        const col = [ '#a3a29d', ...D.parts.map(p => p[1] >= 0 ? '#e5534b' : '#2e9e5b'), U.color ];
        const lo = Math.min(...bars.map(b => b[0]).filter((v, i) => i > 0 && i < bars.length - 1), D.act0, D.act) * 0.9;
        mkChart('chart-cz', { type: 'bar', data: { labels, datasets: [{ label: U.unit, data: bars, backgroundColor: col, maxBarThickness: 46 }] },
          options: (() => { const o = baseOpts(U.unit); o.scales.y.min = Math.max(0, Math.floor(lo / 1000) * 1000); o.scales.x.ticks.maxRotation = 0;
            o.plugins.tooltip.callbacks.label = c => { const i = c.dataIndex; if (i === 0) return ` 비교 달: ${f0(D.act0)} ${U.unit}`; if (i === bars.length - 1) return ` 이번 달: ${f0(D.act)} ${U.unit}`; return ` ${fx(D.parts[i - 1][1])} ${U.unit}`; }; return o; })() });
      } else mkChart('chart-cz', { type: 'bar', data: { labels: [], datasets: [] }, options: baseOpts('') });

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

      renderEquip();
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
        `<div class="hint" style="margin-top:6px">폐수동·공조냉동은 계량기로 실측하므로 원인분석에 <b>그 기간에 있었던 변동 내용만 코멘트</b>로 붙습니다. 생산동·기타(계량기 없는 곳)는 kW × 하루 가동시간이 전기 원인분석의 '부하 변동' 줄로 계산에 들어갑니다. 같은 구역·설비는 가장 최근 시작일 줄이 적용됩니다. 대당 kW 계산: 3상 380V × 전류(A) × 1.732 × 0.85 ÷ 1000.</div>`;
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
      const lines = UT.UTILS.map(u => { const D = decompose(ym, ym0, u.k); if (D.act === undefined) return null; const T = causeSentences(ym, ym0, u.k, D);
        const notes = (D.an || []).map(a => anomNote(a.d, a.u)).filter(Boolean);
        return '· ' + T.plain + (notes.length ? ` (이상 사용: ${notes.join(' / ')})` : ''); }).filter(Boolean);
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
    let anomDays = 60, anomRatio = 1.4, anomUtil = 'all', anomList = [];
    function renderAnomaly() {
      const to = UT.addDays(todayStr, -1), from = UT.addDays(to, -anomDays + 1);
      anomList = UT.anomalies(DAILY, from, to, { ratio: anomRatio }).reverse();
      document.getElementById('anom-chips').innerHTML =
        [['all', '전체'], ...UT.DAILY_UTILS.map(u => [u.k, u.name])].map(([k, n]) => `<button class="chip ${anomUtil === k ? 'on' : ''}" onclick="anomUtil='${k}';renderAnomaly()">${n} ${k === 'all' ? anomList.length : anomList.filter(a => a.u === k).length}</button>`).join('') +
        ' &nbsp; ' + [30, 60, 90].map(n => `<button class="chip ${anomDays === n ? 'on' : ''}" onclick="anomDays=${n};renderAnomaly()">${n}일</button>`).join('') +
        ' &nbsp; 민감도 ' + [[1.3, '높음'], [1.4, '보통'], [1.5, '낮음']].map(([r, n]) => `<button class="chip ${anomRatio === r ? 'on' : ''}" onclick="anomRatio=${r};renderAnomaly()">${n}</button>`).join('');
      const list = anomList.filter(a => anomUtil === 'all' || a.u === anomUtil);
      const W = ['일', '월', '화', '수', '목', '금', '토'];
      document.getElementById('anom-table').innerHTML = !list.length ? '<div class="empty">이 기간에 평소보다 크게 많이 쓴 날이 없습니다 👍</div>' :
        `<table class="t"><tr><th>날짜</th><th>항목</th><th>그날 사용량</th><th>평소<br><span class="hint">최근 4주 같은 종류 날 중앙값</span></th><th>차이</th><th class="l">구분</th><th class="l" style="min-width:220px">원인·조치 메모${isAdmin() ? ' <span class="hint">(입력하면 자동 저장)</span>' : ''}</th><th></th></tr>` +
        list.map(a => { const u = UT.DAILY_UTILS.find(x => x.k === a.u); const wd = new Date(a.d + 'T00:00:00').getDay();
          return `<tr class="anom-row" onclick="anomUtil='${a.u}';anomFocus='${a.d}';renderAnomChart()"><td>${a.d.slice(5).replace('-', '/')} (${W[wd]})</td><td class="l"><i class="dot" style="background:${u.color}"></i>${u.name}</td><td>${f1(a.v)} ${u.unit}</td><td>${a.base === null ? '-' : f1(a.base) + ' ' + u.unit}</td>
            <td>${a.kind !== '과다' ? '-' : a.pct === null ? '<span class="up">평소 0</span>' : `<span class="up">+${nf0.format(a.pct)}%</span>`}</td><td class="l">${a.kind === '지침 오류' ? '<span class="ng">지침 확인 필요 (다음날 지침이 더 작음)</span>' : (a.work ? '생산일 과다 사용' : '쉬는 날 사용 (누수·미차단 확인)')}</td>
            <td class="l" onclick="event.stopPropagation()">${isAdmin() ? `<input class="anom-note" data-d="${a.d}" data-u="${a.u}" value="${esc(anomNote(a.d, a.u))}" placeholder="예) 자숙기 세척 / 누수 확인 → 밸브 교체">` : esc(anomNote(a.d, a.u)) || '<span class="hint">-</span>'}</td>
            <td onclick="event.stopPropagation()"><button class="chip" title="이 날이 그 달 사용량에 얼마나 영향을 줬는지" onclick="goCause('${a.d}','${a.u}')">${Number(a.d.slice(5, 7))}월 원인분석 →</button></td></tr>`; }).join('') + '</table>';
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
    function goCause(d, u) { causeYm = d.slice(0, 7); causeUtil = u; switchTab('cause'); }
    let anomFocus = null;
    function renderAnomChart() {
      if (!window.Chart) return;
      const uk = anomUtil === 'all' ? 'elec' : anomUtil, U = UT.DAILY_UTILS.find(u => u.k === uk);
      document.getElementById('anom-chart-title').textContent = `${U.name} 일 사용량 (${U.unit})`;
      const to = UT.addDays(todayStr, -1), days = []; for (let i = anomDays - 1; i >= 0; i--) days.push(UT.addDays(to, -i));
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
          out.push({ label: `${multiYear ? ds.slice(2, 4) + '/' : ''}${ds.slice(5).replace('-', '/')}(${'일월화수목금토'[new Date(ds + 'T00:00:00').getDay()]})`, cur: dayVal(ds, uk), prev: dayVal(ly, uk), prior: dayVal(UT.addDays(ds, -28), uk), prevLabel: ly }); }
      } else if (perGran === 'week') {
        const multiYear = from.slice(0, 4) !== to.slice(0, 4);
        for (let ws = isoWeekStart(from), i = 0; ws <= isoWeekStart(to) && ws <= last && i < PER_MAX.week; ws = UT.addDays(ws, 7), i++) { const lws = UT.addDays(ws, -364);
          const days = Math.min(7, (new Date(last + 'T00:00:00') - new Date(ws + 'T00:00:00')) / 864e5 + 1);
          const c = sumDays(ws, days, uk), p = sumDays(lws, days, uk), pw = sumDays(UT.addDays(ws, -7), days, uk); // 전주도 같은 날수만큼
          out.push({ label: `${multiYear ? ws.slice(2, 4) + '/' : ''}${ws.slice(5).replace('-', '/')}~`, cur: c && c.v, prev: p && p.v, prior: pw && pw.v, partial: days < 7, prevLabel: lws }); }
      } else if (perGran === 'month') {
        for (let ym = from, i = 0; ym <= to && ym <= thisYm && i < PER_MAX.month; ym = UT.nextYm(ym), i++) { const ly = UT.ym(Number(ym.slice(0, 4)) - 1, Number(ym.slice(5)));
          out.push({ label: ym.slice(2).replace('-', '.'), cur: monthVal(ym, uk, metric), prev: monthVal(ly, uk, metric), prior: monthVal(UT.prevYm(ym), uk, metric), partial: ym === thisYm && !UT.monthComplete(DAILY, ym) }); }
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
    function renderPeriod() {
      if (!window.Chart) return;
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
          return s.cur === null ? '' : `${nLy} 대비 ${pc(s.cur, s.prev)} · ${nPr} 대비 ${pc(s.cur, s.prior)}`; }; return o; })() });
      // 표 (최근 것부터)
      const fmt = v => v === null || v === undefined ? '-' : (perMetric === 'unit' ? fU(v, perUtil) : f0(v));
      const okLy = ser.filter(s => s.cur !== null && s.prev !== null && !s.partial), okPr = ser.filter(s => s.cur !== null && s.prior !== null && s.prior !== undefined && !s.partial);
      const sm = (l, k) => l.reduce((a, s) => a + s[k], 0);
      document.getElementById('per-table').innerHTML = `<table class="t"><tr><th class="l">기간</th><th>이번</th><th>${nLy}</th><th>${nLy} 대비</th><th>${nPr}</th><th>${nPr} 대비</th></tr>` +
        ser.slice().reverse().map(s => `<tr${s.partial ? ' class="hint"' : ''}><td class="l">${esc(s.label)}${s.partial ? ' (진행 중)' : ''}</td><td><b>${fmt(s.cur)}</b></td><td>${fmt(s.prev)}</td><td>${pctTxt(s.cur, s.prev)}</td><td>${fmt(s.prior)}</td><td>${pctTxt(s.cur, s.prior)}</td></tr>`).join('') +
        (perMetric !== 'unit' && (okLy.length || okPr.length) ? `<tr class="sum"><td class="l">합계 <span class="hint">(진행 중 제외, 비교값 있는 기간만)</span></td><td></td><td>${okLy.length ? `${fmt(sm(okLy, 'cur'))} vs ${fmt(sm(okLy, 'prev'))}` : '-'}</td><td>${okLy.length ? pctTxt(sm(okLy, 'cur'), sm(okLy, 'prev')) : ''}</td><td>${okPr.length ? `${fmt(sm(okPr, 'cur'))} vs ${fmt(sm(okPr, 'prior'))}` : '-'}</td><td>${okPr.length ? pctTxt(sm(okPr, 'cur'), sm(okPr, 'prior')) : ''}</td></tr>` : '') + '</table>' +
        `<div class="hint" style="margin-top:6px">단위: ${unit}. 증감 ▲ = 더 씀(빨강), ▼ = 덜 씀(초록).</div>`;
    }


    // =====================================================================
    // 지출결의 자료: 유틸별 [지출결의 입력사항 · 추가의견 문구 · 원육 사용량당 그래프] → 그룹웨어에 붙여넣기
    // =====================================================================
    let exYm = null, exUtil = 'elec', exChartKind = 'unit', exChart = null;
    const EX_NAME = { elec: '전력', gas: '가스', water: '용수', ww: '폐수' };
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
      L.push(`1. ${N} 비용 = ${exCmp(c.cost, c0.cost, v => exF(0)(v / 1000), '천원')}`);
      L.push(`2. ${N} 사용량 = ${exCmp(c.usage, c0.usage, exF(0), U.unit)}`);
      const sub = [];
      sub.push(`일평균 ${N}사용량 = ${exCmp(c.usage === null ? null : c.usage / dn, c0.usage === null ? null : c0.usage / dn0, exF(1), U.unit)}`);
      if (uk === 'elec') {
        const ww = meterKwh(ym, 'elec_ww_kwh'), ww0 = meterKwh(UT.prevYm(ym), 'elec_ww_kwh'), hv = meterKwh(ym, 'elec_hvac_kwh'), hv0 = meterKwh(UT.prevYm(ym), 'elec_hvac_kwh');
        if (ww !== null && hv !== null && c.usage !== null) {
          const pr = c.usage - ww - hv, pr0 = (c0.usage !== null && ww0 !== null && hv0 !== null) ? c0.usage - ww0 - hv0 : null;
          sub.push(`생산 전력 사용량 = ${exCmp(pr, pr0, exF(0), 'kWh')}`);
          sub.push(`폐수처리장 전력 사용량 = ${exCmp(ww, ww0, exF(0), 'kWh')}`);
          sub.push(`공조냉동 전력사용량 = ${exCmp(hv, hv0, exF(0), 'kWh')}`);
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
      sub.forEach((t, i) => L.push(`  ${GA[i]}. ${t}`));
      L.push(`3. 생산량당 비용 = ${exCmp(ratio(c.cost, s.production), ratio(c0.cost, p.production), exF(1), '원/kg')}`);
      L.push(`4. 생산량당 사용량 = ${exCmp(ratio(c.usage, s.production), ratio(c0.usage, p.production), exF(ud), `${U.unit}/kg`)}`);
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
      if (exUtil === 'gas') return gasSplit(s).map(x => [`2공장 도시가스요금_${x.name}_${y}년${m}월`, x.exvat, x.total - x.exvat, x.total]);
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
        ${rows.length > 1 ? `<tr class="sum"><td class="l">지출결의계</td><td>${f0(tot[0])}</td><td>${f0(tot[1])}</td><td>${f0(tot[2])}</td></tr>` : ''}</table></div>
        <div class="hint">${exUtil === 'elec' ? '공급가액 = 청구액 − 부가세 − 전력기금 (원단위 절사 반영). 전력기금은 부가세 없이 따로 한 줄.' : exUtil === 'gas' ? '보일러·식당은 검침 비율대로 고지서 금액을 나눈 값입니다.' : ''}</div></div>`;
      h += `<div class="card"><h3>추가의견 <span class="sub">고쳐서 쓸 수 있습니다</span></h3>
        <textarea id="ex-text" class="ex-text" rows="${lines.length + 1}">${esc(lines.join('\n'))}</textarea>
        <div class="toolbar" style="margin-top:6px"><button class="btn" onclick="exCopy(document.getElementById('ex-text').value,this)">📋 추가의견 복사</button><span class="hint">전월(${ymLabel(UT.prevYm(exYm))})과 비교 · 비용은 부가세 포함 청구액 기준</span></div></div>`;
      h += `<div class="card"><h3>그래프 <span class="sub">그림 복사 후 그룹웨어 「캡쳐자료」 칸에 붙여넣기</span></h3>
        <div class="toolbar"><span class="chips"><button class="chip ${exChartKind === 'unit' ? 'on' : ''}" onclick="exChartKind='unit';renderExpense()">원육 사용량당 ${N}사용량</button><button class="chip ${exChartKind === 'ucost' ? 'on' : ''}" onclick="exChartKind='ucost';renderExpense()">원육 사용량당 ${N} 비용</button><button class="chip ${exChartKind === 'usage' ? 'on' : ''}" onclick="exChartKind='usage';renderExpense()">${N} 사용량</button></span>
          <button class="btn" onclick="exCopyImg(this)">🖼 그림 복사</button><button class="btn secondary" onclick="exSaveImg()">💾 그림 저장</button></div>
        <div class="ex-chart"><canvas id="ex-canvas" width="900" height="460"></canvas></div></div>`;
      document.getElementById('ex-body').innerHTML = h;
      exDraw();
    }
    function exDraw() {
      const y = Number(exYm.slice(0, 4)), mEnd = Number(exYm.slice(5)), U = UT.UTILS.find(u => u.k === exUtil), N = EX_NAME[exUtil];
      const ud = exUtil === 'water' || exUtil === 'ww' ? 3 : 1;
      const K = { unit: { t: `원육 사용량당 ${N}사용량`, u: `${U.unit}/kg`, d: ud, f: s => ratio(s[exUtil].usage, s.production) },
        ucost: { t: `원육 사용량당 ${N} 비용`, u: '원/kg', d: 1, f: s => ratio(s[exUtil].cost, s.production) },
        usage: { t: `${N} 사용량`, u: U.unit, d: 0, f: s => s[exUtil].usage } }[exChartKind];
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
