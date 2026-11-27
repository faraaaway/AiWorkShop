# Feature Specification: 블랙프라이데이 의류 할인 모아보기 (BF Deal Tracker)

**Feature Branch**: `001-bf-deal-tracker`

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "옵스큐라를 이용해 네이버쇼핑, 무신사, 지그재그, 에이블리, 퀸잇, 29CM, W컨셉,
포스티, 4910 같은 사이트를 크롤링해서 블랙프라이데이 할인율, 어디서(사이트 페이지), 언제까지 할인하는지
알려주는 사이트. 쿠팡이츠/배민처럼 의류를 성별별, 테마별, 할인율별로 비교하며 보여줘야 함. 개인용."
추가 조건: "4명이서 클로드 맥스 계정으로 5시간 안에 구현해야 함." (설계 기준: 프로젝트 헌법 v2.0.0)

## Delivery Scope (5시간 · 4명)

| 구분 | 포함 항목 | 완료 기준 |
|------|-----------|-----------|
| **Must** (MVP) | User Story 1, 2 / 사이트 최소 1개(무신사) | 5시간 내 반드시 동작 |
| **Should** | User Story 3 / 사이트 4개 이상 | 4명이 사이트를 나눠 병렬로 추가, 되는 만큼 |
| **Stretch** | User Story 4, 자동 주기 수집, 필터 기억, 오래된 데이터 경고 | 시간이 남을 때만 |

요구사항 중 `(Stretch)` 표시가 없는 항목은 Must 또는 Should다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 한 사이트의 블프 할인 목록 보기 (Priority: P1, Must)

나는 수집을 실행한 뒤, 한 쇼핑몰(첫 대상: 무신사)의 블랙프라이데이 할인 의류를 카드 목록으로 본다.
각 카드에는 상품 사진, 브랜드, 상품명, 정가, 할인가, 할인율, 할인 종료 시각(남은 시간), 판매 사이트가
보이고, 누르면 해당 상품/행사 페이지가 새 창으로 열린다.

**Why this priority**: "어디서, 얼마나, 언제까지"를 확인하는 핵심 가치를 한 사이트만으로도 제공한다.

**Independent Test**: 한 사이트만 수집한 상태에서 목록을 열어, 무작위 카드 10개의 가격·할인율·종료 시각·링크가
실제 사이트와 일치하는지 대조한다.

**Acceptance Scenarios**:

1. **Given** 무신사 수집이 완료된 상태, **When** 목록 화면을 열면, **Then** 수집된 할인 상품이 카드로 표시되고
   각 카드에 사이트명, 할인율, 정가/할인가, 종료 시각, 마지막 수집 시각이 보인다.
2. **Given** 카드 하나, **When** 카드를 누르면, **Then** 해당 상품 또는 행사 페이지가 새 창으로 열린다.
3. **Given** 종료 시각을 알 수 없는 상품, **When** 카드를 보면, **Then** 종료 시각이 "알 수 없음"으로 표시된다.

---

### User Story 2 - 성별·테마·할인율로 필터하고 정렬하기 (Priority: P2, Must)

배민 앱에서 음식 종류를 고르듯, 상단의 성별(남성/여성/공용) 탭과 테마(아우터, 상의, 하의, 원피스, 니트,
신발, 가방·잡화 등) 칩을 눌러 범위를 좁히고, 할인율 구간(30% 이상, 50% 이상, 70% 이상)과 사이트를
선택한다. 할인율 높은 순, 마감 임박 순, 가격 낮은 순으로 정렬한다.

**Why this priority**: 상품이 많아지면 원하는 옷을 빠르게 찾는 기능이 없으면 쓸모가 떨어진다.

