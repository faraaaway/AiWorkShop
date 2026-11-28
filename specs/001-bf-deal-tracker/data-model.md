# Data Model: BF Deal Tracker

모든 타입은 `src/lib/types.ts` 한 파일에 둔다(0단계에서 코어 담당이 작성·커밋 후 변경은 코어 담당만).
시각은 모두 ISO 8601 문자열(KST 오프셋 포함, 예: `2026-11-30T23:59:00+09:00`). 모르는 값은 `null`.

## 열거형

```ts
type SiteId = 'musinsa' | '29cm' | 'wconcept' | 'naver' | 'zigzag' | 'ably' | 'queenit' | 'posty' | '4910'
            | 'attrangs';   // 아뜨랑스: 1시간 시점에 추가한 10번째 사이트 (Crawl C)

type Gender = 'men' | 'women' | 'unisex' | 'unclassified';          // 남성/여성/공용/미분류

type Theme = 'outer' | 'top' | 'knit' | 'bottom' | 'dress' | 'setup'
           | 'shoes' | 'bag_acc' | 'inner_home' | 'etc' | 'unclassified';
// 아우터/상의/니트/하의/원피스·스커트/셋업/신발/가방·잡화/이너·홈웨어/기타/미분류

type SiteState = 'ok' | 'failed' | 'suspect_layout' | 'blocked' | 'login_required' | 'disabled'
               | 'not_implemented' | 'never_run';
// 정상/실패/실패(구조 변경 의심)/차단됨/로그인 필요/꺼짐/준비 중(수집기 미구현)/미실행

type RunPhase = 'idle' | 'queued' | 'running';   // 지금 수집 중인지. 저장하지 않고 GET /api/status가 채움
```

화면 표시용 한글 라벨은 `src/lib/labels.ts`에 매핑한다.

## RawDeal (수집기 → 코어)

수집기는 사이트에서 읽은 값을 가공하지 않고 이 형태로 돌려준다. 계산·분류는 코어의 `normalize()`가 한다.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `siteProductId` | string | ✔ | 사이트 내 상품 ID (중복 제거 키) |
| `name` | string | ✔ | 상품명 |
| `brand` | string \| null | | 브랜드 |
| `url` | string | ✔ | 상품 페이지 절대 URL |
| `imageUrl` | string \| null | | 대표 이미지 절대 URL |
| `originalPrice` | number \| null | | 정가(원) |
| `salePrice` | number | ✔ | 할인가(원) |
| `displayedDiscountRate` | number \| null | | 사이트가 표시한 할인율(%) |
| `endsAt` | string \| null | | 상품 할인 종료 시각. `Date.parse`가 읽는 절대 시각이면 형식 무관 — `normalize()`가 `+09:00` 형식으로 통일하고, 못 읽으면 null. 한글 문구는 `parseKoreanEndDate()` 사용 |
| `rawCategory` | string \| null | | 사이트 카테고리 경로 (예: "여성 > 아우터 > 패딩") |
| `rawGender` | string \| null | | 사이트가 준 성별 표기 |
| `soldOut` | boolean | | 기본 false |
| `event` | `{ name: string; url: string; endsAt: string \| null } \| null` | | 소속 기획전 |

## Deal (저장·화면용)

`normalize(raw, siteId, crawledAt)` 결과.

| 필드 | 타입 | 규칙 |
|------|------|------|
| `id` | string | `${siteId}:${siteProductId}` |
| `siteId` | SiteId | |
| `name`, `brand`, `url`, `imageUrl` | | RawDeal 그대로 |
| `originalPrice` | number \| null | |
| `salePrice` | number | > 0 이어야 함, 아니면 버림 |
| `discountRate` | number \| null | `floor((original − sale) / original × 100)`; 정가 없으면 `displayedDiscountRate`; 둘 다 없으면 null. 0~99 범위 밖이면 null |
| `displayedDiscountRate` | number \| null | 계산값과 1%p 넘게 다를 때 화면에 함께 표시 |
| `endsAt` | string \| null | 상품 `endsAt` → 없으면 `event.endsAt` |
| `endsAtSource` | `'product' \| 'event' \| null` | 종료 시각 출처 |
| `eventName`, `eventUrl` | string \| null | |
| `gender` | Gender | `classifyGender(rawGender, rawCategory, name)` |
| `theme` | Theme | `classifyTheme(rawCategory, name)` |
| `soldOut` | boolean | |
| `crawledAt` | string | 수집 실행 시각 |

