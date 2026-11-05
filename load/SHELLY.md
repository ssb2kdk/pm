# 설비별 부하 모니터링 — 쉘리(Shelly) 설정 정리

> 서버 이전 작업용 참고 자료 (2026-11-05 기준, 저장소 ssb2kdk/pm)
> 비밀문자·키 값은 여기 적지 않음. 사용자에게 받지도 말 것.

## 1. 지금 구조 한눈에

```
[분전반 CT 3개] → Shelly Pro 3EM (분전반마다 1대, LAN 연결)
      │  쉘리 안 스크립트(load/shelly_script.js)가 1분마다 직접 전송
      ▼
Supabase RPC  POST /rest/v1/rpc/load_ingest   (apikey = Publishable 키)
      │  비밀문자 확인 → load_readings 에 1줄 저장
      ▼
웹 화면 load/index.html (실시간 카드 · 기간 그래프 · kWh · 가동시간 · 설정)
      │
      ▼  매일 새벽 3:30 (pg_cron 'load-compact', UTC 18:30)
1분 기록 정리: 하루 kWh·가동시간 확정 → 10분 요약 → 원본은 하루 1줄 배열로 압축 보관
```

- **서버가 따로 없다.** 쉘리가 인터넷으로 Supabase 에 직접 보내는 방식(푸시). 그래서 쉘리가 인터넷에 나갈 수 있어야 함.
- 예전에는 같은 쉘리 → 구글 Apps Script + 구글 시트(월별 시트 `데이터_YYYY_MM`)였고, 2026-10 에 Supabase 로 옮김 (옛 기록은 `load/import_from_sheet.gs` + 26번 SQL `load_import` 로 넣음).
- 금속 분전반 안이라 Wi-Fi 가 불안정해서 **LAN 으로 연결**함.

## 2. 쉘리 기기
- 모델: **Shelly Pro 3EM** (3상 전력계, CT 3개). 분전반 1곳 = 쉘리 1대 = `panel_N`.
- 쓰는 값: `em:0` 의 **a_current, b_current, c_current (전류 A) 만** 보냄.
  - CT 3개를 R·S·T 한 설비에 거는 게 아니라 **CT 하나 = 설비 하나** (채널 0·1·2 = 서로 다른 설비 3대).
  - 전압·역률·유효전력은 보내지 않음 → kW·kWh 는 설정의 전압·역률로 **추정 계산** (아래 5번).
- 쉘리 IP·MAC·펌웨어 버전은 저장소에 기록 없음 → 사용자에게 확인 (쉘리 웹 화면 또는 공유기).

## 3. 쉘리 안 스크립트 (`load/shelly_script.js`, 쉘리 웹 → Scripts 에 넣고 「Run on startup」)

```js
let URL = "https://<프로젝트>.supabase.co/rest/v1/rpc/load_ingest";
let APIKEY = "<Publishable 키>";
let SECRET = "<비밀문자>";      // 25번 SQL load_secret 과 같은 값
let PANEL_ID = "panel_1";        // 쉘리마다 이것만 다름

function sendData() {
  let em0 = Shelly.getComponentStatus("em", 0);
  let payload = { p_secret: SECRET, p_panel: PANEL_ID,
                  p_ch0: em0.a_current, p_ch1: em0.b_current, p_ch2: em0.c_current };
  Shelly.call("HTTP.Request", { method: "POST", url: URL, body: JSON.stringify(payload), timeout: 20,
    headers: { "Content-Type": "application/json", "apikey": APIKEY } }, null, null);
}
Timer.set(60000, true, sendData);   // 1분마다
sendData();
```
- 시각은 쉘리가 안 보내고 **DB 가 받은 시각**(`now()`, 초 단위)으로 저장.
- 실패해도 다시 보내지 않음(버퍼 없음) → 인터넷이 끊긴 동안은 기록이 비고, 화면에 「데이터 누락 구간」(5분 넘게 빈 시간)으로 표시됨.

## 4. 분전반 · 채널 (28번 SQL 기준 — 지금 값은 화면 「설정」 탭이 최신)

| 분전반 | 이름 | CH0 | CH1 | CH2 |
|---|---|---|---|---|
| panel_1 | P-레토르트 | 레토르트칠러1 (80A) | 레토르트칠러2 (80A) | 레토르트칠러3 (80A) |
| panel_2 | P-냉동1 | 냉동창고1 (50A) | 냉동창고2 (50A) | 냉동창고3 (50A) |
| panel_3 | P-냉동2 | 냉장창고1 (50A) | 내포장공조 (50A) | 파쇄공조 (50A) |
| panel_4 | P-기계1 | 관류보일러1 (100A) | 관류보일러2 (100A) | 상수가압펌프 (10A) |
| panel_5 | P-기계2 | 에어컴프레셔1 (70A) | 에어컴프레셔2 (70A) | 전기온수기 (70A, 역률 1) |

