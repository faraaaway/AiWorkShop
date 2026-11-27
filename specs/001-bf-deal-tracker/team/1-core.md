# 팀원1 · Core (Lead)

**한 줄 역할**: 모두가 쓰는 기반을 0:40까지 고정하고, 수집 실행기·API를 만들어 2:00에 MVP를 통합한다.
머지 담당이기도 하다.

**읽을 문서**: [plan.md](../plan.md), [data-model.md](../data-model.md), [contracts/adapter-interface.md](../contracts/adapter-interface.md), [contracts/http-api.md](../contracts/http-api.md), [research.md](../research.md) R2·R4·R5·R7·R8

**내 파일**: `package.json`, 설정 파일, `src/lib/{types,errors,labels,env,discount,dates,classify,normalize,store,api,group}.ts`,
`src/crawler/{obscura,runner,cli,schedule}.ts`, `src/crawler/adapters/index.ts`, `src/app/api/**`, `fixtures/sample-deals.json`, `tests/unit/{discount,dates,classify,runner,group}.test.ts`

## 작업 순서

| 시간 | 작업 | 내용 | 끝나면 |
|------|------|------|--------|
| 0:00 | T001–T003 | Next.js·Tailwind·Vitest·tsx 세팅, `.env.example` | |
| 0:20 | T004–T009 | 타입·오류·라벨, **9개 어댑터 스텁**, 샘플 데이터 40개, `api.ts` | |
| 0:40 | **T010** | `main` 푸시 → 팀에 "기반 완료, pull 하세요" | 3명 병렬 시작 |
| 0:40 | T011, T014 | 할인율 테스트 → 구현 | |
| | T012, T015 | 종료일 파싱 테스트 → 구현 (CrawlA/B가 사용) | 팀에 알림 |
| | T016 | `obscura.ts` (stealth, 대기, 요청 상한, 차단 감지) | CrawlA가 실수집 가능 |
| | T017–T019 | normalize, store, runner 기본형 + `npm run crawl` | |
| 1:45 | T020 | `GET /api/deals` | UI에 알림 |
| **2:00** | 통합 | 무신사 실수집 → 목록 표시 확인, `main` 머지 | **MVP** |
| 2:00 | T027, T029 | 분류 규칙 테스트 → 구현 | |
| 3:00 | T035–T038 | runner 실패 격리·쿨다운, `/api/status`, `/api/crawl` | UI 상태 화면 연결 |
| 4:15 | T056–T057 | 전체 수집 실행, quickstart V1–V8, 최종 머지 | |
| 여유 | T049, T052, T055 | 상품 묶음, 사이트 켜기/끄기, 자동 수집 | |

## 체크 포인트

- 0:40에 `types.ts`를 확정하면 이후 변경은 최소화하고, 바꾸면 즉시 팀에 공지
- `obscura.ts`가 늦어지면 CrawlA/B는 fixture + parse 함수로 계속 진행 가능 — 막히지 않게 우선순위 유지
- PR 머지 시 다른 사람 폴더를 건드린 변경이 있는지 확인
- 차단(`blocked`)이 나오면 그 사이트는 재시도하지 말고 쿨다운을 지킨다(헌법 II)

## Claude에게 시작 요청 예시

```text
specs/001-bf-deal-tracker/team/1-core.md, plan.md, data-model.md, contracts/ 를 읽고
T001부터 T010까지 순서대로 진행해줘. T007 스텁은 contracts/adapter-interface.md 형식으로 9개 모두 만들어줘.
```
