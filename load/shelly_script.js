// ========================================
// Shelly Pro 3EM → Supabase 전송 스크립트 (분전반마다 PANEL_ID 만 바꿔서 사용)
// ========================================
let URL = "https://ncboxlsbbfhrupapipov.supabase.co/rest/v1/rpc/load_ingest";
let APIKEY = "sb_publishable_mYUd7LbTsbvg5lvAohRiTw_KL0T0eKD";
let SECRET = "여기에_비밀번호";   // 25번 SQL 에 넣은 것과 같은 문자
let PANEL_ID = "panel_1";          // panel_1 ~ panel_5

function sendData() {
  let em0 = Shelly.getComponentStatus("em", 0);
  let payload = { p_secret: SECRET, p_panel: PANEL_ID, p_ch0: em0.a_current, p_ch1: em0.b_current, p_ch2: em0.c_current };
  Shelly.call("HTTP.Request", {
    method: "POST", url: URL, body: JSON.stringify(payload), timeout: 20,
    headers: { "Content-Type": "application/json", "apikey": APIKEY }
  }, null, null);
}
Timer.set(60000, true, sendData);
sendData();
