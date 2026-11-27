# W컨셉 fixture

2026-11-27 22:45경, "어게인 더블유위크"(11-26 10:00 ~ 11-30 10:00) 프로모션.
Obscura 0.2.7 `fetch <url> --dump html`로 받았다(`--obey-robots` 없음, `--stealth` 없음).

| 파일 | 요청 | 역할 |
|------|------|------|
| `promotion-163.html` | `https://display.wconcept.co.kr/rn/promotion/163` | 행사 목록: 프로모션 정보, 날짜별 회차와 상품 번호(`self.__next_f` 안의 `promotionPayload`) |
| `product-309024809.html` | `https://www.wconcept.co.kr/Product/309024809` | 상품 상세: 이름·브랜드·정가·할인율·할인가 |

## 원본과 다른 점

크기를 줄이려고 잘랐다(원본 348KB, 683KB). 남긴 부분의 내용은 고치지 않았다.

- `promotion-163.html`: `<title>`과 `promotionPayload`가 든 `<script>` 하나만 남김
- `product-309024809.html`: `<head>`의 meta와 상품명~가격 영역(`.h_group` ~ `.price_wrap`)만 남김, script·style·주석 제거

## 수집 전에 알아둘 것

- **robots.txt**: `display.wconcept.co.kr/robots.txt`는 허용 목록 방식이라 목록에 없는 봇은 `User-agent: *` → `Disallow: /` 이다.
  `--obey-robots`를 켜면 `Blocked by robots.txt`로 끝난다. 어댑터는 담당자 결정으로 `obeyRobots: false`다(2026-11-27).
- **상품 API는 쓸 수 없다**: `gw-front.wconcept.co.kr/extension/api/product/v1/list` 등은 인증 키 헤더와 POST가 필요하다
  (`401 허용된 API KEY가 아닙니다`). Obscura로 프로모션 페이지를 렌더링해도 상품 카드(이름·가격)는 그려지지 않는다.
  그래서 상품 번호만 프로모션 페이지에서 읽고, 이름·가격은 상품 상세 페이지에서 읽는다.
- **느리다**: 상품 상세 페이지 하나에 약 35초가 걸린다. 상품 1개당 요청 1번이라 한 번 실행에 최대 29개까지만 읽는다.
- **회차**: "이번 시즌의 발견"은 날짜별 회차(하루 9~10개)다. 실행 시각에 진행 중인 회차만 읽는다.
- 상품 페이지의 이 영역에서는 카테고리·성별·품절 여부를 읽지 못한다(`rawCategory`·`rawGender`는 null, `soldOut`은 false).

## 실수집 확인 (2026-11-27 22:51~22:57 KST)

`wconcept.crawl(ctx)`를 Obscura로 실행(요청 사이 2~4초): 10요청, 5분 51초, 차단 없음, 상품 9개(11-27 회차 전부).

- 9개 모두 프로모션 화면 표시와 대조: 브랜드·상품명·할인율·할인가 일치
- 화면의 "혜택 마감까지" 타이머(23:59:59 종료)와 `event.endsAt`(`2026-11-27T23:59:59+09:00`) 일치
- 정가는 프로모션 화면에 없어 대조하지 못했다(상품 페이지 값 그대로).
- 완료 기준 "10개 이상"에는 1개 모자란다. 11-27 회차가 9개뿐이다(다른 날은 10개).
