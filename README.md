# BF Deal Tracker — 블랙프라이데이 의류 할인 모아보기

무신사·29CM·W컨셉·네이버쇼핑·지그재그·에이블리·퀸잇·포스티·4910의 블프 할인을 Obscura로 수집해
**할인율 · 어디서 · 언제까지**를 배민식 카드 목록으로 비교하는 개인용 웹앱.

## 팀원 시작 순서

1. **내 담당 확인** → [specs/001-bf-deal-tracker/team/README.md](specs/001-bf-deal-tracker/team/README.md)
2. **설치** (Node 22+, Obscura v0.2.7 stealth 빌드) → [quickstart.md](specs/001-bf-deal-tracker/quickstart.md)
3. **작업 목록** → [tasks.md](specs/001-bf-deal-tracker/tasks.md)

## 설계 문서

| 문서 | 내용 |
|------|------|
| [constitution.md](.specify/memory/constitution.md) | 프로젝트 원칙 (개인용, 크롤링 규칙, 출처 표시) |
| [spec.md](specs/001-bf-deal-tracker/spec.md) | 기능 명세 (Must / Should / Stretch) |
| [plan.md](specs/001-bf-deal-tracker/plan.md) | 기술 스택·폴더 구조 |
| [research.md](specs/001-bf-deal-tracker/research.md) | 기술 선택 근거, 사이트별 난이도 |
| [data-model.md](specs/001-bf-deal-tracker/data-model.md) | Deal / SiteStatus 데이터 형식 |
| [contracts/](specs/001-bf-deal-tracker/contracts/) | 수집기 인터페이스, 내부 API |

## 기술 스택

Next.js 15 · TypeScript · Tailwind CSS · Obscura(헤드리스 브라우저, stealth) · cheerio · Vitest · 로컬 JSON 저장

## 규칙

- 쿠키·세션·`data/`·`.env.local`은 커밋하지 않습니다.
- CAPTCHA는 자동으로 풀지 않고, 뜨면 해당 사이트를 멈춥니다.
- Spec Kit 스킬(`/speckit-*`)은 `.claude/skills/`에 포함되어 있습니다.
