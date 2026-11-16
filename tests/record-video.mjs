// Records the Book Nook demo video (browser footage, mock model, no key).
// Follows docs/VIDEO-SCRIPT.md shot list. Usage: node tests/record-video.mjs
// Output: tests/video/*.webm — convert to mp4 afterwards with ffmpeg.
import { chromium } from "/tmp/shot/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_PORT = 8471, PEER_PORT = 8472;
const CHROME = process.env.HOME + "/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
const VIDEO_DIR = path.join(ROOT, "tests", "video");
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function startServer(port, dir) {
  return spawn(process.execPath, ["serve.mjs", String(port), dir], { cwd: ROOT, stdio: "ignore" });
}
const siteSrv = startServer(SITE_PORT, "site");
const peerSrv = startServer(PEER_PORT, "peer");
await sleep(1000);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
const failedReqs = [];
page.on("requestfailed", (r) => failedReqs.push(r.url() + " " + (r.failure()?.errorText || "")));

const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

// Click a sample query, hold any confirm/consent dialog on screen, confirm it,
// then wait for the agent's reply matching `replyRe`. `dialog` is "confirm",
// "consent", or null.
async function runTurn(queryText, replyRe, dialog = null, pauseAfter = 4000) {
  const before = await page.locator("#chat-log .chat-msg.agent").count();
  await page.locator("#agent").scrollIntoViewIfNeeded();
  await sleep(600);
  await page.locator(".sample-query", { hasText: queryText }).click();
  log(elapsed(), "asked:", queryText);
  let dialogHandled = false;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(({ before, src, flags }) => {
      const msgs = [...document.querySelectorAll("#chat-log .chat-msg.agent")];
      const last = msgs.length > before ? (msgs[msgs.length - 1].textContent || "") : "";
      return {
        replied: msgs.length > before && new RegExp(src, flags).test(last),
        confirmOpen: document.getElementById("confirm-dialog")?.open || false,
        consentOpen: document.getElementById("consent-dialog")?.open || false,
        busy: window.__booknook?.runtime?.busy || false,
      };
    }, { before, src: replyRe.source, flags: replyRe.flags });
    if (state.replied) break;
    if (dialog === "confirm" && state.confirmOpen && !dialogHandled) {
      log(elapsed(), "confirm dialog open — holding on screen");
      await sleep(3000);
      await page.locator("#confirm-yes").click();
      log(elapsed(), "confirmed");
      dialogHandled = true;
    } else if (dialog === "consent" && state.consentOpen && !dialogHandled) {
      log(elapsed(), "consent dialog open — holding on screen");
      await sleep(3500);
      await page.locator("#consent-yes").click();
      log(elapsed(), "allowed peer contact");
      dialogHandled = true;
    }
    await sleep(250);
  }
  const ok = await page.evaluate(({ before, src, flags }) => {
    const msgs = [...document.querySelectorAll("#chat-log .chat-msg.agent")];
    return msgs.length > before && new RegExp(src, flags).test(msgs[msgs.length - 1].textContent || "");
  }, { before, src: replyRe.source, flags: replyRe.flags });
  if (!ok) throw new Error(`turn failed, no reply matching ${replyRe} for: ${queryText}`);
  log(elapsed(), "reply received for:", queryText);
  await sleep(pauseAfter);
}

// --- Shot 0: homepage ---
await page.goto(`http://127.0.0.1:${SITE_PORT}/?peer=http://127.0.0.1:${PEER_PORT}/delivery`);
await page.waitForFunction(
  () => window.__booknook && window.__booknook.runtime && window.__booknook.runtime.manifest && !window.__booknook.runtime.busy,
  { timeout: 20000 }
);
log(elapsed(), "shop loaded, runtime booted");
await sleep(2500);

// --- Shot 1 (0:12-0:30): scroll the catalog, add a book to the cart by hand ---
await page.locator("#catalog").scrollIntoViewIfNeeded();
await sleep(1200);
await page.mouse.wheel(0, 500);
await sleep(1500);
const addBtn = page.locator("#book-grid button", { hasText: "Add to cart" }).first();
await addBtn.scrollIntoViewIfNeeded();
await sleep(800);
await addBtn.click();
log(elapsed(), "clicked Add to cart on a book");
await page.locator("#cart").scrollIntoViewIfNeeded();
await sleep(2500);

// --- Shot 2 (0:30-0:55): fantasy search + agent add to cart (confirm dialog) ---
await runTurn("What fantasy books do you have?", /Glass Meridian/);
await runTurn("Add two copies of The Glass Meridian to my cart", /cart|added/i, "confirm");

// --- Shot 3 (0:55-1:15): checkout (confirm dialog) -> order BN-1001 ---
await runTurn("Check out for pickup, name Ada", /BN-1001/, "confirm");
await page.locator("#orders").scrollIntoViewIfNeeded();
await sleep(3000);

// --- Shot 4 (1:15-1:40): delivery via the peer site (consent dialog) ---
await runTurn("Arrange delivery for my order", /Harbor Delivery.*\$\d+\.\d{2}/, "consent", 4500);

// --- Shot 5: the peer site + its agent manifest ---
await page.goto(`http://127.0.0.1:${PEER_PORT}/`);
await sleep(3500);
await page.goto(`http://127.0.0.1:${PEER_PORT}/agent-manifest.json`);
await sleep(3500);

// --- Shot 6 (1:40-1:45): model settings + activity log on the shop ---
await page.goto(`http://127.0.0.1:${SITE_PORT}/?peer=http://127.0.0.1:${PEER_PORT}/delivery`);
await page.waitForFunction(
  () => window.__booknook && window.__booknook.runtime && window.__booknook.runtime.manifest && !window.__booknook.runtime.busy,
  { timeout: 20000 }
);
await sleep(1500);
await page.locator("#model-settings").scrollIntoViewIfNeeded();
await page.locator("#model-settings > summary").click().catch(() => {});
await sleep(3000);
await page.locator("#activity-log").scrollIntoViewIfNeeded();
await sleep(3500);

log(elapsed(), "recording done. console errors:", JSON.stringify(consoleErrors));
log(elapsed(), "failed requests:", JSON.stringify(failedReqs));
const videoPath = await page.video().path();
await context.close();
await browser.close();
siteSrv.kill();
peerSrv.kill();
console.log("VIDEO_SAVED", videoPath);
console.log("DURATION_S", ((Date.now() - t0) / 1000).toFixed(1));
console.log("CONSOLE_ERRORS", consoleErrors.length);
console.log("FAILED_REQUESTS", failedReqs.length);
