# 퀸잇 fixture

- `collection.html` — https://web.queenit.kr/collection/COLL261006221807d8979 (2026-11-27 수집)
- 받은 방법: Obscura v0.2.7 `--stealth fetch <url> --eval <harvestScript> --dump html --wait 30`
  (`src/crawler/adapters/crawlb-shared.ts`의 `harvestScript('a[href^="/product/"]', 1)`)
- 용량을 줄이려고 `<style>`·`<link>`·svg 내용·인라인 style과 `__bf_cards` 외 `<script>`를 지웠다. 상품 카드와 문구는 원본 그대로.
