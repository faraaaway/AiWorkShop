---

description: "Task list for BF Deal Tracker (4명 · 5시간)"
---

# Tasks: 블랙프라이데이 의류 할인 모아보기 (BF Deal Tracker)

**Input**: Design documents from `/specs/001-bf-deal-tracker/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: 헌법(Development Workflow)이 할인율 계산·분류·파서 자동 테스트를 요구하므로 해당 테스트만 포함한다.
네트워크 없이 fixture로만 테스트한다.

**Organization**: User Story별 Phase. 각 작업에 담당 역할을 표시한다.

## Format: `[ID] [P?] [Story] (담당) Description`

- **[P]**: 다른 파일이고 미완료 작업에 의존하지 않아 병렬 가능
- **[Story]**: US1~US4 (spec.md)
- **(담당)**: `Core`(팀원1, Lead) · `UI`(팀원2) · `CrawlA`(팀원3: 무신사·29CM·W컨셉·네이버) · `CrawlB`(팀원4: 지그재그·에이블리·퀸잇·포스티·4910)
- 사람별 정리: [team/README.md](./team/README.md)

---

## Phase 1: Setup (0:00–0:20, Core 단독)

**Purpose**: 프로젝트 뼈대. 나머지 3명은 이 시간에 Obscura 설치·사이트 조사(quickstart §1–2)

- [x] T001 (Core) Next.js 15 + TypeScript + Tailwind 프로젝트를 저장소 루트에 생성하고 `package.json` 스크립트 `dev`, `crawl`(`tsx src/crawler/cli.ts`), `test`(`vitest run`)를 추가 — `package.json`, `src/app/layout.tsx`, `src/app/page.tsx`
- [x] T002 [P] (Core) `cheerio`, `tsx`, `vitest` 설치 및 `vitest.config.ts` 작성(경로 별칭 `@/` = `src/`)
- [x] T003 [P] (Core) `.env.example`(`OBSCURA_PATH=`)과 환경변수 읽기 `src/lib/env.ts` 작성(없으면 명확한 오류 메시지)

---

## Phase 2: Foundational (0:20–0:40, Core 단독, ⚠️ 모든 작업의 선행 조건)

- [x] T004 (Core) `src/lib/types.ts`에 data-model.md의 `SiteId`, `Gender`, `Theme`, `SiteState`, `RawDeal`, `Deal`, `SiteStatus`와 contracts/adapter-interface.md의 `SiteAdapter`, `CrawlContext` 정의
- [x] T005 [P] (Core) `src/lib/errors.ts`에 `BlockedError`, `LoginRequiredError`, `NotImplementedError` 정의
- [x] T006 [P] (Core) `src/lib/labels.ts`에 SiteId·Gender·Theme·SiteState 한글 라벨 매핑(data-model.md 열거형 주석 기준)
- [x] T007 (Core) `src/crawler/adapters/index.ts`와 9개 스텁 파일 `src/crawler/adapters/{musinsa,29cm,wconcept,naver,zigzag,ably,queenit,posty,4910}.ts` 생성(contracts/adapter-interface.md "스텁" 형식, displayName·homeUrl 채움)
- [x] T008 [P] (Core) `fixtures/sample-deals.json`에 data-model.md `Deal` 형식 가짜 데이터 40개(9개 사이트, 모든 Gender/Theme, 할인율 10~80%, `endsAt` null·과거·오늘·며칠 뒤, `soldOut` true 포함)
- [x] T009 [P] (Core) `src/lib/api.ts`에 `getDeals()`·`getStatus()`·`startCrawl()` 작성 — 우선 `getDeals()`는 sample-deals.json 반환
- [x] T010 (Core) `main`에 커밋·푸시하고 팀에 "기반 완료" 알림

**Checkpoint (0:40)**: 이후 4명이 병렬 작업. 공용 파일(`types.ts`, `errors.ts`, `adapters/index.ts`) 수정은 Core에게 요청.

---

## Phase 3: User Story 1 - 한 사이트의 블프 할인 목록 보기 (P1) 🎯 MVP

**Goal**: 무신사 블프 할인을 카드 목록으로 보고, 카드에서 원 페이지로 이동

**Independent Test**: `npm run crawl -- --site musinsa` 후 `/`에서 카드 10개를 실제 사이트와 대조(quickstart V1–V3)

### Tests for User Story 1

- [ ] T011 [P] [US1] (Core) `tests/unit/discount.test.ts` — data-model.md `Deal.discountRate` 규칙(내림, 정가 없음→표시값, 범위 밖→null)과 `Deal.displayedDiscountRate` 1%p 차이 판정
- [ ] T012 [P] [US1] (Core) `tests/unit/dates.test.ts` — `parseKoreanEndDate`: `~11.30(일) 23:59`, `11/30까지`, `D-2`, `오늘 마감`, 알 수 없는 문자열→null
- [x] T013 [P] [US1] (CrawlA) `tests/adapters/musinsa.test.ts` — `fixtures/sites/musinsa/`로 `parseMusinsa` 검증(10개 이상, 필수 필드 존재, 가격 숫자)

### Implementation for User Story 1

- [ ] T014 [P] [US1] (Core) `src/lib/discount.ts` — data-model.md `Deal.discountRate`, `Deal.displayedDiscountRate` 계산
- [ ] T015 [P] [US1] (Core) `src/lib/dates.ts` — `parseKoreanEndDate(text, now)`(KST, 연도 생략 시 올해/내년 판정)
- [ ] T016 [US1] (Core) `src/crawler/obscura.ts` — `CrawlContext` 구현: `execFile(OBSCURA_PATH)`로 `--stealth`/`--obey-robots` 사이트 설정 반영, `fetchHtml`(`--dump html`), `fetchJson`(`--dump original`), `evalPage`(`--eval`), 요청 간 2~4초 대기, `maxRequests` 초과 시 중단, research.md R4 신호 감지 시 `BlockedError`
- [ ] T017 [US1] (Core) `src/lib/classify.ts` 최소 버전(항상 `unclassified`) + `src/lib/normalize.ts` — `RawDeal`→`Deal` 변환: data-model.md `Deal.id`, `Deal.salePrice`(≤0 버림), `Deal.endsAt`/`Deal.endsAtSource`(상품→행사 순), 같은 `id`는 최저가만
- [ ] T018 [US1] (Core) `src/lib/store.ts` — `data/deals/<siteId>.json`, `data/status/<siteId>.json` 읽기/쓰기(임시 파일→rename), 파일 없으면 빈 값
- [ ] T019 [US1] (Core) `src/crawler/runner.ts` 기본형 + `src/crawler/cli.ts` — `--site <id>` 실행, normalize 후 저장, data-model.md `SiteStatus.lastRunAt`/`lastSuccessAt`/`dealCount`/`state` 갱신
- [ ] T020 [US1] (Core) `src/app/api/deals/route.ts` — contracts/http-api.md `GET /api/deals`(만료 제외 기본, `lastUpdatedAt`)
- [x] T021 [US1] (CrawlA) 무신사 블프 행사 페이지 조사 후 원본을 `fixtures/sites/musinsa/`에 저장(행사 목록 1개 + 상품 목록 1개 이상)
- [x] T022 [US1] (CrawlA) `src/crawler/adapters/musinsa.ts` — `parseMusinsa` 순수 함수 + `crawl(ctx)`(행사 → 상품 목록, `rawCategory`·`rawGender`·`event.endsAt` 채움)
- [x] T023 [P] [US1] (UI) `src/lib/time.ts` — 남은 시간 표시(`D-2 13:00`, `오늘 23:59 마감`, `알 수 없음`, 만료)
- [x] T024 [P] [US1] (UI) `src/components/DealCard.tsx` — contracts/http-api.md "DealCard 필수 표시" 전부, 새 탭 링크, `Deal.discountRate` null이면 "알 수 없음"
- [x] T025 [US1] (UI) `src/app/page.tsx` — 상단 마지막 업데이트 시각 + 카드 그리드(모바일 2열/데스크톱 4~5열), `getDeals()` 사용
- [ ] T026 [US1] (UI) `src/lib/api.ts`의 `getDeals()`를 `/api/deals` 호출로 교체(T020 완료 후, Core와 같이 확인)

**Checkpoint (~2:00)**: 무신사 실데이터로 목록 동작 = MVP 확보. 바로 `main`에 머지.

---

## Phase 4: User Story 2 - 성별·테마·할인율 필터/정렬 (P2)

**Goal**: 배민식 탭·칩 필터와 정렬

**Independent Test**: 샘플 데이터로 "여성 + 아우터 + 50%+ + 마감 임박 순" 확인(quickstart V4, V5)

### Tests for User Story 2

- [ ] T027 [P] [US2] (Core) `tests/unit/classify.test.ts` — research.md R8 키워드·카테고리 사례 20개 이상
- [x] T028 [P] [US2] (UI) `tests/unit/filters.test.ts` — 조합 필터, 정렬 3종, 할인율 null 제외, 품절 뒤로

### Implementation for User Story 2

- [ ] T029 [US2] (Core) `src/lib/classify.ts` 완성 — data-model.md `Deal.gender`, `Deal.theme`(카테고리 1순위, 상품명 키워드 2순위, 실패 시 `unclassified`)
- [x] T030 [US2] (UI) `src/lib/filters.ts` — `applyFilters(deals, state)`/`sortDeals(deals, sort)`: 성별, 테마, 할인율 구간(30/50/70+), 사이트, 오늘 마감, 종료 포함 여부; 정렬 할인율↓·마감 임박·가격↑
- [x] T031 [P] [US2] (UI) `src/components/FilterBar.tsx` — 성별 탭, 테마 칩(가로 스크롤), 할인율 구간, 사이트 선택, "오늘 마감", "종료된 할인 보기"
- [x] T032 [P] [US2] (UI) `src/components/SortSelect.tsx`
- [x] T033 [US2] (UI) `src/app/page.tsx`에 필터·정렬 연결, 빈 결과 문구 + 필터 초기화 버튼, 결과 개수 표시
- [x] T034 [US2] (UI) `src/components/DealCard.tsx`에 품절·만료 배지, 만료 카드 회색 처리

**Checkpoint (~3:00)**: US1+US2 완료.

---

## Phase 5: User Story 3 - 여러 사이트 수집과 상태 확인 (P3)

**Goal**: 사이트 추가 + 실패 격리 + 상태 화면

**Independent Test**: 2개 이상 사이트 수집 중 1개 실패시켜도 나머지 표시(quickstart V6)

### Tests for User Story 3

- [ ] T035 [P] [US3] (Core) `tests/unit/runner.test.ts` — 가짜 어댑터로 성공/예외/0건/`BlockedError`/`LoginRequiredError`/`NotImplementedError` 각각의 data-model.md `SiteStatus.state`·`SiteStatus.cooldownUntil` 전이와 기존 Deal 유지 확인

### Implementation for User Story 3 — Core

- [ ] T036 [US3] (Core) `src/crawler/runner.ts` 확장 — `--site all` 순차 실행, 사이트별 try/catch 격리, data-model.md "상태 전이" 그대로 구현(0건→`suspect_layout`, 차단→`blocked`+6h, 쿨다운 중 건너뜀, `force`로 무시)
- [ ] T037 [P] [US3] (Core) `src/app/api/status/route.ts` — contracts/http-api.md `GET /api/status`
- [ ] T038 [US3] (Core) `src/app/api/crawl/route.ts` — `POST /api/crawl` 백그라운드 실행, 실행 중 409, 잘못된 siteId 400

### Implementation for User Story 3 — UI

- [x] T039 [P] [US3] (UI) `src/components/SiteStatusRow.tsx` — 상태 배지(색상), 마지막 수집, 건수, 메시지, [지금 수집]
- [x] T040 [US3] (UI) `src/app/status/page.tsx` — 9개 사이트 목록, [전체 수집], 수집 중 3초마다 상태 새로고침, 목록 화면과 상단 탭으로 이동

### Implementation for User Story 3 — 사이트 수집기 (각 사이트 = fixture 저장 → parse 함수 → 테스트 → crawl 연결, contracts/adapter-interface.md "완료 기준")

- [x] T041 [P] [US3] (CrawlA) 29CM — `src/crawler/adapters/29cm.ts`, `fixtures/sites/29cm/`, `tests/adapters/29cm.test.ts`
- [x] T042 [P] [US3] (CrawlA) W컨셉 — `src/crawler/adapters/wconcept.ts`, `fixtures/sites/wconcept/`, `tests/adapters/wconcept.test.ts`
- [ ] T043 [P] [US3] (CrawlA) 네이버쇼핑 — `src/crawler/adapters/naver.ts`, `fixtures/sites/naver/`, `tests/adapters/naver.test.ts` (차단되면 상태만 확인하고 중단)
- [ ] T044 [P] [US3] (CrawlB) 지그재그 — `src/crawler/adapters/zigzag.ts`, `fixtures/sites/zigzag/`, `tests/adapters/zigzag.test.ts`
  - **보류(2026-11-27, CrawlB)**: `NotImplemented` 유지. 행사 페이지(`zigzag.kr/events/<uuid>`)는 열리지만 상품은 `api.zigzag.kr` GraphQL(POST 전용)로 따로 불러오는데, Obscura 0.2.7에서는 이 호출의 CORS 사전 요청이 거부되어 스크롤해도 상품 카드가 0개다. `fetchJson`(GET)으로는 "GraphQL only supports POST" 응답. 소유자 결정으로 제외.
- [ ] T045 [P] [US3] (CrawlB) 퀸잇 — `src/crawler/adapters/queenit.ts`, `fixtures/sites/queenit/`, `tests/adapters/queenit.test.ts`
  - **진행(2026-11-27, CrawlB)**: fixture·`parseQueenit`·테스트 통과, 실수집 19개(기획전 1곳, 53초), 무작위 5개 대조 5/5 일치. 남은 것: Core의 `fetchHtml` `preEval` 지원(아래 "CrawlB → Core 요청") 후 `npm run crawl -- --site queenit` 확인.
  - 주의: 목록 카드 가격은 비로그인 "첫구매 특가"(쿠폰 포함)다. 예: 목록 141,000원(16%) / 상품 페이지 기본가 149,000원(11%). 정가는 목록에 없어 `originalPrice: null`. 기획전 주소는 홈 HTML에 없어 `QUEENIT_SEED_COLLECTIONS`에 직접 적는다(현재 1곳).
- [ ] T046 [P] [US3] (CrawlB) 포스티 — `src/crawler/adapters/posty.ts`, `fixtures/sites/posty/`, `tests/adapters/posty.test.ts`
  - **진행(2026-11-27, CrawlB)**: fixture·`parsePosty`·테스트 통과, 실수집 562개(중복 제외 524개, 블프 기획전 5곳, 요청 6회, 371초), 무작위 5개 대조 5/5 일치, 기획전 종료 시각(`date_ended`) 수집. 남은 것: Core `preEval` 지원 후 `npm run crawl -- --site posty` 확인.
  - 주의: 가격은 "쿠폰할인가", 정가는 목록에 없어 `originalPrice: null`. 371초라 "사이트당 2분"(R5)을 넘는다 — 줄이려면 `posty.ts`의 `MAX_EVENTS`(5)를 낮춘다. 위 실수집에는 뷰티&리빙 기획전 1곳(115개)이 섞였고, 이후 제목에 뷰티·리빙이 있으면 빼도록 고쳤다(테스트만 확인, 재수집 안 함).
- [ ] T047 [P] [US3] (CrawlB) 4910 — `src/crawler/adapters/4910.ts`, `fixtures/sites/4910/`, `tests/adapters/4910.test.ts`
  - **진행(2026-11-27, CrawlB)**: fixture·`parse4910`·테스트 통과, 실수집 107개(홈 1장, 52초). 대조: 링크·상품명·브랜드 5/5 일치, **가격은 상품 페이지 대표가와 1/5만 정확히 일치**(3개는 1~2%p, 1개는 9%p 차이). 홈 카드 가격과 상품 페이지 대표가(첫구매 쿠폰 포함)가 서로 다른 쿠폰 기준이라서다 → 완료 기준 "무작위 5개 대조" 미충족. **소유자 결정(2026-11-27): 가격 차이를 감수하고 홈 카드 가격 그대로 사용.**
  - 주의: 홈 탭·"전체보기"가 버튼이라 행사 페이지 주소를 못 얻어 홈만 수집(`event: null`, 종료 시각 null). export 이름은 `site4910`(식별자가 숫자로 시작할 수 없음) — `adapters/index.ts`에서 이 이름으로 등록 필요.
- [ ] T048 [P] [US3] (CrawlB) 에이블리 — `src/crawler/adapters/ably.ts`, `fixtures/sites/ably/`, `tests/adapters/ably.test.ts` (앱 중심이라 마지막)
  - **보류(2026-11-27, CrawlB)**: `NotImplemented` 유지. `m.a-bly.com`·`a-bly.com` 모두 Obscura 0.2.7에서 페이지 스크립트가 "Maximum call stack size exceeded"로 죽어 오류 화면(새로고침 버튼)만 렌더링된다. 상품·행사 내용이 전혀 나오지 않아 수집 불가.

- [x] T058 [P] [US3] (UI→CrawlC) 아뜨랑스(새 사이트, ID `attrangs`) — `src/crawler/adapters/attrangs.ts`, `fixtures/sites/attrangs/`, `tests/adapters/attrangs.test.ts`. 렌더링 fetch는 시간 초과라 원본 HTML(`--dump original`) + cheerio 파싱. 상세: team/2-ui.md "추가 담당 (Crawl C)"
- [ ] T059 (Core) 새 사이트 `attrangs`를 `src/lib/types.ts` `SITE_IDS`, `src/lib/labels.ts`, `src/crawler/adapters/index.ts`(+스텁)에 등록하고, `CrawlContext.fetchHtml`에 원본 모드 `{ raw: true }` 추가 — 코어 엔진 워크플로가 끝난 직후

**Checkpoint (~4:15)**: 4개 이상 사이트 통합 목표(SC-002).

#### CrawlB → Core 요청 (2026-11-27)

1. **`fetchHtml` 옵션에 `preEval?: string` 추가** (T016): 값이 있으면 `--eval <preEval>`를 `--dump html --wait <waitSec>`와 함께 넘긴다. Obscura는 eval을 먼저 실행하고 wait 뒤에 HTML을 내보낸다(확인함). 퀸잇·포스티·4910은 스크롤해야 상품이 로딩되고 `--eval`은 Promise를 기다리지 않아, 이 옵션 없이는 상품이 0개 또는 일부만 나온다. 지원 전에는 세 어댑터가 빈 결과(`suspect_layout`)가 된다. 스크립트는 `src/crawler/adapters/crawlb-shared.ts`의 `harvestScript`.
2. `types.ts`의 `CrawlContext.fetchHtml` 시그니처도 `opts?: { waitSec?: number; preEval?: string }`로.
3. 새 파일 `src/crawler/adapters/crawlb-shared.ts`(CrawlB 세 어댑터 공용)를 추가했다. T007 스텁과 `queenit.ts`·`posty.ts`·`4910.ts`가 겹치면 CrawlB 쪽 파일로 덮으면 된다.
4. 다섯 사이트 모두 robots.txt가 `User-agent: *` 를 `Disallow: /` 한다. 소유자 결정으로 세 어댑터는 `obeyRobots: false`.
5. 한 페이지 수집에 50~60초가 걸린다(`waitSec` 25 + 로딩). Obscura 실행 타임아웃은 120초 이상으로.

---

## Phase 6: User Story 4 - 같은 상품 비교 (P4, Stretch)

**Goal**: 사이트별 가격 비교와 비교함

**Independent Test**: 두 사이트에 같은 상품이 있는 샘플로 최저가 강조 확인

- [ ] T049 [US4] (Core) `src/lib/group.ts` — data-model.md "Stretch: ProductGroup" 그룹 키·최저가 계산 + `tests/unit/group.test.ts`
- [ ] T050 [US4] (UI) `src/app/compare/page.tsx` — 그룹 상품 사이트별 가격표, 최저가 강조
- [ ] T051 [US4] (UI) 비교함(2~4개 담기) — `src/components/CompareTray.tsx`, DealCard에 담기 버튼

---

## Phase 7: Polish & Stretch (4:15–5:00)

- [ ] T052 [P] (Core) `src/app/api/status/[siteId]/route.ts` — `PATCH` 사이트 켜기/끄기(FR-018), runner가 `SiteStatus.enabled` 반영
- [x] T053 [P] (UI) 필터·정렬 상태를 `localStorage`에 기억(FR-022, Stretch) — `src/lib/filters.ts`, `src/app/page.tsx`
- [x] T054 [P] (UI) 마지막 업데이트 12시간 초과 경고 배너(FR-020a, Stretch) — `src/app/page.tsx`
- [ ] T055 [P] (Core) 자동 주기 수집(FR-002a, Stretch) — `src/crawler/schedule.ts`, `npm run crawl:watch`
- [ ] T056 (전원) quickstart.md V1–V8 검증, 실패 항목 수정, `README.md`에 실행법 요약
- [ ] T057 (Core) 최종 `main` 정리·태그 `v0.1.0`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup → Foundational**: Core 단독 40분. 다른 3명은 그동안 Obscura 설치(quickstart §1), 담당 사이트의 블프 행사 URL 찾기, 원본 저장 시작
- **US1~US3**: Foundational 이후 병렬. 수집기(T021–T022, T041–T048)는 `ctx`가 준비되기 전에도 fixture+parse 함수부터 작성 가능
- **US4·Polish**: US1~US2 완료 후, 시간이 남을 때

### Critical Path (MVP)

```text
T001→T004→T007 ─┬─ T016 obscura → T019 runner/cli ─┐
                ├─ T021→T022 musinsa ──────────────┼→ 실데이터 수집 → T020 API → T026 연결 → MVP
                └─ T023→T024→T025 UI(sample) ──────┘
