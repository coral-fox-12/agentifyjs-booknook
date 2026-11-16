// The Book Nook — store logic (no dependencies, no server).
// Owns the catalog, cart and demo orders, and exposes the site actions that
// AgentifyJS discovers from the page and the runtime dispatches as tools.
export const CATALOG = [
  { id: "glass-meridian", title: "The Glass Meridian", author: "A. Reyes", genre: "fantasy", price: 14.99, stock: 8, blurb: "A cartographer maps a city that rearranges itself every dawn." },
  { id: "salt-cinder", title: "Salt & Cinder", author: "M. Okafor", genre: "fantasy", price: 12.50, stock: 5, blurb: "A salt-miner inherits a phoenix and a debt to the mountain." },
  { id: "cartographers-daughter", title: "The Cartographer's Daughter", author: "L. Nguyen", genre: "fantasy", price: 16.00, stock: 3, blurb: "She follows her mother's unfinished map past the edge of the known world." },
  { id: "orbital-harvest", title: "Orbital Harvest", author: "J. Park", genre: "sci-fi", price: 15.99, stock: 6, blurb: "A farming collective on a ring station negotiates with the company that owns the sun." },
  { id: "ninth-signal", title: "The Ninth Signal", author: "R. Almeida", genre: "sci-fi", price: 13.25, stock: 9, blurb: "Eight signals were noise. The ninth answered back." },
  { id: "static-bloom", title: "Static Bloom", author: "K. Tanaka", genre: "sci-fi", price: 11.00, stock: 4, blurb: "A radio engineer grows flowers out of dead channels." },
  { id: "quiet-ledger", title: "The Quiet Ledger", author: "E. Moreau", genre: "mystery", price: 12.99, stock: 7, blurb: "An auditor finds a second set of books — for the town's secrets." },
  { id: "study-in-amber", title: "A Study in Amber", author: "H. Lindqvist", genre: "mystery", price: 14.50, stock: 2, blurb: "A fossil with a fingerprint inside it. A detective who collects both." },
  { id: "winter-archive", title: "The Winter Archive", author: "P. Novak", genre: "history", price: 17.00, stock: 5, blurb: "A century of letters from a lighthouse that was never built." },
  { id: "field-notes-steppe", title: "Field Notes from the Steppe", author: "D. Aydin", genre: "history", price: 15.00, stock: 6, blurb: "A botanist walks the old trade roads and writes down what the maps forgot." },
  { id: "small-hours", title: "Small Hours, Bright Birds", author: "S. Ferreira", genre: "poetry", price: 9.99, stock: 10, blurb: "Sixty poems about staying up late and the birds that do too." },
  { id: "lighthouse-cat", title: "The Lighthouse Cat", author: "T. Berg", genre: "children", price: 10.50, stock: 12, blurb: "A cat keeps the light on for ships that are only a little bit lost." },
];

export const state = {
  cart: [],            // [{id, qty}]
  orders: [],          // [{ref, name, fulfillment, address, items, total, deliveryFee, delivery, status, placedAt}]
  orderCounter: 1000,
  filter: { query: "", genre: "" },
};

const money = (n) => `$${n.toFixed(2)}`;
export const findBook = (id) => CATALOG.find((b) => b.id === id);
export function findBookByTitle(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;
  let best = null;
  for (const b of CATALOG) {
    const title = b.title.toLowerCase();
    if (title === t) return b;
    if (title.includes(t) || t.includes(title)) best = best || b;
  }
  return best;
}
export const cartTotal = () => state.cart.reduce((s, l) => s + findBook(l.id).price * l.qty, 0);
export const cartCount = () => state.cart.reduce((s, l) => s + l.qty, 0);

