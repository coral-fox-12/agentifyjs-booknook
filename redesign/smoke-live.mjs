// Live smoke test for the redesigned Book Nook.
// Like tests/probe.mjs but against the PUBLIC Surge URL, routing headless
// Chromium through the local forward proxy (this VM's egress needs it).
// Usage: node redesign/smoke-live.mjs [site-url]
import { spawn } from "node:child_process";

const SITE = (process.argv[2] || "https://booknook-agentic.surge.sh").replace(/\/$/, "");
const CDP_PORT = 9335;
const CHROME = process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, "--no-sandbox", "--disable-gpu",
  "--proxy-server=http://127.0.0.1:18080",
  "--window-size=1280,900", "--user-data-dir=/home/hatch/tmp/bn-live-profile",
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
const externalRequests = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("exception: " + JSON.stringify(msg.params.exceptionDetails).slice(0, 200));
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push("console.error: " + JSON.stringify(msg.params.args).slice(0, 200));
  if (msg.method === "Network.loadingFailed") failedRequests.push(msg.params.errorText);
  if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) failedRequests.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
  if (msg.method === "Network.requestWillBeSent") {
    const u = msg.params.request.url;
    if (!u.startsWith(SITE) && !u.startsWith("data:") && !u.startsWith("blob:")) externalRequests.push(u);
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
  if (r.result?.exceptionDetails) throw new Error("evaluate failed: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
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

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Page.navigate", { url: SITE + "/" });
await waitFor(`window.__booknook && window.__booknook.runtime && window.__booknook.runtime.manifest && !window.__booknook.runtime.busy`, 30000, "runtime boot");
await sleep(800);

check("live page loads without console errors", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 300));
check("no failed requests", failedRequests.length === 0, failedRequests.join(" | ").slice(0, 300));
check("zero external requests (fonts self-hosted)", externalRequests.length === 0, externalRequests.join(", ").slice(0, 300));

const fonts = await evalJs(`[...document.fonts].map(f => f.family + ' ' + f.status).join(', ')`);
check("Fraunces + IBM Plex Mono loaded", /Fraunces loaded/.test(fonts) && /IBM Plex Mono loaded/.test(fonts), fonts);

const bookCount = await evalJs(`document.querySelectorAll('#book-grid .book').length`);
check("12 books render", bookCount === 12, `${bookCount} books`);

const accent = await evalJs(`getComputedStyle(document.querySelector('.kicker')).color`);
const noBlue = await evalJs(`!document.documentElement.outerHTML.includes('#0000ff') && ![...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.cssText.includes('#0000ff')); } catch { return false; } })`);
check("oxblood accent present, no #0000ff anywhere", accent === "rgb(125, 42, 30)" && noBlue, `kicker color ${accent}`);

// Search filter: fantasy -> 3 books.
await evalJs(`document.getElementById('search-input').value = 'fantasy'; document.getElementById('search-form').dispatchEvent(new Event('submit', { cancelable: true }));`);
await sleep(400);
const fantasyCount = await evalJs(`document.querySelectorAll('#book-grid .book').length`);
check("search 'fantasy' shows 3 books", fantasyCount === 3, `${fantasyCount} books`);
await evalJs(`document.getElementById('search-input').value = ''; document.getElementById('search-form').dispatchEvent(new Event('submit', { cancelable: true }));`);
await sleep(400);

// Add to cart via the visible button.
await evalJs(`document.querySelector('#book-grid .book button').click()`);
await sleep(400);
const cart = await evalJs(`({ lines: document.querySelectorAll('#cart-contents table tbody tr, #cart-contents table tr').length, total: document.getElementById('cart-total-value').textContent })`);
check("Add to cart adds a line + total", cart.total === "$14.99", JSON.stringify(cart));

// Agent chat turn (demo model).
await evalJs(`window.__booknook.send("What fantasy books do you have?")`);
const start = Date.now();
while (Date.now() - start < 30000) {
  const st = await evalJs(`(() => {
    const c = document.getElementById('confirm-dialog');
    if (c.open) { document.getElementById('confirm-yes').click(); return 'confirm'; }
    return window.__booknook.runtime.busy ? 'busy' : 'idle';
  })()`);
  if (st === "idle") break;
  await sleep(200);
}
const lastAgent = await evalJs(`[...document.querySelectorAll('#chat-log .chat-msg.agent')].pop()?.textContent || ''`);
check("agent turn lists real fantasy titles", /Glass Meridian/.test(lastAgent) && /Salt & Cinder/.test(lastAgent), lastAgent.slice(0, 140));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} live checks passed.`);
chrome.kill();
process.exit(failed ? 1 : 0);