**Independent Test**: 수집 데이터에서 "여성 + 아우터 + 50% 이상 + 마감 임박 순"을 선택하고 결과가 모두 조건을
만족하며 순서가 맞는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 여러 상품이 있는 목록, **When** 성별 "남성"과 테마 "아우터"를 고르면, **Then** 해당 조건의 상품만 보인다.
2. **Given** 필터가 적용된 목록, **When** "할인율 높은 순"을 고르면, **Then** 할인율 내림차순으로 정렬된다.
3. **Given** 성별·테마를 판별하지 못한 상품, **When** 필터를 보면, **Then** "미분류"로 따로 고를 수 있다.
4. **Given** 아무 조건에도 맞는 상품이 없음, **When** 필터를 적용하면, **Then** "조건에 맞는 할인이 없습니다"와
   필터 초기화 버튼이 보인다.

---

### User Story 3 - 여러 사이트 수집과 상태 확인 (Priority: P3, Should)

나머지 사이트(네이버쇼핑, 지그재그, 에이블리, 퀸잇, 29CM, W컨셉, 포스티, 4910)도 수집 대상에 추가한다.
수집 상태 화면에서 사이트별 마지막 수집 시각, 수집 건수, 상태(정상/실패/차단됨/로그인 필요)를 보고,
사이트별 또는 전체 수집을 직접 실행할 수 있다. 사이트는 서로 독립적이라 팀원이 나눠서 동시에 추가할 수 있다.

**Why this priority**: 여러 사이트를 한 화면에서 비교하는 것이 최종 목표지만, 사이트별로 독립적으로 추가할 수 있다.

**Independent Test**: 두 개 이상 사이트를 수집하고, 한 사이트를 일부러 실패시킨 뒤 다른 사이트 결과가 정상
표시되고 상태 화면에 실패가 표시되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 여러 사이트가 등록된 상태, **When** 전체 수집을 실행하면, **Then** 사이트별 결과가 합쳐져 한 목록에 표시된다.
2. **Given** 한 사이트에서 CAPTCHA 또는 차단 페이지가 나타남, **When** 수집이 진행되면, **Then** 그 사이트만 "차단됨"과
   시각이 표시되고 다른 사이트 수집과 화면은 영향을 받지 않는다.
3. **Given** 로그인이 필요한 사이트의 세션이 만료됨, **When** 수집하면, **Then** 상태가 "로그인 필요"로 표시된다.

---

### User Story 4 - 같은 상품을 사이트별로 비교하기 (Priority: P4, Stretch)

같은 브랜드의 같은 상품이 여러 사이트에서 팔릴 때, 한 화면에 사이트별 할인가·할인율·종료 시각을
나란히 보고 가장 싼 곳을 바로 고른다. 관심 상품 몇 개를 골라 직접 나란히 비교할 수도 있다.

**Why this priority**: 비교는 유용하지만, 목록과 필터만으로도 충분히 쓸 수 있으므로 마지막 단계다.

**Independent Test**: 두 사이트에 같은 상품이 있는 데이터에서 비교 화면을 열어 최저가 사이트가 강조되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 같은 브랜드·상품명으로 묶인 상품이 2개 사이트 이상에 있음, **When** 상품을 누르면, **Then** 사이트별
   가격 비교가 보이고 최저가가 강조된다.
2. **Given** 목록에서 상품 2~4개를 비교함에 담음, **When** 비교를 열면, **Then** 담은 상품이 나란히 표시된다.

---

### Edge Cases

- 할인율이 사이트 표시값과 정가·할인가로 계산한 값이 다를 때: 계산값을 기준으로 하되, 차이가 1%p를 넘으면 표시값도
  함께 보여준다.
- 정가가 없어서 할인율을 계산할 수 없을 때: 사이트 표시 할인율을 쓰고, 그것도 없으면 "알 수 없음"으로 두며
  할인율 필터에서는 제외한다.
