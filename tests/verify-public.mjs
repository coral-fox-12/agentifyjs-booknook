// Post-deploy verification against the PUBLIC Cloudflare Pages URLs.
// Checks: spec artifacts fetch 200 + validate, AgentifyJS discovery, the four
// scripted agent turns (search, add to cart + confirm, checkout + confirm,
// peer delivery quote + consent), and that no Authorization header is ever
// sent to the peer origin (CDP request headers, not server logs — Pages has
// no per-request log we can read).
// Usage: node tests/verify-public.mjs <site-url> <peer-url>
//   e.g. node tests/verify-public.mjs https://booknook.pages.dev https://harbor-delivery.pages.dev
import { spawn } from "node:child_process";

const SITE_URL = (process.argv[2] || "").replace(/\/$/, "");
const PEER_URL = (process.argv[3] || "").replace(/\/$/, "");
if (!SITE_URL || !PEER_URL) {
  console.error("usage: node tests/verify-public.mjs <site-url> <peer-url>");
  process.exit(2);
}
const CDP_PORT = 9334;
const CHROME = process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, "--no-sandbox",
  "--disable-gpu", "--window-size=1280,900", "--user-data-dir=/tmp/booknook-verify-profile",
  "about:blank",
], { stdio: "ignore" });

let targets = null;
for (let i = 0; i < 30; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); break; }
  catch { await sleep(500); }
}
if (!targets) { console.error("CDP did not come up"); chrome.kill(); process.exit(2); }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
const peerRequests = []; // {url, hasAuth}
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("exception: " + JSON.stringify(msg.params.exceptionDetails).slice(0, 300));
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push("console.error: " + JSON.stringify(msg.params.args).slice(0, 300));
  if (msg.method === "Network.loadingFailed") failedRequests.push(msg.params.errorText + " " + (msg.params.type || ""));
  if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) failedRequests.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
  if (msg.method === "Network.requestWillBeSent" && msg.params.request.url.startsWith(PEER_URL)) {
    const headers = msg.params.request.headers || {};
    peerRequests.push({ url: msg.params.request.url, hasAuth: "authorization" in headers || "Authorization" in headers });
  }
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
async function waitFor(expression, timeoutMs = 30000, label = "") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await evalJs(expression)) return true; } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label || expression}`);
}
const dialogSeen = { confirm: false, consent: false };
async function settle(timeoutMs = 40000) {
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

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Page.navigate", { url: `${SITE_URL}/?peer=${PEER_URL}/delivery` });
await waitFor(`window.__booknook && window.__booknook.runtime && window.__booknook.runtime.manifest && !window.__booknook.runtime.busy`, 30000, "runtime boot");
await sleep(500);

check("public page loads without console errors", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 300));
check("no failed requests", failedRequests.length === 0, failedRequests.join(" | ").slice(0, 300));

// Spec artifacts on the public origins.
const artifacts = await evalJs(`(async () => {
  const mod = await import('./runtime.js');
  const out = {};
  for (const f of ['agent-manifest.json', 'booknook.network.json', 'links.json', '.well-known/agent-card.json']) {
    const r = await fetch(f); out[f] = { status: r.status, json: r.ok ? await r.json() : null };
  }
  out.manifestErrors = mod.validateManifest(out['agent-manifest.json'].json);
  out.networkErrors = mod.validateNetwork(out['booknook.network.json'].json, ['website_get_page_state','website_search_catalog','website_add_to_cart','website_remove_from_cart','website_set_cart','website_get_order_status','website_checkout_demo_order']);
  const peerM = await (await fetch('${PEER_URL}/agent-manifest.json')).json();
  const peerN = await (await fetch('${PEER_URL}/delivery.network.json')).json();
  out.peerManifestErrors = mod.validateManifest(peerM);
  out.peerNetworkErrors = mod.validateNetwork(peerN, []);
  out.linksDelivery = out['links.json'].json?.networks?.booknook_assistant?.delivery;
  return out;
})()`, true);
check("public site artifacts fetch 200", ["agent-manifest.json", "booknook.network.json", "links.json", ".well-known/agent-card.json"].every((f) => artifacts[f].status === 200));
check("public site manifest + network valid", artifacts.manifestErrors.length === 0 && artifacts.networkErrors.length === 0, [...artifacts.manifestErrors, ...artifacts.networkErrors].join("; "));
check("public peer manifest + network valid", artifacts.peerManifestErrors.length === 0 && artifacts.peerNetworkErrors.length === 0, [...artifacts.peerManifestErrors, ...artifacts.peerNetworkErrors].join("; "));
check("links.json points at the public peer", artifacts.linksDelivery === `${PEER_URL}/delivery`, String(artifacts.linksDelivery));

// Four scripted agent turns on the public site.
await evalJs(`window.__booknook.send("What fantasy books do you have?")`);
await settle();
let lastAgent = await evalJs(`[...document.querySelectorAll('#chat-log .chat-msg.agent')].pop()?.textContent || ''`);
check("turn 1 — fantasy search lists real catalog titles", /Glass Meridian/.test(lastAgent) && /Salt & Cinder/.test(lastAgent), lastAgent.slice(0, 160));

dialogSeen.confirm = false;
await evalJs(`window.__booknook.send("Add two copies of The Glass Meridian to my cart")`);
await settle();
const cart = await evalJs(`({ total: document.getElementById('cart-total-value').textContent, count: window.__booknook.state.cart.reduce((s,l)=>s+l.qty,0) })`);
check("turn 2 — cart holds 2x Glass Meridian, total $29.98", cart.total === "$29.98" && cart.count === 2, JSON.stringify(cart));
check("turn 2 — add-to-cart asked for confirmation (write)", dialogSeen.confirm === true);

dialogSeen.confirm = false;
await evalJs(`window.__booknook.send("Check out for pickup, name Ada")`);
await settle();
const order = await evalJs(`window.__booknook.state.orders[window.__booknook.state.orders.length-1]`);
check("turn 3 — checkout asked for confirmation first", dialogSeen.confirm === true);
check("turn 3 — order placed after confirm (BN-1001, pickup)", order && order.ref === "BN-1001" && order.fulfillment === "pickup", JSON.stringify(order));

dialogSeen.consent = false;
await evalJs(`window.__booknook.send("Arrange delivery for my order")`);
await settle();
lastAgent = await evalJs(`[...document.querySelectorAll('#chat-log .chat-msg.agent')].pop()?.textContent || ''`);
check("turn 4 — peer contact asked for consent first", dialogSeen.consent === true);
check("turn 4 — peer delivery quote returned in the chat", /Harbor Delivery/.test(lastAgent) && /\$\d+\.\d{2}/.test(lastAgent), lastAgent.slice(0, 220));

check("peer origin received requests", peerRequests.length > 0, `${peerRequests.length} requests`);
check("no Authorization header ever sent to the peer", peerRequests.length > 0 && peerRequests.every((e) => !e.hasAuth), `${peerRequests.length} peer requests checked`);

ws.close();
chrome.kill();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
