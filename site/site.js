// The Book Nook — page wiring. Renders the shop, wires the forms, and boots
// the agent runtime. No build step, no dependencies.
import { state, renderCatalog, renderCart, renderOrders, setCart } from "./app.js";
import { SITE_ACTIONS } from "./app.js";
import { AgentRuntime } from "./runtime.js";

renderCatalog();
renderCart();
renderOrders();

// Search + genre filter (the form is also an Agentify-discovered action).
const searchForm = document.getElementById("search-form");
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  state.filter.query = document.getElementById("search-input").value;
  state.filter.genre = document.getElementById("genre-select").value;
  renderCatalog();
});
document.getElementById("genre-select").addEventListener("change", () => {
  state.filter.genre = document.getElementById("genre-select").value;
  renderCatalog();
});

// Clear-cart button (manual path; the agent path uses the same handler).
document.getElementById("clear-cart").addEventListener("click", () => setCart([]));

// Checkout form (manual path; the agent path uses the same handler).
const checkoutForm = document.getElementById("checkout-form");
const fulfillmentSel = document.getElementById("fulfillment");
fulfillmentSel.addEventListener("change", () => {
  const isDelivery = fulfillmentSel.value === "delivery";
  document.getElementById("address-label").hidden = !isDelivery;
  document.getElementById("delivery-address").required = isDelivery;
});
checkoutForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("customer-name").value;
  const fulfillment = fulfillmentSel.value;
  const address = document.getElementById("delivery-address").value;
  let delivery;
  if (fulfillment === "delivery") {
    // Manual checkout with delivery still goes through the peer for a quote —
    // the runtime asks for consent first, exactly like the agent path. Without
    // a quote there is no fee and no slot, so the order must not be placed.
    window.__booknook.status("Getting a delivery quote from Harbor Delivery Co.…");
    const quote = await window.__booknook.runtime.callPeer("PEER_DELIVERY_URL",
      `Quote delivery to ${address} for ${window.__booknook.state.cart.reduce((s, l) => s + l.qty, 0)} books.`,
      { toolCalls: 0, maxToolCalls: 8, maxMs: 60000, depth: 0 }, Date.now());
    if (!quote.ok || !quote.quote) {
      window.__booknook.status(quote.error || "Could not get a delivery quote — the order was not placed.");
      return;
    }
    delivery = quote.quote;
    window.__booknook.status(`Delivery quote: $${delivery.fee.toFixed(2)} (${delivery.zone}), slot ${delivery.slot}. Review and confirm below.`);
  }
  const ok = await window.__booknook.runtime.confirmWrite("website_checkout_demo_order",
    { name, fulfillment, address: address || undefined, delivery });
  if (!ok) return;
  const handler = SITE_ACTIONS.find((a) => a.name === "website_checkout_demo_order").handler;
  const result = handler({ name, fulfillment, address, delivery });
  if (result.ok) {
    // No alert(): a modal JS alert blocks the page (and any automation) until
    // dismissed — report the outcome in the status line instead.
    window.__booknook.status(`Demo order ${result.ref} placed. Total ${result.total}. No payment was taken.`);
    checkoutForm.reset();
    document.getElementById("address-label").hidden = true;
  } else {
    window.__booknook.status(`Checkout failed: ${result.error}`);
  }
});

// Sample queries fill the chat box.
document.querySelectorAll(".sample-query").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById("chat-input");
    if (!input) return;
    input.value = btn.textContent;
    input.focus();
    document.getElementById("chat-form").dispatchEvent(new Event("submit", { cancelable: true }));
  });
});

// Model settings (BYOK). Key lives only in this browser's localStorage.
const settingsForm = document.getElementById("settings-form");
const routerSelect = document.getElementById("router-select");
const ROUTER_DEFAULTS = {
  mock: { baseUrl: "", model: "" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
};
routerSelect.addEventListener("change", () => {
  const d = ROUTER_DEFAULTS[routerSelect.value] || {};
  document.getElementById("router-url").value = d.baseUrl || "";
  document.getElementById("router-model").value = d.model || "";
});
settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const router = routerSelect.value;
  const profile = {
    router,
    baseUrl: document.getElementById("router-url").value.trim(),
    model: document.getElementById("router-model").value.trim(),
    apiKey: document.getElementById("router-key").value.trim(),
  };
  if (router !== "mock" && !profile.apiKey) {
    document.getElementById("settings-status").textContent = "Add an API key for BYOK, or choose the demo model.";
    return;
  }
  if (router !== "mock" && !profile.baseUrl) {
    document.getElementById("settings-status").textContent = "Add the router base URL.";
    return;
  }
  window.__booknook.runtime.saveProfile(profile);
  document.getElementById("settings-status").textContent =
    router === "mock" ? "Demo model active — no key, no network calls." : `Saved. Now using ${router} / ${profile.model}. Key stored only in this browser.`;
  document.getElementById("router-key").value = "";
});
document.getElementById("settings-delete").addEventListener("click", () => {
  window.__booknook.runtime.deleteProfile();
  routerSelect.value = "mock";
  document.getElementById("router-url").value = "";
  document.getElementById("router-model").value = "";
  document.getElementById("router-key").value = "";
  document.getElementById("settings-status").textContent = "Saved key deleted. Demo model active.";
});

// Boot the agent runtime.
const runtime = new AgentRuntime({
  mount: document.getElementById("agent-mount"),
  manifestUrl: "agent-manifest.json",
  siteActions: SITE_ACTIONS,
});
runtime.boot().catch((err) => console.error("agent boot failed", err));

// Test hooks (used by tests/probe.mjs; harmless in production).
window.__booknook = {
  runtime,
  state,
  status: (t) => runtime.setStatus(t),
  send: (text) => runtime.chat(text),
  waitIdle: () => new Promise((resolve) => {
    const tick = () => { if (!runtime.busy) resolve(); else setTimeout(tick, 100); };
    tick();
  }),
};
