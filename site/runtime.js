// Book Nook browser runtime — a spec-conformant agent runtime.
// Implements the Minimum Viable Specification for a Worldwide Agentic Web
// (MVP 0.2): manifest + resolved network loading, validation, agent loop with
// tool calls and delegation, local site actions with schema validation and
// user confirmation for writes, peer-network loading with consent, pluggable
// inference (built-in demo model by default, BYOK OpenAI-compatible routers),
// bounded execution, fail-closed errors, and observable execution.
// No dependencies. The LLM key, when configured, is sent only to the selected
// router — never to this site, never to a peer site, never into logs.
import "./agentify.js";
import { mockChat } from "./mock-model.js";
import { SITE_ACTIONS, getStateSummary } from "./app.js";

const Agentify = window.Agentify;
const PROFILE_KEY = "booknook-model-profile";
const PEER_URL_KEY = "booknook-peer-url";

export const ACTION_SCHEMAS = {
  website_get_page_state: { type: "object", properties: {} },
  website_search_catalog: { type: "object", properties: {
    query: { type: "string", description: "Text to match against title, author, or genre" },
    genre: { type: "string", enum: ["", "fantasy", "sci-fi", "mystery", "history", "poetry", "children"] } } },
  website_add_to_cart: { type: "object", properties: {
    book_id: { type: "string" }, quantity: { type: "number" } }, required: ["book_id"] },
  website_remove_from_cart: { type: "object", properties: { book_id: { type: "string" } }, required: ["book_id"] },
  website_set_cart: { type: "object", properties: {
    items: { type: "array", items: { type: "object", properties: {
      book_id: { type: "string" }, quantity: { type: "number" } }, required: ["book_id", "quantity"] } } }, required: ["items"] },
  website_get_order_status: { type: "object", properties: {} },
  website_checkout_demo_order: { type: "object", properties: {
    name: { type: "string" },
    fulfillment: { type: "string", enum: ["pickup", "delivery"] },
    address: { type: "string" },
    delivery: { type: "object", properties: {
      ref: { type: "string" }, slot: { type: "string" }, address: { type: "string" },
      zone: { type: "string" }, fee: { type: "number" }, currency: { type: "string" } } } },
    required: ["name"] },
  call_peer_network: { type: "object", properties: {
    network_url: { type: "string" }, inquiry: { type: "string" } }, required: ["network_url", "inquiry"] },
};

