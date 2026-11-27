# Research: BF Deal Tracker

Phase 0 결과. Technical Context의 모든 항목이 결정되어 남은 NEEDS CLARIFICATION은 없다.

## R1. 크롤링 엔진: Obscura 버전과 빌드

- **Decision**: 팀 전원 **Obscura v0.2.7 stealth 빌드**로 통일한다.
  - Windows: `obscura-x86_64-windows-stealth.zip`
  - macOS (Apple Silicon): `obscura-aarch64-macos-stealth.tar.gz` / Intel Mac: `obscura-x86_64-macos-stealth.tar.gz`
  - 받는 곳: https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.7
  - 압축을 풀고 `obscura.exe`(또는 `obscura`) 경로를 `.env.local`의 `OBSCURA_PATH`에 적는다.
- **Rationale**: `--stealth` 옵션 자체는 모든 빌드에 있지만, TLS 위장과 트래커 차단은 `stealth` 기능으로
  빌드된 배포본에만 들어 있다(`obscura --help`의 `--stealth` 설명). 버전을 맞춰야 같은 fixture에서 같은
  결과가 나온다. 스크린샷이 필요 없으면 `no-render` 빌드도 되지만, 디버깅용 `--screenshot`을 위해 render
  포함 빌드를 쓴다.
- **Alternatives considered**: Playwright/Chromium(무겁고 헌법 II가 Obscura 지정), 일반 `fetch`(SPA 사이트 렌더링 불가).

## R2. Obscura 호출 방식

- **Decision**: Node에서 `child_process.execFile`로 `obscura fetch`를 호출하는 래퍼 하나(`src/crawler/obscura.ts`).
  - HTML 페이지: `obscura --stealth fetch <url> --dump html --wait 5 --timeout 30`
  - 페이지 안 데이터 추출: `--eval "<js>"` 로 `window.__NEXT_DATA__` 같은 내장 JSON을 꺼냄
  - JSON API: `--dump original` 로 응답 본문을 그대로 받음
  - robots.txt: `--obey-robots`를 기본으로 켜고, 사이트 설정에서만 끌 수 있게 함
- **Rationale**: 5시간 안에 가장 단순하고, 수집기 담당자가 `fetchHtml/fetchJson/evalPage` 세 함수만 알면 된다.
- **Alternatives considered**: `obscura serve` + Puppeteer CDP 연결 — 쿠키 주입·여러 단계 클릭이 쉽지만
  설정이 늘어난다. 로그인 필요한 사이트가 생길 때만(Stretch) 도입한다.

## R3. 로그인 세션

- **Decision**: MVP 범위의 행사 페이지는 로그인 없이 수집 가능한 것만 대상으로 한다. 로그인이 꼭 필요한
  사이트는 상태를 `login_required`로 표시하고 건너뛴다. 이후 필요하면 `--storage-dir sessions/<siteId>`로
  본인 세션을 유지하는 방식을 시험한다(세션 폴더는 git 제외).
- **Rationale**: 대부분 블프 기획전은 비로그인으로 열람 가능. 5시간 안에 세션 관리까지 넣으면 위험.

## R4. CAPTCHA / 차단 감지

- **Decision**: 응답 HTML/텍스트에서 다음 신호가 보이면 `blocked`로 판정하고 해당 사이트 수집을 즉시 중단:
  HTTP 403/429, `captcha`, `recaptcha`, `hcaptcha`, `cf-challenge`, "로봇이 아닙니다", "비정상적인 접근",
  "자동입력 방지". 쿨다운 6시간(`cooldownUntil`) 동안 자동 재시도 금지.
- **Rationale**: 헌법 II — 자동으로 풀지 않고 멈춘다.

## R5. 요청 속도

- **Decision**: 요청 사이 2~4초 무작위 대기, 사이트당 한 번 실행에 최대 30요청, 실패 3번 연속이면 중단.
- **Rationale**: 사이트당 2분 이내, 9개 전체 30분 이내(SC). 사람이 둘러보는 수준.

## R6. 웹 스택

- **Decision**: Next.js 15 App Router + TypeScript + Tailwind CSS. 목록은 `/api/deals`로 전체를 한 번 받아
  브라우저에서 필터/정렬(`lib/filters.ts` 순수 함수).
- **Rationale**: 하나의 `npm run dev`로 화면과 API가 함께 뜨고, Claude가 가장 빠르게 생성하는 스택.
  상품 수천 개는 브라우저 메모리 필터로 1초 이내 충분.
- **Alternatives considered**: Vite + Express(프로세스 2개), Python FastAPI + React(언어 2개) — 5시간·4명에 불리.

## R7. 저장소

- **Decision**: 사이트별 JSON 파일 `data/deals/<siteId>.json`, 상태 `data/status/<siteId>.json`.
  쓰기는 임시 파일 작성 후 이름 바꾸기(원자적 교체).
- **Rationale**: 사이트끼리 파일이 분리되어 병렬 수집·부분 실패에 안전. DB 설치 불필요(헌법 I).
- **Alternatives considered**: SQLite(설치·마이그레이션 시간), 단일 JSON(동시 쓰기 충돌).

## R8. 성별·테마 분류

- **Decision**: 1순위 사이트 카테고리 경로 매핑(수집기가 `rawCategory`로 전달), 2순위 상품명 키워드 사전
  (`lib/classify.ts`), 실패 시 `unclassified`. 키워드 예: 패딩/코트/자켓/점퍼→outer, 니트/가디건→knit,
  청바지/슬랙스/팬츠→bottom, 원피스/스커트→dress, 운동화/부츠→shoes, 우먼/여성/W→women, 맨/남성/M→men.
- **Rationale**: 규칙 기반이라 테스트 가능(헌법 IV). AI 분류는 시간·비용 대비 불필요.

## R9. 사이트별 예상 난이도 (수집기 분배 근거)

| 사이트 | 예상 방식 | 난이도 | 담당 |
|--------|-----------|--------|------|
| 무신사 | 행사 페이지 렌더링 후 내장 JSON/HTML | 중 | 수집 A (MVP 1순위) |
| 29CM | 기획전 페이지 내장 JSON | 중 | 수집 A |
| W컨셉 | 기획전 HTML | 중 | 수집 A |
| 네이버쇼핑 | 쇼핑 기획전 페이지, 봇 차단 강함 | 상 | 수집 A (마지막) |
| 지그재그 | SPA, 내장 JSON | 중 | 수집 B |
| 에이블리 | SPA/앱 중심 | 상 | 수집 B |
| 퀸잇 | SPA | 중 | 수집 B |
| 포스티 | 웹 기획전 | 중 | 수집 B |
| 4910 | SPA | 중 | 수집 B |

실제 구조는 각 담당자가 첫 페치에서 확인하고 `fixtures/sites/<siteId>/`에 원본을 저장한다.
