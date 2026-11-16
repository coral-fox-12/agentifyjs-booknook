// Headless end-to-end probe for The Book Nook + Harbor Delivery peer.
// Drives the Playwright headless shell over CDP with Node's built-in WebSocket.
// Checks: no console errors / failed requests, spec artifacts valid, Agentify
// discovery, scripted agent turns (search, add to cart, confirmed checkout,
// consented peer delivery quote), negative cases (invalid network, denied
// origin), and that no Authorization header ever reached the peer.
// Usage: node tests/probe.mjs   (run from the project root)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_PORT = 8471, PEER_PORT = 8472, CDP_PORT = 9333;
const CHROME = process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell";
const SHOTS = path.join(ROOT, "tests", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(path.join(ROOT, "tests", "site.log"), { force: true });
fs.rmSync(path.join(ROOT, "tests", "peer.log"), { force: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, dir, log) {
  return spawn(process.execPath, ["serve.mjs", String(port), dir, log], { cwd: ROOT, stdio: "ignore" });
}
const siteSrv = startServer(SITE_PORT, "site", "tests/site.log");
const peerSrv = startServer(PEER_PORT, "peer", "tests/peer.log");
await sleep(800);

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, "--no-sandbox",
  "--disable-gpu", "--window-size=1280,900", "--user-data-dir=/tmp/booknook-chrome-profile",
  "about:blank",
], { stdio: "ignore" });

let targets = null;
for (let i = 0; i < 30; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); break; }
  catch { await sleep(500); }
}
if (!targets) { console.error("CDP did not come up"); process.exit(2); }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("exception: " + JSON.stringify(msg.params.exceptionDetails).slice(0, 300));
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push("console.error: " + JSON.stringify(msg.params.args).slice(0, 300));
  if (msg.method === "Network.loadingFailed") failedRequests.push(msg.params.errorText + " " + (msg.params.type || ""));
  if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) failedRequests.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
});
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression, awaitPromise = false) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error("evaluate failed: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function waitFor(expression, timeoutMs = 20000, label = "") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await evalJs(expression)) return true; } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label || expression}`);
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, "base64"));
}

// settle(): wait until the runtime is idle, clicking through the confirmation
// and consent dialogs as a user would. Records which dialogs appeared.
const dialogSeen = { confirm: false, consent: false };
async function settle(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await evalJs(`(() => {
      const c = document.getElementById('confirm-dialog');
      const s = document.getElementById('consent-dialog');
      if (c.open) { document.getElementById('confirm-yes').click(); return 'confirm'; }
      if (s.open) { document.getElementById('consent-yes').click(); return 'consent'; }
      return window.__booknook.runtime.busy ? 'busy' : 'idle';
    })()`);
    if (st === "confirm") dialogSeen.confirm = true;
    if (st === "consent") dialogSeen.consent = true;
    if (st === "idle") return true;
    await sleep(200);
  }
  throw new Error("settle timeout — runtime still busy");
}

// settleUntil(): like settle(), but waits for a page condition instead of
// runtime idle. Manual flows (form checkout) never set runtime.busy, so
// settle() would return while the consent/confirm dialogs are still pending.
async function settleUntil(expression, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await evalJs(`(() => {
      const c = document.getElementById('confirm-dialog');
      const s = document.getElementById('consent-dialog');
      if (c.open) { document.getElementById('confirm-yes').click(); return 'confirm'; }
      if (s.open) { document.getElementById('consent-yes').click(); return 'consent'; }
      return 'none';
    })()`);
    if (st === "confirm") dialogSeen.confirm = true;
    if (st === "consent") dialogSeen.consent = true;
    if (await evalJs(expression)) return true;
    await sleep(200);
  }
  throw new Error(`settleUntil timeout waiting for: ${expression}`);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${SITE_PORT}/?peer=http://127.0.0.1:${PEER_PORT}/delivery` });
await waitFor(`window.__booknook && window.__booknook.runtime && window.__booknook.runtime.manifest && !window.__booknook.runtime.busy`, 20000, "runtime boot");
await sleep(500);

// Catalog top-of-page screenshot (Devpost submission asset).
await evalJs(`document.getElementById('catalog').scrollIntoView()`);
await sleep(300);
await shot("01-catalog.png");
await evalJs(`window.scrollTo(0, 0)`);

check("page loads without console errors", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 300));
check("no failed requests", failedRequests.length === 0, failedRequests.join(" | ").slice(0, 300));

