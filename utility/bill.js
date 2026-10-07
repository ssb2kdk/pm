// =====================================================================
// 고지서 자동 읽기 (OCR 결과 / PDF 글자 → 월간입력 값)
//  - 좌표는 모두 가로 662 기준으로 맞춘 값 (A4 세로 ≈ 936)
// =====================================================================
(function (root) {
  const BILL = {};
  const NW = 662;

  // ---------- 페이지 모델 ----------
  // words: [{t, x0,y0,x1,y1, c}] (원래 픽셀 좌표), W: 원본 가로 픽셀
  BILL.makePage = function (words, W) {
    const s = NW / W;
    const ws = words.filter(w => (w.t || '').trim()).map(w => ({
      t: w.t.trim(), c: w.c == null ? 100 : w.c,
      x0: w.x0 * s, y0: w.y0 * s, x1: w.x1 * s, y1: w.y1 * s
    }));
    ws.forEach(w => { w.yc = (w.y0 + w.y1) / 2; w.xc = (w.x0 + w.x1) / 2; w.h = w.y1 - w.y0; });
    // 같은 높이의 단어를 한 줄(row)로 묶기
    const sorted = ws.slice().sort((a, b) => a.yc - b.yc);
    const rows = [];
    sorted.forEach(w => {
      const h = Math.max(4, Math.min(w.h, 14));
      let r = rows.find(r => Math.abs(r.yc - w.yc) < Math.max(3, Math.min(h, r.h) * 0.55));
      if (!r) { r = { words: [], yc: w.yc, h }; rows.push(r); }
      r.words.push(w);
      r.yc = r.words.reduce((a, x) => a + x.yc, 0) / r.words.length;
      r.h = Math.max(r.h, h);
    });
    rows.forEach(r => {
      r.words.sort((a, b) => a.x0 - b.x0);
      r.y0 = Math.min(...r.words.map(w => w.y0)); r.y1 = Math.max(...r.words.map(w => w.y1));
      r.text = r.words.map(w => w.t).join(' ');
      r.ns = nsOf(r.text);
    });
    rows.sort((a, b) => a.yc - b.yc);
    const text = rows.map(r => r.text).join('\n');
    return { words: ws, rows, text, ns: nsOf(text) };
  };
  function nsOf(t) { return String(t).replace(/[\s·ㆍ.,_'"`~\-|:;!/()（）\[\]{}<>「」『』、。]/g, ''); }

  // pdf.js 글자 → 단어 목록
  BILL.wordsFromPdfText = function (items, vpH) {
    const out = [];
    items.forEach(it => {
      const str = it.str; if (!str || !str.trim()) return;
      const x = it.transform[4], yb = vpH - it.transform[5];
      const h = Math.abs(it.transform[3]) || it.height || 8;
      // 띄어쓰기 기준으로 쪼갬 (글자 폭은 비례 배분)
      const parts = str.split(/(\s+)/); let off = 0; const cw = it.width / Math.max(1, str.length);
      parts.forEach(p => {
        if (p.trim()) out.push({ t: p, x0: x + off * cw, x1: x + (off + p.length) * cw, y0: yb - h, y1: yb, c: 100 });
        off += p.length;
      });
    });
    return out;
  };

  // ---------- 찾기 도우미 ----------
  function inX(w, xr) { return !xr || (w.xc >= xr[0] && w.xc <= xr[1]); }
  // 정규식에 맞는 줄 (xr: 그 가로 범위 안 단어만으로 비교)
  function findRows(pg, re, xr) {
    return pg.rows.filter(r => re.test(nsOf(r.words.filter(w => inX(w, xr)).map(w => w.t).join(''))));
  }
  function findRow(pg, re, opt = {}) {
    let rs = findRows(pg, re, opt.xr);
    if (opt.below != null) rs = rs.filter(r => r.yc > opt.below);
    if (opt.above != null) rs = rs.filter(r => r.yc < opt.above);
    return rs[opt.occ || 0] || null;
  }
  // 띠(y0~y1) × 가로범위 안의 숫자 덩어리들
  function numsIn(pg, y0, y1, xr) {
    const ws = pg.words.filter(w => w.yc >= y0 && w.yc <= y1 && inX(w, xr) && /\d/.test(w.t)).sort((a, b) => a.x0 - b.x0);
    const out = [];
    ws.forEach(w => {
      const last = out[out.length - 1];
      // "440," + "898" 처럼 쪼개진 숫자 붙이기
      if (last && w.x0 - last.x1 < 3.5 && /[,.]$/.test(last.raw) && /^\d/.test(w.t)) {
        last.raw += w.t; last.x1 = w.x1; last.y0 = Math.min(last.y0, w.y0); last.y1 = Math.max(last.y1, w.y1); last.c = Math.min(last.c, w.c);
      } else out.push({ raw: w.t, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, c: w.c });
    });
    return out;
  }
  function rowNums(pg, row, xr, pad = 0) { return row ? numsIn(pg, row.y0 - pad, row.y1 + pad, xr) : []; }

  // 숫자 해석. dp = 소수 자릿수 (점이 빠져 읽혀도 자릿수로 맞춤)
  BILL.num = function (raw, dp = 0, allowNeg = false) {
    if (raw == null) return null;
    let s = String(raw).replace(/[OoD]/g, '0').replace(/[Il|]/g, '1').replace(/[Ss]/g, '5').trim();
    if (!/[,.]/.test(s)) s = s.replace(/(\d)\s+(?=\d)/g, '$1'); // "424 1" → 4241 (쉼표 없는 숫자만)
    const neg = allowNeg && /^[^\d]*[-−]\s*\d/.test(s);
    if (dp > 0) {
      // 마지막 구분자 뒤 숫자가 dp 자리면 그대로, 아니면 숫자만 이어붙여 dp로 나눔
      const m = s.match(/(\d[\d,.\s]*)/); if (!m) return null;
      const digits = m[1].replace(/[^\d]/g, '');
      if (!digits) return null;
      const v = Number(digits) / Math.pow(10, dp);
      return neg ? -v : v;
    }
    const m = s.match(/\d[\d,.]*/); if (!m) return null;
    let d = m[0].replace(/[.,]\d{1,2}$/, ''); // 원 단위 뒤 잡음 제거
    d = d.replace(/[^\d]/g, '');
    if (!d) return null;
    return neg ? -Number(d) : Number(d);
  };
  // 숫자 전용 재인식 결과 (pg.rx[name] = {raw, c, box})
  function R(pg, name) { const r = pg.rx && pg.rx[name]; return r && /\d/.test(r.raw) ? { raw: r.raw, c: r.c, ...r.box } : null; }
  // 두 후보 중 하나 (재인식 값 우선, 없으면 일반 인식 값)
  function best(a, b) { return a || b || null; }
  function pick(list, i) { return list[i < 0 ? list.length + i : i] || null; }
  function box(n) { return n ? { x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 } : null; }
  function boxRow(r, xr) { return r ? { x0: xr ? xr[0] : 0, x1: xr ? xr[1] : NW, y0: r.y0 - 2, y1: r.y1 + 2 } : null; }

  // 결과 항목 만들기
  function F(out, k, label, n, dp, extra = {}) {
    const v = n ? BILL.num(n.raw, dp) : null;
    out.push({ k, label, v, raw: n ? n.raw : '', box: box(n), low: n ? n.c < 60 : true, ...extra });
    return v;
  }
  // 고지서 안 날짜(납기·발행일) 중 가장 이른 달의 전월 = 사용월
  function minDateYm(pg) {
    const ds = [...pg.text.matchAll(/(20\d\d)\s*[.\/-]\s*(\d\d)\s*[.\/-]\s*(\d\d)/g)].filter(d => +d[1] >= 2024 && +d[1] <= 2099 && +d[2] >= 1 && +d[2] <= 12 && +d[3] >= 1 && +d[3] <= 31).map(d => d[1] + '-' + d[2]).sort();
    return ds.length ? prevYm(ds[0]) : null;
  }
  function ymFrom(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }
  function prevYm(ym) { let [y, m] = ym.split('-').map(Number); m--; if (!m) { m = 12; y--; } return ymFrom(y, m); }

  // =====================================================================
  // 고지서 종류별 해석
  // =====================================================================
  const T = BILL.TYPES = {};

  // ---------- 전기 상세 청구내역서 (한전 ON → 청구내역서) ----------
  T.elec_detail = {
    name: '전기 청구내역서 (한전)',
    rects: () => ({ u1: [110, 453, 172, 470], u2: [174, 453, 236, 470], u3: [237, 453, 299, 470] }),
    test: ns => /전기요금청구내역서/.test(ns) || (/요금계산내역/.test(ns) && /계절별사용량/.test(ns)),
    parse(pg) {
      const out = [], warn = [];
      let ym = null; const m = pg.ns.match(/\d?\d?(\d\d)년(\d{1,2})월분/); if (m) ym = ymFrom('20' + m[1], m[2]);
      // ① 사용량 칸 (고정 위치 재인식)  ② 배수(720 720 720) 다음 줄  ③ 요금계산내역의 kWh  ④ 지침차 × 배수
      const tbl = pg.rows.filter(r => r.yc > 330 && r.yc < 500).map(r => ({ r, n: numsIn(pg, r.y0, r.y1, [100, 360]) })).filter(x => x.n.length >= 3);
      const iMul = tbl.findIndex(x => { const v = x.n.map(n => BILL.num(n.raw)); return v.filter(y => y === v[0]).length >= 3 && v[0] >= 1; });
      const mul = iMul >= 0 ? BILL.num(tbl[iMul].n[0].raw) : null;
      const diffs = iMul > 0 ? tbl[iMul - 1].n.map(n => BILL.num(n.raw, 2)) : [];
      const rowU = iMul >= 0 && tbl[iMul + 1] ? tbl[iMul + 1].n : rowNums(pg, findRow(pg, /^사.{0,2}량$/, { xr: [0, 100], below: 380, above: 520 }), [100, 360], 1);
      // 전력량요금 줄: "47,714 kWh x 121.5 − 2,349 kWh x 60.7 원" (뒤쪽은 주말 할인, 없을 수도 있음) — 위에서부터 경부하·중간부하·최대부하
      const rr = pg.rows.filter(r => r.yc > 525 && r.yc < 660).map(r => { const n = numsIn(pg, r.y0, r.y1, [285, 512]);
        if (n.length >= 4) return { kwh: n[0], rate: n[1], wkwh: n[2], wrate: n[3] };
        return { kwh: numsIn(pg, r.y0, r.y1, [395, 445])[0], rate: numsIn(pg, r.y0, r.y1, [470, 506])[0] }; }).filter(x => x.kwh && x.rate);
      const ul = [['elec_kwh_light', '경부하 사용량'], ['elec_kwh_mid', '중간부하 사용량'], ['elec_kwh_peak', '최대부하 사용량']];
      const uv = ul.map(([k, label], i) => {
        const cands = [R(pg, 'u' + (i + 1)), pick(rowU, i), rr[i] && rr[i].kwh].filter(Boolean);
        const vals = cands.map(c => BILL.num(c.raw));
        const calc = mul && diffs[i] != null ? Math.round(diffs[i] * mul) : null;
        // 두 군데 이상에서 같은 값 → 그 값, 아니면 계산값과 맞는 값, 아니면 첫 값
        let j = vals.findIndex((v, a) => v != null && vals.some((w, b) => b !== a && w === v));
        if (j < 0 && calc != null) j = vals.findIndex(v => v != null && Math.abs(v - calc) <= 1);
        if (j < 0) j = vals.findIndex(v => v != null);
        const v = F(out, k, label, j >= 0 ? cands[j] : null, 0);
        if (v == null && calc != null) { const o = out[out.length - 1]; o.v = calc; o.raw = `지침차 ${diffs[i]} × ${mul}`; o.low = true; }
        else if (v != null && calc != null && Math.abs(v - calc) > 1) warn.push(`${label} ${v.toLocaleString()} 이 지침차×배수(${calc.toLocaleString()})와 다릅니다. 확인하세요.`);
        return out[out.length - 1].v;
      });
      const rt = findRow(pg, /^합계/, { xr: [0, 120] });
      const tot = BILL.num((pick(rowNums(pg, rt, [150, 300]), 0) || {}).raw);
      if (tot && uv.every(v => v != null) && uv[0] + uv[1] + uv[2] !== tot) warn.push(`부하별 합 ${(uv[0] + uv[1] + uv[2]).toLocaleString()} ≠ 합계 ${tot.toLocaleString()} kWh`);
      // 기본요금 줄 "507 kW x 7,220 원" (글자로 된 제목이 없는 PDF도 있음)
      const rbx = pg.rows.find(r => r.yc > 500 && r.yc < 532 && /kW.*x.*원/i.test(r.text.replace(/\s/g, '')));
      const bxn = rbx ? numsIn(pg, rbx.y0, rbx.y1, [380, 512]) : [];
      F(out, 'elec_contract_kw', '요금적용 전력', pick(rowNums(pg, findRow(pg, /요금적.{0,2}전력/), [150, 300]), 0) || (bxn.length >= 2 ? bxn[0] : null), 0);
      // 단가: "49,982 kWh x 121.5 원" 줄이 위에서부터 경부하·중간부하·최대부하
      const rb = findRow(pg, /^기본요금/, { xr: [40, 200] });
      F(out, 'elec_base_rate', '기본요금 단가', pick(rowNums(pg, rb, [470, 640]), 0) || (bxn.length >= 2 ? bxn[1] : null), 0);
      [['elec_rate_light', '경부하 단가'], ['elec_rate_mid', '중간부하 단가'], ['elec_rate_peak', '최대부하 단가']].forEach(([k, label], i) => F(out, k, label, rr[i] ? rr[i].rate : null, 1));
      // 주말 할인 (경부하·중간부하): 할인 줄이 없으면 0으로 채움 (전달 값이 남지 않게)
      [['light', '경부하', 0], ['mid', '중간부하', 1]].forEach(([b, nm, i]) => {
        const x = rr[i];
        if (x && x.wkwh) { F(out, 'elec_wkd_kwh_' + b, `주말 ${nm} 할인 사용량`, x.wkwh, 0); F(out, 'elec_wkd_rate_' + b, `주말 ${nm} 할인 단가`, x.wrate, 1); }
        else if (x) out.push({ k: 'elec_wkd_kwh_' + b, label: `주말 ${nm} 할인 사용량`, v: 0, raw: '할인 없음', box: box(x.rate) });
      });
      const wk = rr.slice(0, 2).filter(x => x.wkwh);
      if (wk.length) warn.push(`주말 할인이 있는 달입니다: ${wk.map((x, i) => `${i ? '중간부하' : '경부하'} ${x.wkwh.raw} kWh × ${x.wrate.raw}원`).join(', ')} 를 빼서 계산합니다.`);
      // 역률 "지상역률: 93%"
      const pfRow = findRow(pg, /지상역률\d/) || pg.rows.find(r => /(^|[^진])역률\d{2,3}%/.test(r.ns) && !/진상역률/.test(r.ns));
      const pf = pfRow ? pfRow.ns.match(/역률(\d{2,3})%/) : null;
      out.push({ k: 'elec_pf', label: '지상역률', v: pf ? Number(pf[1]) / 100 : null, raw: pf ? pf[1] + '%' : '', box: boxRow(pfRow, [380, 640]) });
      const pl = pg.ns.match(/진상역률(\d{2,3})%/);
      out.push({ k: 'elec_pf_lead', label: '진상역률', v: pl ? Number(pl[1]) / 100 : null, raw: pl ? pl[1] + '%' : '', box: boxRow(findRow(pg, /진상역률\d/), [380, 640]) });
      // 금액
      const amt = (re, xr) => pick(rowNums(pg, findRow(pg, re, { xr: [40, 200] }), xr || [140, 260]), 0);
      const fee = BILL.num((amt(/^전기요금계/) || {}).raw);
      const fund = BILL.num((amt(/^전력기금/) || {}).raw);
      const vat = BILL.num((amt(/^부가가치세/) || {}).raw);
      let total = F(out, 'elec_bill_total', '전기 청구액 (부가세 포함)', amt(/^당월요금계/), 0);
      if (fee != null && vat != null && fund != null) {
        const calc = Math.floor((fee + vat + fund) / 10) * 10, o = out[out.length - 1];
        if (total !== calc) { if (total != null) warn.push(`청구액이 ${total.toLocaleString()} 으로 읽혔지만 계산하면 ${calc.toLocaleString()} 입니다. 계산값을 넣었습니다.`); o.v = total = calc; }
      }
      const rq = findRow(pg, /청구금액/);
      if (total == null && rq) total = F(out, 'elec_bill_total', '전기 청구액', pick(rowNums(pg, rq, [200, 400]), 0), 0);
      const n = amt(/^전기요금계/);
      out.push({ k: 'elec_bill_exvat', label: '전기 부가세 별도 금액 (전기요금계 + 전력기금)', v: fee != null && fund != null ? fee + fund : null, raw: `${fee ?? '?'} + ${fund ?? '?'}`, box: box(n) });
      return { ym, out, warn };
    }
  };

  // ---------- 전기 이메일 청구서 ----------
  T.elec_mail = {
    name: '전기 이메일 청구서 (한전)',
    test: ns => /이메일청구/.test(ns) || (/전기요금/.test(ns) && /청구내역/.test(ns) && /요금계/.test(ns) && !/요금계산내역/.test(ns)),
    parse(pg) {
      const out = [], warn = [];
      let ym = null; const m = pg.ns.match(/(20\d\d)년(\d{1,2})월/); if (m) ym = ymFrom(m[1], m[2]);
      const amt = re => pick(rowNums(pg, findRow(pg, re, { xr: [30, 118], above: 520 }), [110, 190]), 0);
      const fn = amt(/^전.{0,4}금.?계$/), vn = amt(/치세$/), dn = amt(/^.{0,3}기금$/);
      const fee = BILL.num((fn || {}).raw), vat = BILL.num((vn || {}).raw), fund = BILL.num((dn || {}).raw);
      const tn = amt(/^.월요.{0,3}$/);
      let total = BILL.num((tn || {}).raw);
      if (fee != null && vat != null && fund != null) {
        const calc = Math.floor((fee + vat + fund) / 10) * 10;
        if (total !== calc) { if (total != null) warn.push(`청구액이 ${total.toLocaleString()} 으로 읽혔지만 요금계+부가세+기금으로 계산하면 ${calc.toLocaleString()} 입니다. 계산값을 넣었습니다.`); total = calc; }
      }
      out.push({ k: 'elec_bill_total', label: '전기 청구액 (부가세 포함)', v: total, raw: tn ? tn.raw : '', box: box(tn || fn) });
      out.push({ k: 'elec_bill_exvat', label: '전기 부가세 별도 금액 (전기요금계 + 전력기금)', v: fee != null && fund != null ? fee + fund : null, raw: `${fee ?? '?'} + ${fund ?? '?'}`, box: box(fn) });
      const pr = findRow(pg, /지상역률\d/, { xr: [180, 320] });
      const pv = pr ? (pr.ns.match(/지상역률(\d{2,3})/) || [])[1] : null;
      out.push({ k: 'elec_pf', label: '지상역률', v: pv ? Number(pv) / 100 : null, raw: pv || '', box: boxRow(pr, [180, 320]) });
      warn.push('이메일 청구서에는 부하별 사용량·단가가 없습니다. "청구내역서"(상세)를 올리면 더 많이 채워집니다.');
      return { ym, out, warn };
    }
  };

  // ---------- 도시가스 1장 (청구액) ----------
  T.gas_main = {
    name: '도시가스 고지서 (앞면)',
    rects: () => ({ tot: [248, 521, 312, 537] }),
    test: ns => /도시가스/.test(ns) && /공급가액/.test(ns) && !/청구상세내역/.test(ns),
    parse(pg) {
      const out = [], warn = [];
      let ym = null; const m = pg.ns.match(/사용기간(20\d\d)(\d\d)01/); if (m) ym = ymFrom(m[1], m[2]);
      const m2 = !ym && pg.ns.match(/(20\d\d)(\d\d)월청구분/); if (m2) ym = prevYm(ymFrom(m2[1], m2[2]));
      const m3 = !ym && pg.text.match(/(20\d\d)\s*\.\s*(\d\d)\s*\.?\s*,?\s*01\s*[~-]/); if (m3) ym = ymFrom(m3[1], m3[2]);
      const rs = findRow(pg, /공급가액/, { xr: [0, 170] });
      const ex = F(out, 'gas_bill_exvat', '가스 공급가액', pick(rowNums(pg, rs, [80, 190]), 0), 0);
      const rt = findRow(pg, /^합계/, { xr: [150, 250] }) || findRow(pg, /공급자등록번호/, { xr: [0, 120] });
      const tn = best(R(pg, 'tot'), pick(rowNums(pg, rt, [230, 340]), 0));
      const tv = F(out, 'gas_bill_total', '가스 청구액 (부가세 포함)', tn, 0);
      if (ex != null) { // 청구액 = 공급가액 + 부가세(10%, 원 미만 버림)
        const calc = ex + Math.floor(ex / 10), o = out[out.length - 1];
        if (tv !== calc) { if (tv != null && Math.abs(tv - calc) > 10) warn.push(`청구액이 ${tv.toLocaleString()} 으로 읽혔지만 공급가액+부가세로 계산하면 ${calc.toLocaleString()} 입니다. 계산값을 넣었습니다.`); if (tv == null || Math.abs(tv - calc) > 10) o.v = calc, o.low = true; }
      }
      return { ym, out, warn };
    }
  };

  // ---------- 도시가스 2장 (상세내역) ----------
  // 열: 전월지침 / 당월지침 / 보정계수 / 사용량 / 열량계수 / 청구량 / 단가 / 소계
  const GX = { prev: [205, 286], cur: [286, 337], corr: [337, 388], m3: [388, 438], heat: [438, 482], mj: [482, 550], price: [550, 595], sub: [595, 655] };
  T.gas_detail = {
    name: '도시가스 고지서 (상세내역)',
    test: ns => /도시가스요금청구상세내역/.test(ns) || (/설치번호/.test(ns) && /가스사용료/.test(ns)),
    parse(pg) {
      const out = [], warn = [];
      const heads = findRows(pg, /설치번호/);
      const uses = findRows(pg, /^가스사용료/, [0, 80]);
      const fees = findRows(pg, /^보정기교체/, [0, 80]);
      let ym = null; const m = pg.ns.match(/(\d\d)01[~\-](\d\d)(30|31|28|29)/);
      const block = r => { // r 이 속한 설치번호 블록 (기계실=보일러, 식당)
        const h = heads.filter(x => x.yc < r.yc).pop();
        return h && /식당/.test(h.ns) ? 'rest' : 'boiler';
      };
      uses.forEach(r => {
        const b = block(r), p = b === 'rest' ? 'gas_rest_' : 'gas_boiler_', nm = b === 'rest' ? '식당' : '보일러';
        const g = xr => pick(rowNums(pg, r, xr, 2), 0);
        const prev = F(out, p + 'prev', `${nm} 전월지침`, g(GX.prev), 4);
        const cur = F(out, p + 'cur', `${nm} 당월지침`, g(GX.cur), 4);
        const cn = g(GX.corr);
        const corr = cn ? F(out, b === 'rest' ? 'gas_rest_corr' : 'gas_boiler_corr', `${nm} 보정계수`, cn, 6)
          : (out.push({ k: b === 'rest' ? 'gas_rest_corr' : 'gas_boiler_corr', label: `${nm} 보정계수 (빈칸 = 1)`, v: 1, raw: '', box: boxRow(r, GX.corr) }), 1);
        const m3 = BILL.num((g(GX.m3) || {}).raw, 4);
        F(out, b === 'rest' ? 'gas_rest_heat' : 'gas_heat', `${nm} 열량계수`, g(GX.heat), 4);
        if (b === 'boiler') F(out, 'gas_price', '단가', g(GX.price), 4);
        if (prev != null && cur != null && m3 != null) {
          const calc = Math.round((cur - prev) * corr * 10000) / 10000;
          if (Math.abs(calc - m3) > 0.01) warn.push(`${nm}: (당월−전월)×보정계수 = ${calc.toLocaleString()} 인데 고지서 사용량은 ${m3.toLocaleString()} → 지침을 확인하세요`);
        }
      });
      fees.forEach(r => {
        const b = block(r);
        F(out, b === 'rest' ? 'gas_rest_corrector_fee' : 'gas_corrector_fee', `보정기교체비 (${b === 'rest' ? '식당' : '보일러'})`, pick(rowNums(pg, r, [540, 655], 2), -1), 0);
      });
      if (!uses.length) warn.push('"가스사용료" 줄을 찾지 못했습니다.');
      return { ym, out, warn };
    }
  };

  // ---------- 상수도 (익산시 상·하수도 요금 고지서) ----------
  T.water = {
    name: '상수도 고지서 (익산시)',
    rects: () => ({ prev: [57, 537, 100, 562], cur: [133, 537, 179, 562], use: [80, 566, 122, 586], amt: [236, 401, 318, 416], tot: [540, 746, 642, 771] }),
    test: ns => /하수도/.test(ns) && /(요금고지서|납입영수증|수전번호)/.test(ns),
    parse(pg) {
      const out = [], warn = [];
      let ym = null; const m = pg.ns.match(/(20\d\d)년(\d\d)월분/); if (m) ym = prevYm(ymFrom(m[1], m[2]));
      if (!ym) ym = minDateYm(pg);
      // 구경 40 / 50 (사용량 줄 오른쪽) 또는 수전번호
      const ru = findRow(pg, /사용량/, { xr: [0, 120], below: 500, above: 620 });
      let size = null;
      const gm = (ru ? ru.ns : '').match(/구경?(40|50)/) || pg.ns.match(/구경(40|50)/);
      if (gm) size = gm[1];
      if (!size) { if (/2119/.test(pg.ns)) size = '50'; else if (/1726/.test(pg.ns)) size = '40'; }
      // 지침 (전월 / 당월)
      const rj = pg.rows.filter(r => r.yc > 520 && r.yc < 568 && numsIn(pg, r.y0, r.y1, [40, 200]).length);
      let prevN = null, curN = null;
      rj.forEach(r => { const ns = numsIn(pg, r.y0, r.y1, [45, 115]); const nc = numsIn(pg, r.y0, r.y1, [120, 200]); if (!prevN && ns.length) prevN = ns[0]; if (!curN && nc.length) curN = nc[0]; });
      // 두 번 읽은 값 중 자릿수가 더 많은 쪽 (재인식이 숫자를 빠뜨리는 경우 대비)
      const okJ = x => x && /^\d{2,7}$/.test(String(x.raw).replace(/[,.\s]/g, '')) ? x : null; // 지침 숫자 모양만
      const longer = (a, b) => { a = okJ(a); b = okJ(b); const d = x => x ? String(x.raw).replace(/\D/g, '').length : -1; return d(a) >= d(b) ? a : b; };
      prevN = longer(R(pg, 'prev'), prevN); curN = longer(R(pg, 'cur'), curN);
      const prev = BILL.num((prevN || {}).raw), cur = BILL.num((curN || {}).raw);
      const useN = best(R(pg, 'use'), ru ? pick(rowNums(pg, ru, [60, 140]), 0) : null);
      const use = useN ? BILL.num(useN.raw) : null;
      // 납기내 금액 (위 납부금액 칸) ↔ 총납부금액 (오른쪽 아래) 교차 확인
      const a1 = best(R(pg, 'amt'), pick(numsIn(pg, 398, 417, [230, 320]), 0));
      const a2 = best(R(pg, 'tot'), pick(rowNums(pg, findRow(pg, /총납부금액/), [500, 650], 2), 0));
      const v1 = BILL.num((a1 || {}).raw), v2 = BILL.num((a2 || {}).raw);
      let amtN = a1 || a2;
      if (v1 != null && v2 != null && v1 !== v2) warn.push(`납기내 금액 ${v1.toLocaleString()} 과 총납부금액 ${v2.toLocaleString()} 이 다르게 읽혔습니다. 확인하세요.`);
      const info = `${prev ?? '?'} → ${cur ?? '?'}`;
      if (size === '50') {
        F(out, 'w50_bill', '용수 50A 청구액', amtN, 0);
        if (use == null || use === 0) {
          out.push({ k: 'w_combined', label: '고지서 방식 (50A 사용량 없음 → 40A에 합산)', v: '합산', raw: '', box: boxRow(ru, [40, 200]) });
          out.push({ k: 'w50_usage', label: `50A 고지서 사용량 (지침 ${info})`, v: 0, raw: '', box: boxRow(ru, [40, 200]) });
        } else {
          out.push({ k: 'w_combined', label: '고지서 방식', v: '따로', raw: '' });
          F(out, 'w50_usage', `50A 고지서 사용량 (지침 ${info})`, useN, 0);
        }
      } else {
        F(out, 'w40_usage', `40A 고지서 사용량 (지침 ${info})`, useN, 0);
        F(out, 'w40_bill', '용수 40A 청구액', amtN, 0);
      }
      if (!size) warn.push('40A/50A 구분을 못 했습니다. 항목 이름을 확인하세요.');
      return { ym, out, warn, sub: size ? size + 'A' : '', meta: { water: size, diff: prev != null && cur != null ? cur - prev : null, use } };
    }
  };

  // ---------- 폐수 산출기준 (익산시, 엑셀/한글 PDF) ----------
  T.ww_calc = {
    name: '폐수 산출기준 (익산시)',
    test: ns => /산출기준/.test(ns) && /시설개선충당금/.test(ns),
    parse(pg) {
      const out = [], warn = [];
      let ym = null; const m = pg.ns.match(/(20\d\d)년(\d\d)월배출분/); if (m) ym = ymFrom(m[1], m[2]);
      // 아래 표: 구분 / QI / QOI / 개선 납기내 / 개선 납기후 / 사용료 납기내 / 사용료 납기후
      const tbl = findRow(pg, /개별오폐수배출량|개별오염부하량/);
      const below = tbl ? tbl.yc : 500;
      const r = re => findRow(pg, re, { xr: [30, 140], below });
      const ro = r(/^오수/), rw = r(/^폐수/), rt = r(/^당월합계/);
      F(out, 'ww_sewage', '2공장 오수량', pick(rowNums(pg, ro, [130, 200]), 0), 1);
      F(out, 'ww_flow', '2공장 폐수 발생량 (고지서 값)', pick(rowNums(pg, rw, [130, 200]), 0), 1, { note: '비우면 유량계 지침으로 계산됨' });
      const tn = rowNums(pg, rt, [250, 560]);
      // 개선 납기내 = x≈260~320 / 사용료 납기내 = x≈380~440
      const near = (lst, x) => lst.find(n => n.x0 < x + 40 && n.x1 > x - 10) || null;
      F(out, 'ww_improve_fee', '개선부담금', near(tn, 290), 0);
      F(out, 'ww_facility_fee', '시설사용료 (기타사용료)', near(tn, 430), 0);
      return { ym, out, warn };
    }
  };

  // ---------- 폐수 사용료 / 개선충당금 고지서 (익산시 세외수입) ----------
  T.ww_notice = {
    name: '폐수 고지서 (익산시)',
    rects: () => ({ a1: [398, 442, 492, 457], a2: [108, 845, 190, 862], a3: [334, 785, 398, 800], a4: [108, 781, 190, 798] }),
    test: ns => /공공폐수처리시설/.test(ns) && /(부과안내|납부고지|고지서)/.test(ns),
    parse(pg) {
      const out = [], warn = [];
      const improve = /개선충당금/.test(pg.ns) || /부담금/.test(pg.ns.slice(0, 400));
      const k = improve ? 'ww_improve_fee' : 'ww_facility_fee';
      const label = improve ? '개선부담금' : '시설사용료 (기타사용료)';
      // "납부금액" 줄 (부과안내 상자) → 없으면 "합계금액" 줄 왼쪽
      let n = pick(rowNums(pg, findRow(pg, /^납부금액/, { xr: [180, 330] }), [300, 560]), 0)
        || pick(rowNums(pg, findRow(pg, /납부금액/), [300, 560]), 0)
        || pick(rowNums(pg, findRow(pg, /합계금액/), [60, 200]), 0);
      // 같은 금액이 여러 칸에 나오므로 가장 많이 나온 값으로 교차 확인
      const cnt = {};
      const add = (t, wgt) => { t = String(t).replace(/[^\d,.]/g, ''); if (/^\d{1,3}([,.]\d{3})+$/.test(t)) { const v = BILL.num(t); if (v >= 1000) cnt[v] = (cnt[v] || 0) + wgt; } };
      ['a1', 'a2', 'a3', 'a4'].forEach(k => { const r = R(pg, k); if (r) add(r.raw, 2); });
      pg.words.forEach(w => add(w.t, 1));
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      const v = n ? BILL.num(n.raw) : null;
      if (best && best[1] >= 3 && Number(best[0]) !== v) {
        n = { raw: best[0], c: 80, ...(R(pg, 'a1') ? box(R(pg, 'a1')) : n ? box(n) : {}) };
      }
      F(out, k, label, n, 0);
      // 부과일자 → 전월분
      const ym = minDateYm(pg);
      return { ym, out, warn, sub: improve ? '개선충당금' : '시설사용료' };
    }
  };

  BILL.detect = function (pg) {
    // 순서 중요: 상세 → 일반
    const order = ['elec_detail', 'elec_mail', 'gas_detail', 'gas_main', 'ww_calc', 'ww_notice', 'water'];
    return order.find(k => T[k].test(pg.ns)) || null;
  };
  // 종류 판별 → (그림이면) 숫자 칸 재인식 → 해석
  //  ocrRect(rect) : 가로 662 기준 [x0,y0,x1,y1] 영역을 숫자 전용으로 읽어 {text, conf} 반환 (글자 PDF면 생략)
  BILL.analyze = async function (pg, ocrRect) {
    const type = BILL.detect(pg);
    pg.rx = {};
    if (type && T[type].rects) {
      const rs = T[type].rects(pg);
      for (const [name, r] of Object.entries(rs)) {
        const bx = { x0: r[0], y0: r[1], x1: r[2], y1: r[3] };
        if (ocrRect) {
          try { const o = await ocrRect(r); pg.rx[name] = { raw: (o.text || '').trim(), c: o.conf, box: bx }; } catch (e) { }
        } else {
          const ws = pg.words.filter(w => w.xc >= r[0] && w.xc <= r[2] && w.yc >= r[1] && w.yc <= r[3]);
          pg.rx[name] = { raw: ws.map(w => w.t).join(''), c: 100, box: bx };
        }
      }
    }
    return BILL.parse(pg);
  };
  BILL.parse = function (pg) {
    const type = BILL.detect(pg);
    if (!type) return { type: null, name: '알 수 없는 고지서', out: [], warn: ['고지서 종류를 알아보지 못했습니다. (전기·가스·상수도·폐수 고지서만 지원)'] };
    let r;
    try { r = T[type].parse(pg); } catch (e) { r = { out: [], warn: ['읽는 중 오류: ' + e.message] }; }
    if (r.ym) { const y = +r.ym.slice(0, 4), mm = +r.ym.slice(5); if (y < 2024 || y > 2099 || mm < 1 || mm > 12) r.ym = null; }
    return { type, name: T[type].name + (r.sub ? ` ${r.sub}` : ''), ...r };
  };

  root.BILL = BILL;
  if (typeof module !== 'undefined') module.exports = BILL;
})(typeof window !== 'undefined' ? window : globalThis);
