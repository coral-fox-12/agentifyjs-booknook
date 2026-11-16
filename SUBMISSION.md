# Submission checklist — Open Agentic Web Challenge (Devpost)

Hackathon: https://cognizant-agenticweb.devpost.com/
Deadline: **Monday 11 January 2027, 16:00 UTC (23:00 VN)**.
Prizes: 1st $5,000 / 2nd $3,000 / 3rd $2,000 (+ Mozilla Otari credits + swag).

## What is already done

- [x] **AgentifyJS** — zero-dependency library (`site/agentify.js`): live page →
      capability model → OpenAI-style function schemas; MutationObserver keeps
      tools fresh.
- [x] **The Book Nook** — working agentic bookshop (`site/`): 12-book catalog,
      search, cart, demo checkout, orders; agent chat; model settings (BYOK);
      activity log.
- [x] **Agent network** — `booknook_assistant` (front desk + catalog, ordering,
      delivery specialists), Neuro SAN-shaped `booknook.network.json`.
- [x] **Harbor Delivery Co.** — peer agent site (`peer/`) with its own manifest
      + `delivery` network; cross-origin peer calls with consent.
- [x] **Spec conformance** — MVP 0.2 mapped section by section
      (`docs/SPEC-CONFORMANCE.md`, also served as `site/SPEC-CONFORMANCE.md`).
- [x] **Tests** — `node tests/probe.mjs`: **33/33 checks pass** in headless
      Chromium (artifacts valid, discovery, 4 scripted agent turns, manual
      shop flows incl. delivery checkout with a real peer quote, negative
      cases, no `Authorization` header ever reached the peer).
- [x] **Screenshots** — `tests/shots/` (catalog, checkout, delivery quote, settings).
- [x] **Video script** — `docs/VIDEO-SCRIPT.md` (under 2 minutes, shot list).
- [x] **README / LICENSE (MIT)** — open-source quality docs.

## Still needed before submit

1. **Deploy both sites as public static sites** (recommended: two free
   Cloudflare Pages projects). **Ready to run:** `bash deploy.sh` (needs
   `CLOUDFLARE_API_TOKEN` with Pages:Edit — the Cloudflare account is being
   created by a separate browser task; the token is NOT in this repo yet),
   then verify with `node tests/verify-public.mjs
   https://booknook-agentic.surge.sh https://harbor-delivery.surge.sh` (re-runs
   the four scripted agent turns against the live URLs and checks no
   `Authorization` header reaches the peer). No config edits are needed at
   deploy time — the repo already points at the production URLs.
   - Deploy `site/` as e.g. `booknook-agentic.surge.sh`.
   - Deploy `peer/` as e.g. `harbor-delivery.surge.sh`.
   - Update `site/links.json` (`delivery` URL) and `site/agent-manifest.json`
     (`allowed_peers`) to the peer's public origin. (Local dev uses
     `?peer=http://127.0.0.1:8472/delivery`.)
   - Update the `url` fields in both `.well-known/agent-card.json` files.
   - Verify: open the deployed shop, run the four sample queries, confirm the
     peer quote works cross-origin (the peer's `_headers` enables CORS).
2. **Devpost account** — the parent agent is creating the agent's separate
   Devpost account (do NOT use the user's personal account). Register for the
   hackathon on the Devpost page with that account.
3. **Record the demo video** (human presenter, < 2 min, browser footage) —
   follow `docs/VIDEO-SCRIPT.md`; upload to YouTube as Public; paste the link
   in the submission form.
4. **Screenshots** — upload the four from `tests/shots/` (`01-catalog.png`,
   `03-after-checkout.png`, `04-delivery-quote.png`, `05-settings.png`;
   all captured automatically by `tests/probe.mjs`) to the Devpost submission.
5. **Submission text** — draft for the Devpost description field:

   > **AgentifyJS + The Book Nook** — turn any web page into an agent-readable
   > page. AgentifyJS is a zero-dependency library that reads a live page
   > (forms, buttons, headings, tables) and produces the function schemas an
   > AI agent can call — no rewrite, no server. The Book Nook proves it: a
   > working bookshop whose catalog, cart, and checkout are the agent's tools.
   > Its three-agent network runs entirely in the visitor's browser (built-in
   > demo model, or bring your own key for any OpenAI-compatible router — the
   > key never leaves the browser), asks for confirmation before every write,
   > and arranges delivery by calling a second agent site, Harbor Delivery Co.,
   > after the visitor approves the contact. Conforms to the MVP 0.2 spec for
   > a worldwide agentic web (`agent-manifest.json`, resolved network JSON,
   > `links.json`, browser runtime, BYOK, consent, fail-closed validation).
   > Open source (MIT). Live demo: [shop URL]. Peer site: [peer URL].
   > Repo: [public repo URL].

6. **Public repo** — push this folder to a public GitHub repo (the submission
   should link the code; the Devpost form asks for the project URL, which is
   the deployed site — link the repo in the description too).
7. **Submit on Devpost** before 11 Jan 2027 16:00 UTC. Double-check the form:
   project URL (deployed shop), text description, video link (YouTube),
   screenshots. Optional: Otari usage is NOT used, so no Otari email/feedback
   is needed.

## Judging criteria (from the Devpost page)

- **Technological Implementation** — how well built, how effectively it uses
  the open agentic web spec → the conformance doc + probe results speak here.
- **Design** — a complete, coherent product, not just a proof of concept →
  the shop is a full working storefront with a real checkout flow.
- **Potential Impact** — a credible case for a real problem + shared tools →
  AgentifyJS is the reusable, open-source on-ramp for any site.
- **Quality of the Idea** — creative, non-obvious use of an agentic website →
  "your existing page IS the agent's toolset" + cross-site delivery via a peer.
