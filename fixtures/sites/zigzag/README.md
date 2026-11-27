# 지그재그 fixture

2026-11-28 01시경(KST) 받은 응답. 블프 행사 이름은 "직잭팟"이고, 대표 기획전은 홈 배너 "겨울 블프 SPA데이"가
가리키는 `https://zigzag.kr/events/c8c6aabf-766f-4df2-879f-fea9703ca08b` "브랜드 직잭팟 특가"(~2026-12-05 23:59:59)다.

| 파일 | 요청 | 역할 |
|------|------|------|
| `home.html` | `obscura --stealth fetch https://zigzag.kr/ --dump original` | 홈 배너 68개 → 기획전 주소(`/events/<uuid>`)와 문구 |
| `event-c8c6aabf.html` | `obscura --stealth fetch https://zigzag.kr/events/c8c6aabf-… --dump original` | 기획전 이름·기간, 상품 모듈과 그룹(탭)·그룹별 상품 수 |
| `products-request.json` | (보낸 요청) | 상품 목록 GraphQL POST의 주소·헤더·본문. 쿼리는 사이트 번들(`/displayweb/_next/static/chunks/9853-….js`)의 것 그대로 |
| `products-93fa1f0c-group0.json` | 위 요청을 Node `fetch`로 보낸 응답 | "직잭단독 > 단독 상품 더보기" 그룹의 상품 목록 |

쿠키·세션·토큰은 어느 파일에도 없다(요청에 쿠키를 보내지 않았고, 응답의 `set-cookie`는 저장하지 않았다).

## 원본과 다른 점

값과 필드 이름은 고치지 않았다.

- `home.html`: `__NEXT_DATA__`에서 배너 조회(`["banner","list"]`)만 남겼다. `runtimeConfig`(외부 서비스 키 포함)와
  HTML 본문·스크립트·스타일은 지웠다.
- `event-c8c6aabf.html`: `__NEXT_DATA__`의 조회 56개는 그대로. 화면 구성(`component_map` 93개) 중 상품 모듈은 그대로,
  이미지·타이머 같은 나머지는 `uuid`·`__type`·`title`·`display_name`·`visible_between` 등 뼈대만 남겼다.
  `runtimeConfig`와 HTML 본문은 지웠다.
- `products-93fa1f0c-group0.json`: `item_list` 323개 중 앞 15개만 남겼다(`total_count`는 원래 값 323 그대로).
  남긴 상품의 필드는 전부 그대로다.

## 수집 경로와 수집기가 읽을 수 없는 것

- **상품 목록은 `ctx.postJson`(Node가 보내는 POST)으로만 받을 수 있다.** 다른 길을 확인한 결과:
  - 원본 HTML(홈·기획전·상품 페이지)에는 기획전 상품 목록이 없다. 기획전 페이지는 상품을
    `POST https://api.zigzag.kr/api/2/graphql/GetCmsProductsPresetProductCardItemList`로 따로 받는다.
  - `ctx.fetchJson`(GET)에 `?query=…&variables=…`를 붙여도 `{"errors":[{"message":"GraphQL only supports POST requests."}]}`.
  - 페이지 안 `fetch`(`preEval`)는 Obscura 0.2.7에서 실패한다: JSON POST는 "CORS preflight: Origin 'https://zigzag.kr'
    not allowed by Access-Control-Allow-Origin ''", 사전 요청이 없는 text/plain·multipart POST도 같은 CORS 오류.
    Obscura의 페이지 안 요청에는 Referer가 없고 사전 요청(OPTIONS)에는 User-Agent도 없다(로컬 서버로 확인).
    `zigzag.kr/api/2/graphql/…`(같은 출처)은 404, 폼 전송은 Obscura `fetch` 모드에서 이동하지 않는다.
  - Node `fetch`로 헤더 없이 POST하면 본문 없는 200(`x-cache: Error from cloudfront`)이 온다.
    `Origin: https://zigzag.kr`, `Referer: https://zigzag.kr/`를 붙이면 상품 목록이 온다(쿠키·토큰·User-Agent 위장 없음).
    둘 중 어느 헤더가 꼭 필요한지는 가려 보지 못했다(직접 POST는 3번만 했다). 수집기는 둘 다 보낸다.
