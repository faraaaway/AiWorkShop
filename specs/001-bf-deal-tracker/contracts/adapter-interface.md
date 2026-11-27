# Contract: Site Adapter Interface

수집 담당자(A, B)가 구현하고 코어 담당의 `runner.ts`가 호출한다. **이 계약은 0단계에서 고정**한다.

## 파일 위치

- 구현: `src/crawler/adapters/<siteId>.ts` (담당자만 수정)
- 등록: `src/crawler/adapters/index.ts` — 0단계에서 9개 모두 스텁으로 등록됨. 담당자는 손대지 않는다.
- 원본 저장: `fixtures/sites/<siteId>/*.html|*.json`
- 테스트: `tests/adapters/<siteId>.test.ts`

## 인터페이스

```ts
// src/lib/types.ts
interface SiteAdapter {
  id: SiteId;
  displayName: string;          // '무신사'
  homeUrl: string;
  stealth: boolean;             // Obscura --stealth 사용 여부 (기본 true)
  obeyRobots: boolean;          // 기본 true
  maxRequests: number;          // 한 번 실행 상한 (기본 30)

  /** 블프 행사 페이지들을 돌며 RawDeal을 모은다. 네트워크는 ctx만 사용. */
  crawl(ctx: CrawlContext): Promise<RawDeal[]>;
}

interface CrawlContext {
  fetchHtml(url: string, opts?: { waitSec?: number }): Promise<string>;   // 렌더링된 HTML
  fetchJson<T = unknown>(url: string): Promise<T>;                         // --dump original + JSON.parse
  evalPage<T = unknown>(url: string, js: string): Promise<T>;             // --eval 결과(JSON)
  log(msg: string): void;
  signal: AbortSignal;          // 차단 감지 시 runner가 중단
}
```

## 규칙

1. 네트워크 호출은 **반드시 `ctx`의 함수만** 쓴다(직접 `fetch`, Obscura 직접 실행 금지). 대기·요청 상한·
   CAPTCHA 감지는 `ctx`가 처리한다.
2. 파싱은 순수 함수로 분리한다: `export function parseXxx(htmlOrJson): RawDeal[]` — fixture로 테스트.
3. 값을 추측하지 않는다. 못 읽으면 `null`. 할인율 계산·성별/테마 판정은 하지 않는다(코어가 함).
4. 가격은 숫자(원)로: `"129,000원"` → `129000`. URL은 절대 경로로.
5. 종료 시각 텍스트(예: `~11.30(일) 23:59`, `D-2`)는 `src/lib/dates.ts`의 `parseKoreanEndDate(text, now)`로 변환.
   못 바꾸면 null.
6. 예외 처리:
   - 로그인 페이지로 이동됨 → `throw new LoginRequiredError()`
   - 구조를 못 찾음 → 빈 배열 반환(runner가 `suspect_layout` 처리)
   - CAPTCHA/차단은 `ctx`가 `BlockedError`를 던지므로 잡지 말 것
7. 블프/행사 상품만 대상. 행사 목록 페이지 → 상품 목록 순서로, 사이트 전체 상품을 훑지 않는다.

## 스텁 (0단계 기본값)

```ts
export const zigzag: SiteAdapter = {
  id: 'zigzag', displayName: '지그재그', homeUrl: 'https://zigzag.kr',
  stealth: true, obeyRobots: true, maxRequests: 30,
  async crawl() { throw new NotImplementedError('zigzag'); },
};
```

`NotImplementedError`인 사이트는 상태 화면에서 `disabled`(꺼짐)로 보인다.

## 완료 기준 (사이트 하나당)

- [ ] fixture 1개 이상 저장, `parse*` 테스트 통과
- [ ] `npm run crawl -- --site <id>` 실행 시 `data/deals/<id>.json`에 10개 이상 Deal 생성
- [ ] 무작위 5개를 실제 사이트와 대조: 가격·할인율·링크 일치
