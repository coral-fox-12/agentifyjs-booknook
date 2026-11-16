// Demo model — a deterministic, local stand-in for a real LLM.
// Implements the same OpenAI chat-completions shape the runtime uses for BYOK
// routers, so the agent network runs end-to-end with no key and no network.
// It is rule-based and grounded: it only ever answers from the live page state
// (catalog, cart, orders) or the peer network's published price table that the
// runtime passes in as context. It never invents books, prices, or order refs.
export function mockChat({ messages, tools, context, agentName }) {
  const toolNames = new Set((tools || []).map((t) => t.function.name));
  const has = (n) => toolNames.has(n);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const inquiry = (lastUser && lastUser.content) || "";
  const lower = inquiry.toLowerCase();
  const toolResults = messages.filter((m) => m.role === "tool");

  const call = (name, args) => ({
    id: `call_${Math.random().toString(36).slice(2, 10)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });
  const reply = (content, tool_calls) => ({
    id: `mock_${Date.now()}`,
    choices: [{ message: { role: "assistant", content: content || null, tool_calls: tool_calls || null }, finish_reason: tool_calls ? "tool_calls" : "stop" }],
    model: "booknook-demo-model",
  });
  const delegate = (agent, mode = "Fulfill") => reply(null, [call(agent, { inquiry, mode })]);

  // ---- helpers over the grounded context ----
  const catalog = (context && context.catalog) || [];
  const matchTitle = (text) => {
    const t = String(text || "").toLowerCase();
    let best = null;
    for (const b of catalog) {
      const title = b.title.toLowerCase();
      if (title === t) return b;
      if (t.includes(title) || title.includes(t)) best = best || b;
    }
    return best;
  };
  const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const qtyOf = (text) => {
    const m = String(text).match(/(\d+)\s*(copies|copy|×|x)?/);
    if (m) return Math.max(1, parseInt(m[1], 10));
    const w = String(text).toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    return w ? WORD_NUMBERS[w[1]] : 1;
  };
  const nameOf = (text) => {
    let m = String(text).match(/name (?:is )?([A-Z][a-z]+(?: [A-Z][a-z]+)?)/)
      || String(text).match(/(?:^|[,;])\s*(?:for|i'?m)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/);
    return m ? m[1] : null;
  };
  const addressOf = (text) => {
    const m = String(text).match(/address[: ]+([^,.;]+)/i) || String(text).match(/deliver(?:y)? to ([^,.;]+)/i);
    return m ? m[1].trim() : null;
  };
  const peerQuoteFromHistory = () => {
    for (const tr of [...toolResults].reverse()) {
      try {
        const d = JSON.parse(tr.content);
        if (d && d.ok && d.quote) return d.quote;
      } catch { /* not JSON — ignore */ }
    }
    return null;
  };

  // ---- peer-network turn (Harbor Delivery): quote/book from its price table ----
  if (context && context.peer === "harbor-delivery") {
    const zones = context.zones || [];
    const slots = context.slots || [];
    const zoneFor = (addr) => {
      const a = String(addr || "").toLowerCase();
      if (/old town|harbor|pier|dock/.test(a)) return zones[0] || { name: "Local", fee: 2 };
      if (/north|university|hill/.test(a)) return zones[1] || { name: "City", fee: 5 };
      return zones[2] || { name: "Outskirts", fee: 9 };
    };
    if (/book|reserve|schedule/.test(lower)) {
      const addr = addressOf(inquiry) || "Old Town";
      const zone = zoneFor(addr);
      const slot = slots[0] || "today 18:00";
      const ref = `DLV-${String(Math.abs(hash(inquiry + slot)) % 9000 + 1000)}`;
      return reply(`Booked. Delivery ${ref} is scheduled for ${slot} to ${addr} (${zone.name} zone, $${zone.fee.toFixed(2)}). ` +
        `The courier will text on arrival.\n\n\`\`\`json\n${JSON.stringify({ quote: { ref, slot, address: addr, zone: zone.name, fee: zone.fee, currency: "USD" } } )}\n\`\`\``);
    }
    const addr = addressOf(inquiry) || "Old Town";
    const zone = zoneFor(addr);
    const nBooks = qtyOf(inquiry) || 1;
    const fee = +(zone.fee + Math.max(0, nBooks - 3) * 0.5).toFixed(2);
    const slot = slots[0] || "today 18:00";
    return reply(`Delivery quote for ${addr}: ${zone.name} zone, $${fee.toFixed(2)}. Earliest slot ${slot}. ` +
      `Ask me to book it and I will hold the slot.\n\n\`\`\`json\n${JSON.stringify({ quote: { slot, address: addr, zone: zone.name, fee, currency: "USD" } })}\n\`\`\``);
  }

  // ---- after a tool result: compose the final answer (or continue a chain) ----
  if (toolResults.length > 0) {
    const last = toolResults[toolResults.length - 1];
    let data = null;
    try { data = JSON.parse(last.content); } catch { /* plain text */ }
    const isPeerQuote = data && data.ok && data.quote;
    // Chain: a delivery quote came back and the user wanted delivery checkout.
    if (isPeerQuote && /check\s*out|place|order|buy/.test(lower) && /deliver/.test(lower) && has("website_checkout_demo_order")) {
      const name = nameOf(inquiry) || "Ada";
      const address = addressOf(inquiry) || data.quote.address;
      return reply(null, [call("website_checkout_demo_order", { name, fulfillment: "delivery", address, delivery: data.quote })]);
    }
    if (isPeerQuote) {
      return reply(`Harbor Delivery quoted $${data.quote.fee.toFixed(2)} for ${data.quote.zone} delivery to ${data.quote.address}, earliest slot ${data.quote.slot}. ` +
        `Say "book it" and I will hold that slot, or ask me to check out with delivery.`);
    }
    // Delegation result: a specialist (or peer) agent answered — pass it on.
    if (data && data.ok && typeof data.answer === "string") {
      return reply(data.answer);
    }
    if (data && data.ok === false) return reply(`That did not work: ${data.error} Can I help another way?`);
    if (data && data.ok && data.ref) {
      return reply(`Done — your demo order ${data.ref} is placed (${data.status}). Total ${data.total}. ` +
        `No payment was taken; this is a demo order. Would you like the delivery arranged as well?`);
    }
    if (data && data.ok && data.matches) {
      if (data.matches.length === 0) return reply("I could not find a book matching that. Try a different title, author, or genre — we carry fantasy, science fiction, mystery, history, poetry, and children's books.");
      const lines = data.matches.map((b) => `• ${b.title} by ${b.author} — ${b.genre}, $${b.price.toFixed(2)} (${b.stock} in stock)`);
      return reply(`Here is what I found:\n${lines.join("\n")}\nWant me to add any of these to your cart?`);
    }
    if (data && data.ok && data.state) {
      return reply(summarizeState(data.state, inquiry));
    }
    if (data && data.ok && typeof data.cart_total !== "undefined") {
      return reply(`Cart updated — ${data.cart_count} item(s), total ${data.cart_total}. Anything else?`);
    }
    if (data && data.ok && data.order) {
      const o = data.order;
      return reply(o ? `Your latest demo order is ${o.ref}: ${o.status}. Total ${o.total || ""}.` : "You have no demo orders yet.");
    }
    if (data && data.ok) return reply("Done.");
    return reply(typeof last.content === "string" ? last.content : "Done.");
  }

  // ---- front agent: route to a specialist ----
  if (agentName === "front_desk_coordinator") {
    if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(lower.trim())) {
      return reply("Hello! I can search the catalog, add books to your cart, check out, and arrange delivery. What are you looking for today?");
    }
    if (/deliver|delivery/.test(lower) && has("delivery_tracking_specialist")) return delegate("delivery_tracking_specialist");
    if (/check\s*out|place (an? )?order|buy|purchase|pay/.test(lower) && has("ordering_checkout_specialist")) return delegate("ordering_checkout_specialist");
    if (/add|cart|remove|order status|status of/.test(lower) && has("ordering_checkout_specialist")) return delegate("ordering_checkout_specialist");
    if (has("catalog_specialist")) return delegate("catalog_specialist");
    return reply("I can help with the catalog, your cart, checkout, and delivery. What would you like?");
  }

  // ---- catalog specialist: answer from the live catalog ----
  if (agentName === "catalog_specialist") {
    if (has("website_search_catalog")) {
      const genre = ["fantasy", "sci-fi", "science fiction", "mystery", "history", "poetry", "children"].find((g) => lower.includes(g));
      const query = genre === "science fiction" ? "sci-fi" : (genre || "");
      const words = lower.replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3 && !["what", "which", "books", "have", "there", "about", "show", "list", "find", "search"].includes(w));
      return reply(null, [call("website_search_catalog", { query: query || words.join(" "), genre: genre === "science fiction" ? "sci-fi" : (genre || "") })]);
    }
    return reply(summarizeState({ catalog, cart: [], cart_total: "$0.00", latest_order: null }, inquiry));
  }

  // ---- ordering specialist: cart + checkout ----
  if (agentName === "ordering_checkout_specialist") {
    if (/status|where.*order|track/.test(lower) && has("website_get_order_status")) {
      return reply(null, [call("website_get_order_status", {})]);
    }
    if (/check\s*out|place (an? )?order|buy|purchase/.test(lower)) {
      const fulfillment = /deliver/.test(lower) ? "delivery" : "pickup";
      const name = nameOf(inquiry);
      if (!name) return reply("I can check you out — what name should the demo order be under?");
      if (fulfillment === "delivery") {
        const address = addressOf(inquiry);
        if (!address) return reply("For delivery I need an address. Where should Harbor Delivery bring the books?");
        const quote = peerQuoteFromHistory();
        if (!quote) {
          if (has("call_peer_network")) return reply(null, [call("call_peer_network", { network_url: "PEER_DELIVERY_URL", inquiry: `Quote delivery to ${address} for ${qtyOf(inquiry)} books.` })]);
          return reply(null, [call("website_checkout_demo_order", { name, fulfillment, address })]);
        }
        return reply(null, [call("website_checkout_demo_order", { name, fulfillment, address, delivery: quote })]);
      }
      return reply(null, [call("website_checkout_demo_order", { name, fulfillment })]);
    }
    if (/remove|take .* out|delete/.test(lower) && has("website_remove_from_cart")) {
      const b = matchTitle(inquiry);
      if (!b) return reply("Which book should I remove from the cart?");
      return reply(null, [call("website_remove_from_cart", { book_id: b.id })]);
    }
    if (/add|put/.test(lower) && has("website_add_to_cart")) {
      const b = matchTitle(inquiry);
      if (!b) return reply("I could not match that to a book in the catalog. Which title did you mean?");
      return reply(null, [call("website_add_to_cart", { book_id: b.id, quantity: qtyOf(inquiry) })]);
    }
    if (/cart|what.*in.*cart/.test(lower) && has("website_get_page_state")) {
      return reply(null, [call("website_get_page_state", {})]);
    }
    return reply("I can add books to your cart, remove them, check the cart, or check out. What would you like?");
  }

  // ---- delivery specialist: quotes and bookings via the peer network ----
  if (agentName === "delivery_tracking_specialist") {
    if (/status|where.*order|track/.test(lower) && has("website_get_order_status")) {
      return reply(null, [call("website_get_order_status", {})]);
    }
    if (has("call_peer_network")) {
      return reply(null, [call("call_peer_network", { network_url: "PEER_DELIVERY_URL", inquiry })]);
    }
    return reply("Delivery is handled by our partner, Harbor Delivery Co. — ask me to arrange delivery and I will get a quote.");
  }

  // Fallback: answer from grounded state.
  return reply(summarizeState(context || {}, inquiry));
}

function summarizeState(s, inquiry) {
  const catalog = s.catalog || [];
  const lower = String(inquiry || "").toLowerCase();
  if (catalog.length && /fantasy|sci-fi|science|mystery|history|poetry|children/.test(lower)) {
    const genre = /science/.test(lower) ? "sci-fi" : lower.match(/fantasy|mystery|history|poetry|children|sci-fi/)?.[0];
    const list = catalog.filter((b) => !genre || b.genre === genre);
    if (!list.length) return "We have no books in that genre right now.";
    return `Our ${genre} books:\n` + list.map((b) => `• ${b.title} by ${b.author} — $${b.price.toFixed(2)} (${b.stock} in stock)`).join("\n");
  }
  if (s.cart && s.cart.length) {
    return `Your cart has ${s.cart.map((l) => `${l.qty} × ${l.title}`).join(", ")} — total ${s.cart_total}.`;
  }
  return "The Book Nook carries fantasy, science fiction, mystery, history, poetry, and children's books. " +
    "Ask me to search the catalog, add a book to your cart, or check out.";
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