// Spec artifacts: fetch + validate in-page.
const artifacts = await evalJs(`(async () => {
  const mod = await import('./runtime.js');
  const out = {};
  for (const f of ['agent-manifest.json', 'booknook.network.json', 'links.json', '.well-known/agent-card.json']) {
    const r = await fetch(f); out[f] = { status: r.status, json: r.ok ? await r.json() : null };
  }
  out.manifestErrors = mod.validateManifest(out['agent-manifest.json'].json);
  out.networkErrors = mod.validateNetwork(out['booknook.network.json'].json, ['website_get_page_state','website_search_catalog','website_add_to_cart','website_remove_from_cart','website_set_cart','website_get_order_status','website_checkout_demo_order']);
  const peerM = await (await fetch('http://127.0.0.1:${PEER_PORT}/agent-manifest.json')).json();
  const peerN = await (await fetch('http://127.0.0.1:${PEER_PORT}/delivery.network.json')).json();
  out.peerManifestErrors = mod.validateManifest(peerM);
  out.peerNetworkErrors = mod.validateNetwork(peerN, []);
  return out;
})()`, true);
check("site manifest/network/links/agent-card fetch 200", ["agent-manifest.json", "booknook.network.json", "links.json", ".well-known/agent-card.json"].every((f) => artifacts[f].status === 200));
check("site manifest valid", artifacts.manifestErrors.length === 0, artifacts.manifestErrors.join("; "));
check("site network valid (4 agents, front agent defined)", artifacts.networkErrors.length === 0, artifacts.networkErrors.join("; "));
check("peer manifest + network valid", artifacts.peerManifestErrors.length === 0 && artifacts.peerNetworkErrors.length === 0,
  [...artifacts.peerManifestErrors, ...artifacts.peerNetworkErrors].join("; "));

// AgentifyJS discovery on the live page.
const discovered = await evalJs(`(() => {
  const m = window.Agentify.describePage(document);
  return { actions: m.actions.map((a) => a.name), tools: window.Agentify.toTools(m).map((t) => t.function.name) };
})()`);
for (const name of ["website_get_page_state", "website_search_catalog", "website_add_to_cart", "website_set_cart", "website_checkout_demo_order", "website_get_order_status"]) {
  check(`AgentifyJS discovers "${name}" from the live page`, discovered.actions.includes(name), `found: ${discovered.actions.join(", ")}`);
}
check("AgentifyJS exposes >= 7 tools", discovered.tools.length >= 7, `${discovered.tools.length} tools`);

// Turn 1: catalog question.
await evalJs(`window.__booknook.send("What fantasy books do you have?")`);
await settle();
let lastAgent = await evalJs(`[...document.querySelectorAll('#chat-log .chat-msg.agent')].pop()?.textContent || ''`);
check("turn 1 — fantasy search lists real catalog titles", /Glass Meridian/.test(lastAgent) && /Salt & Cinder/.test(lastAgent), lastAgent.slice(0, 160));

// Turn 2: add to cart (write → confirmation dialog, settled by clicking yes).
dialogSeen.confirm = false;
await evalJs(`window.__booknook.send("Add two copies of The Glass Meridian to my cart")`);
await settle();
const cart = await evalJs(`({ total: document.getElementById('cart-total-value').textContent, count: window.__booknook.state.cart.reduce((s,l)=>s+l.qty,0) })`);
check("turn 2 — cart holds 2x Glass Meridian, total $29.98", cart.total === "$29.98" && cart.count === 2, JSON.stringify(cart));
check("turn 2 — add-to-cart asked for confirmation (write)", dialogSeen.confirm === true);
const discovered2 = await evalJs(`window.Agentify.describePage(document).actions.map((a) => a.name)`);
check("AgentifyJS discovers remove_from_cart once the cart has items", discovered2.includes("website_remove_from_cart"));

// Turn 3: checkout (confirmation dialog must appear).
dialogSeen.confirm = false;
await evalJs(`window.__booknook.send("Check out for pickup, name Ada")`);
await settle();
const order = await evalJs(`window.__booknook.state.orders[window.__booknook.state.orders.length-1]`);
check("turn 3 — checkout asked for confirmation first", dialogSeen.confirm === true);
check("turn 3 — order placed after confirm (BN-1001, pickup)", order && order.ref === "BN-1001" && order.fulfillment === "pickup" && order.status.includes("pickup"), JSON.stringify(order));
check("turn 3 — cart emptied after checkout", await evalJs(`window.__booknook.state.cart.length`) === 0);
await evalJs(`document.getElementById('agent').scrollIntoView()`);
await sleep(300);
await shot("03-after-checkout.png");

// Manual path: the shop's own Add to cart / Remove buttons must work too
// (regression: renderCart wired Remove buttons with the wrong data attribute).
await evalJs(`document.querySelector('#book-grid .book button').click()`);
await sleep(300);
check("manual — Add to cart button adds a book", await evalJs(`window.__booknook.state.cart.length`) === 1,
  `cart lines: ${await evalJs(`window.__booknook.state.cart.length`)}`);
