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
