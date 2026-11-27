# 29CM fixture

2026-11-27 22:30경, 29 DAY(이구데이, 본행사 11-29) 티징 페이지
`https://www.29cm.co.kr/content/campaign/2026/11/29-day/teasing`가 부르는 API 응답.
Obscura 0.2.7 `--obey-robots fetch <url> --dump original`로 받은 원본 그대로다.

| 파일 | 요청 | 역할 |
|------|------|------|
| `collections.json` | `GET https://content-api.29cm.co.kr/api/v4/framers/proxy/content-api/api/v4/collections?collectionIds=30759` | 행사 목록: 기획전 제목·기간, 카테고리 그룹 |
| `products-outer.json` | `GET …/api/v5/keyword-collections/30759/product-groups/284267/products?sort=NEW&page=0&size=20` | "아우터" 그룹 상품 목록 첫 20개 |

## 수집 전에 알아둘 것

- `https://www.29cm.co.kr/robots.txt`는 `User-agent: *` → `Allow: /` (마이페이지·주문 등 일부만 금지). `--stealth` 없이 응답한다.
- 캠페인 페이지는 Framer로 만든 화면이라 렌더링한 HTML에 기획전 번호(30759)가 없다.
  번호는 어댑터 `CAMPAIGN.collectionIds`에 직접 적는다.
- 기획전 표시 기간은 11-29 10:00 ~ 23:59이다. 그 전에 수집한 가격은 행사 전 가격이고, 11-29에는 쿠폰이 더해져 달라진다.
- 같은 페이지의 "29일의 특가"(`…/api/v5/highlight-products/75`)는 11-29에 적용될 가격만 내려주고 정가가 없어 수집하지 않는다.
- 행사 목록 API(`/api/v4/brand-news/retrieve`)는 POST 전용이라 `ctx.fetchJson`으로 부를 수 없다.

## 실수집 확인 (2026-11-27 22:35 KST)

`cm29.crawl(ctx)`를 Obscura로 실행(요청 사이 2~4초, stealth 없음, robots 준수): 8요청, 약 23초, 차단 없음, 상품 626개(중복 없음).

- 그룹: 아우터·상의·하의·기타 (`size=100`으로 페이지 수를 줄임)
- 무작위 10개를 상품 페이지와 대조: 정가·할인율·할인가·링크 10개 모두 일치
- 품절 상품은 0개여서 `soldOut: true`인 경우는 실제 화면과 대조하지 못했다.
