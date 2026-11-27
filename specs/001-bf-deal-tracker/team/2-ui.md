# 팀원2 · UI

**한 줄 역할**: 배민/쿠팡이츠처럼 훑어보기 좋은 카드 목록과 필터·정렬, 수집 상태 화면을 만든다.
API가 준비되기 전에는 `fixtures/sample-deals.json`으로 개발한다.

**읽을 문서**: [spec.md](../spec.md) US1·US2·US3·US4, [contracts/http-api.md](../contracts/http-api.md) (특히 "화면 계약"),
[data-model.md](../data-model.md) `Deal`·`SiteStatus`

**내 파일**: `src/app/page.tsx`, `src/app/status/page.tsx`, `src/app/compare/page.tsx`, `src/components/**`,
`src/lib/{filters,time}.ts`, `tests/unit/filters.test.ts`
(`src/lib/api.ts`는 Core 파일이지만 T026의 `getDeals()` 교체만 Core와 함께 진행)

## 작업 순서

| 시간 | 작업 | 내용 | 끝나면 |
|------|------|------|--------|
| 0:00–0:40 | 준비 | Obscura 설치(통합 확인용), 배민/쿠팡이츠 화면 참고해 카드·탭·칩 스케치 | |
| 0:40 | T023 | 남은 시간 표시 `time.ts` | |
| | T024 | `DealCard` — 이미지, 사이트, 브랜드, 상품명, **할인율 크게**, 할인가, 정가 취소선, 남은 시간 | |
| | T025 | 목록 화면 + 상단 마지막 업데이트 시각, 모바일 2열 / 데스크톱 4~5열 | 샘플 데이터로 데모 |
| ~1:50 | **T026** | Core의 `/api/deals` 준비되면 `getDeals()` 교체 | **MVP 통합 (2:00)** |
| 2:00 | T028, T030 | 필터·정렬 테스트 → `filters.ts` | |
| | T031–T034 | FilterBar(성별 탭·테마 칩·할인율·사이트·오늘 마감·종료 보기), SortSelect, 빈 결과, 품절/만료 배지 | US2 완료 |
| 3:00 | T039–T040 | 상태 화면: 사이트별 배지·마지막 수집·건수·[지금 수집]·[전체 수집], 3초 새로고침 | Core의 T037·T038 필요 |
| 4:15 | 검증 | 375px 폭 가로 스크롤 없음, V4·V5·V7 | |
| 여유 | T050–T051, T053–T054 | 비교 화면·비교함, 필터 기억, 오래된 데이터 경고 | |

## 추가 담당 (Crawl C): 새 사이트 수집기 1개 (T058)

UI 화면이 일찍 끝나, 기존 9개 밖에서 **지금 블랙프라이데이 행사를 하는 의류 사이트**를 새로 붙인다.
기존 9개(무신사·29CM·W컨셉·네이버·지그재그·퀸잇·포스티·4910·에이블리)는 담당자가 있으니 건드리지 않는다.

### 1단계: 사이트 (아뜨랑스 확정, 그다음은 후보에서)

**첫 번째는 아뜨랑스(`attrangs.co.kr`, ID `attrangs`)로 확정.** 2026-11-27 22:55에 Core가 확인한 내용:

- 첫 화면에 "🎉 블랙프라이데이 6900원부터~" 문구와 "블프특가" 메뉴가 있다 → 그 메뉴의 링크가 행사 페이지다.
- `obscura --stealth --obey-robots fetch https://attrangs.co.kr/ --dump original` 은 정상(HTML 36만 자, robots 허용).
- 같은 주소를 `--dump html`(렌더링)로 읽으면 30초 안에 끝나지 않고 시간 초과가 난다.
  → 렌더링 없이 **원본 HTML을 받아 cheerio로 파싱**하는 방식으로 간다. `ctx.fetchHtml`에 원본 모드
  (`{ raw: true }`)를 Core가 추가할 예정이니, 그 전까지는 저장한 원본으로 `parse` 함수와 테스트부터 만든다.
- 여성 쇼핑몰이라 성별 표기가 없으면 `rawGender: '여성'`으로 넣어도 된다(사이트 자체가 여성 전용임을 주석에 적을 것).

아뜨랑스가 끝나고 시간이 남으면 아래 후보에서 **행사가 실제로 진행 중이고 Obscura로 읽히는 첫 번째 사이트**를 하나 더 한다.
날짜는 2026-11-27 검색 기준이며 자료마다 달랐으니 사이트에서 직접 확인한다.

| 순위 | 사이트 | 보도된 행사 기간 | 참고 |
|------|--------|------------------|------|
| 1 | 유니클로 (`uniqlo.com/kr`) | 11-27 ~ 12-03 (다른 자료는 11-21 ~ 11-27) | 가장 늦게 끝날 가능성. 성별 카테고리가 명확 |
| 2 | 탑텐몰 (`topten10mall.com`) | 11-18 ~ 11-30 (다른 자료는 11-08 종료) | |
| 3 | 스파오 (`spao.com`) | 11-23 ~ 11-29 (공식 미확정) | |

