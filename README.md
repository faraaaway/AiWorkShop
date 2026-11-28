# BF Deal Tracker — 블랙프라이데이 의류 할인 모아보기

무신사·29CM·W컨셉·네이버쇼핑·지그재그·에이블리·퀸잇·포스티·4910·아뜨랑스의 블프 할인을 Obscura로 수집해
**할인율 · 어디서 · 언제까지**를 배민식 카드 목록으로 비교하는 개인용 웹앱.

## 팀원 시작 순서

1. **내 담당 확인** → [specs/001-bf-deal-tracker/team/README.md](specs/001-bf-deal-tracker/team/README.md)
2. **설치** (Node 22+, Obscura v0.2.7 stealth 빌드) → [quickstart.md](specs/001-bf-deal-tracker/quickstart.md)
3. **작업 목록** → [tasks.md](specs/001-bf-deal-tracker/tasks.md)

## 실행

`.env.example`을 `.env.local`로 복사해 `OBSCURA_PATH`(Obscura 실행 파일 경로)를 적은 뒤:

```powershell
npm install
npm run dev                       # http://localhost:3000 — 떠 있는 동안 매시 정각에 자동 수집
npm run crawl -- --site musinsa   # 한 사이트만 수집
npm run crawl -- --site all       # 켜진 사이트 전부 수집
npm test                          # 단위·파서 테스트 (네트워크 없음)
npm run typecheck                 # 타입 검사
npm run lint                      # ESLint
npm run build                     # 배포용 빌드 (개발 서버를 멈춘 뒤 실행)
```

| 화면      | 주소       | 내용                                                           |
| --------- | ---------- | -------------------------------------------------------------- |
| 할인 목록 | `/`        | 카드 목록, 성별·테마·할인율·사이트 필터, 정렬, 비교함 담기     |
| 가격 비교 | `/compare` | 비교함에 담은 2~4개 나란히 보기, 여러 사이트에 있는 같은 상품의 사이트별 가격 |
| 수집 상태 | `/status`  | 사이트별 수집 결과, 지금 수집, 사이트 켜기/끄기                |

- 자동 수집 간격은 `.env.local`의 `BF_AUTO_CRAWL_MINUTES`(기본 60, `0`이면 끔)로 바꿉니다.
- 수집한 데이터는 `data/`(git 제외)에 JSON으로 저장됩니다.
- 자세한 설치·검증 절차: [quickstart.md](specs/001-bf-deal-tracker/quickstart.md)

## 공개 배포 (읽기 전용 데모)

Vercel 같은 곳에서는 수집을 돌릴 수 없으므로(Obscura 실행 파일도, 유지되는 디스크도 없음), 공개 배포판은
**내 PC에서 수집해 내보낸 스냅샷만 보여 주는 읽기 전용**입니다. 수집 상태 탭은 숨겨지고, 수집 시작·사이트
켜기/끄기 API는 403을 돌려주며, 자동 수집도 돌지 않습니다.

1. PC에서 평소처럼 수집합니다 (`npm run dev`의 자동 수집 또는 `npm run crawl -- --site all`).
2. 스냅샷을 내보냅니다. `data/`의 모든 사이트 할인이 `public/snapshot/deals.json` 하나로 합쳐집니다.

   ```powershell
   npm run snapshot
   ```

3. 그 파일을 커밋하고 푸시하면 Vercel이 다시 배포하고, 배포판에 반영됩니다.

   ```powershell
   git add public/snapshot/deals.json
   git commit -m "chore: update the public deal snapshot"
   git push
   ```

- Vercel에 올리면 읽기 전용 모드가 자동으로 켜집니다 (`next.config.ts`가 `VERCEL=1`을 봅니다). 따로 넣을
  환경변수는 없습니다.
- 내 PC에서 배포판 모습을 확인하려면 개발 서버를 `BF_READONLY=1`로 띄웁니다
  (PowerShell: `$env:BF_READONLY = "1"; npm run dev`). 평소 서버와 동시에 띄우지 마세요.
- 스냅샷은 푸시한 시점까지만 최신입니다. 파일이 커밋마다 쌓이므로(약 2.3MB) 매시간보다는 필요할 때 올립니다.
- 저장소가 공개라면 스냅샷(수집한 가격·상품 주소)도 그대로 공개됩니다.

## 설계 문서

| 문서                                                     | 내용                                           |
| -------------------------------------------------------- | ---------------------------------------------- |
| [constitution.md](.specify/memory/constitution.md)       | 프로젝트 원칙 (개인용, 크롤링 규칙, 출처 표시) |
| [spec.md](specs/001-bf-deal-tracker/spec.md)             | 기능 명세 (Must / Should / Stretch)            |
| [plan.md](specs/001-bf-deal-tracker/plan.md)             | 기술 스택·폴더 구조                            |
| [research.md](specs/001-bf-deal-tracker/research.md)     | 기술 선택 근거, 사이트별 난이도                |
| [data-model.md](specs/001-bf-deal-tracker/data-model.md) | Deal / SiteStatus 데이터 형식                  |
| [contracts/](specs/001-bf-deal-tracker/contracts/)       | 수집기 인터페이스, 내부 API                    |

## 기술 스택

Next.js 15 · TypeScript · Tailwind CSS · Obscura(헤드리스 브라우저, stealth) · cheerio · Vitest · 로컬 JSON 저장

## 규칙

- 쿠키·세션·`data/`·`.env.local`은 커밋하지 않습니다.
- CAPTCHA는 자동으로 풀지 않고, 뜨면 해당 사이트를 멈춥니다.
- Spec Kit 스킬(`/speckit-*`)은 `.claude/skills/`에 포함되어 있습니다.
