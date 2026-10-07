    // =====================================================================
    // 월간입력 · 고지서로 채우기 (PDF 글자 읽기 / 사진·스캔은 브라우저 안 글자 인식)
    //  - 파일은 서버로 보내지 않고 이 컴퓨터 브라우저 안에서만 읽습니다.
    // =====================================================================
    const BILL_LIB = {
      pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
      pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
      tess: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      kor: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor/4.0.0_best_int',
      eng: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int'
    };
    const OCR_W = 2480;          // 글자 인식용 가로 픽셀 (A4 300dpi)
    const PREV_W = 1240;         // 미리보기·조각 이미지용
    let billPages = [];          // [{file, page, name, type, ym, out, warn, prev(canvas)}]
    let billWorkers = null;

    function loadScript(src) {
      return new Promise((ok, no) => {
        if ([...document.scripts].some(s => s.src === src)) return ok();
        const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('불러오기 실패: ' + src)); document.head.appendChild(s);
      });
    }
    async function billPdfLib() {
      await loadScript(BILL_LIB.pdf);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = BILL_LIB.pdfWorker;
      return window.pdfjsLib;
    }
    async function billOcr(status) {
      if (billWorkers) return billWorkers;
      status('글자 인식 프로그램 준비 중… (처음 한 번은 1분 정도 걸릴 수 있습니다)');
      await loadScript(BILL_LIB.tess);
      const kor = await Tesseract.createWorker('kor', 1, { langPath: BILL_LIB.kor, logger: m => { if (m.status === 'recognizing text') status(`글자 인식 중… ${Math.round(m.progress * 100)}%`); } });
      await kor.setParameters({ preserve_interword_spaces: '1' });
      const dig = await Tesseract.createWorker('eng', 1, { langPath: BILL_LIB.eng });
      await dig.setParameters({ tessedit_char_whitelist: '0123456789,.-', tessedit_pageseg_mode: '7' });
      billWorkers = { kor, dig };
      return billWorkers;
    }

    function openBill() {
      if (!isAdmin()) return;
      billPages = [];
      document.getElementById('bill').hidden = false;
      document.getElementById('bill-file').value = '';
      renderBill();
    }
    function closeBill() {
      if (billPages.length && !document.getElementById('bill-apply').disabled && !confirm('확정하지 않은 값이 있습니다. 닫을까요?')) return;
      document.getElementById('bill').hidden = true; billPages = [];
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('bill').hidden) closeBill(); });

    function billStatus(t) { document.getElementById('bill-status').textContent = t || ''; }

    async function billFiles(files) {
      files = [...files]; if (!files.length) return;
      const btn = document.getElementById('bill-pick'); btn.disabled = true;
      try {
        for (const f of files) {
          if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) await billFromPdf(f);
          else if (/^image\//.test(f.type) || /\.(jpe?g|png|heic|webp|bmp|gif)$/i.test(f.name)) await billFromImage(f);
          else alert(`${f.name}: PDF나 사진 파일만 읽을 수 있습니다.`);
          renderBill();
        }
        billStatus('');
      } catch (e) {
        console.error(e); billStatus('');
        alert('읽기 실패: ' + (e.message || e) + '\n\n회사 네트워크에서 cdn.jsdelivr.net 이 막혀 있으면 글자 인식 프로그램을 받을 수 없습니다.');
      } finally { btn.disabled = false; billPrefer(); renderBill(); }
    }
    // 전기 청구내역서(상세)와 이메일 청구서를 같이 넣으면 같은 항목은 청구내역서 값 사용 (PDF 글자라 더 정확)
    function billPrefer() {
      const det = billPages.filter(p => p.type === 'elec_detail' || /청구내역서/.test(p.name || ''));
      billPages.filter(p => p.type === 'elec_mail' || /이메일/.test(p.name || '')).forEach(p => (p.out || []).forEach(o => {
        const d = det.find(q => q.ym === p.ym && (q.out || []).some(x => x.k === o.k && x.v != null)); if (!d || o.preferDone) return;
        const dv = d.out.find(x => x.k === o.k).v; o.preferDone = true; o.on = false; o.off = true;
        o.note = o.v != null && o.v !== dv ? `청구내역서 값(${Number(dv).toLocaleString('ko-KR')})을 씁니다` : '청구내역서 값을 씁니다';
      }));
    }

    // 캔버스 → 가로 w 로 줄인 사본
    function shrink(src, w) {
      const c = document.createElement('canvas'); const s = w / src.width;
      c.width = w; c.height = Math.round(src.height * s);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height); return c;
    }

    async function billFromPdf(file) {
      billStatus(`${file.name} 여는 중…`);
      const lib = await billPdfLib();
      const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        // 1) 글자가 들어 있는 PDF면 그 글자로 먼저 해석
        const tc = await page.getTextContent();
        const words = BILL.wordsFromPdfText(tc.items, vp1.height);
        const big = await renderPdfPage(page, OCR_W / vp1.width);
        let res = null;
        if (words.length >= 30) {
          const pg = BILL.makePage(words, vp1.width);
          const r = await BILL.analyze(pg, null);
          const got = r.out.filter(o => o.v != null).length;
          if (r.type && got >= Math.max(1, r.out.length / 2)) res = { ...r, how: 'PDF 글자' };
        }
        // 2) 그림 PDF(스캔) → 글자 인식
        if (!res) res = { ...(await billOcrCanvas(big, `${file.name} ${doc.numPages > 1 ? i + '쪽 ' : ''}`)), how: '글자 인식' };
        billPages.push({ file: file.name, page: i, pages: doc.numPages, prev: shrink(big, PREV_W), ...res });
        big.width = big.height = 0;
        renderBill();
      }
    }
    async function renderPdfPage(page, scale) {
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      return c;
    }
    async function billFromImage(file) {
      billStatus(`${file.name} 여는 중…`);
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error(`${file.name}: 이 사진 형식은 열 수 없습니다 (HEIC면 JPG로 바꿔 주세요)`)); im.src = url; });
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
        const big = shrink(c, OCR_W); c.width = c.height = 0;
        const res = await billOcrCanvas(big, file.name + ' ');
        billPages.push({ file: file.name, page: 1, pages: 1, prev: shrink(big, PREV_W), ...res, how: '글자 인식' });
        big.width = big.height = 0;
      } finally { URL.revokeObjectURL(url); }
    }
    async function billOcrCanvas(canvas, label) {
      const W = await billOcr(t => billStatus(label + t));
      billStatus(label + '글자 인식 중…');
      const { data } = await W.kor.recognize(canvas);
      const words = (data.words || []).map(w => ({ t: w.text, c: w.confidence, ...w.bbox }));
      const pg = BILL.makePage(words, canvas.width);
      const s = canvas.width / 662;
      billStatus(label + '숫자 다시 확인 중…');
      return await BILL.analyze(pg, async r => {
        const o = await W.dig.recognize(digitCrop(canvas, r, s));
        return { text: o.data.text, conf: o.data.confidence };
      });
    }
    // 숫자 칸만 잘라 흑백·여백 처리 (인식률 ↑)
    function digitCrop(src, r, s) {
      const x = Math.max(0, r[0] * s), y = Math.max(0, r[1] * s);
      const w = Math.min(src.width - x, (r[2] - r[0]) * s), h = Math.min(src.height - y, (r[3] - r[1]) * s);
      const k = h < 50 ? 50 / h : 1, pad = 16;
      const c = document.createElement('canvas'); c.width = Math.round(w * k + pad * 2); c.height = Math.round(h * k + pad * 2);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.filter = 'grayscale(1) contrast(1.6)';
      g.drawImage(src, x, y, w, h, pad, pad, w * k, h * k);
      return c;
    }

    // ---------- 검토 화면 ----------
    function billTargetYm() {
      const sel = document.getElementById('bill-ym');
      return sel && sel.value ? sel.value : monthlyYm;
    }
    function billCurVal(ym, k) {
      const src = ym === monthlyYm ? monthlyDraft : (MONTHLY[ym] || {});
      return src[k];
    }
    function fmtB(v) {
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'number') return (Math.round(v * 1e6) / 1e6).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
      return String(v);
    }
    function cropUrl(p, b) {
      if (!b || !p.prev) return '';
      const s = p.prev.width / 662, pad = 6;
      const x = Math.max(0, (b.x0 - pad) * s), y = Math.max(0, (b.y0 - pad / 2) * s);
      const w = Math.min(p.prev.width - x, (b.x1 - b.x0 + pad * 2) * s), h = Math.min(p.prev.height - y, (b.y1 - b.y0 + pad) * s);
      if (w < 4 || h < 4) return '';
      const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h);
      c.getContext('2d').drawImage(p.prev, x, y, w, h, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', .85);
    }

    function renderBill() {
      const list = document.getElementById('bill-list');
      const has = billPages.length > 0;
      document.getElementById('bill-drop').classList.toggle('small', has);
      // 넣을 달: 고지서에서 읽은 달 중 가장 많은 것
      const yms = billPages.map(p => p.ym).filter(Boolean);
      const cnt = {}; yms.forEach(y => cnt[y] = (cnt[y] || 0) + 1);
      const guess = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(x => x[0])[0];
      const sel = document.getElementById('bill-ym');
      const prevSel = sel.value;
      const opts = new Set([monthlyYm, ...Object.keys(cnt)]);
      [-2, -1, 1].forEach(d => { let y = monthlyYm; for (let i = 0; i < Math.abs(d); i++) y = d < 0 ? UT.prevYm(y) : UT.nextYm(y); opts.add(y); });
      sel.innerHTML = [...opts].sort().map(y => `<option value="${y}">${ymLabel(y)}${cnt[y] ? ' (고지서 기준)' : ''}</option>`).join('');
      sel.value = prevSel && opts.has(prevSel) && sel.dataset.touched ? prevSel : (guess || monthlyYm);
      const target = sel.value;
      const mism = yms.filter(y => y !== target);
      document.getElementById('bill-ymnote').textContent = mism.length ? `⚠ ${[...new Set(mism)].map(ymLabel).join(', ')} 고지서가 섞여 있습니다` : '';

      // 같은 항목이 여러 고지서에서 나오면 표시
      const seen = {};
      billPages.forEach((p, pi) => (p.out || []).forEach((o, oi) => { if (o.v != null) (seen[o.k] = seen[o.k] || []).push(`${pi}:${oi}`); }));

      // 상수도 40A·50A 지침 교차 확인
      const w40 = billPages.find(p => p.meta && p.meta.water === '40'), w50 = billPages.find(p => p.meta && p.meta.water === '50');
      billPages.forEach(p => delete p.check);
      if (w40 && w40.meta.use != null && w40.meta.diff != null) {
        const a = w40.meta, f = n => n.toLocaleString();
        if (a.diff === a.use) w40.check = { ok: true, t: `지침 차이 ${f(a.diff)}㎥ = 사용량 ${f(a.use)}㎥` };
        else if (w50 && w50.meta.diff != null && a.diff + w50.meta.diff === a.use) w40.check = { ok: true, t: `40A 지침 차이 ${f(a.diff)} + 50A 지침 차이 ${f(w50.meta.diff)} = 사용량 ${f(a.use)}㎥ (50A 합산 고지) 맞음` };
        else w40.check = { ok: false, t: `40A 지침 차이 ${f(a.diff)}㎥ ≠ 사용량 ${f(a.use)}㎥` + (w50 && w50.meta.diff != null ? ` (50A 지침 차이 ${f(w50.meta.diff)} 더해도 다름) → 지침·사용량을 확인하세요` : ' → 50A 합산분이면 정상입니다 (50A 고지서도 같이 올리면 자동 확인)') };
      }
      let h = '';
      billPages.forEach((p, pi) => {
        h += `<div class="bcard"><div class="bhd"><b>${esc(p.name || '알 수 없는 고지서')}</b>
          <span class="hint">${esc(p.file)}${p.pages > 1 ? ` · ${p.page}쪽` : ''} · ${esc(p.how || '')}${p.ym ? ` · <b>${ymLabel(p.ym)}분</b>` : ''}</span>
          <button class="bx" onclick="billRemove(${pi})">✕ 빼기</button></div>`;
        if (p.warn && p.warn.length) h += `<div class="bwarn">${p.warn.map(w => '⚠ ' + esc(w)).join('<br>')}</div>`;
        if (p.check) h += `<div class="${p.check.ok ? 'bok' : 'bwarn'}">${p.check.ok ? '✓' : '⚠'} ${esc(p.check.t)}</div>`;
        h += `<div class="bbody"><table class="btbl"><thead><tr><th></th><th>항목</th><th>읽어 온 값</th><th>지금 값</th><th>원본</th></tr></thead><tbody>`;
        (p.out || []).forEach((o, oi) => {
          const f = UT.FIELD[o.k] || { label: o.k, unit: '' };
          const cur = billCurVal(target, o.k);
          const same = cur !== undefined && o.v != null && String(cur) === String(o.v);
          const diff = cur !== undefined && cur !== '' && o.v != null && !same;
          if (o.on === undefined) o.on = o.v != null && !o.off;
          const dup = (seen[o.k] || []).length > 1;
          const img = cropUrl(p, o.box);
          h += `<tr class="${o.v == null ? 'none' : ''} ${diff ? 'diff' : ''}">
            <td><input type="checkbox" ${o.on ? 'checked' : ''} onchange="billOn(${pi},${oi},this.checked)"></td>
            <td>${esc(o.label || f.label)} <span class="u">${esc(f.unit || '')}</span>${o.note ? `<div class="hint">${esc(o.note)}</div>` : ''}${dup ? '<div class="hint">※ 다른 고지서에도 있음 (체크한 값이 들어감)</div>' : ''}</td>
            <td><input class="bv ${o.low && o.v != null ? 'low' : ''}" value="${esc(fmtB(o.v))}" placeholder="못 읽음" inputmode="decimal" oninput="billEdit(${pi},${oi},this)"></td>
            <td class="cur">${cur === undefined || cur === '' ? '<span class="hint">비어 있음</span>' : esc(fmtB(cur))}${same ? ' <span class="ok">같음</span>' : ''}</td>
            <td class="crop">${img ? `<img src="${img}" onclick="billShowPage(${pi})" title="눌러서 전체 보기">` : ''}</td></tr>`;
        });
        if (!(p.out || []).length) h += `<tr><td colspan="5" class="hint">읽은 값이 없습니다.</td></tr>`;
        h += `</tbody></table>${p.prev ? `<div class="bthumb"><img src="${p.prev.toDataURL('image/jpeg', .6)}" onclick="billShowPage(${pi})"></div>` : ''}</div></div>`;
      });
      list.innerHTML = h;
      const n = billPages.reduce((a, p) => a + (p.out || []).filter(o => o.on && o.v != null && o.v !== '').length, 0);
      const ap = document.getElementById('bill-apply');
      ap.disabled = !n; ap.textContent = n ? `✓ 확정 — ${ymLabel(target)}에 ${n}개 저장` : '✓ 확정';
    }
    function billOn(pi, oi, on) { billPages[pi].out[oi].on = on; renderBillCount(); }
    function billEdit(pi, oi, el) {
      const o = billPages[pi].out[oi], f = UT.FIELD[o.k] || {};
      const raw = el.value.trim();
      if (raw === '') o.v = null;
      else if (f.text || f.options) o.v = raw;
      else { const v = Number(raw.replace(/,/g, '')); o.v = isNaN(v) ? null : v; }
      el.classList.toggle('bad', raw !== '' && o.v == null);
      el.classList.remove('low');
      o.on = o.v != null;
      const cb = el.closest('tr').querySelector('input[type=checkbox]'); cb.checked = o.on;
      renderBillCount();
    }
    function renderBillCount() {
      const n = billPages.reduce((a, p) => a + (p.out || []).filter(o => o.on && o.v != null && o.v !== '').length, 0);
      const ap = document.getElementById('bill-apply');
      ap.disabled = !n; ap.textContent = n ? `✓ 확정 — ${ymLabel(billTargetYm())}에 ${n}개 저장` : '✓ 확정';
    }
    function billRemove(pi) { billPages.splice(pi, 1); renderBill(); }
    function billShowPage(pi) {
      const p = billPages[pi]; if (!p || !p.prev) return;
      const w = window.open('', '_blank');
      if (w) { w.document.write(`<title>${esc(p.file)}</title><body style="margin:0;background:#555"><img src="${p.prev.toDataURL('image/jpeg', .9)}" style="width:100%;max-width:1240px;display:block;margin:auto">`); w.document.close(); }
    }

    async function billApply() {
      const target = billTargetYm();
      const vals = {};
      billPages.forEach(p => (p.out || []).forEach(o => { if (o.on && o.v != null && o.v !== '') vals[o.k] = o.v; }));
      const keys = Object.keys(vals); if (!keys.length) return;
      const lines = keys.map(k => `· ${(UT.FIELD[k] || {}).label || k}: ${fmtB(vals[k])}`).join('\n');
      if (!confirm(`${ymLabel(target)} 월간입력에 아래 ${keys.length}개 값을 넣고 저장합니다.\n\n${lines}`)) return;
      if (target !== monthlyYm) {
        if (monthlyDirty && !confirm(`${ymLabel(monthlyYm)}에 저장하지 않은 입력이 있습니다. 버리고 ${ymLabel(target)}로 이동할까요?`)) return;
        monthlyYm = target; renderMonthly();
      }
      Object.assign(monthlyDraft, vals);
      monthlyDirty = true;
      await saveMonthly();
      if (!monthlyDirty) {      // 저장 성공
        billPages = []; document.getElementById('bill').hidden = true;
        renderMonthly();
        const note = document.getElementById('monthly-note');
        note.textContent = `고지서 값 ${keys.length}개를 저장했습니다.`;
      }
    }

    // 끌어다 놓기
    (function () {
      const ready = () => {
        const drop = document.getElementById('bill-drop'); if (!drop) return;
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => billFiles(e.dataTransfer.files));
        document.getElementById('bill-ym').addEventListener('change', e => { e.target.dataset.touched = '1'; renderBill(); });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
    })();

    // =====================================================================
    // 월간입력 · 생산팀 스마트팩토리(Firebase)에서 원육 투입량·생산일수 가져오기 (읽기 전용)
    //  - 생산팀 웹 '분석 → 월별현황'의 총 원육 사용량·작업일 = monthly_summary/{YYYY-MM}
    //  - 그 문서가 없으면 생산일수만 내포장 기록 날짜로 계산
    // =====================================================================
    const SSB = {
      cfg: { apiKey: 'AIzaSyA0Y6VK8EOahDE607LEWtyG9-U8YP3yqDE', authDomain: 'ssbon-factory.firebaseapp.com', projectId: 'ssbon-factory', appId: '1:815013258298:web:a80156143cf742ece8c103' },
      sdk: ['https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'],
      url: 'https://wooms19-del.github.io/ssbon-2factory/',
      db: null
    };
    async function ssbDb() {
      if (SSB.db) return SSB.db;
      for (const u of SSB.sdk) await loadScript(u);
      const app = firebase.apps.find(a => a.name === 'ssbon') || firebase.initializeApp(SSB.cfg, 'ssbon');
      const auth = app.auth();
      if (!auth.currentUser) await auth.signInAnonymously();
      SSB.db = app.firestore();
      return SSB.db;
    }
    async function ssbMonth(ym) {
      const db = await ssbDb();
      const from = ym + '-01', to = ym + '-' + String(UT.daysIn(ym)).padStart(2, '0');
      const res = { ym, rm: null, days: null, src: '', updatedAt: null, sumDays: 0, pkDays: 0, missing: [] };
      // ① 생산팀 월별 요약 (생산팀 웹에 저장 기능이 들어간 경우 — 월별현황 숫자와 똑같음)
      try {
        const doc = await db.collection('monthly_summary').doc(ym).get();
        if (doc.exists) { const d = doc.data() || {}; if (d.rawMeatKg != null) { res.rm = Number(d.rawMeatKg); res.days = d.workDays != null ? Number(d.workDays) : null; res.updatedAt = d.updatedAt || null; res.src = 'monthly'; } }
      } catch (e) { }
      // ② 생산팀 일별 요약(daily_summary): 전처리 투입량(방혈 원육) 합계 · 요약 있는 날 수
      const snap = await db.collection('daily_summary').where('date', '>=', from).where('date', '<=', to).get();
      let rm = 0; const sd = new Set();
      snap.docs.forEach(x => {
        const d = x.data() || {}, ds = String(d.date || x.id).slice(0, 10);
        const pp = (d.processes || []).filter(p => p && p.process === '전처리');
        const kg = pp.reduce((s, p) => s + (Number(p.inputKg) || 0), 0);
        if (kg > 0) { rm += kg; sd.add(ds); }
      });
      res.sumDays = sd.size;
      // ③ 내포장 기록이 있는 날 (시운전·테스트 제외) — 빠진 날 확인용
      const pk = await db.collection('packing').where('date', '>=', from).where('date', '<=', to + '').get();
      const pd = new Set();
      pk.docs.forEach(x => { const r = x.data() || {}; if (r.testRun || r.isTest) return; const d = String(r.date || '').slice(0, 10); if (d) pd.add(d); });
      res.pkDays = pd.size;
      res.missing = [...pd].filter(d => !sd.has(d)).sort();
      if (res.src !== 'monthly') {
        if (sd.size) { res.rm = Math.round(rm * 100) / 100; res.days = sd.size; res.src = 'daily'; }
        if (res.missing.length && pd.size > sd.size) res.days = pd.size; // 생산일수는 내포장 기록 날 수가 더 정확
      }
      return res;
    }
    async function openProdImport() {
      if (!isAdmin()) return;
      const ym = monthlyYm;
      openBill();
      billStatus(`생산팀 웹에서 ${ymLabel(ym)} 실적 읽는 중…`);
      try {
        const r = await ssbMonth(ym);
        const out = [], warn = [];
        const srcTxt = r.src === 'monthly' ? '생산팀 월별현황 · 총 원육 사용량' : '생산팀 일별 요약 · 전처리 투입량 합계';
        out.push({ k: 'production_kg', label: `원육 투입량 (${srcTxt})`, v: r.rm, raw: '' });
        out.push({ k: 'prod_days', label: `생산일수 (${r.src === 'monthly' ? '생산팀 월별현황 · 작업일' : '생산 기록이 있는 날'})`, v: r.days, raw: '' });
        const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
        if (r.src === 'monthly') warn.push(`생산팀 월별현황과 같은 숫자입니다.${r.updatedAt ? ` (갱신 ${String(r.updatedAt).slice(0, 16).replace('T', ' ')})` : ''}`);
        else {
          warn.push(`일별 요약이 있는 날 ${r.sumDays}일 / 내포장 기록이 있는 날 ${r.pkDays}일`);
          if (r.missing.length) warn.push(`일별 요약이 없는 날 ${r.missing.length}일: ${r.missing.map(md).join(', ')} → 원육 투입량이 그만큼 적게 잡혔습니다. 생산팀 웹 일별 실적에서 그 날짜를 한 번 열면 채워집니다.`);
          if (r.rm === null) warn.push(`생산팀 웹에 ${ymLabel(ym)} 일별 요약이 없습니다.`);
          warn.push('일별 요약 합계는 월별현황 "총 원육 사용량"과 조금 다를 수 있습니다 (코스트코 가안·테스트 부위 등 보정 전 값). 월 마감 후 한 번 비교해 주세요.');
        }
        if (ym === thisYm) warn.push('이번 달은 아직 진행 중이라 값이 계속 바뀝니다.');
        // 이미 넣어 둔 값과 다르면 체크를 꺼 둠 (실수로 덮어쓰지 않게 — 비교해 보고 직접 체크)
        out.forEach(o => { const c = billCurVal(ym, o.k); if (c !== undefined && c !== '' && o.v != null && Number(c) !== Number(o.v)) { o.off = true; o.note = `지금 값과 ${(o.v - Number(c) >= 0 ? '+' : '')}${fmtB(Math.round((o.v - Number(c)) * 100) / 100)} 차이 — 바꾸려면 체크`; } });
        billPages.push({ file: '생산팀 스마트팩토리', page: 1, pages: 1, name: `생산팀 실적 · ${ymLabel(ym)}`, how: '생산팀 웹', ym, out, warn, prev: null });
        billStatus('');
        const sel = document.getElementById('bill-ym'); sel.dataset.touched = ''; renderBill();
      } catch (e) {
        console.error(e); billStatus('');
        alert('생산팀 웹 자료를 읽지 못했습니다: ' + (e.message || e) + '\n\n회사 네트워크에서 gstatic.com / googleapis.com 이 막혀 있거나, 생산팀 웹 보안 설정이 바뀌었을 수 있습니다.');
      }
    }
