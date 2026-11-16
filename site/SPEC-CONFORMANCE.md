# Spec conformance — MVP Profile 0.2 (6 November 2026)

How The Book Nook + Harbor Delivery Co. implement the *Minimum Viable
Specification for a Worldwide Agentic Web* (Cognizant AI Lab), section by
section. Reference: `cognizant-ai-labs/agentic-web`, file
`docs/worldwide_agentic_web_mvp_spec.md`.

## Tenet 1 — Common multi-agent representation (§2)

| Requirement | Implementation |
|---|---|
| Network in Neuro SAN HOCON data model, resolved JSON for browser loading (§2, §2.1) | `site/booknook.network.json` and `peer/delivery.network.json` follow the reference `pizza_restaurant_website_assistant.network.json` shape: top-level `tools[]` of agents, each with `function {description, parameters}`, `instructions`, `tools[]`; plus `llm_config`, `max_execution_seconds`, `metadata`, `front_agent`. |
| Identity/metadata, agent definitions, invocation schemas, model hints (§2.1) | Manifest declares network name, description, `front_man`; every agent has a JSON-Schema invocation schema (`{inquiry, mode}`); model names are hints (`booknook-demo-model`), the caller's router wins. |
| Private context deny-by-default (§2.1, §5) | No `sly_data` is used at all. The only data crossing the peer boundary is the inquiry text and the peer's public answer. |
| External capabilities: peer-network URL, MCP, site-action catalog (§2.1) | `call_peer_network` (peer URL), `links.json` bindings, and the manifest `actions.agentTools` catalog. MCP facade is explicitly unavailable (static hosting) and declared so in the manifest (`agent_mcp.available: false`). |

## Tenet 2 — Browser execution and site composition (§3)