// Minimal JSON Schema validator (types, required, enum, properties, items).
export function validateArgs(schema, value, path = "") {
  const errs = [];
  if (!schema || typeof schema !== "object") return errs;
  if (schema.type) {
    const t = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (t !== schema.type) errs.push(`${path || "value"}: expected ${schema.type}, got ${t}`);
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path || "value"}: not one of ${JSON.stringify(schema.enum)}`);
  if (schema.type === "object" && value && typeof value === "object") {
    for (const r of schema.required || []) if (!(r in value)) errs.push(`${path ? path + "." : ""}${r}: required but missing`);
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in value) errs.push(...validateArgs(sub, value[k], path ? `${path}.${k}` : k));
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errs.push(...validateArgs(schema.items, v, `${path}[${i}]`)));
  }
  return errs;
}

export function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== "object") return ["manifest is not a JSON object"];
  if (!Array.isArray(m.networks) || m.networks.length === 0) errs.push("manifest.networks must be a non-empty array");
  for (const n of m.networks || []) {
    if (!n.name) errs.push("a network is missing its name");
    if (!n.front_man) errs.push(`network "${n.name || "?"}": missing front_man`);
    if (!n.hocon) errs.push(`network "${n.name || "?"}": missing hocon (network definition location)`);
  }
  return errs;
}

export function validateNetwork(n, siteActionNames) {
  const errs = [];
  if (!n || typeof n !== "object") return ["network definition is not a JSON object"];
  if (!Array.isArray(n.tools) || n.tools.length === 0) return ["network.tools must be a non-empty array of agents"];
  const names = new Set();
  for (const a of n.tools) {
    if (!a.name) { errs.push("an agent is missing its name"); continue; }
    if (names.has(a.name)) errs.push(`duplicate agent name "${a.name}"`);
    names.add(a.name);
    if (!a.function || typeof a.function.description !== "string") errs.push(`agent "${a.name}": missing function.description`);
    if (!a.instructions || typeof a.instructions !== "string") errs.push(`agent "${a.name}": missing instructions`);
    if (!Array.isArray(a.tools)) errs.push(`agent "${a.name}": tools must be an array`);
  }
  const front = n.tools.find((a) => a.name === (n.front_agent || (n.metadata && n.metadata.front_agent)));
  if (!front && n.front_agent) errs.push(`front agent "${n.front_agent}" is not defined in tools`);
  const callable = new Set([...names, ...(siteActionNames || []), "call_peer_network"]);
  for (const a of n.tools) {
    for (const t of a.tools || []) {
      if (!callable.has(t)) errs.push(`agent "${a.name}": calls unknown tool/agent "${t}"`);
    }
  }
  return errs;
}

export class AgentRuntime {
  constructor({ mount, manifestUrl, siteActions, peerLinksUrl = "links.json" }) {
    this.mount = mount;
    this.manifestUrl = manifestUrl;
    this.peerLinksUrl = peerLinksUrl;
    this.siteActions = new Map(siteActions.map((a) => [a.name, a]));
    this.manifest = null;
    this.network = null;
    this.networkName = null;
    this.links = {};
    this.history = [];
    this.busy = false;
    this.autoConfirm = false; // test hook only
    this.consentedOrigins = new Set();
    this.profile = this.loadProfile();
    this.activityEl = document.getElementById("activity-list");
    this.statusEl = null;
  }

  loadProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") || { router: "mock" }; }
    catch { return { router: "mock" }; }
  }
  saveProfile(p) {
    this.profile = p;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    this.log("model", `Model profile saved: ${p.router}${p.model ? ` / ${p.model}` : " (demo model)"}. Key is stored only in this browser.`);
  }
  deleteProfile() {
    localStorage.removeItem(PROFILE_KEY);
    this.profile = { router: "mock" };
    this.log("model", "Saved model profile deleted. Back to the built-in demo model.");
  }

  log(kind, text) {
    const li = document.createElement("li");
    li.className = `kind-${kind}`;
    li.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    if (this.activityEl) { this.activityEl.appendChild(li); this.activityEl.scrollTop = this.activityEl.scrollHeight; }
    console.info(`[booknook:${kind}]`, text);
  }

  renderChat() {
    this.mount.innerHTML = `
      <div id="chat-log" class="chat" aria-live="polite"></div>
      <form id="chat-form" class="chat-form">
        <label for="chat-input" class="sr-only">Message the shop's agent</label>
        <input id="chat-input" type="text" placeholder="Ask about books, your cart, or an order&hellip;" autocomplete="off">
        <button type="submit">Send</button>
      </form>
      <p id="chat-status" class="chat-status" aria-live="polite"></p>`;
    this.chatLog = this.mount.querySelector("#chat-log");
    this.statusEl = this.mount.querySelector("#chat-status");
    this.mount.querySelector("#chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = this.mount.querySelector("#chat-input");
      const text = input.value.trim();
      if (!text || this.busy) return;
      input.value = "";
      this.chat(text);
    });
  }

  addMessage(role, text, kind = "") {
    const div = document.createElement("div");
    div.className = `chat-msg ${role} ${kind}`.trim();
    div.innerHTML = `<span class="role">${role === "user" ? "You" : role === "agent" ? this.networkName || "Agent" : "System"}</span>`;
    const body = document.createElement("div");
    body.textContent = text;
    div.appendChild(body);
    this.chatLog.appendChild(div);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  setStatus(text) { if (this.statusEl) this.statusEl.textContent = text; }

  async boot() {
    this.renderChat();
    this.addMessage("system", "Loading the shop's agent network…");
    try {
      const res = await fetch(this.manifestUrl);
      if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
      this.manifest = await res.json();
      const merrs = validateManifest(this.manifest);
      if (merrs.length) throw new Error(`invalid agent-manifest.json: ${merrs.join("; ")}`);
      const net = this.manifest.networks[0];
      this.networkName = net.name;
      const netRes = await fetch(new URL(net.hocon, new URL(this.manifestUrl, location.href)));
      if (!netRes.ok) throw new Error(`network definition fetch failed: HTTP ${netRes.status}`);
      this.network = await netRes.json();
      const nerrs = validateNetwork(this.network, [...this.siteActions.keys()]);
      if (nerrs.length) throw new Error(`invalid network definition: ${nerrs.join("; ")}`);
      try {
        const lres = await fetch(this.peerLinksUrl);
        if (lres.ok) this.links = await lres.json();
      } catch { this.links = {}; }
      // Cross-check: every site action must be discoverable on the live page.
      const model = Agentify.describePage(document);
      const discovered = new Set(model.actions.map((a) => a.name));
      for (const name of this.siteActions.keys()) {
        if (!discovered.has(name)) this.log("error", `AgentifyJS could not discover site action "${name}" on the page — check data-agent-action attributes.`);
      }
      this.log("model", `Network "${net.name}" loaded: ${this.network.tools.length} agents, front agent "${net.front_man}". ${model.actions.length} page actions discovered by AgentifyJS.`);
      this.chatLog.querySelector(".chat-msg.system").remove();
      this.addMessage("agent", `Hello — I am the Book Nook's agent. I can search the catalog, manage your cart, check out, and arrange delivery with Harbor Delivery Co. ` +
        `I run on the built-in demo model; add your own key under AI model settings to use a real LLM.`);
      this.setStatus(`Ready — network "${net.name}", model: ${this.profile.router === "mock" ? "demo model (built in)" : `${this.profile.router} / ${this.profile.model || "?"}`}.`);
    } catch (err) {
      this.log("error", `Failed to start the agent network: ${err.message}`);
      this.addMessage("system", `The agent network could not start: ${err.message}`);
      this.setStatus("Agent unavailable — see the error above.");
      throw err;
    }
  }

  // ---- model ----
  async modelCall(agent, messages, tools) {
    if (this.profile.router === "mock" || !this.profile.apiKey) {
      const context = agent.peerContext || getStateSummary();
      return mockChat({ messages, tools, context, agentName: agent.name });
    }
    const base = (this.profile.baseUrl || "").replace(/\/$/, "");
    const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.profile.apiKey}` },
      body: JSON.stringify({ model: this.profile.model, messages, tools, tool_choice: "auto", temperature: 0.2 }),
    });
    if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data;
  }

  groundingBlock(agent) {
    // A peer agent runs with the PEER's published data, not this site's state.
    if (agent.peerContext) {
      return `${agent.instructions}\n\nPUBLISHED PEER DATA (ground truth — use this, never invent prices, slots, or references):\n${JSON.stringify(agent.peerContext)}\n\nRULES: You run in the caller's browser on the caller's model. You have no access to the caller's site actions, cart, or keys. Answer only from the published data above. If the data does not establish an answer, say so.`;
    }
    const model = Agentify.describePage(document);
    const page = Agentify.summarizeForModel(model);
    const state = JSON.stringify(getStateSummary());
    return `${agent.instructions}\n\nLIVE PAGE STATE (ground truth — use this, never invent books, prices, stock, or orders):\n${state}\n\nPAGE CAPABILITIES (discovered from the live page by AgentifyJS):\n${page}\n\nRULES: Only call tools listed for you. Never invent a book, price, or order reference. Report a change only after the tool result confirms it. If the page does not establish an answer, say so.`;
  }

  toolsFor(agent) {
    const tools = [];
    for (const name of agent.tools || []) {
      const sub = this.network.tools.find((a) => a.name === name);
      if (sub) {
        tools.push({ type: "function", function: {
          name: sub.name,
          description: sub.function.description,
          parameters: sub.function.parameters || { type: "object", properties: { inquiry: { type: "string" }, mode: { type: "string" } }, required: ["inquiry"] },
        } });
        continue;
      }
      if (name === "call_peer_network") {
        tools.push({ type: "function", function: { name, description: "Call a named network on a peer agent site (requires user consent). Use the network_url from links.json.", parameters: ACTION_SCHEMAS.call_peer_network } });
        continue;
      }
      const action = this.siteActions.get(name);
      if (action) {
        tools.push({ type: "function", function: { name, description: action.description, parameters: ACTION_SCHEMAS[name] || { type: "object", properties: {} } } });
      }
    }
    return tools;
  }

  // ---- main loop ----
  async chat(userText) {
    if (this.busy) return;
    this.busy = true;
    this.addMessage("user", userText);
    this.setStatus("Agent is thinking…");
    const started = Date.now();
    const budget = { toolCalls: 0, maxToolCalls: 8, maxMs: 60000, depth: 0 };
    try {
      this.history.push({ role: "user", content: userText });
      const front = this.network.tools.find((a) => a.name === this.manifest.networks[0].front_man);
      const answer = await this.runAgent(front, userText, budget, started, new Set());
      this.addMessage("agent", answer);
      this.history.push({ role: "assistant", content: answer });
      this.history = this.history.slice(-12);
      this.setStatus("Ready.");
    } catch (err) {
      this.log("error", `Chat failed: ${err.message}`);
      this.addMessage("system", `Sorry — ${err.message}`);
      this.setStatus("Ready.");
    } finally {
      this.busy = false;
    }
  }

  async runAgent(agent, inquiry, budget, started, callStack) {
    const key = `${agent.name}:${inquiry.slice(0, 80)}`;
    if (callStack.has(key)) throw new Error(`composition cycle detected: "${agent.name}" was already asked the same thing in this turn. Stopping (fail closed).`);
    callStack.add(key);
    if (budget.depth >= 3) throw new Error("delegation depth limit reached (3). Stopping.");
    budget.depth += 1;
    const tools = this.toolsFor(agent);
    const messages = [
      { role: "system", content: this.groundingBlock(agent) },
      { role: "user", content: inquiry },
    ];
    for (let turn = 0; turn < 6; turn++) {
      if (Date.now() - started > budget.maxMs) throw new Error("execution time budget (60s) exceeded. Stopping.");
      this.log("model", `Model call → ${agent.name} (turn ${turn + 1})`);
      const data = await this.modelCall(agent, messages, tools);
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      if (!msg) throw new Error("router returned no message");
      messages.push(msg);
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return msg.content || "(no answer)";
      }
      for (const tc of msg.tool_calls) {
        budget.toolCalls += 1;
        if (budget.toolCalls > budget.maxToolCalls) throw new Error(`tool-call budget (8) exceeded. Stopping.`);
        const result = await this.dispatch(agent, tc, budget, started, callStack);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    throw new Error("agent turn limit reached without a final answer. Stopping.");
  }

  async dispatch(agent, tc, budget, started, callStack) {
    const name = tc.function.name;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); }
    catch { return { ok: false, error: `tool arguments for "${name}" are not valid JSON` }; }
    this.log("tool", `${agent.name} → ${name}(${JSON.stringify(args).slice(0, 200)})`);

    // Internal agent delegation.
    const sub = this.network.tools.find((a) => a.name === name);
    if (sub) {
      const answer = await this.runAgent(sub, args.inquiry || "", budget, started, new Set(callStack));
      return { ok: true, agent: name, answer };
    }
    // Peer network call.
    if (name === "call_peer_network") {
      return this.callPeer(args.network_url, args.inquiry, budget, started);
    }
    // Local site action.
    const action = this.siteActions.get(name);
    if (!action) return { ok: false, error: `unknown tool "${name}"` };
    const errs = validateArgs(ACTION_SCHEMAS[name] || { type: "object", properties: {} }, args);
    if (errs.length) return { ok: false, error: `invalid arguments for "${name}": ${errs.join("; ")}` };
    if (action.effect === "write") {
      const ok = await this.confirmWrite(name, args);
      if (!ok) {
        this.log("tool", `User declined "${name}" — not executed.`);
        return { ok: false, error: "The user declined to confirm this action, so it was not executed." };
      }
    }
    try {
      const result = await action.handler(args);
      this.log("tool", `Receipt: ${name} → ${JSON.stringify(result).slice(0, 200)}`);
      return result;
    } catch (err) {
      return { ok: false, error: `site action "${name}" failed: ${err.message}` };
    }
  }

  resolvePeerUrl(raw) {
    if (raw && raw !== "PEER_DELIVERY_URL") return raw;
    const param = new URLSearchParams(location.search).get("peer");
    if (param) return param;
    const stored = localStorage.getItem(PEER_URL_KEY);
    if (stored) return stored;
    const bound = this.links && this.links.networks && this.links.networks[this.networkName];
    if (bound && bound.delivery) return bound.delivery;
    throw new Error("no peer delivery URL configured (links.json, ?peer=, or saved setting)");
  }

  async callPeer(rawUrl, inquiry, budget, started) {
    let url;
    try { url = this.resolvePeerUrl(rawUrl); }
    catch (err) { return { ok: false, error: err.message }; }
    let parsed;
    try { parsed = new URL(url, location.href); }
    catch { return { ok: false, error: `peer URL "${url}" is not a valid URL` }; }
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: `peer URL must be http(s): "${url}"` };
    const origin = parsed.origin;
    const policy = (this.manifest && this.manifest.peer_policy) || {};
    const allowed = this.manifest.allowed_peers || [];
    if (policy.mode === "closed" && !allowed.includes(origin)) {
      this.log("error", `Peer origin ${origin} is not in allowed_peers — contact refused.`);
      return { ok: false, error: `Peer origin ${origin} is not allowed by this site's peer policy.` };
    }
    if ((policy.deny_origins || []).includes(origin)) {
      return { ok: false, error: `Peer origin ${origin} is explicitly denied.` };
    }
    if (!this.consentedOrigins.has(origin)) {
      const ok = await this.requestConsent(origin, `ask its delivery network about: "${String(inquiry).slice(0, 120)}"`);
      if (!ok) {
        this.log("consent", `User denied contact with ${origin}.`);
        return { ok: false, error: `You did not approve contact with ${origin}, so the peer was not contacted.` };
      }
      this.log("consent", `User approved contact with ${origin}.`);
    }
    // Resolve: <base>/<network> → fetch <base>/agent-manifest.json, exact name match.
    const parts = parsed.pathname.split("/").filter(Boolean);
    const netName = parts[parts.length - 1];
    const base = parsed.origin + (parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : "");
    try {
      const mres = await fetch(`${base}/agent-manifest.json`);
      if (!mres.ok) return { ok: false, error: `peer manifest fetch failed: HTTP ${mres.status}` };
      const m = await mres.json();
      const merrs = validateManifest(m);
      if (merrs.length) return { ok: false, error: `peer manifest invalid: ${merrs.join("; ")}` };
      const entry = m.networks.find((n) => n.name === netName);
      if (!entry) return { ok: false, error: `peer site has no network named "${netName}" (exact match required — refusing to pick another)` };
      const nres = await fetch(new URL(entry.hocon, `${base}/`));
      if (!nres.ok) return { ok: false, error: `peer network fetch failed: HTTP ${nres.status}` };
      const peerNet = await nres.json();
      const perrs = validateNetwork(peerNet, []);
      if (perrs.length) return { ok: false, error: `peer network invalid: ${perrs.join("; ")}` };
      const front = peerNet.tools.find((a) => a.name === entry.front_man);
      if (!front) return { ok: false, error: `peer front agent "${entry.front_man}" is not defined` };
      this.log("tool", `Loaded peer network "${netName}" from ${origin}; running its front agent locally in this browser.`);
      // Run the peer front agent locally with the CALLER's router. The peer
      // gets no site actions and no key: only its published instructions/data.
      const peerAgent = { ...front, peerContext: peerNet.data || {} };
      const savedNetwork = this.network;
      this.network = peerNet;
      try {
        const answer = await this.runAgent(peerAgent, inquiry, budget, started, new Set());
        const quote = extractJsonBlock(answer);
        if (quote && quote.quote) return { ok: true, peer: netName, origin, quote: quote.quote, answer };
        return { ok: true, peer: netName, origin, answer };
      } finally {
        this.network = savedNetwork;
      }
    } catch (err) {
      return { ok: false, error: `peer call failed: ${err.message}` };
    }
  }

  confirmWrite(tool, args) {
    if (this.autoConfirm) { this.log("tool", `auto-confirm (test mode): ${tool}`); return Promise.resolve(true); }
    return new Promise((resolve) => {
      const dlg = document.getElementById("confirm-dialog");
      document.getElementById("confirm-text").textContent =
        `The agent wants to run "${tool}" on this site. Review the arguments — nothing happens until you confirm.`;
      const dl = document.getElementById("confirm-args");
      dl.innerHTML = "";
      for (const [k, v] of Object.entries(args)) {
        if (v === undefined) continue; // e.g. no address on a pickup order
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = JSON.stringify(v);
        dl.append(dt, dd);
      }
      const onClose = () => {
        dlg.removeEventListener("close", onClose);
        resolve(dlg.returnValue === "yes");
      };
      dlg.addEventListener("close", onClose);
      dlg.showModal();
    });
  }

  requestConsent(origin, purpose) {
    return new Promise((resolve) => {
      const dlg = document.getElementById("consent-dialog");
      document.getElementById("consent-text").textContent =
        `The agent wants to contact ${origin} to ${purpose}. The peer network will run in your browser on your model — your key is never sent to the peer.`;
      const remember = document.getElementById("consent-remember");
      remember.checked = false;
      const onClose = () => {
        dlg.removeEventListener("close", onClose);
        if (dlg.returnValue === "yes") {
          if (remember.checked) this.consentedOrigins.add(origin);
          resolve(true);
        } else resolve(false);
      };
      dlg.addEventListener("close", onClose);
      dlg.showModal();
    });
  }
}

export function extractJsonBlock(text) {
  const m = String(text || "").match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
