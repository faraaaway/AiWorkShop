# 에이블리 (ably) 원본 저장

수집 일시: 2026-11-28 01:00~01:30 (KST). 로그인·쿠키·토큰 없이 받은 공개 응답이다.
받은 방법: `obscura --stealth fetch <주소> --dump original` (렌더링 없는 원본, `ctx.fetchHtml(url, { raw: true })`·`ctx.fetchJson(url)`과 같은 요청).

| 파일 | 주소 | 내용 |
|------|------|------|
| `events.html` | `https://m.a-bly.com/events` | 이벤트 목록 페이지. `__NEXT_DATA__`에 진행 중인 행사(번호·제목·기간)가 들어 있다 |
| `event-25051.json` | `https://api.a-bly.com/webview/events/25051/` | "❄️ 에블프 베스트 윈터템 ❄️" 행사. 화면 블록(`page_content`)과 상품 묶음 목록 |
| `event-25179.json` | `https://api.a-bly.com/webview/events/25179/` | "에이블리 블프백서🖤" 행사 |
| `segment-165515.json` | `https://api.a-bly.com/api/v2/events/segments/165515/?count=30` | 묶음 "패딩/점퍼"의 상품 목록(인기순) |

## 줄인 부분

- `events.html`: 원본(143KB)에서 `<title>`과 `__NEXT_DATA__`만 남겼다. 이벤트 177개 중 앞 12개·뒤 3개와 제목에 블프가 든 31개만(46개),
  기획/세일전 10개 중 2개만 남겼고, `_sentry*`·`serverUserContext`(요청한 브라우저의 User-Agent)는 지웠다.
- `segment-165515.json`: 상품 30개 중 앞 12개만 남겼다(`total_count` 966, `is_last` false는 원본 그대로).
- `event-*.json`: 받은 그대로.

## 확인한 동작

- `m.a-bly.com`, `a-bly.com` 첫 화면은 빈 껍데기(`<div id="root">`)라 원본 HTML에 상품이 없다. 렌더링하면 주소에 따라 앱 설치 배너만
  나오거나(`/events/<번호>`), "오류가 발생했어요 … 새로고침" 화면이 나온다(`/events/<번호>?global_layout=app&embedded_web=true`).
- 같은 `/events`, `/events/<번호>` 주소라도 렌더링(`--dump html`)으로 받으면 빈 껍데기가 오고, 원본(`--dump original`)으로 받으면
  Next.js가 그린 HTML이 온다. 수집기는 원본만 쓴다.
- `/events/<번호>` 원본의 `__NEXT_DATA__`에는 행사 이름·썸네일만 있다. 상품은 위 API 두 개로 읽는다.
- 헤더 없이 GET만으로 응답하는 주소: `api/v2/home/tabs/`, `api/v2/events/<번호>/`, `webview/events/<번호>/`,
  `api/v2/events/segments/<묶음>/`. 화면은 묶음을 10개씩 부르지만 `count=30`이 그대로 적용된다.
- 헤더 없이는 `{"detail":"자격 인증데이터(authentication credentials)가 제공되지 않았습니다."}`만 오는 주소:
  `api/v2/main/tabs/`, `webview/events/segments/<묶음>/goods`, `api/v3/goods/<상품>/basic/`.
  웹사이트는 `api/v2/anonymous/token/`에서 받은 방문자별 익명 토큰을 `X-Anonymous-Token` 헤더로 보내는데, 수집기는 이 토큰을 쓰지 않는다.
- `robots.txt`(m.a-bly.com)는 검색 엔진 봇만 허용하고 나머지는 `Disallow: /`다 → 어댑터는 `obeyRobots: false`(리드 허용).
- 행사의 `open_date`·`close_date`는 오프셋 없는 한국 시각이다. 25051의 유의사항 블록에
  "2026.11.16 (월) 00:00:00 - 2026.12.03 (목) 23:59:59 (KST)"라고 적혀 있고 API 값과 같다.
- 상품 카드 표시(`render.data`)와 숫자 필드가 같다: 받은 30개 모두 `render.data.price` = `price`, `render.data.discount_rate` = `discount_rate`%.
- 카드의 상점 글자(`render.data.store_text`)는 쇼핑몰 상품이면 마켓 이름, 브랜드 상품이면 `<font …>브랜드</font> 아디다스`처럼 브랜드 이름이다
  (이때 `market.name`은 판매 마켓 "세컨찬스").
- 행사 묶음에는 할인 없는 상품(`discount_rate` 0, 정가 = 판매가)도 섞여 있다. 사이트 값 그대로 넣는다.

## 수집기가 읽지 못하는 것

- **상품별 할인 종료 시각**: 응답에 없다(`render.data.discount_end_text`는 받은 30개 모두 null). 행사 종료 시각만 `event.endsAt`에 넣는다.
- **상품별 성별**: 응답에 없다. 여성 패션 앱이라 모두 `'여성'`으로 넣는데, 이름에 "남녀공용"이 든 브랜드 상품도 여성이 된다.
- **쿠폰 적용가**: 행사 쿠폰(`fixedBottomButtonTool`의 쿠폰팩)을 받은 뒤의 가격은 로그인이 필요해 읽지 않는다. `salePrice`는 카드 표시 가격이다.
- **묶음의 31번째 이후 상품**: 묶음마다 인기순 30개만 읽는다(`last_sno`로 더 부를 수 있지만 요청 수를 아끼려고 쓰지 않는다).
  한 번 실행에 16번 요청(목록 1 + 행사 2 + 묶음 13)이라 행사 2개의 묶음 13개만 읽는다. `maxRequests`를 늘리면 다음 차례 묶음을 더 읽는다.

## 실수집 (2026-11-28 01:26)

`npm run crawl -- --site ably` → 정상 · 352건, 요청 16번, 62초. 행사 "❄️ 에블프 베스트 윈터템 ❄️" 178건, "에이블리 블프백서🖤" 174건,
종료 시각은 모두 2026-12-03T23:59:59+09:00(행사 종료).
이 실행은 브랜드를 `market.name`으로만 넣던 때의 것이라 `data/deals/ably.json`의 브랜드 상품은 판매 마켓 이름으로 저장돼 있다. 다음 수집 때 바뀐다.

## 실제 사이트 대조

- 상품 페이지 1개(`https://m.a-bly.com/goods/24891887`)의 원본 HTML: HTTP 200, `<title>`의 상품명이 수집한 이름과 같다.
- **가격·할인율은 상품 페이지와 대조하지 못했다.** 상품 페이지 원본에는 가격이 없고(빈 껍데기 + 메타 태그), 가격을 주는
  `api/v3/goods/<상품>/basic/`은 익명 토큰을 요구한다. 대신 같은 응답 안의 카드 표시값과 숫자 필드가 같은 것만 확인했다(위).
