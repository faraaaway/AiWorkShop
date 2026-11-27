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
  fetchHtml(url: string, opts?: { waitSec?: number; raw?: boolean }): Promise<string>;   // 렌더링된 HTML (raw: 원본 HTML)
  fetchJson<T = unknown>(url: string): Promise<T>;                         // 단순 GET(--dump original) + JSON.parse
  evalPage<T = unknown>(url: string, js: string, opts?: { waitSec?: number }): Promise<T | null>; // --eval 결과
  log(msg: string): void;
  signal: AbortSignal;          // 차단 감지 시 runner가 중단
  readonly requestsLeft: number; // 이번 실행에서 남은 요청 수
}
```

### Obscura 0.2.7에서 확인한 동작 (2026-11-27)

- `fetchJson`은 **GET만** 가능하다(헤더·POST·GraphQL 불가).
- `fetchHtml(url, { raw: true })`는 렌더링하지 않고 **원본 응답 본문**을 그대로 준다(자바스크립트 실행 없음).
  렌더링이 시간 초과되는 사이트(예: 아뜨랑스)나 HTML 조각 응답에 쓴다. 빈 본문은 빈 문자열로 온다.
- `evalPage`의 `js`는 **동기 표현식 하나**이고 **객체나 배열**로 끝나야 한다. Promise는 기다려 주지 않고(`{}`가 됨),
  표현식이 예외를 던지거나 값이 없으면 `null`이 온다 → `null`이면 "구조를 못 찾음"으로 보고 빈 배열을 반환한다.
  늦게 채워지는 데이터는 `opts.waitSec`로 기다린다.
- HTTP 403/429, robots.txt 차단은 `ctx`가 오류로 바꿔 준다(아래 규칙 6).
- 테스트에서는 객체를 직접 만들지 말고 `tests/helpers/fakeContext.ts`의 `createFakeContext()`를 쓴다.

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
   - CAPTCHA/차단은 `ctx`가 `BlockedError`를 던지므로 잡지 말 것 (한 번 던진 뒤에는 이후 모든 `ctx` 호출이 다시 던진다)
   - 요청 상한을 넘으면 `ctx`가 `RequestLimitError`를 던진다. `ctx.requestsLeft`를 보고 미리 멈추거나, 잡아서 그때까지
     모은 결과를 반환해도 된다. 잡지 않으면 그 실행은 `failed`가 되고 이전 데이터가 유지된다
7. 블프/행사 상품만 대상. 행사 목록 페이지 → 상품 목록 순서로, 사이트 전체 상품을 훑지 않는다.

## 스텁 (0단계 기본값)

```ts
export const zigzag: SiteAdapter = {
  id: 'zigzag', displayName: '지그재그', homeUrl: 'https://zigzag.kr',
  stealth: true, obeyRobots: true, maxRequests: 30,
  async crawl() { throw new NotImplementedError('zigzag'); },
};
```

`NotImplementedError`인 사이트는 상태 화면에서 `not_implemented`(준비 중)로 보인다.

## 완료 기준 (사이트 하나당)

- [ ] fixture 1개 이상 저장, `parse*` 테스트 통과
- [ ] `npm run crawl -- --site <id>` 실행 시 `data/deals/<id>.json`에 10개 이상 Deal 생성
- [ ] 무작위 5개를 실제 사이트와 대조: 가격·할인율·링크 일치
