# Contract: Internal HTTP API

Next.js Route Handler. 코어 담당이 구현하고 UI 담당이 호출한다. 로컬 전용(인증 없음, 헌법 I).
응답 공통 형식: `{ "ok": true, "data": ... }` / `{ "ok": false, "error": "사람이 읽는 메시지" }`.
타입은 [data-model.md](../data-model.md) 참고.

UI 담당은 API가 준비되기 전까지 `fixtures/sample-deals.json`을 직접 import해서 개발하고,
`src/lib/api.ts`의 `getDeals()` 한 곳만 나중에 실제 API로 바꾼다.

## GET /api/deals

모든 사이트의 Deal을 합쳐 반환. 필터/정렬은 클라이언트(`lib/filters.ts`)에서 한다.

- Query: `includeExpired=1` (선택, 기본은 만료 제외)
- 200:
  ```json
  { "ok": true, "data": { "deals": [ /* Deal */ ], "lastUpdatedAt": "2026-11-27T21:00:00+09:00" } }
  ```
  `lastUpdatedAt` = 사이트별 `lastSuccessAt` 중 가장 최근. 데이터가 없으면 `deals: []`, `lastUpdatedAt: null`.

## GET /api/status

- 200: `{ "ok": true, "data": { "sites": [ /* SiteStatusView */ ] } }` — 9개 사이트 모두, 고정 순서.
- 응답에는 `autoCrawl`도 들어 있다: `{ "intervalMinutes": 60, "nextRunAt": "2026-11-28T01:26:00+09:00" }`.
  자동 수집이 꺼져 있으면 `null`, 예약된 수집이 도는 중이면 `nextRunAt`이 `null`이다. 주기는 서버 환경변수
  `BF_AUTO_CRAWL_MINUTES`(기본 60, 최소 10, `0`이면 끔)로 정하고, 서버가 켜져 있는 동안만 동작한다.
- `SiteStatusView` = `SiteStatus` + `displayName` + `run: 'idle' | 'queued' | 'running'`.
  UI는 `run`이 `queued`/`running`인 사이트가 하나라도 있으면 3초마다 다시 조회하고, 모두 `idle`이면 멈춘다.
- `state`는 `enabled === false`이면 `disabled`로 바뀌어 온다. 토글은 `enabled`에, 배지는 `state`에 연결한다.
  [지금 수집]은 `enabled === false`이거나 `state === 'not_implemented'`일 때만 비활성화한다.

## POST /api/crawl

수집 시작. 응답은 바로 돌려주고 수집은 백그라운드에서 진행(상태는 `/api/status`로 확인).

- Body: `{ "siteId": "musinsa" }` 또는 `{ "siteId": "all" }`
- Query/Body 옵션: `"force": true` — 쿨다운 무시(수동 재시도)
- 202: `{ "ok": true, "data": { "started": ["musinsa"] } }`
  - `"all"` 요청에서 시작하지 않은 사이트는 `"skipped": [{ "siteId": "naver", "reason": "cooldown" }]`로 알려 준다
    (`reason`: `cooldown` | `disabled` | `running` | `not_implemented`).
- 409: 이미 실행 중 `{ "ok": false, "error": "무신사 수집이 이미 진행 중입니다" }`
- 409: 한 사이트 요청인데 쿨다운 중이고 `force`가 없음 → 남은 시간을 담은 메시지. UI는 그 줄에 "강제 재시도"를 보여 준다.
  꺼진 사이트·미구현 사이트의 단일 요청도 409와 이유 메시지.
- 400: 알 수 없는 siteId

## PATCH /api/status/:siteId (Should)

- Body: `{ "enabled": false }` — 사이트 켜기/끄기
- 200: 변경된 SiteStatus

## 화면 계약 (UI)

| 경로 | 내용 | 관련 요구사항 |
|------|------|---------------|
| `/` | 상단: 마지막 업데이트 시각 · 성별 탭 · 테마 칩 · 할인율 구간 · 사이트 선택 · "오늘 마감" · 정렬 · "종료된 할인 보기". 본문: DealCard 그리드(모바일 2열, 데스크톱 4~5열) | FR-014~017, 020, 021 |
| `/status` | 사이트별 행: 이름 · 상태 배지 · 마지막 수집 · 건수 · 메시지 · [지금 수집] 버튼, 상단 [전체 수집] | FR-018 |
| `/compare` (Stretch) | 그룹 상품 사이트별 가격표, 최저가 강조 / 비교함 2~4개 | FR-019 |

DealCard 필수 표시: 이미지, 사이트명, 브랜드, 상품명, 할인율(크게), 할인가, 정가(취소선), 남은 시간
(`D-2 13:00` 또는 "알 수 없음"), 품절/만료 배지. 카드 클릭 → `url`을 새 탭(`target="_blank" rel="noopener"`).
