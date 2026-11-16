# Demo video script — The Book Nook (target: under 2 minutes)

The Devpost rules require: under 2 minutes, footage of the project running in
a browser, and the entrant explaining the project on camera (not AI generated).
Record with a real human presenter speaking to camera + screen capture.
No third-party trademarks or copyrighted music.

## Shot list (total ~1:45)

| Time | Visual | Script (presenter, ~150 wpm) |
|---|---|---|
| 0:00–0:12 | Presenter to camera, then the shop homepage | "Hi, I'm [name]. Most websites will never be rewritten as agent sites — so I built AgentifyJS, a tiny library that turns the page you already have into tools an AI agent can call. This is the proof: The Book Nook, a working bookshop." |
| 0:12–0:30 | Scroll the catalog; click "Add to cart" on a book | "Every button, form and list on this page is machine-readable. AgentifyJS scans the live page and produces function schemas — the same catalog you see is the agent's toolset. No rewrite, no server." |
| 0:30–0:55 | Chat: "What fantasy books do you have?" → answer; "Add two copies of The Glass Meridian to my cart" → confirmation dialog → confirm → cart updates | "The shop runs a three-agent network in the browser. It answers from the live catalog, and when it writes — adding to the cart — it asks you to confirm first, showing exactly what it will do." |
| 0:55–1:15 | Chat: "Check out for pickup, name Ada" → confirm → order BN-1001 appears | "Checkout works the same way: the agent proposes, you review, and only then the demo order is placed. No payment, no server — the whole thing is static files." |
| 1:15–1:40 | Chat: "Arrange delivery for my order" → consent dialog → allow → Harbor Delivery quote appears; show the peer site + `agent-manifest.json` | "Delivery comes from a second agent site, Harbor Delivery. The network asks your permission, then loads the peer's published network and runs it right here in your browser — on your model. The peer never sees your key." |
| 1:40–1:45 | AI model settings panel; activity log | "It runs on a built-in demo model, or your own key for any OpenAI-compatible router — the key never leaves your browser. Everything is open source, MIT licensed. Thanks!" |

## Recording notes

- Capture at 1280×720 or 1920×1080, browser window maximized.
- Run the demo against the deployed sites (or local servers on 8471/8472 with `?peer=`).
- Before recording: reload the page so the cart is empty and the chat is fresh.
- Use the exact sample queries above — they are the scripted, tested path.
- The confirmation and consent dialogs are the point: do not skip them, narrate them.
- Keep the presenter's face or voice in the video throughout (rule: the entrant must explain the project).
- Export, upload to YouTube as Public (or Unlisted — the rules say publicly visible; use Public), and paste the link into the Devpost submission form.

## Screenshots (captured automatically by tests/probe.mjs)

- `tests/shots/01-catalog.png` — catalog top of page
- `tests/shots/03-after-checkout.png` — order placed in the chat
- `tests/shots/04-delivery-quote.png` — peer delivery quote in the chat
- `tests/shots/05-settings.png` — AI model settings (BYOK)
