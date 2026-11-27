# 팀원4 · Crawl B — 지그재그 · 퀸잇 · 포스티 · 4910 · 에이블리

**한 줄 역할**: 여성 패션 앱 계열 사이트 수집기를 붙여 **사이트 4개 이상(SC-002)** 목표를 채운다.
MVP(무신사)와 독립적이라 0:40부터 바로 시작한다.

**읽을 문서**: [contracts/adapter-interface.md](../contracts/adapter-interface.md) (필독), [data-model.md](../data-model.md) `RawDeal`,
[research.md](../research.md) R1·R2·R4·R5·R9, [quickstart.md](../quickstart.md) §1–2

**내 파일**: `src/crawler/adapters/{zigzag,queenit,posty,4910,ably}.ts`, `fixtures/sites/{zigzag,queenit,posty,4910,ably}/`,
`tests/adapters/{zigzag,queenit,posty,4910,ably}.test.ts`

## 작업 순서

| 시간 | 작업 | 내용 |
|------|------|------|
| 0:00–0:40 | 준비 | Obscura v0.2.7 stealth 설치, 지그재그·퀸잇 블프 행사 URL 찾기, 원본 저장 |
| 0:40 | T044 | 지그재그 (fixture → parse → 테스트 → crawl) |
| 2:00 | T045 | 퀸잇 — 2:00 통합 때 지그재그 실수집도 같이 확인 |
| 2:40 | T046 | 포스티 |
| 3:20 | T047 | 4910 |
| 4:00 | T048 | 에이블리 (웹 행사 페이지가 없거나 앱 전용이면 `NotImplemented` 유지하고 사유를 tasks.md에 메모) |
| 4:15 | 검증 | 내 사이트 각각 무작위 5개 대조, 결과를 팀에 공유 |

한 사이트에 40분 넘게 걸리면 다음 사이트로 넘어가고, 남는 시간에 돌아온다.

## 사이트마다 같은 절차

1. 블프 행사 페이지 URL 찾기 → 원본 저장 `fixtures/sites/<id>/event.html` (또는 `.json`)
2. SPA가 많으므로 먼저 렌더링된 HTML 안의 JSON(`__NEXT_DATA__` 등)이나 페이지가 호출하는 JSON API를 확인 → `evalPage` / `fetchJson`
3. `parse<Site>(raw): RawDeal[]` 순수 함수 + 테스트
4. `crawl(ctx)`: 행사 목록 → 상품 목록, 페이지는 `maxRequests` 이내
5. 종료 시각 문구는 `parseKoreanEndDate` 사용, 없으면 `null`

## 하지 말 것

- `ctx` 말고 직접 `fetch`나 Obscura 실행
- 앱 전용 API를 위해 인증 토큰을 빼내거나 로그인 자동화 (헌법 II)
- 할인율 계산, 성별/테마 판정 (Core가 함)
- CAPTCHA가 뜬 사이트 반복 재시도, 쿠키·세션 파일 커밋

## Claude에게 시작 요청 예시

```text
specs/001-bf-deal-tracker/team/4-crawl-b.md 와 contracts/adapter-interface.md 를 읽어줘.
fixtures/sites/zigzag/ 원본으로 지그재그 수집기(T044)를 테스트부터 진행해줘.
```