await evalJs(`document.querySelector('#cart-contents [data-agent-action="website_remove_from_cart"]').click()`);
await sleep(300);
check("manual — Remove button empties the cart", await evalJs(`window.__booknook.state.cart.length`) === 0,
  `cart lines: ${await evalJs(`window.__booknook.state.cart.length`)}`);

// Manual delivery checkout: must get a real peer quote (consent first) before
// placing the order — no $0 "delivery booked" order without a fee/slot.
await evalJs(`document.querySelector('#book-grid .book button').click()`);
await sleep(300);
await evalJs(`(() => {
  document.getElementById('customer-name').value = 'Ada';
  const sel = document.getElementById('fulfillment');
  sel.value = 'delivery';
  sel.dispatchEvent(new Event('change'));
  document.getElementById('delivery-address').value = '12 Harbor Lane, Old Town';
  document.getElementById('checkout-form').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
dialogSeen.consent = false; dialogSeen.confirm = false;
await settleUntil(`window.__booknook.state.orders.length === 2`);
const dOrder = await evalJs(`window.__booknook.state.orders[window.__booknook.state.orders.length-1]`);
check("manual — delivery checkout asked for peer consent first", dialogSeen.consent === true);
check("manual — delivery checkout asked for confirmation", dialogSeen.confirm === true);
check("manual — delivery order placed with real quote (fee $2.00, slot)", dOrder && dOrder.ref === "BN-1002" && dOrder.fulfillment === "delivery" && dOrder.deliveryFee === 2 && dOrder.delivery && dOrder.delivery.slot === "today 18:00", JSON.stringify(dOrder));
check("manual — order list shows the delivery slot, never 'undefined'", await evalJs(`!document.getElementById('order-list').textContent.includes('undefined')`));

// Turn 4: delivery via peer (consent dialog must appear).
dialogSeen.consent = false;
await evalJs(`window.__booknook.send("Arrange delivery for my order")`);
await settle();
lastAgent = await evalJs(`[...document.querySelectorAll('#chat-log .chat-msg.agent')].pop()?.textContent || ''`);
check("turn 4 — peer contact asked for consent first", dialogSeen.consent === true);
check("turn 4 — peer delivery quote returned in the chat", /Harbor Delivery/.test(lastAgent) && /\$\d+\.\d{2}/.test(lastAgent), lastAgent.slice(0, 220));
await evalJs(`document.getElementById('agent').scrollIntoView()`);
await sleep(300);
await shot("04-delivery-quote.png");

// Peer never received an Authorization header.
await sleep(300);
const peerLog = fs.readFileSync(path.join(ROOT, "tests", "peer.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
check("peer received no Authorization header (key never leaves the browser)", peerLog.length > 0 && peerLog.every((e) => e.authorization === false), `${peerLog.length} peer requests logged`);

// Negative cases.
const neg = await evalJs(`(async () => {
  const mod = await import('./runtime.js');
  const broken = JSON.parse(JSON.stringify(window.__booknook.runtime.network));
  broken.tools.push({ name: 'catalog_specialist', function: { description: 'dup', parameters: {} }, instructions: 'x', tools: [] });
  const dupErrors = mod.validateNetwork(broken, []);
  const missingFront = mod.validateNetwork({ ...broken, tools: broken.tools.filter((a) => a.name !== 'catalog_specialist'), front_agent: 'no_such_agent' }, []);
  const denied = await window.__booknook.runtime.callPeer('https://evil.example/delivery', 'hello');
  const badArgs = mod.validateArgs({ type: 'object', properties: { book_id: { type: 'string' } }, required: ['book_id'] }, {});
  return { dupErrors, missingFront, deniedOk: denied.ok === false, deniedMsg: denied.error || '', badArgs };
})()`, true);
check("negative — duplicate agent name rejected by validation", neg.dupErrors.length > 0, neg.dupErrors.join("; "));
check("negative — missing front agent rejected", neg.missingFront.length > 0, neg.missingFront.join("; "));
check("negative — disallowed peer origin refused", neg.deniedOk && /not allowed/.test(neg.deniedMsg), neg.deniedMsg.slice(0, 120));
check("negative — invalid tool args rejected by schema", neg.badArgs.length > 0, neg.badArgs.join("; "));

// Settings panel screenshot.
await evalJs(`document.getElementById('model-settings').open = true; document.getElementById('model-settings').scrollIntoView()`);
await sleep(400);
await shot("05-settings.png");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
ws.close();
chrome.kill("SIGKILL");
siteSrv.kill("SIGKILL");
peerSrv.kill("SIGKILL");
process.exit(failed.length ? 1 : 0);
