# 팀원3 · Crawl A — 무신사 · 29CM · W컨셉 · 네이버쇼핑

**한 줄 역할**: MVP의 핵심인 **무신사 수집기를 2:00 전에 완성**하고, 이어서 29CM → W컨셉 → 네이버쇼핑을 붙인다.

**읽을 문서**: [contracts/adapter-interface.md](../contracts/adapter-interface.md) (필독), [data-model.md](../data-model.md) `RawDeal`,
[research.md](../research.md) R1·R2·R4·R5·R9, [quickstart.md](../quickstart.md) §1–2

**내 파일**: `src/crawler/adapters/{musinsa,29cm,wconcept,naver}.ts`, `fixtures/sites/{musinsa,29cm,wconcept,naver}/`,
`tests/adapters/{musinsa,29cm,wconcept,naver}.test.ts`

## 작업 순서

| 시간 | 작업 | 내용 |
|------|------|------|
| 0:00–0:40 | 준비 | Obscura v0.2.7 stealth 설치, 무신사 블프 행사 URL 찾기, `obscura --stealth fetch <url> --dump html -o ...`로 원본 저장 (T021) |
| 0:40 | T013 | 무신사 파서 테스트 작성(fixture 기반) |
| | T022 | `parseMusinsa` → `crawl(ctx)` 연결. Core의 `obscura.ts`(T016)가 오면 `npm run crawl -- --site musinsa` 실수집 |
| **2:00** | MVP 통합 | 실데이터 10개를 사이트와 대조 (가격·할인율·링크·종료 시각) |
| 2:00 | T041 | 29CM |
| 3:00 | T042 | W컨셉 |
| 3:45 | T043 | 네이버쇼핑 (봇 차단이 강하면 `blocked` 상태 확인까지만 하고 중단) |
| 4:15 | 검증 | 내 사이트 각각 무작위 5개 대조, 결과를 팀에 공유 |

## 사이트마다 같은 절차

1. 블프 행사 페이지 URL 찾기 → 원본 저장 `fixtures/sites/<id>/event.html` (또는 `.json`)
2. 데이터 위치 확인: HTML 안의 JSON(`__NEXT_DATA__`, `window.__APOLLO_STATE__` 등) → 있으면 `evalPage`나 JSON 파싱, 없으면 cheerio로 HTML 파싱
3. `parse<Site>(raw): RawDeal[]` 순수 함수 + 테스트
4. `crawl(ctx)`: 행사 목록 → 상품 목록, 페이지는 `maxRequests` 이내
5. 종료 시각 문구는 `parseKoreanEndDate` 사용, 없으면 `null`

## 하지 말 것

- `ctx` 말고 직접 `fetch`나 Obscura 실행 (요청 간격·차단 감지가 빠짐)
- 할인율 계산, 성별/테마 판정 (Core가 함) — 사이트 원문을 `rawCategory`, `rawGender`, `displayedDiscountRate`에 담기만
- CAPTCHA가 뜬 사이트 반복 재시도 — 멈추고 다음 사이트로(헌법 II)
- 쿠키·세션 파일 커밋

## Claude에게 시작 요청 예시

```text
specs/001-bf-deal-tracker/team/3-crawl-a.md 와 contracts/adapter-interface.md 를 읽어줘.
fixtures/sites/musinsa/ 에 저장한 원본으로 parseMusinsa 테스트(T013)와 구현(T022)을 진행해줘.
```