- 쪽 크기: `input.limit`, 다음 쪽: `input.after`(= 응답의 `end_cursor`)는 사이트 번들(`6964.….js`)이 쓰는 이름이다.
  `limit` 없이 보내면 그룹 전체가 한 번에 온다(323개, 1.1MB). 수집기는 `limit: 50`을 보내고(실수집에서 동작 확인),
  `after`로 다음 쪽을 받지는 않는다(`limit_count`는 "is not defined by type" 오류).
- 한 번 실행에 읽는 양(요청 30개 안): 홈 배너 순서로 블프 기획전 3개, 남은 요청(26개)을 기획전끼리 나눠 그룹마다 50개씩.
  카테고리 탭(ProductTab)을 먼저 읽는다. 그룹당 100개·실행당 1,500개 상한. 기획전 전체 상품(대표 기획전만 그룹 105개,
  수만 개)을 다 읽는 것이 아니다.
- 상품별 성별: 없다. 수집기는 사이트 소개 문구("4,000만 여성이 선택한…")에 따라 `rawGender: '여성'`을 넘긴다.
- 상품별 할인 종료 시각: 없다(`discount_info`는 323개 모두 null). 기획전 종료 시각(`date_ended`)만 있다.
- 카테고리: 상품에는 없고, 그룹(탭) 이름이 "아우터"·"슈즈" 같은 카테고리인 모듈(ProductTab)이 있다.
  수집기는 ProductTab의 탭 이름만 `rawCategory`로 넘긴다("전체 BEST"처럼 카테고리가 아닌 탭 이름도 섞여 있다).
  브랜드별 레일(ProductRail)·목록(ProductList)의 그룹 이름은 넘기지 않는다(null).
- 의류가 아닌 상품: 블프 대표 페이지("직잭팟 블랙프라이데이")의 레일에는 화장품 등도 섞여 있다(예: 힌스 럭키박스).
  배너 문구로는 걸러지지 않고 상품에도 카테고리가 없어 그대로 들어온다.
- `robots.txt`는 목록에 없는 봇에게 `User-agent: *` → `Disallow: /`다. 그래서 `obeyRobots: false`(소유자 결정).

## 대조 (2026-11-28)

상품 1개(172164329)를 상품 페이지 `https://zigzag.kr/catalog/products/172164329` 원본 HTML과 대조:
주소(canonical)·정가 99,900·할인율 37%·쿠폰 적용가 62,930 일치. 나머지 상품은 대조하지 못했다.

## 실수집 확인 (2026-11-28 01:47 KST, Obscura 0.2.7 + Node POST)

`npm run crawl -- --site zigzag` 한 번: 정상, 상품 715개, 약 86초, 차단·빈 응답 없음.
요청은 상한 30개 이내(홈 1 + 기획전 3 + 그룹 최대 26, 요청 사이 2~4초; 실행 기록에 정확한 수는 남지 않는다).

| 기획전 | 종료 | 상품 |
|--------|------|------|
| 직잭팟 블랙프라이데이 (`/events/eb0be80d-…`) | 2026-12-02 23:59:59 | 226 (레일, rawCategory 없음) |
| 브랜드 직잭팟 특가 (`/events/c8c6aabf-…`) | 2026-12-05 23:59:59 | 336 (아우터·상의·니트·가디건·팬츠, 전체/직진 BEST) |
| 나이니 블랙프라이데이 SALE ~60% (`/events/c28368f4-…`) | 2026-12-02 23:59:59 | 153 (아우터·니트/가디건·상의·팬츠·스커트/원피스 등) |

- `limit: 50`이 듣는다(그룹당 50개 이하로 왔다).
- 715개 중 19개는 줄 그은 가격과 할인율이 없어 `originalPrice`·`displayedDiscountRate`가 null. 품절 0개.
  상품별 종료 시각은 전부 없고 기획전 종료 시각만 있다.
- 사이트 표시 할인율과 계산값이 1%p 넘게 다른 상품 0개.
- 이번 실행의 상품은 상품 페이지와 대조하지 않았다.
