# 무신사 fixture

2026-11-27 22시경, 무진장 26 겨울 블랙프라이데이(`mujinjangwinter2026`, ~2026-12-03 00:00) 캠페인 API 응답.

| 파일 | 요청 | 역할 |
|------|------|------|
| `meta.json` | `GET https://api.musinsa.com/api2/cpcms/cpcms/v3/MUSINSA/mujinjangwinter2026/meta` | 행사 목록: 캠페인 정보, 탭("특가" 등)과 모듈 목록 |
| `module-signatureItem.json` | `GET …/modules/01a1a6e2-798c-7774-9b13-295239702aae?countryCode=KR&locale=ko-KR&gf=A` | 모듈(시그니처특가): 제목, 종료 시각, 카테고리 탭과 상품 API 주소 |
| `goods-signatureItem-outer.json` | 위 모듈 "아우터" 탭의 `tabLazyLoadApiUrl` | 상품 목록 |

## 원본과 다른 점

Obscura 설치 전에 브라우저에서 받은 응답을 옮겨 적었고, 크기를 줄이려고 일부를 잘랐다.
값과 필드는 고치지 않았다. Obscura `--dump original`로 받은 전체 응답으로 바꿔도 된다
(그때는 테스트의 개수 기대값 13·16·4를 함께 고칠 것).

- `meta.json`: `linkTabList` 13개 중 3개(타임·특가·아우터)만 남김
- `module-signatureItem.json`: `moduleTabList` 14개 중 앞 4개만 남김, `cautionContent`(유의사항 HTML) 생략
- `goods-signatureItem-outer.json`: `goodsList` 36개 중 13개만 남김(앞 10개 + 여성 상품 2개 + 쿠폰 할인 상품 1개)

## 수집 전에 알아둘 것

- `https://www.musinsa.com/robots.txt`는 허용 목록에 없는 봇에게 `User-agent: *` → `Disallow: /` 이다.
  `obscura --obey-robots fetch https://www.musinsa.com`은 `Blocked by robots.txt`로 끝난다(quickstart §2 명령은 무신사에서 실패한다).
- `api.musinsa.com`의 JSON은 `obscura --obey-robots fetch <url> --dump original`로 받을 수 있다. `--stealth`는 필요 없다.
- 일반 HTTP 클라이언트(curl)로 `api.musinsa.com`, `www.musinsa.com`을 부르면 Cloudflare가 403을 준다.

## 실수집 확인 (2026-11-27 22:21 KST, Obscura 0.2.7)

`musinsa.crawl(ctx)`를 Obscura로 실행(요청 사이 2~4초, stealth 없음, robots 준수): 28요청, 약 85초, 차단 없음, 상품 725개.

- 기획전: 시그니처특가 222개(~12-03 00:00), 단독 하루특가 251개(~11-28 00:00), 72시간 특가 252개(~11-28 00:00)
- 카테고리 탭: 아우터·상의·바지·가방·소품 각 108개, 신발 107개, 원피스/스커트 78개
- 무작위 10개를 상품 페이지와 대조: 정가·할인율·할인가·링크 10개 모두 일치, 성별 5개·품절 1개 일치
- 상품 페이지의 "종료까지" 타이머는 캠페인 전체 종료(12-03 00:00)만 보여 준다.
  하루특가·72시간 특가의 종료 시각(11-28 00:00)은 모듈의 `timerEndAt` 값이며 상품 페이지로는 대조하지 못했다.

