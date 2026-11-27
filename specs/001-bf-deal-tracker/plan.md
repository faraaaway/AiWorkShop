# Implementation Plan: 블랙프라이데이 의류 할인 모아보기 (BF Deal Tracker)

**Branch**: `001-bf-deal-tracker` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-bf-deal-tracker/spec.md`

## Summary

개인용 블프 의류 할인 모아보기. 사이트별 수집기(adapter)가 Obscura(스텔스 모드) 헤드리스 브라우저로
행사 페이지/JSON을 받아 공통 `Deal` 형식으로 바꿔 사이트별 JSON 파일에 저장하고, Next.js 웹앱이 이를
합쳐 배민식 카드 목록 + 성별·테마·할인율 필터/정렬 + 수집 상태 화면으로 보여준다.

5시간·4명 일정에 맞춰 **첫 30분 안에 공통 타입·수집기 인터페이스·샘플 데이터를 고정**하고, 이후
UI 담당 1명, 수집기 담당 2명, 코어/통합 담당 1명이 서로 다른 파일만 건드리며 병렬로 작업한다.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 (설치됨: v24.16.0)

**Primary Dependencies**:
- Web: Next.js 15 (App Router) + React 19 + Tailwind CSS 4
- Crawl: Obscura v0.2.7 CLI (`obscura fetch --stealth`), 경로는 `OBSCURA_PATH` 환경변수
- Parse: cheerio (HTML), 기본 `JSON.parse` (JSON API 응답)
- CLI 실행: tsx

**Storage**: 로컬 JSON 파일 (`data/deals/<siteId>.json`, `data/status/<siteId>.json`), git 제외

**Testing**: Vitest — 할인율 계산, 분류 규칙, 사이트별 파서(저장된 fixture 사용, 네트워크 없음)

**Target Platform**: 소유자 PC(Windows)에서 `npm run dev`; 같은 와이파이의 휴대폰 브라우저로 접속

**Project Type**: Web application (Next.js 단일 프로젝트 + Node CLI 수집기)

**Performance Goals**: 5,000개 상품에서 필터/정렬 1초 이내(클라이언트 메모리 필터), 전체 수집 30분 이내

**Constraints**: 요청 간 2~4초 대기, 사이트당 최대 페이지 수 제한, CAPTCHA 감지 시 중단 + 6시간 쿨다운,
쿠키/세션 파일 커밋 금지, 테스트는 네트워크 없이

**Scale/Scope**: 사용자 1명, 사이트 9개(MVP 1개), 화면 2개(목록, 수집 상태) + Stretch 비교 화면,
상품 최대 수천 개

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 원칙 | 확인 내용 | 결과 |
|------|-----------|------|
| I. 개인용 범위 | 로그인/결제/배포 없음. 로컬 실행, JSON 파일 저장 | PASS |
| II. Obscura 크롤링 | 모든 수집은 `src/crawler/obscura.ts` 하나를 통해 Obscura 사용. `--stealth` 사이트별 on/off. 요청 간격·페이지 상한·CAPTCHA 감지 후 중단·쿨다운. 자동 로그인 없음 | PASS |
| III. 출처 추적 | `Deal`에 site, url, 정가/할인가, 할인율, endsAt, crawledAt 필수 필드. 모르면 `null` → "알 수 없음". 할인율은 `lib/discount.ts` 한 곳 | PASS |
| IV. 공통 데이터 형식 | 수집기는 `RawDeal` → `normalize()` → `Deal`. 성별/테마는 `lib/classify.ts` 규칙 + 테스트. 종료된 할인 기본 숨김 | PASS |
| V. 비교 UX | 카드 목록 + 필터/정렬 + 모바일 대응 + 마지막 수집 시각 표시 | PASS |
| 기술 제약 | 사이트별 독립 모듈, fixture 기반 파서 테스트, 비밀정보 git 제외 | PASS |

위반 사항 없음 → Complexity Tracking 비움.

**Post-design re-check (Phase 1 이후)**: data-model.md, contracts/ 확인 결과 위 표 그대로 PASS.
수집기 인터페이스가 Obscura 호출을 공용 모듈로 강제하고, 실패를 `CrawlResult.status`로 격리하므로 II·III 충족.

## Project Structure

### Documentation (this feature)

```text
specs/001-bf-deal-tracker/
├── plan.md              # This file
├── research.md          # Phase 0: 기술 선택과 근거
├── data-model.md        # Phase 1: Deal / SiteStatus 등 데이터 형식
├── quickstart.md        # Phase 1: 실행·검증 방법
├── contracts/
│   ├── adapter-interface.md   # 수집기 공통 인터페이스 (수집 담당자 필독)
│   └── http-api.md            # 웹앱 내부 API (UI 담당자 필독)
├── team/                # 사람별 담당 문서 (tasks 이후 작성)
└── tasks.md             # /speckit-tasks 출력
```

### Source Code (repository root)

```text
src/
├── app/                         # Next.js App Router (UI 담당)
│   ├── page.tsx                 # 할인 목록 (카드 + 필터 + 정렬)
│   ├── status/page.tsx          # 수집 상태 화면
│   ├── compare/page.tsx         # (Stretch) 비교 화면
│   └── api/
│       ├── deals/route.ts       # GET  전체 Deal 목록 (코어 담당)
│       ├── status/route.ts      # GET  사이트별 상태 (코어 담당)
│       └── crawl/route.ts       # POST 수집 실행 (코어 담당)
├── components/                  # DealCard, FilterBar, SortSelect, SiteStatusRow ... (UI 담당)
├── lib/                         # 공용 로직 (코어 담당)
│   ├── types.ts                 # Deal, RawDeal, SiteId, Gender, Theme ... ← 0단계에서 고정
│   ├── discount.ts              # 할인율 계산
│   ├── classify.ts              # 성별/테마 분류 규칙
│   ├── normalize.ts             # RawDeal → Deal
│   ├── store.ts                 # data/ JSON 읽기/쓰기
│   └── filters.ts               # 필터/정렬 순수 함수 (UI·코어 공용)
└── crawler/
    ├── obscura.ts               # Obscura CLI 래퍼 (stealth, 대기, CAPTCHA 감지) (코어 담당)
    ├── runner.ts                # 사이트 실행, 실패 격리, 쿨다운, 상태 저장 (코어 담당)
    ├── cli.ts                   # npm run crawl -- --site musinsa
    └── adapters/
        ├── index.ts             # 9개 사이트 등록 (0단계에서 스텁으로 모두 등록해 충돌 방지)
        ├── musinsa.ts  29cm.ts  wconcept.ts  naver.ts      # 수집 담당 A
        └── zigzag.ts   ably.ts  queenit.ts  posty.ts  4910.ts  # 수집 담당 B

tests/
├── unit/                        # discount, classify, normalize, filters
└── adapters/                    # 사이트별 파서 테스트
fixtures/
├── sample-deals.json            # UI 개발용 가짜 데이터 (0단계에서 생성)
└── sites/<siteId>/              # 사이트별로 저장한 HTML/JSON 원본
data/                            # 실행 중 생성 (git 제외)
```

**Structure Decision**: Next.js 단일 프로젝트. 웹 화면, 내부 API, 수집 CLI가 `src/lib`의 타입과 함수를
공유한다. 4명이 같은 파일을 동시에 고치지 않도록 0단계에서 `types.ts`, `adapters/index.ts`(9개 스텁),
`fixtures/sample-deals.json`을 먼저 커밋하고, 이후 각자 담당 폴더만 수정한다.

## Complexity Tracking

> 위반 없음.