- 종료 시각이 지난 할인: 기본으로 숨기고, "종료된 할인 보기"를 켜면 회색으로 표시한다.
- 종료 시각이 상품이 아니라 행사(기획전) 단위로만 있을 때: 행사 종료 시각을 상품에 적용하고 출처가 행사임을 표시한다.
- 같은 상품이 한 사이트의 여러 행사에 중복될 때: 하나로 합치고 가장 낮은 가격을 보여준다.
- 품절 상품: 표시는 하되 "품절"로 표시하고 기본 정렬에서 뒤로 보낸다.
- 사이트 구조가 바뀌어 수집 결과가 0건이거나 급감할 때: 이전 데이터를 지우지 않고 상태를 "실패(구조 변경 의심)"로 표시한다.

## Requirements *(mandatory)*

### Functional Requirements

**수집**

- **FR-001**: System MUST collect Black Friday clothing deals from the configured sites; the initial set is Musinsa,
  Naver Shopping, Zigzag, Ably, Queenit, 29CM, W Concept, Postie, and 4910, each added and enabled independently.
  Musinsa is required for MVP; the others are added as time allows.
- **FR-002**: The owner MUST be able to start collection manually for one site or all sites.
- **FR-002a** (Stretch): The owner can set an automatic collection interval (default every 6 hours).
- **FR-003**: Collection MUST wait between requests and stop retrying after repeated failures, so that a full run
  stays within normal browsing volume.
- **FR-004**: For sites that require login, collection MUST use the owner's own saved session; it MUST NOT enter
  credentials automatically. Expired sessions MUST show status "로그인 필요".
- **FR-005**: When a CAPTCHA or block page appears, collection for that site MUST stop, the site MUST be marked
  "차단됨" with the time, and no automatic retry MUST occur before a cool-down (default 6 hours) or a manual retry.
- **FR-006**: A failure in one site MUST NOT stop collection of other sites or break the deal list.
- **FR-007**: If a run returns zero deals, previously collected deals for that site MUST be kept and the site flagged
  as "실패(구조 변경 의심)".

**데이터**

- **FR-008**: Every deal MUST record site, product name, brand, original price, sale price, discount rate, sale end
  time, product/sale page link, image, gender, theme, sold-out state, and last-collected time.
- **FR-009**: The discount rate MUST be calculated as (original − sale) / original, rounded down to a whole percent;
  if the original price is missing, the site's displayed rate is used; otherwise it is "알 수 없음".
- **FR-010**: Missing values MUST be shown as "알 수 없음" and MUST NOT be estimated.
- **FR-011**: Gender MUST be one of 남성 / 여성 / 공용 / 미분류, and theme one of a fixed list (아우터, 상의, 니트,
  하의, 원피스·스커트, 셋업, 신발, 가방·잡화, 이너·홈웨어, 기타, 미분류), determined from the site's category
  first and product name keywords second.
- **FR-012**: Deals listed in several sale events on the same site MUST be merged into one entry showing the lowest price.
- **FR-013** (Stretch): Products sold on multiple sites are grouped when brand and normalized product name match.

**화면**

- **FR-014**: The main screen MUST show deals as cards with image, brand, name, original/sale price, discount rate,
  time remaining until the sale ends, and site; tapping a card MUST open the source page in a new tab.
- **FR-015**: The owner MUST be able to filter by gender, theme, discount range (전체 / 30%+ / 50%+ / 70%+), site,
  and "오늘 마감", and combine filters.
- **FR-016**: The owner MUST be able to sort by discount rate (high→low), ending soonest, and price (low→high).
- **FR-017**: Expired deals MUST be hidden by default and viewable via a toggle; sold-out items MUST be labeled.
- **FR-018**: A status screen MUST show, per site, last collected time, deal count, and state
  (정상 / 실패 / 차단됨 / 로그인 필요 / 꺼짐), with a button to collect now.
- **FR-019** (Stretch): A comparison view shows the same grouped product across sites with the lowest price
  highlighted, and allows manual side-by-side comparison of 2–4 selected deals.
