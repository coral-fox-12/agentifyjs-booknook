# AgentifyJS + The Book Nook

**Turn any web page into an agent-readable page — and prove it with a working
open agentic bookshop.**

Built for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/)
(Cognizant × MIT NANDA × Mozilla × AWS). Deadline: **11 January 2027, 16:00 UTC**.
Prizes: 1st $5,000, 2nd $3,000, 3rd $2,000 (+ Mozilla Otari credits).

## The idea

The agentic web needs a low-friction on-ramp: most websites will never be
rewritten as "agent sites" from scratch. **AgentifyJS** is a zero-dependency
JavaScript library that reads a live page — its headings, forms, buttons, links
and tables — and turns it into a machine-readable capability model plus
OpenAI-style function schemas an agent can call. The page you already have
becomes the agent's toolset, with no rewrite and no server.

**The Book Nook** is the proof: a small independent bookshop (real catalog,
cart, demo checkout) agentified with AgentifyJS. It publishes a conforming
agent network (`booknook_assistant`: front desk + catalog, ordering, and
delivery specialists), runs it entirely in the visitor's browser, and arranges
delivery by calling a second agent site — **Harbor Delivery Co.** — after the
visitor approves the contact. No server, no tracking, no payment. The visitor's
LLM key (if they add one) never leaves their browser.

## Repository layout

```
site/                  The Book Nook — the agentic website (static, deploy anywhere)
  index.html           Bookshop page + agent chat + model settings + activity log
  styles.css
  app.js               Catalog, cart, demo orders, site-action handlers
  agentify.js          AgentifyJS — the library (UMD, zero dependencies)
  mock-model.js        Deterministic demo model (OpenAI chat-completions shape)
  runtime.js           Spec-conformant browser runtime
  site.js              Page wiring + runtime boot
  agent-manifest.json  Public manifest (networks, router, peer policy, actions)
  booknook.network.json  Resolved network definition (Neuro SAN shape)
  links.json           Peer-network bindings (delivery → Harbor Delivery Co.)
  .well-known/agent-card.json  A2A agent card (optional discovery metadata)
peer/                  Harbor Delivery Co. — a second agent site (peer)
  index.html, agent-manifest.json, delivery.network.json, links.json,
  _headers (CORS), .well-known/agent-card.json
tests/probe.mjs        Headless end-to-end probe (CDP, no dependencies)
serve.mjs              Static dev server with CORS + request logging
docs/                  Spec conformance map, video script
```

## Quickstart

```bash
# Serve both sites (different origins, as the spec's peer protocol needs)
node serve.mjs 8471 site tests/site.log &
node serve.mjs 8472 peer tests/peer.log &
# Open the shop (the ?peer= parameter points at the local peer)
# http://127.0.0.1:8471/?peer=http://127.0.0.1:8472/delivery
```

Try in the chat ("Ask the Nook"):

- "What fantasy books do you have?"
- "Add two copies of The Glass Meridian to my cart"
- "Check out for pickup, name Ada" (you confirm the order first)
- "Arrange delivery for my order" (you approve the peer contact first)

By default the shop runs on its built-in **demo model** — deterministic,
no key, no network calls. Under **AI model settings** you can bring your own
key for any OpenAI-compatible router (OpenAI, OpenRouter, …). The key is stored
only in your browser's localStorage, is sent only to the router you choose,
and can be deleted at any time.

## How it works

1. **AgentifyJS discovers the page.** `describePage(document)` scans the live
   DOM for `data-agent-action` elements, forms, headings, links and tables and
   builds a capability model. `toTools(model)` converts it to function schemas.
   A `MutationObserver` keeps the model fresh as the page changes, so tools
   never go stale when the catalog re-renders.
2. **The runtime runs the network.** `runtime.js` fetches `agent-manifest.json`
   and the resolved network definition, validates them (duplicate/missing
   agents, unknown tools, invalid front agent → fail closed with a visible
   error), then runs the agent loop: model call → tool call → dispatch →
   result → model. Budgets bound every turn (8 tool calls, 3 delegation depth,
   60 s). Internal agents delegate like the Neuro SAN aaosa pattern.
3. **Site actions are real.** Tools map to the shop's own handlers
   (`website_add_to_cart`, `website_checkout_demo_order`, …). Arguments are
   validated against JSON Schema, and every write asks the user to confirm in
   a review dialog showing the exact action and arguments. A receipt is logged.
4. **Peers are loaded, not trusted.** `call_peer_network` resolves a
   peer-network URL, checks the manifest's peer policy (closed: only listed
   origins), asks the visitor for consent (origin + purpose shown), fetches
   the peer's manifest, requires an **exact** network-name match, validates
   the definition, and runs the peer's front agent locally in the visitor's
   browser on the visitor's model. The peer gets no site actions and no key.
   Private context is deny-by-default.
5. **Inference is pluggable.** Default: the deterministic demo model.
   Optional: BYOK OpenAI-compatible routers. The runtime never puts a key in
   a URL, manifest, prompt, tool argument, trace, or peer request.

## Spec conformance

Conforms to the *Minimum Viable Specification for a Worldwide Agentic Web*
(MVP 0.2, 6 Nov 2026). The full section-by-section mapping is in
[`docs/SPEC-CONFORMANCE.md`](docs/SPEC-CONFORMANCE.md), including how each of
the spec's §6 interoperability checks is demonstrated. The public artifacts
follow the reference implementation's shapes (`agent-manifest.json` fields,
resolved `<network>.network.json`, `links.json`) so any conforming runtime can
consume them.

## Testing

```bash
node tests/probe.mjs
```

The probe drives headless Chromium over CDP and checks 33 assertions:
no console errors or failed requests; manifest/network/links/agent-card fetch
and validate; AgentifyJS discovery; four scripted agent turns (search, add to
cart, confirmed checkout, consented peer delivery quote); the manual shop
flows (Add to cart / Remove buttons, delivery checkout with a real peer quote);
negative cases (duplicate agent, missing front agent, denied origin, invalid
tool args); and that **no `Authorization` header ever reached the peer**
(server request logs). Screenshots land in `tests/shots/`.

## Deployment

Both sites are static files. Deploy `site/` and `peer/` as two static sites
(e.g. two Cloudflare Pages projects, free), then update `site/links.json` and
`site/agent-manifest.json` (`allowed_peers`) to the peer's public origin.
The peer's `_headers` file enables CORS for `*.json` on Cloudflare Pages.
See [`SUBMISSION.md`](SUBMISSION.md) for the submission checklist.

## Why this matters

- **For site owners:** agentify the site you already have. Annotate the
  actions with `data-agent-action` (or let the library infer them from forms)
  and publish a manifest — no backend, no rewrite, no LLM bill (visitors
  bring their own keys).
- **For agent builders:** a page's capabilities become callable tools with
  schemas, and peer networks compose by URL with consent — the open agentic
  web's discovery and trust primitives, working in a plain browser today.
- **For users:** the agent runs in their browser, on their model, with their
  key, and asks before every write and every cross-site contact.

## License

MIT — see [LICENSE](LICENSE).
