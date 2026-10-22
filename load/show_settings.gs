// 옛 부하 시트 백업 파일들의 「설정」 탭 내용을 로그로 보기 (읽기만 함, 아무것도 안 보냄)
// script.google.com → 새 프로젝트 → 이 내용 통째로 붙여넣기 → 저장 → showSettings 실행

const FILE_IDS = [
  'https://docs.google.com/spreadsheets/d/1KYfglKsXl5iVtuHL32AIlAj8YvhUPC5CTFKkdIAo1vc/edit',
  'https://docs.google.com/spreadsheets/d/1kUyCVVqykKrxHTDh9lcuZ47aAlRaUEPrlSe6TGUxi2M/edit',
  'https://docs.google.com/spreadsheets/d/1LZyzsBPy1Bs6Kp56Wj2icRjShikBtxTtCHlGlTTP0Bo/edit',
  'https://docs.google.com/spreadsheets/d/1xkwo37LZoW9o39hPdXikrl5wo5hNHOtpNF8CpmBKAkQ/edit',
  'https://docs.google.com/spreadsheets/d/1hivIoWnPl6cQ-eRP6DWkwkBXop7N5atkwECyuiUipAA/edit',
];

function showSettings() {
  FILE_IDS.forEach(u => {
    const m = String(u).match(/\/d\/([\w-]+)/), id = m ? m[1] : String(u).trim();
    let ss;
    try { ss = SpreadsheetApp.openById(id); } catch (e) { Logger.log('❌ 못 엶: ' + id + ' → ' + e.message); return; }
    const names = ss.getSheets().map(s => s.getName());
    Logger.log('📄 ' + ss.getName() + ' [' + names.filter(n => /^데이터_/.test(n)).join(', ') + ']');
    const sh = ss.getSheets().find(s => s.getName().indexOf('설정') >= 0);
    if (!sh) { Logger.log('   설정 탭 없음 (시트들: ' + names.join(', ') + ')'); return; }
    const v = sh.getRange(1, 1, Math.max(1, Math.min(sh.getLastRow(), 40)), Math.max(1, Math.min(sh.getLastColumn(), 10))).getDisplayValues();
    v.filter(r => r.some(String)).forEach(r => Logger.log('   ' + r.join(' | ')));
  });
  Logger.log('끝');
}
