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
    function fitModels(t, y) {
      const out = {};
      UT.UTILS.forEach(u => { out[u.k] = UT.fitBaseline(baseFor(t, y, u.k).map(monthRow).map(r => ({ ...r, y: r[u.k] })), UT.MODEL_FEATS[u.k]); });
      ['water', 'ww'].forEach(k => { const m = fitSimple(baseFor(t, y, k), k); if (m) out[k] = m; });
      const em = fitElecHall(baseFor(t, y, 'elec')) || fitElecIdle(baseFor(t, y, 'elec')); if (em) out.elec = em;
      const gm = fitGasBoiler(baseFor(t, y, 'gas')); if (gm) out.gas = gm;
      return out;
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
      h += `<table class="t tg" style="margin-top:10px;width:100%"><colgroup><col style="width:90px"><col><col style="width:80px"><col style="width:90px"></colgroup><tr><th class="l">항목</th><th class="l">예상 사용량 식 (기준 달 ${base.length}개로 계산)</th><th>맞는 정도</th><th>월 평균 오차</th></tr>` +
        UT.UTILS.map(u => { const m = models[u.k]; if (!m) return `<tr><td class="l"><b>${u.name}</b></td><td class="l hint" colspan="3">기준 달이 부족해 계산할 수 없습니다</td></tr>`;
          const fc = v => Math.abs(v) >= 100 ? f0(v) : Number(v.toPrecision(3)).toLocaleString('ko-KR');
          const note = (f, v) => f === 'hdd' ? (v < 0 ? ' <span class="hint">(추울수록 덜 씀)</span>' : ' <span class="hint">(추울수록 더 씀)</span>') : f === 'cdd' ? (v < 0 ? ' <span class="hint">(더울수록 덜 씀)</span>' : ' <span class="hint">(더울수록 더 씀)</span>') : '';
          const parts = m.hall ? `생산동 하루 기본 <b>${fc(m.coef[0])}</b> × 달력 날수 &nbsp;+&nbsp; 원육 1kg당 <b>${fc(m.coef[1])}</b> &nbsp;+&nbsp; ${m.Tb !== null ? `더운 몫 <span class="hint">(하루 평균기온 ${m.Tb}℃ 넘는 1℃마다 <b>${fc(m.coef[2])}</b> — 계량기 없는 칠러·실외기 등)</span> &nbsp;+&nbsp; ` : ''}${m.Tc !== null ? `추운 몫 <span class="hint">(하루 평균기온 ${m.Tc}℃ 아래 1℃마다 <b>${fc(m.coef[3])}</b> — 현장 온수 전기보일러)</span> &nbsp;+&nbsp; ` : `<span class="hint">추운 몫(전기보일러): 기준 달에 추운 달이 ${m.coldMonths}개뿐이라 아직 계산 안 함 — 겨울 달이 2개 이상 들어오면 자동으로 들어감</span> &nbsp;+&nbsp; `}폐수동·공조냉동 계량기 실측 &nbsp;+&nbsp; 부하 변동 <span class="hint">(${m.months[0].slice(2).replace('-', '.')}~${m.months[m.months.length - 1].slice(2).replace('-', '.')} ${m.n}개월 · 생산동만 따로 맞춘 오차 ±${nf1.format(m.hallMape)}%)</span>`
            : m.gasBoiler ? `<b>보일러</b>(스팀 → 자숙탱크·레토르트) = ${m.feats.filter(f => f !== 'grest').map(f => `${UT.FEAT_LABEL[f]} <b>${fc(m.coef[m.feats.indexOf(f)])}</b>`).join(' &nbsp;+&nbsp; ')} &nbsp;+&nbsp; 식당 가스 실측 <span class="hint">(기숙사 — 통제 밖이라 그대로 더함 · 보일러만 따로 맞춘 오차 ±${nf1.format(m.boilerMape)}%${m.hdd ? '' : ' · 난방도일은 넣어도 오차가 줄지 않아 뺌 (난방용 가스 없음)'})</span>`
            : m.idle ? `휴무일 하루 기본 <b>${fc(m.coef[0])}</b> × 달력 날수 &nbsp;+&nbsp; 생산일 1일당 <b>${fc(m.coef[1])}</b> &nbsp;+&nbsp; 원육 1kg당 <b>${fc(m.coef[2])}</b> &nbsp;+&nbsp; ${m.idle.b || m.idle.c ? `기온 영향 <span class="hint">(평균기온 ${m.idle.Tb}℃ 넘는 1℃마다 하루 <b>${fc(m.idle.b)}</b>${m.idle.c ? `, ${m.idle.Tc}℃ 아래 1℃마다 하루 <b>${fc(m.idle.c)}</b>` : ''})</span> &nbsp;+&nbsp;` : ''} 폐수동·공조냉동 (계량기 실측) &nbsp;+&nbsp; 부하 변동 (생산동·기타)`
            : m.feats.map((f, i) => `${UT.FEAT_LABEL[f]} <b>${fc(m.coef[i])}</b>${note(f, m.coef[i])}`).join(' &nbsp;+&nbsp; ');
          const ex = exclOf(t, u.k), exHtml = `<div class="tg-excl">이 항목 기준 달 <span class="hint">(빨간 줄 = 뺌 · 눌러서 바꾸기)</span>: ${base.map(ym => { const auto = u.k === 'elec' && m.hall && ym < HVAC_FULL_FROM;
            return `<button class="chip mini ${ex.includes(ym) || auto ? 'off' : ''}" ${ro || auto ? 'disabled' : `onclick="toggleExcl('${u.k}','${ym}')"`} title="${auto ? '공조냉동·폐수동 검침이 나뉘기 전이라 자동으로 뺌' : ex.includes(ym) ? '빠짐 — 눌러서 다시 넣기' : '들어감 — 눌러서 빼기'}">${ym.slice(2).replace('-', '.')}</button>`; }).join('')}${u.k === 'elec' && m.hall && base.some(ym => ym < HVAC_FULL_FROM) ? ' <span class="hint">← 26.1~2월: 공조·폐수 검침 분리 전이라 자동 제외</span>' : ''}${ex.length && EXCL_WHY[u.k] && !Array.isArray((t.excl || {})[u.k]) ? ` <span class="hint">← 기본: ${EXCL_WHY[u.k]}</span>` : ''}${m.hddDropped ? ' <span class="hint">· 난방도일은 오차가 줄지 않아 뺌</span>' : ''}</div>`;
          return `<tr><td class="l"><i class="dot" style="background:${u.color}"></i><b>${u.name}</b> <span class="hint">${u.unit}</span></td><td class="l">${parts.split(' &nbsp;+&nbsp; ').map((x, i) => (i ? '<span class="plus">+</span> ' : '') + x).join('<br>')}${exHtml}</td><td>${m.r2 === null ? '-' : nf0.format(m.r2 * 100) + '%'}</td><td>${m.mape < 8 ? '<span class="ok">' : m.mape < 15 ? '<span>' : '<span class="ng">'}±${nf1.format(m.mape)}%</span></td></tr>`; }).join('') + '</table>';
      h += `<div class="hint" style="margin-top:6px">생산일 = 보일러 가스를 하루 50㎥ 넘게 쓴 날 수 (스팀보일러는 생산하는 날만 돌기 때문 · 월간입력 '생산일수'로 직접 고칠 수 있음). 가스는 보일러 스팀(자숙탱크·레토르트)만 생산일·원육으로 계산하고 식당 가스는 실측 그대로 (난방용 가스 없음). 전기는 생산동 기본(달력 날수)·원육·더운 몫(칠러·실외기)·추운 몫(현장 온수 전기보일러, 겨울 자료가 쌓이면)으로 계산. 난방도일 = 하루 평균기온이 18℃보다 낮은 만큼의 한 달 합, 냉방도일 = 24℃보다 높은 만큼의 합 (설비검침 최저·최고온도의 평균으로 계산). 맞는 정도는 100%에 가까울수록, 월 평균 오차는 작을수록 믿을 만합니다.</div>`;
      // 계산 근거: 기준 달마다 (요인 × 계수) 더한 값 vs 실제
      const brows = base.map(monthRow);
      const FL = { days: '달력 날수', op: '생산일', prod: '원육 투입(kg)', hdd: '난방도일', cdd: '냉방도일', wx: '기온 영향(kWh)', cx: '추운 몫', wwk: '폐수동 실측(kWh)', hvk: '공조냉동 실측(kWh)', eq: '부하 변동(kWh)', grest: '식당 가스 실측(MJ)' };
      h += UT.UTILS.map(u => { const m = models[u.k]; if (!m) return '';
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
      if ('식당 가스 (실측)' in P) rows.push(['식당 가스 (실측)', `식당(기숙사) 가스 ${f0(r0.grest)} → ${f0(r.grest)} ${un} · 보일러와 따로 계량 — 생산과 관계없어 실측 그대로`, P['식당 가스 (실측)']]);
      if ('부하 변동 (생산동·기타)' in P) rows.push(['부하 변동 (생산동·기타)', `부하 변동 사항에 적은 생산동·기타 부하 ${f0(r0.eq)} → ${f0(r.eq)} ${un}${evs('생산동')}`, P['부하 변동 (생산동·기타)']]);
      if ('생산일' in P) rows.push(['생산일', `${opInfo} · ${srcTxt}${calc('op', r.op - r0.op, '일')}`, P['생산일']]);
      if ('달력 날수' in P) rows.push(['달력 날수', `${r0.days}일 → ${r.days}일 · ${(D.mdl.idle || D.mdl.hall) && uk === 'elec' ? '조명·사무실·공기압축기·계량기 없는 설비처럼 생산과 관계없이 매일 도는 생산동 기본 부하' : '냉동·공조처럼 매일 도는 몫'}${calc('days', r.days - r0.days, '일', D.mdl.idle ? '일 (휴무일 기본)' : '')}`, P['달력 날수']]);
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
      concl += `<div class="hint" style="margin-top:4px">※ ${uk === 'elec' ? '폐수동·공조냉동은 계량기 실측, ' : ''}생산일·날수·원육·날씨 몫은 목표 탭 ①의 예상 사용량 식(월 평균 오차 ±${nf1.format(tol)}%)으로 계산한 추정값입니다.</div>`;
      return { lead, rows, concl, plain };
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
      setTimeout(renderProdCompare, 0);
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
      if (!window.Chart) return;
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
    function loadProdDaily() { if (PRODD) return Promise.resolve(PRODD); if (!PRODD_P) PRODD_P = loadProdDaily0().catch(e => { PRODD_P = null; throw e; }); return PRODD_P; }
    async function loadProdDaily0() {
      const base = 'https://firestore.googleapis.com/v1/projects/ssbon-factory/databases/(default)/documents/daily_summary';
      const out = {}; let tok = '';
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
      return (PRODD = out);
    }
    const PD_UTIL = {
      elec: { name: '전기', unit: 'kWh', val: ds => (UT.dailyUsage(DAILY, ds) || {}).elec, feats: [['prod', '생산한 날'], ['rm', '원육 kg'], ['warm', '더운 정도 (18℃ 넘는 ℃)']] },
      gas: { name: '보일러 가스', unit: '㎥', val: ds => UT.diffReading(DAILY, ds, ['gas_boiler']), feats: [['steamH', '자숙 작업시간 (h)'], ['ea1k', '포장 1,000EA'], ['cold', '추운 정도 (15℃ 아래 ℃)']] },
      water: { name: '용수', unit: '㎥', val: ds => (UT.dailyUsage(DAILY, ds) || {}).water, feats: [['prod', '생산한 날'], ['rm', '원육 kg']] },
      ww: { name: '폐수', unit: '㎥', val: ds => (UT.dailyUsage(DAILY, ds) || {}).ww, feats: [['prod', '생산한 날'], ['rm', '원육 kg']] }
    };
    function pdRow(ds) {
      const p = PRODD[ds], t = (TEMPS || {})[ds], boiler = UT.diffReading(DAILY, ds, ['gas_boiler']);
      const noRec = !p && boiler !== null && boiler > 50; // 보일러는 돌았는데 생산 기록이 없는 날
      const unknown = !p && boiler === null; // 생산 기록도, 보일러 검침도 없는 날 → 판단 안 함
      const x = { prod: p && p.rm > 0 ? 1 : 0, rm: p ? p.rm : 0, steamH: p ? p.steamH : 0, ea1k: p ? p.ea / 1000 : 0,
        warm: t === undefined || t === null ? null : Math.max(0, t - 18), cold: t === undefined || t === null ? null : Math.max(0, 15 - t) };
      return { ds, p, x, t, noRec, unknown };
    }
    function pdFit(uk, to) {
      const U = PD_UTIL[uk], rows = [];
      for (let i = 1; i <= 120; i++) { const ds = UT.addDays(to, -i + 1), r = pdRow(ds), y = U.val(ds);
        if (y === null || y === undefined || isNaN(y) || r.noRec || r.unknown || U.feats.some(([f]) => r.x[f] === null)) continue; rows.push({ ...r, y }); }
      if (rows.length < 20) return null;
      let feats = U.feats.map(f => f[0]).filter(f => { const v = rows.map(r => r.x[f]); return Math.max(...v) - Math.min(...v) > 1e-9; }), use = rows, co = null; // 값이 다 같은 요인(예: 여름엔 추운 정도가 모두 0)은 뺌
      const tolAbs = ((UT.DAILY_UTILS.find(u => u.k === uk) || {}).minAbs || 1);
      for (let it = 0; it < 6; it++) {
        let c2 = UT.ols(use.map(r => [1, ...feats.map(f => r.x[f])]), use.map(r => r.y));
        while (!c2 && feats.length) { feats = feats.slice(0, -1); c2 = UT.ols(use.map(r => [1, ...feats.map(f => r.x[f])]), use.map(r => r.y)); }
        if (!c2) { if (!co) return null; break; } co = c2;
        const neg = feats.findIndex((f, i) => co[i + 1] < 0);
        if (neg >= 0) { feats = feats.filter((_, i) => i !== neg); continue; }
        const pr = r => co[0] + feats.reduce((s, f, i) => s + co[i + 1] * r.x[f], 0);
        const keep = rows.filter(r => Math.abs(r.y - pr(r)) <= Math.max(0.3 * pr(r), tolAbs));
        if (keep.length === use.length || keep.length < 15) break; use = keep;
      }
      const pr = r => Math.max(0, co[0] + feats.reduce((s, f, i) => s + co[i + 1] * r.x[f], 0));
      const prodRows = use.filter(r => r.x.prod), mean = f => prodRows.length ? prodRows.reduce((s, r) => s + r.x[f], 0) / prodRows.length : 0;
      const mape = use.reduce((s, r) => s + Math.abs(r.y - pr(r)), 0) / Math.max(1, use.reduce((s, r) => s + r.y, 0)) * 100; // 전체 사용량 대비 오차
      return { feats, co, pr, mean: Object.fromEntries(feats.map(f => [f, mean(f)])), n: use.length, mape };
    }
    async function renderProdCompare() {
      const el = document.getElementById('pd-body'); if (!el) return;
      if (!PRODD) { el.innerHTML = '<div class="loading">생산 대시보드 일별 실적 불러오는 중...</div>';
        try { await loadProdDaily(); } catch (e) { el.innerHTML = `<div class="empty">생산 대시보드 자료를 읽지 못했습니다: ${esc(errMsg(e))}<br>회사 네트워크에서 firestore.googleapis.com 이 막혀 있을 수 있습니다.</div>`; return; } }
      try { await loadTemps(); } catch (e) { TEMPS = TEMPS || {}; }
      const to = UT.addDays(todayStr, -1), from = UT.addDays(to, -anomDays + 1), U = PD_UTIL[pdUtil], M = pdFit(pdUtil, to);
      const fl = Object.fromEntries(U.feats), fmtV = v => v === null || v === undefined ? '-' : f0(v);
      let h = `<div class="toolbar"><span class="chips">${Object.entries(PD_UTIL).map(([k, u]) => `<button class="chip ${k === pdUtil ? 'on' : ''}" onclick="pdUtil='${k}';pdFocus=null;renderProdCompare()">${u.name}</button>`).join('')}</span>
        <label class="hint"><input type="checkbox" ${pdOnlyHigh ? 'checked' : ''} onchange="pdOnlyHigh=this.checked;renderProdCompare()"> 예상보다 많이 쓴 날만</label></div>`;
      if (!M) { el.innerHTML = h + '<div class="empty">비교할 자료가 아직 부족합니다 (최근 120일 중 생산 실적·검침이 함께 있는 날 20일 이상 필요).</div>'; return; }
      const cf = v => Math.abs(v) < 0.5 && Math.abs(v) > 0 && M.co.indexOf(v) === 0 ? '0' : Math.abs(v) >= 100 ? f0(v) : Number(Number(v).toPrecision(3)).toLocaleString('ko-KR');
      h += `<div class="hint" style="margin-bottom:6px">예상 ${U.name} = 하루 기본 <b>${cf(M.co[0])}</b>${M.feats.map((f, i) => ` + ${fl[f]} × <b>${cf(M.co[i + 1])}</b>`).join('')} ${U.unit} <span class="hint">(최근 ${M.n}일로 맞춤 · 평균 오차 ±${nf1.format(M.mape)}%${U.feats.length > M.feats.length ? ` · 관련 없게 나온 ${U.feats.filter(([f]) => !M.feats.includes(f)).map(x => x[1]).join(', ')} 은 뺌` : ''})</span></div>`;
      const W = ['일', '월', '화', '수', '목', '금', '토'], minAbs = (UT.DAILY_UTILS.find(u => u.k === pdUtil) || {}).minAbs || 0;
      const rows = []; for (let ds = to; ds >= from; ds = UT.addDays(ds, -1)) { const r = pdRow(ds), y = U.val(ds); if (y === null || y === undefined || isNaN(y)) continue;
        const ok = !r.noRec && !r.unknown && M.feats.every(f => r.x[f] !== null), e = ok ? M.pr(r) : null, d = e === null ? null : y - e;
        const hi = d !== null && d > Math.max(minAbs * 0.5, e * 0.15); rows.push({ ...r, y, e, d, hi }); }
      const list = rows.filter(r => !pdOnlyHigh || r.hi || r.noRec);
      h += `<div class="tbl-wrap"><table class="t"><tr><th>날짜</th><th>원육 kg</th><th>자숙 h</th><th>포장 EA</th><th>기온</th><th>실제 ${U.unit}</th><th>예상</th><th>차이</th><th class="l">원인 추정 (평소 생산일과 비교)</th></tr>` +
        (list.length ? list.map(r => {
          const why = r.noRec ? '<span class="up">보일러는 돌았는데 생산 실적이 없음 — 대시보드에서 그 날짜를 열면 생깁니다</span>' : r.unknown ? '<span class="hint">생산 실적·보일러 검침이 아직 없음</span>' : r.e === null ? '-' : (() => {
            const parts = M.feats.map((f, i) => [fl[f], M.co[i + 1] * (r.x[f] - (f === 'prod' ? (r.x.prod ? 1 : 0) : M.mean[f]) * (f === 'prod' ? 1 : r.x.prod ? 1 : 0))]).filter(x => Math.abs(x[1]) >= Math.max(1, r.e * 0.03));
            const txt = parts.map(([n, v]) => `${n} ${v >= 0 ? '+' : '−'}${f0(Math.abs(v))}`).join(', ');
            return (r.x.prod ? (txt ? `평소 생산일보다 ${txt}` : '생산 조건은 평소와 비슷') : '생산 없는 날') + (r.hi ? ` · <b class="up">설명 안 되는 +${f0(r.d)} ${U.unit}</b> → 설비 미차단·공회전·누수·특이 작업 확인` : '');
          })();
          const nts = notesIn(r.ds, r.ds, pdUtil === 'gas' ? 'gas' : pdUtil); const ntH = nts.length ? `<br><span class="un-note">📝 ${nts.map(n => `${esc(n.cat)}: ${esc(n.text)}`).join(' / ')}</span>` : '';
          return `<tr class="${r.hi ? 'hl' : ''}"><td>${r.ds.slice(5).replace('-', '/')} (${W[new Date(r.ds + 'T00:00:00').getDay()]})</td><td>${r.p ? f0(r.p.rm) : '-'}</td><td>${r.p ? nf1.format(r.p.steamH) : '-'}</td><td>${r.p ? f0(r.p.ea) : '-'}</td><td>${r.t === undefined || r.t === null ? '-' : nf1.format(r.t) + '℃'}</td>
            <td><b>${fmtV(r.y)}</b></td><td>${fmtV(r.e)}</td><td class="${r.d > 0 ? 'up' : 'down'}">${r.d === null ? '-' : (r.d >= 0 ? '+' : '−') + f0(Math.abs(r.d)) + (r.e ? ` <span class="hint">(${r.d >= 0 ? '+' : ''}${nf1.format(r.d / r.e * 100)}%)</span>` : '')}</td><td class="l">${why}${ntH}</td></tr>`;
        }).join('') : `<tr><td colspan="9" class="empty">최근 ${anomDays}일 동안 예상보다 크게 많이 쓴 날이 없습니다 👍</td></tr>`) + '</table></div>';
      h += `<div class="hint" style="margin-top:6px">· 생산 실적은 생산 대시보드 일별 요약(읽기 전용)에서 가져옵니다. 대시보드에서 그 날짜를 한 번도 안 연 날은 실적이 없을 수 있습니다.<br>· 「예상보다 많이 쓴 날」 = 예상보다 15% 넘게 더 쓴 날. 원인 추정의 ± 값은 그날 원육·작업시간·기온이 평소 생산일과 달라서 생긴 몫이고, 나머지가 설명 안 되는 몫입니다.<br>· 검침 시각(08시) 기준이라 전기(파워플래너, 0~24시)와 하루 정도 어긋날 수 있습니다.</div>`;
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
    function renderNotes() {
      if (!unYm) unYm = thisYm;
      const E = unEditId ? utNotes().find(n => n.id === unEditId) : null, ro = !isAdmin();
      const utilBox = (n) => UT.UTILS.map(u => `<label class="un-u"><input type="checkbox" class="un-ut" value="${u.k}" ${(n ? (n.utils || []) : UN_UTIL_DEF['전기']).includes(u.k) ? 'checked' : ''}> ${u.name}</label>`).join('');
      let h = ro ? '' : `<div class="card"><h3>${E ? '특이사항 고치기' : '특이사항 적기'} <span class="sub">유틸리티·생산설비 — 원인분석·이상감지에서 그 기간 기록이 같이 나옵니다</span></h3>
        <div class="un-form">
          <label>날짜 <input type="date" id="un-d" value="${esc(E ? E.d : todayStr)}"></label>
          <label>분류 <select id="un-cat" onchange="unCatChange(this.value)">${UN_CATS.map(c => `<option ${E && E.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>설비·장소 <input id="un-eq" value="${esc(E ? E.eq || '' : '')}" placeholder="예: 레토르트 2호기, 1번 공기압축기"></label>
          <label class="wide">내용 <textarea id="un-text" rows="2" placeholder="예: 레토르트 2호기 스팀 트랩 누설, 야간 냉동기 수동 운전, 생산 연장(22시까지)">${esc(E ? E.text : '')}</textarea></label>
          <label class="wide">조치 <input id="un-act" value="${esc(E ? E.act || '' : '')}" placeholder="예: 트랩 교체, 타이머 재설정"></label>
          <div class="wide">관련 유틸리티 <span id="un-utils">${utilBox(E)}</span> <span class="hint">— 체크한 유틸의 원인분석·이상감지에 나옵니다</span></div>
          <div><button class="btn" onclick="unSave()">${E ? '✓ 고친 내용 저장' : '+ 기록 추가'}</button>${E ? ` <button class="btn secondary" onclick="unEditId=null;renderNotes()">취소</button>` : ''}</div>
        </div></div>`;
      const list = utNotes().filter(n => (!unYm || n.d.slice(0, 7) === unYm) && (!unCat || n.cat === unCat));
      h += `<div class="card"><div class="toolbar">
          <div class="month-nav"><button onclick="unShift(-1)">◀</button><span>${unYm ? ymLabel(unYm) : '전체'}</span><button onclick="unShift(1)">▶</button></div>
          <button class="chip ${unYm ? '' : 'on'}" onclick="unYm=unYm?'':thisYm;renderNotes()">전체 기간</button>
          <span class="chips"><button class="chip ${unCat ? '' : 'on'}" onclick="unCat='';renderNotes()">전체</button>${UN_CATS.map(c => `<button class="chip ${unCat === c ? 'on' : ''}" onclick="unCat='${c}';renderNotes()">${c}</button>`).join('')}</span>
          <span class="hint">${list.length}건</span></div>` +
        (list.length ? `<div class="tbl-wrap"><table class="t"><tr><th>날짜</th><th>분류</th><th class="l">설비·장소</th><th class="l">내용</th><th class="l">조치</th><th>관련</th><th>적은 사람</th>${ro ? '' : '<th></th>'}</tr>` +
          list.map(n => `<tr><td>${n.d}</td><td><span class="un-cat">${esc(n.cat)}</span></td><td class="l">${esc(n.eq || '')}</td><td class="l un-txt">${esc(n.text)}</td><td class="l un-txt">${esc(n.act || '')}</td>
            <td>${(n.utils || []).map(k => (UT.UTILS.find(u => u.k === k) || {}).name).filter(Boolean).join('·')}</td><td>${esc(n.by || '')}</td>
            ${ro ? '' : `<td><button class="btn secondary small" onclick="unEditId='${n.id}';renderNotes();window.scrollTo(0,0)">고치기</button> <button class="btn danger small" onclick="unDel('${n.id}')">삭제</button></td>`}</tr>`).join('') + '</table></div>'
          : `<div class="empty">${unYm ? '이 달에 적은 특이사항이 없습니다.' : '적은 특이사항이 없습니다.'}</div>`) + '</div>';
      document.getElementById('notes-body').innerHTML = h;
      if (unYm && dcYm !== unYm) dcYm = unYm; setTimeout(renderDayCmp, 0);
    }
    function unWriteFor(ds) { // 비교표에서 [+ 적기] → 위 입력칸에 날짜 넣고 내용으로 이동
      if (unEditId) { unEditId = null; renderNotes(); }
      const d = document.getElementById('un-d'), t = document.getElementById('un-text'); if (!d || !t) return;
      d.value = ds; document.querySelector('#notes-body .card').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => t.focus(), 300);
    }
    function unCatChange(c) { const set = UN_UTIL_DEF[c] || []; document.querySelectorAll('.un-ut').forEach(x => { x.checked = set.includes(x.value); }); }
    function unShift(n) { unYm = n > 0 ? UT.nextYm(unYm || thisYm) : UT.prevYm(unYm || thisYm); renderNotes(); }
    async function unSave() {
      const d = document.getElementById('un-d').value, cat = document.getElementById('un-cat').value, eq = document.getElementById('un-eq').value.trim(),
        text = document.getElementById('un-text').value.trim(), act = document.getElementById('un-act').value.trim(), utils = [...document.querySelectorAll('.un-ut:checked')].map(x => x.value);
      if (!d || !text) { alert('날짜와 내용을 넣어 주세요.'); return; }
      const id = unEditId, now = new Date().toISOString();
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
      const U = UT.UTILS.find(u => u.k === uk);
      return `<h3>이 기간 특이사항 <span class="sub">${ymLabel(a)} ~ ${ymLabel(b)} · ${U.name} 관련 · [특이사항] 탭에서 적음</span></h3>` +
        (L.length ? `<ul class="un-list">${L.map(n => `<li>${unLine(n)}</li>`).join('')}</ul>` : `<div class="hint">이 기간에 적은 ${U.name} 관련 특이사항이 없습니다. 원인 확인이 필요하면 <a href="#" onclick="showTabByName('notes');return false">특이사항</a>에 적어 두세요.</div>`);
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
    const DC_P = [['rm', '원육 투입 kg'], ['ea', '포장 EA'], ['prepH', '전처리 h'], ['steamH', '자숙 h'], ['crushH', '파쇄 h'], ['packH', '포장 h']];
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
      let h = `<div class="toolbar"><div class="month-nav"><button onclick="dcYm=UT.prevYm(dcYm);if(unYm){unYm=dcYm;renderNotes()}else renderDayCmp()">◀</button><span>${ymLabel(dcYm)}</span><button onclick="dcYm=UT.nextYm(dcYm);if(unYm){unYm=dcYm;renderNotes()}else renderDayCmp()">▶</button></div>
        <span class="hint">그래프: </span><span class="chips">${DC_U.map(u => `<button class="chip ${dcU === u[0] ? 'on' : ''}" onclick="dcU='${u[0]}';renderDayCmp()">${u[1]}</button>`).join('')}</span>
        <span class="hint">와 </span><span class="chips">${DC_P.map(x => `<button class="chip ${dcP === x[0] ? 'on' : ''}" onclick="dcP='${x[0]}';renderDayCmp()">${x[1]}</button>`).join('')}</span></div>
        <div class="chart-box" style="height:260px"><canvas id="dc-chart"></canvas></div>
        <div class="tbl-wrap" style="margin-top:10px"><table class="t dc-t"><tr><th rowspan="2">날짜</th><th colspan="2">전처리 원육 투입</th><th rowspan="2" class="l">포장 제품 · EA</th><th colspan="4">공정별 작업시간 (h)</th><th colspan="4">유틸리티 사용량</th><th rowspan="2" class="l">특이사항</th></tr>
        <tr><th class="l">부위</th><th>kg</th><th>전처리</th><th>자숙</th><th>파쇄</th><th>포장</th>${DC_U.map(u => `<th>${u[1]}<br><span class="hint">${u[2]}</span></th>`).join('')}</tr>` +
        rows.map(r => { const p = r.p, w = new Date(r.ds + 'T00:00:00').getDay(), parts = p ? Object.entries(p.rmParts || {}) : [];
          const items = p && p.packItems && p.packItems.length ? p.packItems.map(x => `${x.name} ${f0(x.ea)}`).join('\n') : '';
          return `<tr class="${!p ? 'dc-off' : ''}"><td>${Number(r.ds.slice(8))}일 (<span class="${w === 0 ? 'dc-sun' : w === 6 ? 'dc-sat' : ''}">${W[w]}</span>)</td>
            <td class="l">${parts.length ? parts.map(([k]) => esc(k)).join('<br>') : (p ? '' : '<span class="hint">생산 없음</span>')}</td><td>${parts.length ? parts.map(([, v]) => f0(v)).join('<br>') : ''}</td>
            <td class="l dc-pack">${p && p.packItems && p.packItems.length ? (() => { const m = {}; p.packItems.forEach(x => { const k = dcProdName(x.name); m[k] = (m[k] || 0) + x.ea; }); const e = Object.entries(m);
              return e.map(([k, v]) => `<div><span class="dc-pn">${esc(k)}</span> <b>${f0(v)}</b></div>`).join('') + (e.length > 1 ? `<div class="hint">계 ${f0(p.ea)}</div>` : ''); })() : (p && p.ea ? f0(p.ea) : '')}</td>
            <td>${p ? nh(p.prepH) : ''}</td><td>${p ? nh(p.steamH) : ''}</td><td>${p ? nh(p.crushH) : ''}</td><td>${p ? nh(p.packH) : ''}</td>${r.u.map(uv).map(x => `<td>${x}</td>`).join('')}<td class="l dc-note">${notesIn(r.ds, r.ds).map(n => `<div><span class="un-cat">${esc(n.cat)}</span> ${esc(n.text)}</div>`).join('')}${isAdmin() ? `<button class="btn secondary small" onclick="unWriteFor('${r.ds}')">+ 적기</button>` : ''}</td></tr>`; }).join('') +
        (() => { const pd = rows.filter(r => r.p && r.p.rm > 0), np = pd.length;
          const tot = `<tr class="dc-sum"><td>합계</td><td class="l">${(() => { const t = {}; pd.forEach(r => Object.entries(r.p.rmParts || {}).forEach(([k, v]) => { t[k] = (t[k] || 0) + v; })); return Object.keys(t).map(esc).join('<br>'); })()}</td>
            <td>${(() => { const t = {}; pd.forEach(r => Object.entries(r.p.rmParts || {}).forEach(([k, v]) => { t[k] = (t[k] || 0) + v; })); return Object.values(t).map(f0).join('<br>'); })()}</td>
            <td class="l dc-pack">${(() => { const m = {}; pd.forEach(r => (r.p.packItems || []).forEach(x => { const k = dcProdName(x.name); m[k] = (m[k] || 0) + x.ea; })); return Object.entries(m).map(([k, v]) => `<div><span class="dc-pn">${esc(k)}</span> <b>${f0(v)}</b></div>`).join(''); })()}<div>계 ${f0(sum(r => r.p && r.p.ea))}</div></td>${['prepH', 'steamH', 'crushH', 'packH'].map(k => `<td>${nf1.format(sum(r => r.p && r.p[k]))}</td>`).join('')}${DC_U.map((u, i) => `<td>${f0(sum(r => r.u[i]))}</td>`).join('')}<td></td></tr>`;
          const avg = (f, rs) => { const v = rs.map(f).filter(x => x !== null && x !== undefined && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
          const off = rows.filter(r => !r.p);
          const a1 = `<tr class="dc-sum"><td>생산일 평균<br><span class="hint">${np}일</span></td><td></td><td>${np ? f0(sum(r => r.p && r.p.rm) / np) : ''}</td><td>${np ? f0(sum(r => r.p && r.p.ea) / np) : ''}</td>${['prepH', 'steamH', 'crushH', 'packH'].map(k => `<td>${np ? nf1.format(sum(r => r.p && r.p[k]) / np) : ''}</td>`).join('')}${DC_U.map((u, i) => `<td>${uv(avg(r => r.u[i], pd))}</td>`).join('')}<td></td></tr>`;
          const a2 = `<tr class="dc-sum"><td>쉬는 날 평균<br><span class="hint">${off.length}일</span></td><td colspan="7"></td>${DC_U.map((u, i) => `<td>${uv(avg(r => r.u[i], off))}</td>`).join('')}<td></td></tr>`;
          return tot + a1 + a2; })() + '</table></div>' +
        `<div class="hint" style="margin-top:4px">생산 자료는 생산 대시보드 일별 요약(읽기만). 원육 kg은 그날 전처리 투입량이고 월 공식값(원육 투입량)과는 마지막 수정분만큼 다를 수 있습니다. 포장 제품명은 생산 대시보드 포장 공정에 적힌 이름(부위 뒤 제품명)입니다. 사용량은 그날 아침 → 다음날 아침 검침 차이입니다 (전기는 파워플래너 일별값).</div>`;
      h += dcCorrHtml();
      el.innerHTML = h;
      const U = DC_U.find(u => u[0] === dcU), PP = DC_P.find(x => x[0] === dcP);
      mkChart('dc-chart', { data: { labels: rows.map(r => Number(r.ds.slice(8)) + '일'), datasets: [
          { type: 'bar', label: `${U[1]} ${U[2]}`, data: rows.map(r => r.u[DC_U.indexOf(U)]), backgroundColor: U[3] + 'bb', yAxisID: 'y', order: 2 },
          { type: 'line', label: PP[1], data: rows.map(r => r.p ? (r.p[dcP] || 0) : 0), borderColor: '#333', backgroundColor: '#333', pointRadius: 3, borderWidth: 1.5, yAxisID: 'y2', order: 1 }] },
        options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } },
          scales: { y: { beginAtZero: true, title: { display: true, text: U[2] } }, y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: PP[1] } } } } });
    }

    // 연관성(상관계수) — 생산한 날만, 기간 끝 = 선택한 달 말일
    function dcCorrHtml() {
      const end = UT.dateStr(dcYm, UT.daysIn(dcYm)) > todayStr ? UT.addDays(todayStr, -1) : UT.dateStr(dcYm, UT.daysIn(dcYm));
      let st = dcYm; for (let i = 1; i < dcRange; i++) st = UT.prevYm(st); const from = UT.dateStr(st, 1);
      const days = []; for (let ds = from; ds <= end; ds = UT.addDays(ds, 1)) { const p = PRODD[ds]; if (p && p.rm > 0) days.push({ ds, p, t: (TEMPS || {})[ds], u: DC_U.map(u => u[4](ds)) }); }
      const cols = [...DC_P, ['temp', '평균기온 ℃']], xv = (d, k) => k === 'temp' ? (d.t === undefined || d.t === null ? null : d.t) : (d.p[k] || 0);
      const M = DC_U.map((u, ui) => cols.map(([k]) => { const v = days.filter(d => d.u[ui] !== null && d.u[ui] !== undefined && !isNaN(d.u[ui]) && xv(d, k) !== null); return pearson(v.map(d => xv(d, k)), v.map(d => d.u[ui])); }));
      const lvl = r => { const a = Math.abs(r); return a >= 0.7 ? '강함' : a >= 0.4 ? '보통' : a >= 0.2 ? '약함' : '거의 없음'; };
      const bg = r => { const a = Math.min(1, Math.abs(r)); return r >= 0 ? `rgba(42,120,214,${(a * 0.75).toFixed(2)})` : `rgba(217,48,37,${(a * 0.6).toFixed(2)})`; };
      const unitX = { rm: 'kg', ea: 'EA', prepH: 'h', steamH: 'h', crushH: 'h', packH: 'h', temp: '℃' }, per = { rm: 1000, ea: 10000, temp: 1 };
      const slope = (c, k, u) => { const m = per[k] || 1, v = c.b * m; return `${unitX[k] === 'h' ? '1h' : k === 'temp' ? '1℃' : (m === 1000 ? '1,000' : '10,000') + unitX[k]}당 ${v >= 0 ? '+' : ''}${Math.abs(v) >= 100 ? f0(v) : nf1.format(v)} ${u[2]}`; };
      // 생산 항목끼리의 연관 (서로 같이 움직이면 어느 게 진짜 원인인지 구분 어려움)
      const PX = cols.map(([k]) => cols.map(([k2]) => { const v = days.filter(d => xv(d, k) !== null && xv(d, k2) !== null); return pearson(v.map(d => xv(d, k)), v.map(d => xv(d, k2))); }));
      let h = `<h4 style="margin:18px 0 6px">연관성 검토 (상관계수 r) <span class="hint">생산한 날 ${days.length}일 · ${from} ~ ${end}</span></h4>
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
