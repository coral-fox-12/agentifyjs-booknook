# Book Nook redesign — "a secondhand bookshop's printed catalogue"

## Before (audit, 2026-11-17)
- Dark brown header bar, emoji book-stack logo, system-ui everywhere — no type identity.
- Centred single 960px column; identical rounded white cards in a 3-column grid.
- Pill genre badges, brown pill buttons, same rhythm in every section.
- Latent bug (pre-existing, also visible in the before shots): the Delivery address
  field showed for pickup orders — `form label { display: block }` overrode the
  `hidden` attribute. Fixed here with `[hidden] { display: none !important; }`.

## After — new identity
- **Palette:** warm paper `#f5f0e6`, ink `#211a13`, hairline rules, ONE accent —
  oxblood `#7d2a1e` (book-cloth red). Zero blue, zero gradients, zero rounded
  corners, zero shadows.
- **Type (self-hosted, zero external requests):** Fraunces (display serif,
  normal + italic) for the wordmark and headings, IBM Plex Mono for kickers,
  prices, labels and buttons, Georgia serif for body. Fonts in `site/fonts/`
  (OFL, copied from the Terminal 3 redesign's set).
- **Layout:** dateline strip ("An open agentic bookshop · 12 books on the
  shelves"), asymmetric masthead — giant Fraunces wordmark + "BN" bookplate left,
  contents index (01 Catalogue / 02 Cart & checkout / 03 Orders / 04 Ask the
  Nook) and a shop note right, double rule underneath. Numbered sections 00–04
  with mono kickers. The catalogue is a ledger: two columns of ruled entries,
  title in Fraunces, price + stock right-aligned in mono, genre as a stamp
  (outlined, no fill), ink buttons (oxblood on hover).
- **Copy:** tightened to specifics; no invented claims. The shop note in the
  masthead: "Every button on this page is a tool an agent can call. The shop
  answers back — in this browser, on your say-so." Footer notes the typefaces.
- **Presentation only:** every element ID, `data-agent-action`, link, heading,
  sample flow and JS file untouched. One CSS-only fix for the stray `&middot;`
  between price and stock (parent `font-size: 0`, spans keep their sizes).

## Verification
- `node tests/probe.mjs` (local, full E2E): **33/33 checks passed** — discovery,
  4 scripted agent turns, manual shop flows incl. consented peer delivery
  quote, negative cases, no `Authorization` header to the peer. Re-run after the
  final CSS fix: still 33/33.
- `node redesign/smoke-live.mjs` (public URL, via local forward proxy):
  **9/9 live checks passed** — no console errors, no failed requests, zero
  external requests, Fraunces + IBM Plex Mono loaded, 12 books render, oxblood
  kicker colour `rgb(125, 42, 30)`, no `#0000ff` anywhere, search "fantasy" →
  3 books, Add to cart → $14.99 total, agent turn lists real fantasy titles.
- Note: `tests/verify-public.mjs` cannot run in this VM as-is — it launches
  Chromium without `--proxy-server`, and headless Chromium cannot reach the
  internet here without the local forward proxy (it times out on "runtime
  boot"). The live smoke script above is its proxy-aware equivalent and passed
  9/9. The script itself is unchanged.

## Files
- `site/index.html`, `site/styles.css` — the redesign.
- `site/fonts/` (new, 5 woff2 files, ~155 KB) — self-hosted fonts.
- `redesign/` (new, work evidence only) — before/after screenshots (live),
  `smoke-live.mjs`, `local_proxy.cjs`.

## Deploy
- Live: https://booknook-agentic.surge.sh (same URL, Surge, `surge` auth in
  `~/.netrc`). Peer (Harbor Delivery, untouched): https://harbor-delivery.surge.sh
- $0 spent. Local test server stopped after verification; local forward proxy
  (127.0.0.1:18080, `redesign/local_proxy.cjs`) left running for reuse.
