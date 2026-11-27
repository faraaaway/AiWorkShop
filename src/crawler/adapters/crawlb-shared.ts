// Crawl B(퀸잇·포스티·4910) 수집기 공용 도구.
//
// 세 사이트 모두 상품 목록을 "스크롤해서 화면에 들어올 때" 불러오고, 화면 밖 카드는 DOM에서 지운다
// (가상 스크롤). 그래서 Obscura로 HTML만 받으면 상품이 없거나 일부만 있다.
// 해결: 페이지 안에서 스크롤하며 본 카드의 outerHTML을 <script id="__bf_cards"> 에 모아 두는
// 스크립트(harvestScript)를 `--eval`로 먼저 실행하고, `--wait` 뒤에 `--dump html`로 받는다.
// 값 해석은 전부 Node 쪽 parse* 순수 함수가 한다(페이지 스크립트는 HTML만 모은다).
import * as cheerio from 'cheerio';
import type { CrawlContext, FetchHtmlOptions } from '@/lib/types';

export const HARVEST_ID = '__bf_cards';

/** fetchHtml 옵션 중 스크롤 수집에 쓰는 것: `preEval`은 `--eval`로 넘겨 `--wait` 전에 실행된다. */
export type ScrollFetchOpts = Pick<FetchHtmlOptions, 'waitSec' | 'preEval'>;

/**
 * 페이지 안에서 실행할 수집 스크립트. linkSelector에 맞는 상품 링크를 찾아
 * parentLevels 만큼 위 요소(카드 뿌리)의 outerHTML을 href 기준으로 중복 없이 모은다.
 * Obscura는 타이머가 느려(약 1초에 1번) 한 번에 한 화면 넘게 내린다.
 */
export function harvestScript(linkSelector: string, parentLevels: number, stepPx = 1000): string {
  return `(function () {
  var seen = {}, order = [];
  var box = document.createElement("script");
  box.type = "application/json"; box.id = ${JSON.stringify(HARVEST_ID)};
  document.body.appendChild(box);
  function grab() {
    var links = document.querySelectorAll(${JSON.stringify(linkSelector)});
    var added = false;
    for (var i = 0; i < links.length; i++) {
      var key = links[i].getAttribute("href");
      if (!key) continue;
      var el = links[i];
      for (var n = 0; n < ${Number(parentLevels)} && el.parentElement; n++) el = el.parentElement;
      if (!seen[key]) { order.push(key); added = true; }
      seen[key] = el.outerHTML;
    }
    if (!added && box.textContent) return;
    var out = [];
    for (var j = 0; j < order.length; j++) out.push(seen[order[j]]);
    box.textContent = JSON.stringify(out).split("<").join("\\\\u003c");
  }
  var y = 0;
  setInterval(function () {
    try { grab(); } catch (e) { box.setAttribute("data-error", String(e)); }
    y += ${Number(stepPx)};
    window.scrollTo(0, y);
  }, 250);
  return "harvesting";
})()`;
}

/** 스크롤 수집 스크립트를 붙여 렌더링된 HTML을 받는다. 네트워크는 ctx만 쓴다. */
export function fetchScrolled(
  ctx: CrawlContext,
  url: string,
  linkSelector: string,
  parentLevels: number,
  waitSec = 25,
): Promise<string> {
  const opts: ScrollFetchOpts = { waitSec, preEval: harvestScript(linkSelector, parentLevels) };
  return ctx.fetchHtml(url, opts);
}

export interface Card {
  href: string;
  /** 카드 뿌리 요소 하나만 담긴 cheerio 문서 */
  $: cheerio.CheerioAPI;
}

/**
 * HTML에서 상품 카드를 꺼낸다. 수집 스크립트가 모아 둔 것(__bf_cards)을 먼저, 그다음
 * 현재 DOM에 남아 있는 카드를 더한다. 같은 href는 한 번만.
 */
export function collectCards(html: string, linkSelector: string, parentLevels: number): Card[] {
  const $page = cheerio.load(html);
  const fragments: string[] = [];

  const stash = $page(`script#${HARVEST_ID}`).first().text();
  if (stash) {
    try {
      const list: unknown = JSON.parse(stash);
      if (Array.isArray(list)) for (const h of list) if (typeof h === 'string') fragments.push(h);
    } catch {
      // 수집 중 잘린 JSON이면 DOM에 남은 카드만 쓴다.
    }
  }
  $page(linkSelector).each((_, a) => {
    let el = $page(a);
    for (let n = 0; n < parentLevels; n++) {
      const parent = el.parent();
      if (!parent.length) break;
      el = parent;
    }
    fragments.push($page.html(el) ?? '');
  });

  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const fragment of fragments) {
    if (!fragment) continue;
    const $ = cheerio.load(fragment, null, false);
    const href = $(linkSelector).first().attr('href');
    if (!href || seen.has(href)) continue;
    seen.add(href);
    cards.push({ href, $ });
  }
  return cards;
}

/** 카드 안에서 자식 요소가 없는 요소들의 글자를 문서 순서대로. (아이콘 svg 제외) */
export function leafTexts($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  $('*').each((_, el) => {
    const node = $(el);
    if (node.children().length > 0) return;
    if (node.closest('svg').length > 0) return;
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  });
  return out;
}

/** "129,000원" / "129,000" → 129000. 숫자가 아니면 null. */
export function toWon(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^([\d,]+)\s*원?$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "48%" → 48. 그 밖은 null. */
export function toPercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^(\d{1,3})\s*%$/.exec(text.trim());
  return m ? Number(m[1]) : null;
}

export function absoluteUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** epoch 밀리초 → KST 오프셋 ISO 문자열 (예: 2026-11-30T23:59:59+09:00). */
export function msToKstIso(ms: number): string {
  return new Date(ms + 9 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

/** 로그인 화면으로 넘어갔는지. 제목이나 og:url로만 판단한다. */
export function looksLikeLoginPage(html: string): boolean {
  const $ = cheerio.load(html);
  const title = $('title').first().text();
  const ogUrl = $('meta[property="og:url"]').attr('content') ?? '';
  return /로그인/.test(title) || /\/(auth\/)?login(\b|\/|\?)/.test(ogUrl);
}

/** 페이지에 심긴 __NEXT_DATA__ JSON. 없거나 깨졌으면 null. */
export function readNextData(html: string): unknown {
  const $ = cheerio.load(html);
  const raw = $('script#__NEXT_DATA__').first().text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
