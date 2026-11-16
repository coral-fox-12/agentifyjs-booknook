// AgentifyJS v0.1.0 — turn any web page into an agent-readable page.
// Zero dependencies. Works as an ES module or a browser global (window.Agentify).
// Given a live DOM it builds a capability model (sections, forms, actions, links),
// converts it to OpenAI-style function schemas an agent can call, and keeps the
// model fresh as the page changes. It never invents capabilities: every tool it
// produces maps to a real element on the page.
(function (global) {
  "use strict";

  const VERSION = "0.1.0";
  const MAX_TEXT = 400;      // chars kept per section
  const MAX_ROWS = 50;       // table rows kept per table

  function textOf(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }
  function clamp(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function inputType(input) {
    const t = (input.type || "text").toLowerCase();
    if (t === "number" || t === "range") return "number";
    if (t === "checkbox") return "boolean";
    if (t === "date" || t === "email" || t === "url" || t === "tel") return "string";
    return "string";
  }
  function fieldSchema(input) {
    const schema = { type: inputType(input), description: labelFor(input) || input.name || input.id || "field" };
    if (input.tagName === "SELECT") {
      schema.enum = Array.from(input.options).map((o) => o.value).filter((v) => v !== "");
      if (schema.enum.length) schema.type = "string";
    }
    if (input.required) schema.required = true;
    return schema;
  }
  function labelFor(input) {
    if (input.id) {
      const lab = input.ownerDocument.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lab) return textOf(lab);
    }
    const wrap = input.closest("label");
    if (wrap) return textOf(wrap).replace(textOf(input), "").trim();
    return "";
  }

  // Describe one form element as a callable action.
  function describeForm(form) {
    const fields = {};
    const required = [];
    for (const el of form.querySelectorAll("input, select, textarea")) {
      if (!el.name || el.disabled) continue;
      fields[el.name] = fieldSchema(el);
      if (el.required) required.push(el.name);
    }
    const action = form.dataset.agentAction || form.id || "submit_form";
    return {
      kind: "form",
      name: action,
      description: form.dataset.agentDescription || `Submit the "${form.id || "page"}" form`,
      element: form,
      parameters: { type: "object", properties: fields, required },
    };
  }

  // Describe one button/action element as a callable action.
  function describeButton(btn) {
    const name = btn.dataset.agentAction;
    if (!name) return null;
    let params = {};
    try { params = btn.dataset.agentParams ? JSON.parse(btn.dataset.agentParams) : {}; } catch { params = {}; }
    const properties = {};
    for (const [k, v] of Object.entries(params)) {
      properties[k] = { type: typeof v === "number" ? "number" : "string", description: `Example value: ${JSON.stringify(v)}` };
    }
    return {
      kind: "button",
      name,
      description: btn.dataset.agentDescription || textOf(btn) || name,
      element: btn,
      parameters: { type: "object", properties, required: Object.keys(properties) },
      defaults: params,
    };
  }

  function describePage(doc, options = {}) {
    doc = doc || document;
    const root = options.root || doc.body;
    const model = {
      version: 1,
      generator: `AgentifyJS/${VERSION}`,
      url: doc.location ? doc.location.href : "",
      title: (doc.title || "").trim(),
      description: "",
      sections: [],
      forms: [],
      actions: [],
      links: [],
      tables: [],
    };
    const meta = doc.querySelector('meta[name="description"]');
    if (meta) model.description = meta.getAttribute("content") || "";

    // Sections: headings plus the text that follows them.
    for (const h of root.querySelectorAll("h1, h2, h3")) {
      let text = "";
      let node = h.nextElementSibling;
      while (node && !/^H[123]$/.test(node.tagName) && text.length < MAX_TEXT) {
        if (node.tagName !== "SCRIPT" && node.tagName !== "STYLE") text += " " + textOf(node);
        node = node.nextElementSibling;
      }
      model.sections.push({ heading: textOf(h), level: h.tagName, text: clamp(text.trim(), MAX_TEXT) });
    }

    // Forms and elements with data-agent-action. Only annotated forms become
    // actions; unannotated forms (chat, settings) are listed, not exposed.
    const seen = new Set();
    for (const form of root.querySelectorAll("form")) {
      const d = describeForm(form);
      model.forms.push({ name: d.name, parameters: d.parameters });
      if (form.dataset.agentAction && !seen.has(d.name)) { model.actions.push(d); seen.add(d.name); }
    }
    for (const btn of root.querySelectorAll("[data-agent-action]")) {
      if (btn.tagName === "FORM") continue;
      const d = describeButton(btn);
      if (!d) continue;
      if (seen.has(d.name)) continue; // one tool per action name (first occurrence wins)
      model.actions.push(d); seen.add(d.name);
    }

    // Navigation links.
    for (const a of root.querySelectorAll("nav a, header a")) {
      if (a.href) model.links.push({ text: textOf(a), href: a.getAttribute("href") });
    }

    // Tables, summarized.
    for (const t of root.querySelectorAll("table")) {
      const headers = Array.from(t.querySelectorAll("thead th")).map(textOf);
      const rows = Array.from(t.querySelectorAll("tbody tr")).slice(0, MAX_ROWS)
        .map((tr) => Array.from(tr.querySelectorAll("td")).map(textOf));
      model.tables.push({ headers, rows, totalRows: t.querySelectorAll("tbody tr").length });
    }
    return model;
  }

  // Convert a capability model to OpenAI-style function definitions.
  function toTools(model) {
    const tools = [];
    for (const a of model.actions) {
      tools.push({
        type: "function",
        function: {
          name: a.name,
          description: a.description,
          parameters: a.parameters,
        },
      });
    }
    // Generic readers every agentified page gets.
    tools.push({
      type: "function",
      function: {
        name: "website_read_section",
        description: "Read the text of one section of this page, by its heading.",
        parameters: { type: "object", properties: { heading: { type: "string", description: "Section heading, e.g. \"Catalog\"" } }, required: ["heading"] },
      },
    });
    return tools;
  }

  // Compact text grounding for a model: what the page is and what it can do.
  function summarizeForModel(model) {
    const lines = [`PAGE: ${model.title || "(untitled)"} — ${model.url}`];
    if (model.description) lines.push(`ABOUT: ${model.description}`);
    for (const s of model.sections) lines.push(`SECTION "${s.heading}": ${s.text}`);
    lines.push("ACTIONS AVAILABLE ON THIS PAGE:");
    for (const a of model.actions) {
      const props = Object.keys(a.parameters.properties || {}).join(", ");
      lines.push(`- ${a.name} (${a.kind}): ${a.description} [params: ${props || "none"}]`);
    }
    return lines.join("\n");
  }

  // Keep a live model: re-describe (debounced) whenever the DOM mutates.
  function observe(doc, callback, options = {}) {
    doc = doc || document;
    let timer = null;
    const run = () => { clearTimeout(timer); timer = setTimeout(() => callback(describePage(doc, options)), 150); };
    const mo = new MutationObserver(run);
    mo.observe(options.root || doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-agent-action", "data-agent-params"] });
    return () => { clearTimeout(timer); mo.disconnect(); };
  }

  const Agentify = { VERSION, describePage, toTools, summarizeForModel, observe };
  if (typeof module !== "undefined" && module.exports) module.exports = Agentify;
  global.Agentify = Agentify;
})(typeof window !== "undefined" ? window : globalThis);