| Requirement | Implementation |
|---|---|
| Runtime usable from a normal page, executes the graph in JS (§3) | `site/runtime.js` — zero-dependency browser runtime, loaded as an ES module. |
| Parse & validate: reject malformed networks, dup/missing refs, invalid front agent (§3.1) | `validateManifest()` / `validateNetwork()` in `runtime.js`; boot fails closed with a visible error. Covered by probe negative cases. |
| Agent loop: streaming, tool calls, delegation, error propagation, bounded history (§3.1) | `runAgent()` loop (max 6 turns/agent, history capped at 12 messages); delegation mirrors the Neuro SAN aaosa pattern (front → specialist with `{inquiry, mode}`). Streaming is not used (mock + BYOK request/response); the loop is otherwise complete. |
| Grounded capabilities: MCP baseline; approval before third-party MCP (§3.1) | No third-party MCP is used. Grounded capability = registered local site actions (the shop's own handlers). |
| Local site actions: name, purpose, JSON Schema, effect, handler; validate args; show destination+args before writes (§3.1) | `SITE_ACTIONS` in `app.js` + `ACTION_SCHEMAS` in `runtime.js`; `validateArgs()` checks every call; `confirmWrite()` shows a review dialog (tool, args) before any `effect: "write"` action. Receipts are logged. |
| Report outcomes accurately; unknown outcome on timeout after a write (§3.1) | Receipts carry `{ok, ref, total, status}`; a timeout after a write begins is reported as unknown (the runtime never retries a write whose outcome is unknown — it surfaces the failure). |
| Bound execution: depth, invocations, remote calls, concurrency, time (§3.1) | Per user turn: max 8 tool calls, max delegation depth 3, 60 s wall budget, cycle detection on `(agent, inquiry)`; exceeding any limit stops the turn with a visible error. |
| Peer loading protocol (§3.2) | `callPeer()`: URL → site base → `agent-manifest.json` → **exact** network-name match (otherwise fail) → fetch + validate definition → run peer front agent locally in the caller's browser on the caller's router. Consent before contact (origin + purpose shown; per-origin, per-session remember). Peer gets no site actions and no key. |
| Minimum public files (§3.3) | `agent-manifest.json` (networks, `front_man`, `hocon`, router metadata, peer policy, linking, deployment, actions), `<network>.network.json`, `links.json`, plus optional `.well-known/agent-card.json` (A2A card) and `peer/_headers` (CORS for `*.json`). |
| Browser origin / CORS (§3.4) | Peer artifacts are fetched cross-origin with CORS (peer serves `Access-Control-Allow-Origin: *` for JSON). No credentials are ever attached to a peer request (proven by `tests/peer.log` in the probe). |

## Tenet 3 — Pluggable inference (§4)

| Requirement | Implementation |
|---|---|
| Default inference MAY be published; BYOK optional (§4) | Default: built-in deterministic demo model (no key, no network). BYOK offered: any OpenAI-compatible router (OpenAI, OpenRouter, …) with base URL + model + key. |
| Key stays in the caller's browser, only to the selected router (§4) | Key lives in origin-scoped `localStorage`, is sent only as an `Authorization` header to the configured router, and is never placed in URLs, manifests, prompts, tool arguments, traces, or peer requests. Deletable from the settings panel. |
| Peer inherits the caller's router; peer manifest cannot replace it (§4) | `callPeer()` runs the peer network through the caller's `modelCall()`; peer router metadata is ignored. |
| Missing key stops the model call with a clear setup error (§4) | If BYOK is selected without a key, the settings form refuses to save and the runtime falls back to the demo model with a visible note. |

## Security & privacy (§5)

- Peer definitions are treated as untrusted input: validated before execution; the peer cannot execute code, touch site actions, or see the key.
- Consent before every third-party contact, with destination + purpose; a redirect to a new origin would be a new consent decision.
- Private context: none is forwarded (no `sly_data` at all).
- Fail closed everywhere: invalid network, unknown tool, invalid args, denied origin, over-budget, composition cycle — all stop with a visible error and are never reported as success.
- User-owned writes: the runtime (not the model) owns confirmation; the reviewed proposal (tool + args + request id) is bound to the receipt.
- Observable execution: the activity log shows router, contacted origins, agent/tool calls, consent decisions, errors, and receipts — with no secrets.

## Interoperability checks (§6) — how to demonstrate each

1. **Publish a two-agent HOCON network + manifest from ordinary HTTPS hosting** — deploy `site/` and `peer/` as static sites; both manifests and networks are plain files.
2. **Load & run in a browser with the default router; BYOK path too** — open the site: it runs on the demo model immediately; add a key under *AI model settings* to exercise BYOK.
3. **Call an internal agent + a grounded capability** — ask "What fantasy books do you have?" (front → catalog specialist → `website_search_catalog`).
4. **After approval, load an exact named network from a second origin and run it locally** — ask "Arrange delivery for my order", approve the consent dialog; the `delivery` network loads from the peer origin and runs in the same browser.
5. **Show the second site never receives the key and cannot change the router** — `tests/peer.log` records every peer request with `authorization: false`; the peer manifest's router metadata is ignored by design.
6. **Private context absent at the peer unless explicitly allowed** — no private-context fields exist; the peer only ever receives the inquiry text.
7. **Stop an invalid network, composition cycle, over-budget request, denied origin with visible errors** — probe negative cases cover invalid networks (duplicate agent, missing front agent), invalid args, and denied origin; cycle and budget guards are in `runAgent()`.

## Known gaps (honest)

- **No streaming** — the demo model and BYOK calls use request/response; the agent loop is otherwise complete.
- **No third-party MCP** — grounded capability is the local site-action catalog (the spec's alternative to MCP for static sites); the public MCP facade is declared unavailable in the manifest.
- **No coded-tool bundles** — the network is pure data, which is the minimum portable profile; no untrusted code is executed.
- **Single-page demo data** — the catalog, cart, and orders live in page memory; nothing is persisted server-side (there is no server).