- **FR-020**: The screen MUST show when the data was last updated.
- **FR-020a** (Stretch): A warning appears when data is older than 12 hours.
- **FR-021**: Screens MUST be usable on both a phone-width and a desktop browser.
- **FR-022** (Stretch): Selected filters and sort are remembered between visits.

### Key Entities *(include if feature involves data)*

- **Site (쇼핑몰)**: 수집 대상 쇼핑몰. 이름, 사용 여부, 로그인 필요 여부, 수집 상태, 마지막 수집 시각, 쿨다운 종료 시각.
- **Sale Event (행사)**: 사이트의 블프 기획전/행사. 사이트, 행사명, 행사 페이지 링크, 시작·종료 시각.
- **Deal (할인 상품)**: 사이트·행사에 속한 할인 상품. 상품명, 브랜드, 정가, 할인가, 할인율, 종료 시각, 상품 링크, 이미지,
  성별, 테마, 품절 여부, 마지막 수집 시각.
- **Product Group (동일 상품 묶음, Stretch)**: 여러 사이트의 같은 상품을 묶은 단위. 브랜드, 대표 상품명, 소속 Deal 목록, 최저가.
- **Collection Run (수집 기록)**: 사이트별 수집 실행 1회. 시작·종료 시각, 결과(성공/실패/차단/로그인 필요), 수집 건수, 오류 요약.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 5시간 안에 최소 1개 사이트(무신사)의 실제 블프 할인이 목록·필터·정렬과 함께 동작한다.
- **SC-002**: 5시간 안에 4개 이상 사이트의 할인이 한 목록에 함께 표시된다(Should).
- **SC-003**: 무작위로 고른 할인 카드 20개 중 19개 이상(95%)에서 할인가·할인율·종료 시각·링크가 실제 사이트와 일치한다.
- **SC-004**: 원하는 조건(성별+테마+할인율)의 할인 상품을 목록을 연 뒤 3번 이하의 탭/클릭과 10초 이내에 찾을 수 있다.
- **SC-005**: 필터나 정렬을 바꾸면 수집된 상품이 5,000개일 때도 결과가 1초 이내에 바뀐다.
- **SC-006**: 한 사이트가 실패하거나 차단되어도 나머지 사이트의 할인은 100% 계속 표시된다.
- **SC-007**: 블프 기간 동안 수집 때문에 소유자 계정이 정지되거나 IP가 영구 차단되는 일이 0건이다.
- **SC-008**: 휴대폰 화면 폭에서도 가로 스크롤 없이 카드와 필터를 모두 사용할 수 있다.

## Assumptions

- 개발은 4명이 Claude Max 계정으로 5시간 안에 한다. 화면과 공통 데이터 형식을 먼저 정하고, 그 뒤 사이트 수집기를
  사람별로 나눠 동시에 만든다(헌법: 사이트별 독립 수집기).
- 사용하는 사람은 개인(소유자)이며 회원가입, 결제, 공개 배포는 범위 밖이다(헌법 원칙 I).
- 앱은 소유자의 컴퓨터에서 실행하고, 같은 네트워크의 휴대폰 브라우저에서도 볼 수 있으면 충분하다.
- 첫 번째 구현 대상 사이트는 무신사이며, 나머지 사이트는 하나씩 추가한다. 5시간 안에 9개를 모두 붙이는 것은 목표가 아니다.
- "의류" 범위에는 신발과 가방·잡화를 포함하고, 화장품·식품·가전은 제외한다.
- 수집 대상은 각 사이트의 블랙프라이데이 행사 페이지와 그 안의 상품이며, 사이트 전체 상품은 수집하지 않는다.
- 성별은 남성/여성/공용으로 나누며 키즈는 범위 밖이다.
- 동일 상품 묶음은 브랜드와 상품명이 같을 때만 자동으로 묶고, 비슷한 상품 추천은 하지 않는다.
- 로그인 세션은 소유자가 자기 계정으로 직접 준비하며, CAPTCHA는 자동으로 풀지 않는다(헌법 원칙 II).