export function renderCatalog() {
  const grid = document.getElementById("book-grid");
  const { query, genre } = state.filter;
  const q = query.toLowerCase();
  const list = CATALOG.filter((b) =>
    (!genre || b.genre === genre) &&
    (!q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || b.genre.includes(q)));
  grid.innerHTML = "";
  for (const b of list) {
    const el = document.createElement("article");
    el.className = "book";
    el.setAttribute("role", "listitem");
    el.innerHTML = `
      <h3>${escapeHtml(b.title)}</h3>
      <p class="author">by ${escapeHtml(b.author)}</p>
      <span class="genre">${escapeHtml(b.genre)}</span>
      <p class="blurb">${escapeHtml(b.blurb)}</p>
      <p><span class="price">${money(b.price)}</span> &middot;
      <span class="stock${b.stock === 0 ? " out" : ""}">${b.stock === 0 ? "Out of stock" : `${b.stock} in stock`}</span></p>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Add to cart";
    btn.dataset.agentAction = "website_add_to_cart";
    btn.dataset.agentParams = JSON.stringify({ book_id: b.id, quantity: 1 });
    btn.disabled = b.stock === 0;
    btn.addEventListener("click", () => addToCart(b.id, 1));
    el.appendChild(btn);
    grid.appendChild(el);
  }
  document.getElementById("catalog-empty").hidden = list.length > 0;
}

export function renderCart() {
  const box = document.getElementById("cart-contents");
  if (state.cart.length === 0) {
    box.innerHTML = `<p class="empty">Your cart is empty.</p>`;
  } else {
    const rows = state.cart.map((l) => {
      const b = findBook(l.id);
      return `<tr><td>${escapeHtml(b.title)}</td><td>${l.qty}</td><td>${money(b.price)}</td>
        <td>${money(b.price * l.qty)}</td>
        <td><button type="button" class="secondary" data-agent-action="website_remove_from_cart"
          data-agent-params='${JSON.stringify({ book_id: b.id })}'>Remove</button></td></tr>`;
    }).join("");
    box.innerHTML = `<table><thead><tr><th>Book</th><th>Qty</th><th>Price</th><th>Line total</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    box.querySelectorAll("[data-agent-action='website_remove_from_cart']").forEach((btn) => {
      btn.addEventListener("click", () => removeFromCart(JSON.parse(btn.dataset.agentParams).book_id));
    });
  }
  const total = document.getElementById("cart-total");
  total.hidden = state.cart.length === 0;
  document.getElementById("cart-total-value").textContent = money(cartTotal());
}

export function renderOrders() {
  const box = document.getElementById("order-list");
  if (state.orders.length === 0) {
    box.innerHTML = `<p class="empty">No demo orders yet.</p>`;
    return;
  }
  box.innerHTML = state.orders.slice().reverse().map((o) => `
    <div class="order">
      <p><span class="ref">${o.ref}</span> &middot; <span class="status">${escapeHtml(o.status)}</span>
      &middot; ${escapeHtml(o.fulfillment)}${o.delivery ? ` &middot; delivery ${escapeHtml(o.delivery.slot)}${o.delivery.ref ? ` · ${escapeHtml(o.delivery.ref)}` : ""}` : ""}</p>
      <p>${escapeHtml(o.name)} — ${o.items.map((i) => `${i.qty} × ${escapeHtml(findBook(i.id).title)}`).join(", ")}
      — total ${money(o.total)}${o.deliveryFee ? ` (incl. ${money(o.deliveryFee)} delivery)` : ""}</p>
    </div>`).join("");
}

export function addToCart(bookId, qty = 1) {
  const b = findBook(bookId);
  if (!b) return { ok: false, error: `No book with id "${bookId}".` };
  const line = state.cart.find((l) => l.id === bookId);
  const have = line ? line.qty : 0;
  if (have + qty > b.stock) {
    return { ok: false, error: `Only ${b.stock} copies of "${b.title}" in stock (you already have ${have} in the cart).` };
  }
  if (line) line.qty += qty; else state.cart.push({ id: bookId, qty });
  renderCart();
  return { ok: true, book: b.title, quantity: have + qty, cart_total: money(cartTotal()), cart_count: cartCount() };
}

export function removeFromCart(bookId) {
  state.cart = state.cart.filter((l) => l.id !== bookId);
  renderCart();
  return { ok: true, cart_total: money(cartTotal()), cart_count: cartCount() };
}

export function setCart(items) {
  // items: [{book_id, quantity}] — replaces the cart; quantity 0 removes.
  for (const it of items) {
    const b = findBook(it.book_id);
    if (!b) return { ok: false, error: `No book with id "${it.book_id}".` };
    if (it.quantity > b.stock) return { ok: false, error: `Only ${b.stock} copies of "${b.title}" in stock.` };
  }
  state.cart = items.filter((i) => i.quantity > 0).map((i) => ({ id: i.book_id, qty: i.quantity }));
  renderCart();
  return { ok: true, cart_total: money(cartTotal()), cart_count: cartCount() };
}