- 괄호 = 기준 전류 `limit_a` (넘으면 화면에서 빨간색·「기준 넘은 시간」 집계). 경보 메시지·문자 발송은 **없음** (화면 표시만).
- `on_a` = 가동 기준 전류 (이 값 이상이면 「돌고 있음」 → 가동시간·켠/끈 시각·기동 횟수).
- 기본 전압 380V, 3상, 역률 0.85.
- **측정 이력 `load_assign`**: 쉘리 CT 를 다른 설비로 옮겨 잰 기간 (분전반·채널·시작일·끝일·설비 이름). 그 기간 그래프·표에 이 이름이 나옴.

## 5. 계산식
- kW = 전류(A) × √3 × 전압 × 역률 ÷ 1000 (단상이면 √3 없음)
- kWh = Σ kW × 측정 간격(분) ÷ 60
  - 간격이 10분 이하면 실제 간격, 10분 넘게 끊겼으면 1분만 인정 (끊긴 시간 추정 안 함)
- 하루 요약 `load_day`: 채널별 A·분 합계(amin), 평균·최대 전류 → 화면에서 kWh = amin × kW계수 ÷ 60 (전압·역률을 바꿔도 다시 계산 불필요)
- 계량기 값이 아니라 **전류로 추정한 값**이라고 화면에 표시함.

## 6. Supabase 쪽 (SQL 파일 순서대로)

| 파일 | 내용 |
|---|---|
| 25_load_monitor.sql | 표 `load_panels`, `load_channels`, `load_readings(panel_id, ts, ch0, ch1, ch2)`, `load_secret`(정책 없음 = 아무도 못 봄) · 함수 `load_ingest`(쓰기, anon 허용, 비밀문자 확인), `load_series`, `load_latest`, `load_energy` · 읽기 권한 `load_ok()` = admin·user·viewer |
| 26_load_import.sql | `load_import(secret, rows jsonb)` — 옛 시트 기록 한꺼번에 넣기 |
| 28_load_runtime.sql | 옛 설정 이름·기준, `on_a`(가동 기준), `load_assign`(측정 이력) |
| 29_load_daily.sql | `load_day`(하루 요약), `load_day_build(d)` |
| 30_load_compact.sql | `load_hist`(10분 요약: 최댓값·평균) |
| 31_load_today_raw.sql | `load_run_day`(하루 가동시간), 1분 기록은 오늘만 두고 매일 정리 |
| 32_load_raw_archive.sql | `load_raw_day` — 지우기 전 1분 원본을 하루 1줄 배열(secs, c0, c1, c2)로 보관 (손실 없음, 월별 CSV 받기 가능) |
| 33_load_restore.sql | `load_restore(from, to)` — 보관본에서 1분 기록 되살리기 |

- 정리 작업: `cron.schedule('load-compact', '30 18 * * *', 'select public.load_compact(0, 400)')` (한국 시각 03:30).
- ⚠ **`load_secret` 은 레토르트 수집 프로그램도 같이 씀** (40번 SQL `retort_ingest` 가 같은 표로 비밀문자 확인). 비밀문자를 바꾸면 쉘리 5대 + 레토르트 수집 프로그램(환경변수 `SSB2MES_SECRET`) 모두 바꿔야 함.

## 7. 서버로 옮길 때 참고
- **화면(load/index.html)은 Supabase 표를 그대로 읽으므로**, 서버가 같은 `load_ingest`(또는 같은 표)로 넣어 주면 화면은 고칠 필요 없음.
- 방법 두 가지:
  1. 쉘리 스크립트의 `URL` 만 서버 주소로 바꾸기 (쉘리가 서버로 푸시 → 서버가 Supabase 로 전달). 쉘리 5대에 들어가서 고쳐야 함.
  2. 쉘리 스크립트는 끄고, **서버가 쉘리에 직접 물어보기(폴링)**: `http://<쉘리 IP>/rpc/EM.GetStatus?id=0` → `a_current, b_current, c_current` (같은 응답에 `a_voltage, a_act_power, a_pf, total_act_power` 등도 있음), 누적 전력량은 `EMData.GetStatus?id=0`. 레토르트 수집 프로그램(`retort/collector.py`, Modbus 폴링 → Supabase)과 같은 방식으로 맞추기 좋음. 쉘리 Pro 3EM 은 Modbus-TCP 도 지원(설정에서 켜야 함).
- 서버로 옮기면 좋아지는 점: 인터넷이 끊겨도 서버에 모아 두었다가 나중에 보내기(지금은 끊긴 동안 기록이 사라짐), 실제 전압·역률·유효전력 기록 가능(지금은 전류만), 알람(문자·메신저) 붙이기.
- 바꾸는 동안 두 경로가 같이 넣으면 중복 → `load_readings` 기본키가 (panel_id, ts 초 단위)라 같은 초만 막힘. 한쪽을 끄고 다른 쪽을 켤 것.
- 저장소 규칙은 `CLAUDE.md` 참고 (새 SQL 은 sql 폴더 마지막 번호 + 1, 지금 마지막 47).
