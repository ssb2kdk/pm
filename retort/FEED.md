# 레토르트 실시간 값 가져가기 (생산 웹페이지 개발자용)

시설관리시스템이 모으는 레토르트 온도기록계 값을 다른 시스템에서 **읽기만** 해 가는 방법입니다.

- 값은 기록계 → 수집 프로그램 → Supabase 순서로 들어옵니다. 운전 중에는 **10초마다**, 쉬는 중에는 1분마다 저장됩니다.
- 로그인은 필요 없습니다. **읽기용 키**만 있으면 되고, 키는 시설 담당자에게 받으세요.
- 이 창구로는 값을 바꿀 수 없습니다(읽기 전용). 키가 틀리면 `denied` 오류가 납니다.

## 접속 정보

| 항목 | 값 |
|---|---|
| 주소 | `https://ncboxlsbbfhrupapipov.supabase.co/rest/v1/rpc/<함수이름>` |
| 방식 | `POST`, 본문은 JSON |
| 헤더 | `apikey: <Publishable 키>`, `Content-Type: application/json` |

Publishable 키는 시설관리시스템 `config.js`의 `SUPABASE_KEY` 값과 같습니다. 공개용 키라서 웹페이지에 넣어도 됩니다.

## 1. 최신값 — `retort_feed_latest`

본문: `{"p_key": "읽기용 키"}`

돌려주는 값: 레토르트마다 한 줄씩 나옵니다.

| 칸 | 뜻 |
|---|---|
| `unit_id`, `name` | `retort_1` / 레토르트1 … |
| `ts`, `age_sec` | 마지막 값 시각(UTC), 몇 초 전 값인지 (**180초 넘으면 끊김**으로 보세요) |
| `tc`, `pc` | 챔버 온도(℃), 챔버 압력(kgf/cm²) |
| `t1`~`t4` | 제품 중심 온도 TEMP_1~4 (℃) |
| `fo1`~`fo4` | 살균값 Fo_1~4 (분) |

기록이 없는 레토르트는 `ts`부터 값이 모두 `null`입니다.

## 2. 기간값 (그래프용) — `retort_feed_series`

본문: `{"p_key": "…", "p_unit": "retort_1", "p_from": "2026-11-03T00:00:00+09:00", "p_to": "2026-11-04T00:00:00+09:00", "p_sec": 60}`

- `p_sec`초 단위로 묶어서 돌려줍니다. 온도와 압력은 평균, Fo는 최댓값이고, 최소 10초 단위입니다.
- 한 번에 최대 31일까지 조회할 수 있습니다.
- 한 번에 최대 1000줄을 돌려줍니다. 더 받으려면 헤더에 `Range: 1000-1999`처럼 범위를 지정하세요.

## 예시

브라우저 JavaScript:

```js
const URL = 'https://ncboxlsbbfhrupapipov.supabase.co/rest/v1/rpc/retort_feed_latest';
const res = await fetch(URL, {
  method: 'POST',
  headers: { 'apikey': '<Publishable 키>', 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_key: '<읽기용 키>' })
});
const rows = await res.json();   // [{unit_id:'retort_1', name:'레토르트1', tc:121.2, ...}, ...]
```

10초마다 다시 부르면 실시간처럼 보입니다. 그보다 자주 불러도 새 값은 없습니다.

명령줄(curl):

```
curl -X POST https://ncboxlsbbfhrupapipov.supabase.co/rest/v1/rpc/retort_feed_latest \
  -H "apikey: <Publishable 키>" -H "Content-Type: application/json" -d '{"p_key":"<읽기용 키>"}'
```

## 참고

- 읽기용 키를 브라우저 코드에 넣으면 페이지를 보는 사람이 키를 볼 수 있습니다. 레토르트 값 읽기만 가능한 키라 큰 문제는 없지만, 외부에 공개되는 페이지라면 서버 쪽에서 불러서 전달하세요.
- 키는 시설 담당자가 46번 SQL에서 바꿀 수 있습니다. 바꾸면 예전 키는 바로 막힙니다.
- 공식 살균 기록은 기록계(CF카드)에 있습니다. 이 값은 모니터링용입니다.