SSF샵·LF몰·아디다스·나이키는 행사가 이미 끝난 것으로 나와 제외했다. 다른 사이트를 찾았다면 그것도 좋다.

확인 방법: 브라우저에서 행사 페이지가 열려 있는지 본 뒤 Obscura로 읽어 본다.

```powershell
& $env:OBSCURA_PATH --stealth --obey-robots fetch <행사 페이지 URL> --dump text --timeout 30
```

- `Blocked by robots.txt` → 그 주소는 못 쓴다. 페이지가 부르는 공개 JSON API 주소(개발자도구 Network 탭)를 같은 명령으로
  확인하고, 그것도 막히면 다음 후보로 넘어간다.
- CAPTCHA/차단 문구 → 다음 후보로.

`attrangs`는 Core(장성민)가 공용 타입 `SITE_IDS`와 라벨, `adapters/index.ts`에 등록한다(이 세 파일은 Core만 고친다).
등록 전에도 2단계의 1~3번은 진행할 수 있다. **두 번째 사이트를 정하면 팀 채팅에 사이트 이름과 ID(영문 소문자,
예: `uniqlo`)를 알린다** — 그것도 Core가 등록한다.

### 2단계: 수집기 만들기

**먼저 할 일**: `git pull origin main` → Obscura v0.2.7 stealth 설치([quickstart.md](../quickstart.md) §1–2)
→ [contracts/adapter-interface.md](../contracts/adapter-interface.md) 읽기. 브랜치는 `feat/crawlc-<id>`.

**내 파일(추가)**: `src/crawler/adapters/<id>.ts`, `fixtures/sites/<id>/`, `tests/adapters/<id>.test.ts`

본보기: `feat/crawla-musinsa` 브랜치의 `src/crawler/adapters/musinsa.ts`와 `tests/adapters/musinsa.test.ts`
(실수집 725개로 검증된 구현).

1. 블프 행사 페이지의 원본 응답을 `fixtures/sites/<id>/`에 저장
2. 데이터 위치 확인: 공개 JSON API(`ctx.fetchJson`, GET만 가능) → 없으면 HTML 안 JSON(`ctx.evalPage`, 동기 표현식만,
   실패 시 `null`) → 그것도 없으면 HTML 파싱(`ctx.fetchHtml` + cheerio)
3. `parse<Site>(raw): RawDeal[]` 순수 함수 + fixture 테스트 (`tests/helpers/fakeContext.ts`의 `createFakeContext()` 사용)
4. `crawl(ctx)` 연결 — 요청은 `ctx.requestsLeft` 안에서. 종료 시각은 사이트가 준 값을 그대로 넣는다
   (절대 시각이면 형식 무관, 한글 문구면 `parseKoreanEndDate`, 모르면 `null`)
5. 무작위 5개를 실제 사이트와 대조하고 결과를 `fixtures/sites/<id>/README.md`에 적는다

**하지 말 것**: `ctx` 말고 직접 `fetch`/Obscura 실행, 할인율 계산·성별/테마 판정(Core가 함), CAPTCHA 뜬 사이트 반복 재시도,
로그인·앱 전용 API 우회, 쿠키 커밋, 공용 파일(`types.ts`, `labels.ts`, `adapters/index.ts`) 수정.

40분 넘게 막히면 멈추고 다음 후보로 넘어간다.

Claude에게 시작 요청 예시:

```text
specs/001-bf-deal-tracker/team/2-ui.md 의 "추가 담당 (Crawl C)"와 contracts/adapter-interface.md 를 읽어줘.
아뜨랑스(attrangs.co.kr)의 "블프특가" 행사 페이지를 찾아 원본 HTML을 fixtures/sites/attrangs/ 에 저장하고
(obscura --dump original 사용), parseAttrangs 테스트부터 수집기를 진행해줘.
```

## 디자인 가이드 (배민식)

- 상단 고정: 성별 탭(전체/남성/여성/공용) → 테마 칩 가로 스크롤 → 할인율 칩(30/50/70%+) → 정렬
- 카드: 정사각 이미지, 좌상단 사이트 뱃지, 할인율은 빨간 굵은 글씨, 마감 24시간 이내면 "오늘 마감" 강조
- "알 수 없음"은 회색 작은 글씨 — 값을 지어내지 않는다(헌법 III)
- 카드 클릭은 원 사이트 새 탭

## Claude에게 시작 요청 예시

```text
specs/001-bf-deal-tracker/team/2-ui.md 와 contracts/http-api.md, data-model.md 를 읽고
fixtures/sample-deals.json 으로 T023, T024, T025 를 진행해줘. 디자인은 배민 앱처럼 카드형으로.
```
