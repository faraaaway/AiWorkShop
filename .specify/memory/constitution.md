# BF_web (Black Friday Discount Tracker) Constitution

## Core Principles

### I. Personal-Use Scope (NON-NEGOTIABLE)
BF_web is a single-user, personal tool. It MUST NOT include user accounts, payments, public
hosting requirements, multi-tenancy, or scaling infrastructure. Any feature that only makes
sense for a public service MUST be rejected under YAGNI.
Rationale: the owner is the only user; complexity spent on public-service concerns is waste.

### II. Obscura-Based Crawling, Polite and Bounded
All data collection MUST go through the Obscura-driven crawler, one adapter per site
(Naver Shopping, Musinsa, Zigzag, Ably, Queenit, 29CM, W Concept, Postie, 4910; new sites are
added the same way).
- Obscura stealth mode MAY be enabled per adapter so pages render as in a normal browser.
- Pages that require login MAY be read using the owner's own account session (cookies
  exported from the owner's browser or a manual login), stored locally and never committed.
  The crawler MUST NOT automate credential entry or use anyone else's account.
- CAPTCHAs MUST NOT be solved automatically or via solving services. When a CAPTCHA or block
  page is detected, the adapter MUST stop, mark the site as blocked with a timestamp, and
  back off; the owner may resolve it manually and resume.
- Crawlers MUST use rate limits with delays and backoff, cache results, and run on demand or
  on a schedule, never in a tight loop. They read only public product/sale data and MUST NOT
  collect other users' personal data.
- A failing or blocked adapter MUST NOT break other adapters or the UI.
Rationale: stealth and own-account sessions make crawling reliable for personal use, while
low request rates and stopping at CAPTCHAs keep the owner's IP and accounts from being banned
and isolate per-site breakage, which is inevitable.

### III. Source Traceability
Every deal shown MUST carry: the site name, a direct link to the product/sale page, the
discount rate, original and sale price, and the sale end time ("until when"), plus the time it
was last crawled. If a field cannot be obtained it MUST be shown as unknown, never guessed.
The discount rate MUST be computed from captured prices (or the site's displayed value) in one
shared function, with rounding rules documented.
Rationale: the product's value is knowing where and until when; wrong or stale data is worse
than missing data.

### IV. Normalized Data Model
Raw per-site data MUST be normalized into one common deal schema (site, product, brand, gender,
theme/category, prices, discount rate, end time, URL, image, crawled-at) before storage or
display. Gender and theme classification MUST be derived by documented, testable rules (site
categories first, keyword mapping second) and fall back to "unclassified". Expired deals MUST
be hidden or clearly marked by default.
Rationale: cross-site comparison by gender, theme, and discount rate only works on a
consistent schema.

### V. Browse-and-Compare UX
The UI MUST present clothing deals as a browsable, card-based catalog in the manner of food
delivery apps (Coupang Eats, Baemin): filter and sort by gender, theme, discount rate, site,
and time remaining, with side-by-side comparison of the same or similar items across sites.
It MUST be usable on mobile and desktop and show the data freshness. Filtering and sorting
MUST stay responsive on the full local dataset.
Rationale: the core job is fast comparison during a time-limited sale event.

## Technical Constraints

- Obscura is the crawling engine; per-site adapters live in isolated modules with a common
  adapter interface.
- Data is stored locally (a file or embedded database); no external services are required to
  run the app, other than the crawled sites.
- No secrets, cookies, or tokens are committed; session cookies and configuration live in
  git-ignored local files.
- Site markup changes are expected: each adapter MUST have saved HTML/JSON fixtures so parsing
  can be tested offline.
- The specific web stack and storage are decided in the implementation plan, favoring the
  simplest option that meets Principles I–V.

## Development Workflow

- Work follows Spec Kit: specify → plan → tasks → implement.
- Parsing, discount calculation, and gender/theme classification MUST have automated tests
  using saved fixtures (no live network in tests). Crawler runs are verified manually against
  live sites.
- Each adapter is delivered and verified independently, starting with one site end to end
  before adding others.
- Before finishing a feature, run the app and confirm the filters and links work on real
  crawled data.

## Governance

This constitution supersedes other practices in this repository. Amendments require editing
this file with a Sync Impact Report and a version bump: MAJOR for removing or redefining a
principle, MINOR for adding a principle or materially expanding guidance, PATCH for
clarifications. Plans and specs MUST state how they comply with Principles I–V, and any
violation MUST be justified in the plan's complexity section. Compliance is reviewed at the
end of each feature.

**Version**: 2.0.0 | **Ratified**: 2026-11-27 | **Last Amended**: 2026-11-27
