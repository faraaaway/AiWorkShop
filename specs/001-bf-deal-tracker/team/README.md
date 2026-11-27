# 팀 담당표 (4명 · 5시간)

이름 칸을 채우고 시작하세요. 작업 번호는 [tasks.md](../tasks.md) 기준입니다.

| 역할                  | 이름       | 담당                                                                | 문서                           | 주로 수정하는 곳                                                                                                     |
| --------------------- | ---------- | ------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 팀원1 **Core (Lead)** | 장성민(나) | 프로젝트 뼈대, 공용 타입, Obscura 래퍼, 수집 실행기, API, 통합·머지 | [1-core.md](./1-core.md)       | `src/lib/*`, `src/crawler/*.ts`, `src/app/api/*`, `fixtures/sample-deals.json`                                       |
| 팀원2 **UI + Crawl C** | 김호성    | 카드 목록, 필터·정렬, 상태 화면, 비교 화면 + **새 사이트 수집기: 아뜨랑스**(다음 후보: 유니클로·탑텐몰·스파오) | [2-ui.md](./2-ui.md)           | `src/app/page.tsx`, `src/app/status`, `src/app/compare`, `src/components/*`, `src/lib/filters.ts`, `src/lib/time.ts`, 새 사이트의 `adapters/<id>.ts` |
| 팀원3 **Crawl A**     | 이광민     | 무신사(MVP) → 29CM → W컨셉 → 네이버쇼핑                             | [3-crawl-a.md](./3-crawl-a.md) | `src/crawler/adapters/{musinsa,29cm,wconcept,naver}.ts`, `fixtures/sites/…`, `tests/adapters/…`                      |
| 팀원4 **Crawl B**     | 이태영     | 지그재그 → 퀸잇 → 포스티 → 4910 → 에이블리                          | [4-crawl-b.md](./4-crawl-b.md) | `src/crawler/adapters/{zigzag,queenit,posty,4910,ably}.ts`, `fixtures/sites/…`, `tests/adapters/…`                   |

> **담당 추가 (1시간 시점)**: UI 화면이 일찍 끝나, 김호성 님이 기존 9개 밖의 **새 사이트**를 맡습니다. 첫 번째는
> 아뜨랑스(`attrangs`, 블프 행사 진행 중 확인)입니다. 기존 9개 사이트의 담당은 그대로입니다.
> 새 사이트 ID는 Core(장성민)가 공용 타입에 등록합니다 — 두 번째 사이트를 정하면 팀 채팅에 알려 주세요.

## 타임라인

| 시간      | Core                                                       | UI                                            | Crawl A                                         | Crawl B                                                |
| --------- | ---------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| 0:00–0:40 | 뼈대·공용 타입·스텁·샘플 데이터 (T001–T010)                | Obscura 설치, 디자인 참고(배민/쿠팡이츠) 정리 | Obscura 설치, 무신사 블프 페이지 찾기·원본 저장 | Obscura 설치, 지그재그·퀸잇 블프 페이지 찾기·원본 저장 |
| 0:40–2:00 | obscura.ts → normalize → store → runner/cli → `/api/deals` | DealCard·목록 화면(샘플 데이터)               | 무신사 수집기 완성                              | 지그재그 수집기                                        |
| **2:00**  | **MVP 통합: 무신사 실데이터가 목록에 표시**                | ← API 연결                                    | ← 실수집 확인                                   | 계속                                                   |
| 2:00–3:00 | 분류 규칙(classify)                                        | 필터·정렬                                     | 29CM                                            | 퀸잇 → 포스티                                          |
| 3:00–4:15 | 실패 격리·상태 API·수집 API                                | 상태 화면                                     | W컨셉 → 네이버                                  | 4910 → 에이블리                                        |
| 4:15–5:00 | 통합 검증·머지                                             | 다듬기·Stretch                                | 검증                                            | 검증                                                   |

## 공통 규칙

1. 시작 전 [quickstart.md](../quickstart.md) §1 설치(Obscura **v0.2.7 stealth 빌드**)
2. 브랜치 `feat/<역할>-<작업>` (예: `feat/crawla-musinsa`) → 작게 PR → `main`. 머지는 Core가 확인
3. **자기 파일만 수정**. `src/lib/types.ts`, `src/lib/errors.ts`, `src/crawler/adapters/index.ts`는 Core만
4. 쿠키, `data/`, `.env.local` 커밋 금지
5. 사이트가 30분 넘게 막히면 다음 사이트로 넘어가고 팀 채팅에 공유
6. 4:30 이후 새 기능 시작 금지 — 통합과 검증만

## Claude Code 사용 팁

- 각자 세션 시작 시 자기 문서를 먼저 읽히세요:
  `specs/001-bf-deal-tracker/team/<내 문서>.md 와 contracts/를 읽고 내 담당 작업 T0xx부터 진행해줘`
- `/speckit-implement`는 전체 작업을 한 번에 진행하므로 **4명이 동시에 쓰지 마세요**. 담당 작업 번호를 지정해서 요청하세요.
- 작업이 끝나면 tasks.md의 해당 체크박스를 `[x]`로 바꿔 함께 커밋하세요.
