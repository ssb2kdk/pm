// ============================================================
// 옛 구글시트 부하 기록 → Supabase 옮기기 (한 번만 쓰는 스크립트)
//  · 옛 부하 모니터링 앱스크립트 프로젝트에 새 파일로 붙여넣고 [importLoad] 실행
//  · '데이터_YYYY_MM' 시트를 모두 읽어 보냄 (날짜 | 시간 | 분전반ID | CH0 | CH1 | CH2)
//  · 6분 실행 제한에 걸리면 1분 뒤 자동으로 이어서 실행 → 다 끝나면 스스로 멈춤
//  · 이미 들어간 시각은 건너뛰므로 여러 번 실행해도 중복되지 않음
// ============================================================
const SB_URL = 'https://ncboxlsbbfhrupapipov.supabase.co/rest/v1/rpc/load_import';
const SB_KEY = 'sb_publishable_mYUd7LbTsbvg5lvAohRiTw_KL0T0eKD';
const SECRET = '여기에_비밀번호';   // 쉘리 스크립트에 넣은 것과 같은 문자 (직접 입력)

// 월별 백업 파일들 — 각 파일 주소창 주소를 통째로 복사해서 한 줄에 하나씩 (작은따옴표로 감싸고 끝에 쉼표)
// 지금 이 파일(스크립트가 붙어 있는 시트)은 자동 포함이라 안 넣어도 됩니다.
const FILE_IDS = [
  // 'https://docs.google.com/spreadsheets/d/1AbC...xyz/edit#gid=0',
  // 'https://docs.google.com/spreadsheets/d/1DeF...uvw/edit',
];

const BATCH = 2000;         // 한 번에 보내는 줄 수
const TIME_LIMIT = 270000;  // 4분 30초 지나면 멈추고 이어서 실행 예약

function fileIds_() {
  const me = SpreadsheetApp.getActiveSpreadsheet().getId();
  return [me].concat(FILE_IDS.filter(String).map(u => { const m = String(u).match(/\/d\/([\w-]+)/); return m ? m[1] : String(u).trim(); }).filter(id => id !== me));
}
function open_(fid) {
  try { return SpreadsheetApp.openById(fid); }
  catch (e) { Logger.log('❌ 파일 못 엶: ' + fid + ' → ' + e.message + '  (주소가 맞는지, 엑셀(.xlsx) 파일이 아닌지 확인 — 엑셀이면 [파일 → Google 스프레드시트로 저장] 후 그 주소 사용)'); return null; }
}

// ① 먼저 이것만 실행해서 파일·시트가 제대로 보이는지 확인 (아무것도 보내지 않음)
function checkFiles() {
  for (const fid of fileIds_()) {
    const ss = open_(fid); if (!ss) continue;
    const sheets = ss.getSheets().filter(s => /^데이터_\d{4}_\d{2}$/.test(s.getName()));
    Logger.log('📄 ' + ss.getName() + ' — ' + (sheets.length ? sheets.map(s => s.getName() + '(' + (s.getLastRow() - 1) + '줄)').join(', ') : '데이터_YYYY_MM 시트 없음'));
    const sh = sheets[0]; if (sh) Logger.log('   예시 2번째 줄: ' + JSON.stringify(sh.getRange(2, 1, 1, 6).getDisplayValues()[0]));
  }
  Logger.log('확인 끝');
}

// ② 확인되면 이것 실행 (실제로 보냄)
function importLoad() {
  const t0 = Date.now(), props = PropertiesService.getScriptProperties();
  clearTriggers_();
  for (const fid of fileIds_()) {
    const ss = open_(fid); if (!ss) continue;
    const sheets = ss.getSheets().filter(s => /^데이터_\d{4}_\d{2}$/.test(s.getName()));
    Logger.log('📄 ' + ss.getName() + ': ' + sheets.map(s => s.getName()).join(', '));
    for (const sh of sheets) {
      const key = 'done:' + fid + ':' + sh.getName();
      let row = Number(props.getProperty(key) || 2), skipped = 0;   // 다음에 읽을 줄 (1줄은 제목)
      const last = sh.getLastRow();
      if (row > last) continue;
      while (row <= last) {
        if (Date.now() - t0 > TIME_LIMIT) { ScriptApp.newTrigger('importLoad').timeBased().after(60 * 1000).create(); log_(ss, `⏸ ${sh.getName()} ${row}/${last}줄 — 1분 뒤 이어서`); return; }
        const n = Math.min(BATCH, last - row + 1);
        const disp = sh.getRange(row, 1, n, 2).getDisplayValues();   // 날짜, 시간 (보이는 글자 그대로)
        const vals = sh.getRange(row, 3, n, 4).getValues();          // 분전반ID, CH0, CH1, CH2
        const rows = [];
        for (let i = 0; i < n; i++) {
          const dm = String(disp[i][0]).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/), tm = String(disp[i][1]).trim(), p = String(vals[i][0]).trim();
          if (!dm || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(tm) || !p) { skipped++; continue; }
          const d = dm[1] + '-' + ('0' + dm[2]).slice(-2) + '-' + ('0' + dm[3]).slice(-2);
          const hms = tm.split(':').map(x => ('0' + x).slice(-2)); while (hms.length < 3) hms.push('00');
          const num = v => (v === '' || v === null || isNaN(Number(v))) ? null : Number(v);
          rows.push({ p: p, t: d + 'T' + hms.join(':') + '+09:00', a: num(vals[i][1]), b: num(vals[i][2]), c: num(vals[i][3]) });
        }
        if (rows.length) send_(rows);
        Logger.log(`   ${sh.getName()} ${row + n - 1}/${last}줄 보냄`);
        row += n;
        props.setProperty(key, String(row));
      }
      log_(ss, `✅ ${sh.getName()} 완료 (${last - 1}줄${skipped ? `, 형식이 이상해 건너뛴 줄 ${skipped}` : ''})`);
    }
  }
  Logger.log('🎉 전부 옮겼습니다');
}

function send_(rows) {
  for (let k = 0; k < 3; k++) {
    const res = UrlFetchApp.fetch(SB_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, payload: JSON.stringify({ p_secret: SECRET, p_rows: rows }) });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return;
    if (code < 500 || k === 2) throw new Error('보내기 실패 ' + code + ': ' + res.getContentText().slice(0, 300));
    Utilities.sleep(3000);
  }
}

function clearTriggers_() { ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'importLoad').forEach(t => ScriptApp.deleteTrigger(t)); }
function log_(ss, msg) { Logger.log(msg); }

// 처음부터 다시 옮기고 싶을 때만 실행 (진행 위치 기억 지우기)
function resetImport() { PropertiesService.getScriptProperties().getKeys().filter(k => k.indexOf('done:') === 0).forEach(k => PropertiesService.getScriptProperties().deleteProperty(k)); clearTriggers_(); Logger.log('초기화 완료'); }