```

### Story Dependencies

- US1: Foundational만 필요
- US2: Foundational만 필요(샘플 데이터로 독립 개발), 실데이터 분류는 T029
- US3: 수집기는 Foundational만 필요, 상태 화면은 T037·T038 필요
- US4: T017 normalize 이후

### Parallel Opportunities

- 0:40 이후 4명이 서로 다른 폴더: Core=`src/lib`·`src/crawler/*.ts`·`src/app/api`, UI=`src/app/(page)`·`src/components`, CrawlA/B=각자 `adapters/<site>.ts`·`fixtures/sites/<site>`·`tests/adapters/<site>`
- 사이트 수집기 8개(T041–T048)는 모두 [P]

## Parallel Example: 0:40 시점

```text
Core   : T016 obscura.ts → T017 normalize → T018 store → T019 runner/cli → T020 API
UI     : T023 time.ts → T024 DealCard → T025 page → T030 filters ...
CrawlA : T021 무신사 fixture → T013 테스트 → T022 musinsa.ts
CrawlB : T044 지그재그 fixture/parse/test → T045 퀸잇 ...
```

## Implementation Strategy

1. **0:00–0:40** Setup + Foundational (Core), 나머지는 설치·사이트 조사
2. **0:40–2:00** US1 — 무신사 실데이터 목록 = **MVP**. 2:00에 무조건 통합·머지
3. **2:00–3:00** US2 필터/정렬 + 사이트 추가 진행
4. **3:00–4:15** US3 상태 화면 + 사이트 4개 이상
5. **4:15–5:00** 통합 검증(quickstart), 남는 시간에 Stretch. 4:30 이후 새 기능 시작 금지

## Notes

- 작업 하나 끝날 때마다 작은 PR → `main` 머지(30~45분 간격)
- 공용 파일 변경은 Core에게 요청, 다른 사람 폴더 수정 금지
- 사이트가 막히면 30분 이상 붙잡지 말고 다음 사이트로
- 쿠키·`data/`·`.env.local` 커밋 금지