**검증/중복**: 같은 `id`가 여러 기획전에서 나오면 `salePrice`가 가장 낮은 것 하나만 남긴다.
**만료**: `endsAt`이 현재보다 과거면 만료 — 저장은 하되 화면에서 기본 숨김.

## SiteStatus

`data/status/<siteId>.json`

| 필드 | 타입 | 설명 |
|------|------|------|
| `siteId` | SiteId | |
| `enabled` | boolean | 꺼진 사이트는 전체 수집에서 제외 |
| `state` | SiteState | |
| `lastRunAt` | string \| null | 마지막 실행 시작 |
| `lastSuccessAt` | string \| null | 마지막 성공 |
| `dealCount` | number | 현재 저장된 Deal 수 |
| `message` | string \| null | 오류/차단 요약 (사람이 읽는 문장) |
| `cooldownUntil` | string \| null | 이 시각 전에는 자동 재시도 안 함 |

### 상태 전이

```text
never_run ──run──▶ ok
ok/failed/suspect_layout ──run──▶ ok | failed | suspect_layout | blocked | login_required
blocked ──(cooldownUntil 지남 또는 수동 재시도)──▶ run
수집기가 스텁(NotImplementedError) ──run──▶ not_implemented
enabled=false ──(조회 시)──▶ disabled 로 표시, enabled=true 로 되돌리면 저장된 마지막 결과가 다시 보임
```

- 결과 0건 → `suspect_layout`, 기존 Deal 파일 **유지**
- CAPTCHA/403/429 감지 → `blocked`, `cooldownUntil = now + 6h`, 기존 Deal 유지
- 요청 상한 초과(RequestLimitError를 수집기가 잡지 않음)·그 밖의 예외 → `failed`, 기존 Deal 유지
- 로그인 필요 → `login_required`, 기존 Deal 유지

**enabled와 state의 관계**: `enabled`는 사용자가 켜고 끄는 유일한 스위치이며 전체 수집에서 건너뛰는 유일한 기준이다.
runner는 `enabled`를 쓰지 않는다. 디스크의 `state`에는 항상 마지막 실행 결과가 들어가고 `disabled`는 저장하지 않는다
(`enabled === false`일 때 조회 시점에만 `disabled`로 바꿔 보여 준다).

**SiteStatusView** (GET /api/status 응답 한 줄) = `SiteStatus` + `displayName` + `run: RunPhase`.

## 파일 형식

- `data/deals/<siteId>.json`: `{ "siteId": "musinsa", "crawledAt": "...", "deals": Deal[] }`
- `data/status/<siteId>.json`: `SiteStatus`
- `fixtures/sample-deals.json`: `Deal[]` 30개 이상 — 여러 사이트·성별·테마·할인율·만료/품절/null 값을 섞어 UI 개발에 사용

## Stretch: ProductGroup

`groupKey = normalize(brand) + '|' + normalize(name)` (소문자, 공백·특수문자·색상/사이즈 표기 제거).
같은 키가 2개 사이트 이상이면 그룹으로 묶고 `minSalePrice`를 계산. 저장하지 않고 요청 시 계산한다.

구현(`src/lib/group.ts`, 2026-11-28)에서 정한 세부 규칙:

- 정규화는 낱말 단위다. 색상(블랙, ivory …)·사이즈(S, XL, FREE …)·색상 개수(`5 color`, `7컬러`)는 낱말이 통째로
  일치할 때만 지운다("블랙진", "redwing"은 그대로). 밝기 표기(다크, light …)는 색상 바로 앞에 있을 때만 지운다.
  모델 번호 같은 숫자는 남긴다.
- 상품명 맨 앞에 붙은 브랜드명은 뺀다(일부 사이트는 상품명 앞에 브랜드를 붙인다).
- 브랜드를 모르거나(null) 정규화한 상품명이 비면 키가 없다 — 그런 상품은 묶지 않는다.
- 종료된 할인은 묶음에서 뺀다. 사이트마다 가장 싼 것 하나(판매 중 우선)만 남긴다.
- `minSalePrice`는 판매 중인 것 중 최저가(모두 품절이면 품절 포함 최저가)이고, 판매 중이면서 그 값인 사이트에
  `isLowest`를 단다(같은 값이면 여러 곳).
- 한계: 브랜드 표기가 사이트마다 다르면(나이키 / NIKE) 묶이지 않는다. 사이트마다 쿠폰 포함 기준이 달라 가격 차이는
  참고용이며, 화면에 그 안내를 함께 보여 준다.
