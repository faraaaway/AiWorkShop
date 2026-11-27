# 포스티 fixture

- `home.html` — https://posty.kr (2026-11-27, `--dump html --wait 6`). 기획전 링크 목록과 홈 상품 카드.
- `event.html` — https://posty.kr/events/cms/5e77cd50-082c-4bce-a6a5-78403928c003 "[블프] 여성 TOP 브랜드"
  (2026-11-27, `--eval <harvestScript('a[href^="/products/"]', 0)> --dump html --wait 25`)
- 용량을 줄이려고 `<style>`·`<link>`·svg 내용·인라인 style·`<script>`를 지웠다. `event.html`의 `__NEXT_DATA__`는
  `title`, `uuid`, `date_ended`, `server_now`, `page_url`만 남겼고 `__bf_cards`는 앞 40개만 남겼다(실제 수집 158개).
