# Quickstart: BF Deal Tracker

## 1. 준비 (팀원 전원, 10분)

1. Node.js 22 이상(권장 24), Git, Claude Code
2. **Obscura v0.2.7 stealth 빌드** 설치 ([research.md R1](./research.md#r1-크롤링-엔진-obscura-버전과-빌드))
   - Windows: https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.7 에서 `obscura-x86_64-windows-stealth.zip`
   - Mac: `obscura-aarch64-macos-stealth.tar.gz`(M 칩) / `obscura-x86_64-macos-stealth.tar.gz`(Intel)
   - 압축 해제 후 확인: `obscura --version` → `obscura 0.2.7`
3. 저장소 받기
   ```powershell
   git clone https://github.com/faraaaway/AiWorkShop.git
   cd AiWorkShop
   npm install
   ```
4. `.env.example`을 `.env.local`로 복사하고 경로 입력
   ```text
   OBSCURA_PATH=C:\tools\obscura\obscura.exe
   ```

UI 담당은 Obscura 없이도 샘플 데이터로 개발할 수 있지만, 통합 확인을 위해 설치를 권장한다.

## 2. Obscura 동작 확인 (수집 담당·코어 담당)

```powershell
& $env:OBSCURA_PATH --stealth --obey-robots fetch https://example.com --dump text --timeout 30
```

"Example Domain" 텍스트가 나오면 정상. 담당 사이트는 그다음에 같은 명령으로 확인한다.

- `Blocked by robots.txt` 오류: 그 주소는 robots.txt가 막은 것이다(예: `www.musinsa.com` 페이지). 같은 사이트의
  공개 JSON API(`api.musinsa.com`처럼 허용된 주소)를 찾거나, 없으면 그 사이트는 건너뛴다.
- CAPTCHA/차단 문구: 해당 사이트는 잠시 쉬고 다른 사이트부터.

## 3. 실행

```powershell
npm run dev                         # http://localhost:3000
npm run crawl -- --site musinsa     # 한 사이트 수집
npm run crawl -- --site all         # 켜진 사이트 전체
npm test                            # 단위·파서 테스트 (네트워크 없음)
```

휴대폰 확인: 같은 와이파이에서 `http://<PC IP>:3000` (`npm run dev -- -H 0.0.0.0`).

## 4. 검증 시나리오

| # | 시나리오 | 기대 결과 | 관련 |
|---|----------|-----------|------|
| V1 | 무신사 수집 후 `/` 열기 | 카드에 사이트·할인율·정가/할인가·종료 시각·마지막 수집 시각 표시 | US1, SC-001 |
| V2 | 카드 클릭 | 실제 상품 페이지가 새 탭으로 열림 | FR-014 |
| V3 | 무작위 카드 20개를 실제 사이트와 대조 | 19개 이상 일치 | SC-003 |
| V4 | 여성 + 아우터 + 50%+ + 마감 임박 순 | 조건 만족 + 순서 맞음, 3번 이하 클릭 | US2, SC-004 |
| V5 | 조건에 맞는 상품 없음 | 빈 상태 문구 + 필터 초기화 버튼 | US2-4 |
| V6 | 한 사이트 `OBSCURA_PATH`를 틀리게 하거나 수집기에서 예외 발생시킨 뒤 전체 수집 | 그 사이트만 실패, 나머지 표시 유지 | US3, SC-006 |
| V7 | 개발자도구 375px 폭 | 가로 스크롤 없음 | SC-008 |
| V8 | 샘플 데이터 5,000개로 필터 변경 | 1초 이내 반영 | SC-005 |
| V9 | 같은 상품이 2개 사이트 이상에 있을 때 카드의 "N곳 가격 비교" 누르기 / 카드 2~4개를 "+ 비교"로 담고 "비교하기" | 사이트별 가격표에서 최저가 강조 / 담은 상품이 나란히 표시 | US4 (Stretch) |

## 5. 협업 규칙 요약

- 브랜치: `feat/<이름>-<작업>` → `main`으로 PR, 작게 자주 머지
- 자기 담당 폴더만 수정. 공용 파일(`src/lib/types.ts`, `adapters/index.ts`)은 코어 담당만
- 쿠키·세션·`data/`·`.env.local` 커밋 금지(.gitignore 처리됨)
- 담당과 순서: [team/README.md](./team/README.md)