export function checkout({ name, fulfillment, address, delivery }) {
  if (state.cart.length === 0) return { ok: false, error: "The cart is empty — add a book first." };
  if (!name || !name.trim()) return { ok: false, error: "A name is required for the demo order." };
  if (fulfillment === "delivery" && (!address || !address.trim())) {
    return { ok: false, error: "A delivery address is required for delivery orders." };
  }
  const deliveryFee = delivery ? delivery.fee : 0;
  const ref = `BN-${++state.orderCounter}`;
  const order = {
    ref, name: name.trim(), fulfillment, address: address || null,
    items: state.cart.map((l) => ({ ...l })),
    total: +(cartTotal() + deliveryFee).toFixed(2),
    deliveryFee, delivery: delivery || null,
    status: fulfillment === "delivery" ? "Placed — delivery booked" : "Placed — ready for pickup",
    placedAt: new Date().toISOString(),
  };
  // decrement stock (demo state only)
  for (const l of state.cart) findBook(l.id).stock -= l.qty;
  state.orders.push(order);
  state.cart = [];
  renderCatalog(); renderCart(); renderOrders();
  return { ok: true, ref, total: money(order.total), status: order.status };
}

export function getStateSummary() {
  return {
    catalog: CATALOG.map((b) => ({ id: b.id, title: b.title, author: b.author, genre: b.genre, price: b.price, stock: b.stock })),
    cart: state.cart.map((l) => ({ ...l, title: findBook(l.id).title, price: findBook(l.id).price })),
    cart_total: money(cartTotal()),
    latest_order: state.orders.length ? state.orders[state.orders.length - 1] : null,
    policies: "Pickup is free at the shop. Delivery is arranged by Harbor Delivery Co. (peer agent site); the delivery fee depends on distance and is quoted before checkout. Demo orders only — no payment is collected.",
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Site actions (registered with the runtime; schemas come from AgentifyJS) ---
export const SITE_ACTIONS = [
  {
    name: "website_get_page_state",
    description: "Read the live catalog, cart, and latest order from the shop page. Use this before answering any question about books, prices, stock, the cart, or orders.",
    effect: "read",
    handler: () => ({ ok: true, state: getStateSummary() }),
  },
  {
    name: "website_search_catalog",
    description: "Search the catalog by a text query and/or genre. Returns matching books with title, author, genre, price, and stock.",
    effect: "read",
    handler: ({ query = "", genre = "" }) => {
      const q = String(query).toLowerCase();
      const list = CATALOG.filter((b) =>
        (!genre || b.genre === genre) &&
        (!q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || b.genre.toLowerCase().includes(q)));
      return { ok: true, matches: list.map((b) => ({ id: b.id, title: b.title, author: b.author, genre: b.genre, price: b.price, stock: b.stock })) };
    },
  },
  {
    name: "website_add_to_cart",
    description: "Add a book to the cart by its catalog id. Fails if the requested quantity exceeds stock.",
    effect: "write",
    handler: ({ book_id, quantity = 1 }) => addToCart(book_id, quantity),
  },
  {
    name: "website_remove_from_cart",
    description: "Remove a book from the cart by its catalog id.",
    effect: "write",
    handler: ({ book_id }) => removeFromCart(book_id),
  },
  {
    name: "website_set_cart",
    description: "Replace the whole cart with a list of {book_id, quantity} lines. Quantity 0 removes a line.",
    effect: "write",
    handler: ({ items }) => setCart(items),
  },
  {
    name: "website_get_order_status",
    description: "Return the latest demo order and its status, or say there is no order yet.",
    effect: "read",
    handler: () => {
      const o = state.orders.length ? state.orders[state.orders.length - 1] : null;
      return { ok: true, order: o || null };
    },
  },
  {
    name: "website_checkout_demo_order",
    description: "Place a demo order for the current cart. Requires a customer name and fulfillment (pickup or delivery). For delivery, an address and a delivery quote (from the Harbor Delivery peer network) are required. This is a write: the user must confirm it first.",
    effect: "write",
    handler: ({ name, fulfillment = "pickup", address, delivery }) => checkout({ name, fulfillment, address, delivery }),
  },
];
