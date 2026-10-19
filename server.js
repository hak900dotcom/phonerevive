// PhoneRevive - week build (features 1-3: search and filters, product pages, shopping cart)
// Runs with plain Node.js. No packages to install. Start it with: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// Looks for a file in the given subfolder first, then next to server.js.
// This way the app still works if the folders get flattened when uploading to GitHub.
function findFile(folder, file) {
  const inFolder = path.join(__dirname, folder, file);
  const nextToServer = path.join(__dirname, file);
  if (fs.existsSync(inFolder) || !fs.existsSync(nextToServer)) return inFolder;
  return nextToServer;
}

// ---------- CSV helpers ----------

// Reads a CSV file into a list of objects. Handles quoted values with commas.
function readCsv(file) {
  const full = findFile('data', file);
  if (!fs.existsSync(full)) {
    if (file === 'cart_items.csv') return []; // created on the first add to cart
    console.error(`Missing data file: ${file}. Upload the data folder (with ${file} inside) next to server.js.`);
    process.exit(1);
  }
  const text = fs.readFileSync(full, 'utf8').replace(/\r/g, '');
  const rows = [];
  let row = [], value = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else value += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(value); value = ''; }
    else if (c === '\n') { row.push(value); rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift();
  return rows.filter(r => r.length > 1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return obj;
  });
}

function writeCsv(file, headers, items) {
  const esc = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = [headers.join(',')].concat(items.map(it => headers.map(h => esc(it[h])).join(',')));
  const full = findFile('data', file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lines.join('\n') + '\n');
}

// ---------- Load business data ----------

const phones = readCsv('phones.csv').map(p => ({
  ...p,
  kind: 'phone',
  storage_gb: Number(p.storage_gb),
  battery_health: Number(p.battery_health),
  price: Number(p.price),
}));

const parts = readCsv('parts.csv').map(p => ({
  ...p,
  kind: 'part',
  price: Number(p.price),
  stock: Number(p.stock),
  fits: p.fits.split('|'),
}));

const settings = {};
readCsv('settings.csv').forEach(s => { settings[s.key] = Number(s.value); });

const CART_FILE = 'cart_items.csv';
const CART_HEADERS = ['cart_id', 'item_id', 'qty', 'added_at'];
const RESERVE_MS = settings.reserve_minutes * 60 * 1000;

function findItem(id) {
  return phones.find(p => p.id === id) || parts.find(p => p.sku === id);
}

// ---------- Cart (saved in data/cart_items.csv) ----------

// Loads all cart rows and drops phones whose 15 minute hold has run out.
function loadCartRows() {
  const now = Date.now();
  const rows = readCsv(CART_FILE).map(r => ({ ...r, qty: Number(r.qty), added_at: Number(r.added_at) }));
  const kept = rows.filter(r => {
    const item = findItem(r.item_id);
    if (!item) return false;
    if (item.kind === 'phone') return now - r.added_at < RESERVE_MS;
    return true;
  });
  if (kept.length !== rows.length) writeCsv(CART_FILE, CART_HEADERS, kept);
  return kept;
}

function saveCartRows(rows) {
  writeCsv(CART_FILE, CART_HEADERS, rows);
}

// A phone is reserved if it sits in another shopper's cart.
function reservedBy(phoneId, rows) {
  const r = rows.find(x => x.item_id === phoneId);
  return r ? r.cart_id : null;
}

function cartFor(cartId) {
  const rows = loadCartRows().filter(r => r.cart_id === cartId);
  const lines = rows.map(r => {
    const item = findItem(r.item_id);
    return { row: r, item, lineTotal: item.price * r.qty };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shipping = subtotal === 0 || subtotal >= settings.free_shipping_over ? 0 : settings.shipping_fee;
  const tax = Math.round(subtotal * settings.tax_rate * 100) / 100;
  const count = rows.reduce((s, r) => s + r.qty, 0);
  return { lines, subtotal, shipping, tax, total: subtotal + shipping + tax, count };
}

// Returns an error message, or null if the item was added.
function addToCart(cartId, itemId, qty) {
  const item = findItem(itemId);
  if (!item) return 'That item does not exist.';
  const rows = loadCartRows();
  const mine = rows.find(r => r.cart_id === cartId && r.item_id === itemId);

  if (item.kind === 'phone') {
    if (item.status !== 'available') return 'Sorry, this phone has been sold.';
    if (mine) return 'This phone is already in your cart.';
    const owner = reservedBy(itemId, rows);
    if (owner) return 'Sorry, someone else is holding this phone right now. Try again in a few minutes.';
    rows.push({ cart_id: cartId, item_id: itemId, qty: 1, added_at: Date.now() });
  } else {
    if (!(qty >= 1)) return 'Quantity must be at least 1.';
    const newQty = (mine ? mine.qty : 0) + qty;
    if (newQty > item.stock) return `Only ${item.stock} in stock.`;
    if (mine) mine.qty = newQty;
    else rows.push({ cart_id: cartId, item_id: itemId, qty, added_at: Date.now() });
  }
  saveCartRows(rows);
  return null;
}

function updateQty(cartId, itemId, qty) {
  const item = findItem(itemId);
  const rows = loadCartRows();
  const mine = rows.find(r => r.cart_id === cartId && r.item_id === itemId);
  if (!mine || !item || item.kind !== 'part' || !(qty >= 1)) return;
  mine.qty = Math.max(1, Math.min(qty, item.stock));
  saveCartRows(rows);
}

function removeFromCart(cartId, itemId) {
  saveCartRows(loadCartRows().filter(r => !(r.cart_id === cartId && r.item_id === itemId)));
}

// ---------- Search and filters ----------

// Every word the user types must match the start of some word in the item.
// "12 battery" matches "iPhone 12 / 12 Pro Battery".
function matchesKeywords(text, q) {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const terms = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return terms.every(t => words.some(w => /^\d+$/.test(t) ? w === t : w.startsWith(t)));
}

function searchPhones(q, f, cartId) {
  const rows = loadCartRows();
  let list = phones.filter(p => {
    if (p.status !== 'available') return false;
    const owner = reservedBy(p.id, rows);
    if (owner && owner !== cartId) return false;
    if (p.imei_status !== 'Clean') return false;
    if (q && !matchesKeywords(`${p.model} ${p.color}`, q)) return false;
    if (f.model && p.model !== f.model) return false;
    if (f.storage && p.storage_gb < Number(f.storage)) return false;
    if (f.grade && p.grade !== f.grade) return false;
    if (f.lock === 'unlocked' && p.lock_status !== 'Unlocked') return false;
    if (f.max && p.price > Number(f.max)) return false;
    return true;
  });
  if (f.sort === 'price_asc') list.sort((a, b) => a.price - b.price);
  else if (f.sort === 'price_desc') list.sort((a, b) => b.price - a.price);
  else if (f.sort === 'battery') list.sort((a, b) => b.battery_health - a.battery_health);
  else list.sort((a, b) => b.listed_on.localeCompare(a.listed_on)); // newest first
  return list;
}

function searchParts(q, f) {
  let list = parts.filter(p => {
    if (q && !matchesKeywords(`${p.name} ${p.part_type} ${p.fits.join(' ')}`, q)) return false;
    if (f.ptype && p.part_type !== f.ptype) return false;
    if (f.fits && !p.fits.includes(f.fits)) return false;
    return true;
  });
  if (f.sort === 'price_desc') list.sort((a, b) => b.price - a.price);
  else list.sort((a, b) => a.price - b.price);
  return list;
}

// ---------- HTML ----------

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + n.toFixed(2);
const unique = arr => [...new Set(arr)].sort();

function page(title, body, cartCount, flash) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | PhoneRevive</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
<header class="top"><a href="/" class="logo">PhoneRevive</a>
<a href="/cart" class="cart-link">Cart (${cartCount})</a></header>
${flash ? `<p class="flash ${flash.type}">${esc(flash.text)}</p>` : ''}
<main>${body}</main>
<nav class="bottom"><a href="/">Home</a><a href="/search">Search</a><a href="/cart">Cart (${cartCount})</a></nav>
</body></html>`;
}

function searchBox(q = '', type = 'phones') {
  return `<form action="/search" class="search">
  <input name="q" value="${esc(q)}" placeholder='Search "iPhone 13" or "12 battery"' aria-label="Search">
  <div class="tabs">
    <label><input type="radio" name="type" value="phones" ${type === 'phones' ? 'checked' : ''}> Phones</label>
    <label><input type="radio" name="type" value="parts" ${type === 'parts' ? 'checked' : ''}> Parts</label>
  </div>
  <button>Search</button></form>`;
}

function homePage() {
  const chip = (label, qs) => `<a class="chip" href="/search?${qs}">${label}</a>`;
  return `${searchBox()}
  <h2>Quick filters</h2>
  <div class="chips">
    ${chip('iPhone 14', 'q=iPhone+14')}${chip('iPhone 13', 'q=iPhone+13')}
    ${chip('128GB+', 'storage=128')}${chip('Grade A', 'grade=A')}
    ${chip('Unlocked', 'lock=unlocked')}${chip('Under $300', 'max=300')}
  </div>
  <p class="trust">Every phone tested + IMEI checked</p>
  <h2>Popular parts</h2>
  <div class="chips">
    ${['Screen', 'Battery', 'Camera', 'Charging port'].map(t => chip(t === 'Battery' ? 'Batteries' : t + 's', 'type=parts&ptype=' + encodeURIComponent(t))).join('')}
  </div>`;
}

function select(name, label, options, current) {
  return `<label>${label}<select name="${name}"><option value="">Any</option>${options.map(([v, t]) =>
    `<option value="${esc(v)}" ${String(current) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}

function resultsPage(q, f, cartId) {
  const type = f.type === 'parts' ? 'parts' : 'phones';
  let filters, grid, count;

  if (type === 'phones') {
    const list = searchPhones(q, f, cartId);
    count = `${list.length} phone${list.length === 1 ? '' : 's'} found`;
    filters = [
      select('model', 'Model', unique(phones.map(p => p.model)).map(m => [m, m]), f.model),
      select('storage', 'Storage', [['64', '64GB+'], ['128', '128GB+'], ['256', '256GB+']], f.storage),
      select('grade', 'Grade', [['A', 'Grade A'], ['B', 'Grade B'], ['C', 'Grade C']], f.grade),
      select('lock', 'Lock', [['unlocked', 'Unlocked only']], f.lock),
      select('max', 'Price', [['200', 'Under $200'], ['300', 'Under $300'], ['400', 'Under $400'], ['600', 'Under $600']], f.max),
      select('sort', 'Sort', [['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['battery', 'Best battery']], f.sort).replace('Any', 'Newest'),
    ].join('');
    grid = list.map(p => `<a class="card" href="/phone/${p.id}">
      <div class="photo">Photo</div>
      <strong>${esc(p.model)} ${p.storage_gb}GB</strong>
      <span>${money(p.price)} · Grade ${p.grade}</span>
      <span class="small">Battery ${p.battery_health}% ${p.lock_status === 'Unlocked' ? '✔' : '· ' + esc(p.lock_status)}</span>
    </a>`).join('');
  } else {
    const list = searchParts(q, f);
    count = `${list.length} part${list.length === 1 ? '' : 's'} found`;
    filters = [
      select('ptype', 'Part type', unique(parts.map(p => p.part_type)).map(t => [t, t]), f.ptype),
      select('fits', 'Fits', unique(parts.flatMap(p => p.fits)).map(m => [m, m]), f.fits),
      select('sort', 'Sort', [['price_desc', 'Price: high to low']], f.sort).replace('Any', 'Price: low to high'),
    ].join('');
    grid = list.map(p => `<a class="card" href="/part/${p.sku}">
      <div class="photo">Photo</div>
      <strong>${esc(p.name)}</strong>
      <span>${money(p.price)}</span>
      <span class="small">${p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}</span>
    </a>`).join('');
  }

  const empty = `<p class="empty">No ${type} found. Try removing a filter.</p>`;
  return `${searchBox(q, type)}
  <form action="/search" class="filters">
    <input type="hidden" name="q" value="${esc(q)}"><input type="hidden" name="type" value="${type}">
    ${filters}<button>Apply</button> <a href="/search?type=${type}&q=${encodeURIComponent(q)}">Clear</a>
  </form>
  <p class="count">${count}${q ? ` for "${esc(q)}"` : ''}</p>
  ${grid ? `<div class="grid">${grid}</div>` : empty}
  ${type === 'phones' ? '<p class="small">✔ = IMEI clean, unlocked</p>' : ''}`;
}

function shippingLine() {
  return `<p class="small">Shipping ${money(settings.shipping_fee)}, free over ${money(settings.free_shipping_over)}. No other fees.</p>`;
}

function phonePage(p, cartId) {
  const rows = loadCartRows();
  const owner = reservedBy(p.id, rows);
  let button;
  if (p.status !== 'available') button = '<p class="flash error">This phone has been sold.</p>';
  else if (owner === cartId) button = '<a class="btn" href="/cart">In your cart. View cart</a>';
  else if (owner) button = '<p class="flash error">Someone is holding this phone right now. Check back soon.</p>';
  else button = `<form method="post" action="/cart/add"><input type="hidden" name="id" value="${p.id}"><button class="btn">Add to Cart</button></form>`;

  return `<a href="javascript:history.back()" class="small">← Back</a>
  <div class="gallery">${['Front', 'Back', 'Left side', 'Right side'].map(s => `<div class="photo">${s}</div>`).join('')}</div>
  <p class="small">Real photos of this unit</p>
  <h1>${esc(p.model)}, ${p.storage_gb}GB, ${esc(p.color)}</h1>
  <p class="price">${money(p.price)}</p>
  <div class="badges">
    <span class="badge">Grade ${p.grade}</span>
    <span class="badge">Battery ${p.battery_health}%</span>
    <span class="badge ok">✔ IMEI clean (checked ${esc(p.imei_checked_on)})</span>
    <span class="badge">${esc(p.lock_status)}</span>
  </div>
  <h2>Condition notes</h2><p>${esc(p.condition_notes)}</p>
  <p>${p.warranty_days}-day warranty · Sold by PhoneRevive</p>
  ${button}
  ${shippingLine()}`;
}

function partPage(p) {
  const button = p.stock > 0
    ? `<form method="post" action="/cart/add" class="qty-form"><input type="hidden" name="id" value="${p.sku}">
       <label>Quantity <input type="number" name="qty" value="1" min="1" max="${p.stock}"></label>
       <button class="btn">Add to Cart</button></form>`
    : '<p class="flash error">Out of stock.</p>';
  return `<a href="javascript:history.back()" class="small">← Back</a>
  <div class="gallery"><div class="photo">Photo</div></div>
  <h1>${esc(p.name)}</h1>
  <p class="price">${money(p.price)}</p>
  <p>${p.stock > 0 ? `<strong>${p.stock}</strong> in stock` : 'Out of stock'} · SKU ${esc(p.sku)}</p>
  <p>${esc(p.description)}</p>
  <h2>Fits these models</h2><ul>${p.fits.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
  ${button}
  ${shippingLine()}`;
}

function cartPage(cart) {
  if (!cart.lines.length) return '<h1>Your cart</h1><p class="empty">Your cart is empty. <a href="/">Start shopping</a></p>';
  const lines = cart.lines.map(({ row, item, lineTotal }) => {
    const id = item.kind === 'phone' ? item.id : item.sku;
    const name = item.kind === 'phone' ? `${item.model} ${item.storage_gb}GB (${item.grade})` : item.name;
    let extra;
    if (item.kind === 'phone') {
      const minsLeft = Math.ceil((RESERVE_MS - (Date.now() - row.added_at)) / 60000);
      extra = `<span class="small reserve">Reserved for you for ${minsLeft} more min</span>`;
    } else {
      extra = `<form method="post" action="/cart/update" class="qty">
        <input type="hidden" name="id" value="${id}">
        <button name="qty" value="${row.qty - 1}" ${row.qty <= 1 ? 'disabled' : ''}>–</button>
        <span>${row.qty}</span>
        <button name="qty" value="${row.qty + 1}" ${row.qty >= item.stock ? 'disabled' : ''}>+</button></form>`;
    }
    return `<div class="line"><div><strong>${esc(name)}</strong><br>${extra}</div>
      <div class="right">${money(lineTotal)}<form method="post" action="/cart/remove"><input type="hidden" name="id" value="${id}"><button class="link">Remove ×</button></form></div></div>`;
  }).join('');
  return `<h1>Your cart</h1>${lines}
  <table class="totals">
    <tr><td>Subtotal</td><td>${money(cart.subtotal)}</td></tr>
    <tr><td>Shipping</td><td>${money(cart.shipping)}</td></tr>
    <tr><td>Tax (est.)</td><td>${money(cart.tax)}</td></tr>
    <tr class="total"><td>Estimated total</td><td>${money(cart.total)}</td></tr>
  </table>
  <a class="btn" href="/checkout">Proceed to Checkout</a>
  <p class="small">Checkout is not built yet. It comes in a later week.</p>`;
}

// ---------- Server ----------

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => resolve(new URLSearchParams(body)));
  });
}

function getCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

function redirect(res, to, headers = {}) {
  res.writeHead(303, { Location: to, ...headers });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const cookies = getCookies(req);

  // Each visitor gets a cart id in a cookie. No sign-up needed.
  let cartId = cookies.cart;
  const setCookie = [];
  if (!cartId || !/^[a-f0-9]{16}$/.test(cartId)) {
    cartId = crypto.randomBytes(8).toString('hex');
    setCookie.push(`cart=${cartId}; Path=/; HttpOnly; SameSite=Lax`);
  }
  // One-time messages ("Added to cart") are passed in a short cookie.
  let flash = null;
  if (cookies.flash) {
    const [type, ...text] = cookies.flash.split('|');
    flash = { type, text: text.join('|') };
    setCookie.push('flash=; Path=/; Max-Age=0');
  }
  const flashCookie = (type, text) => `flash=${encodeURIComponent(type + '|' + text)}; Path=/`;
  const headers = setCookie.length ? { 'Set-Cookie': setCookie } : {};

  try {
    if (req.method === 'GET' && url.pathname === '/style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(fs.readFileSync(findFile('public', 'style.css')));
    }

    const count = () => cartFor(cartId).count;

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, page('Home', homePage(), count(), flash), headers);
    }

    if (req.method === 'GET' && url.pathname === '/search') {
      const f = Object.fromEntries(url.searchParams);
      const q = (f.q || '').trim();
      return send(res, 200, page('Search', resultsPage(q, f, cartId), count(), flash), headers);
    }

    let m;
    if (req.method === 'GET' && (m = url.pathname.match(/^\/phone\/([\w-]+)$/))) {
      const p = phones.find(x => x.id === m[1]);
      if (!p) return send(res, 404, page('Not found', '<p>Phone not found.</p>', count()), headers);
      return send(res, 200, page(p.model, phonePage(p, cartId), count(), flash), headers);
    }

    if (req.method === 'GET' && (m = url.pathname.match(/^\/part\/([\w-]+)$/))) {
      const p = parts.find(x => x.sku === m[1]);
      if (!p) return send(res, 404, page('Not found', '<p>Part not found.</p>', count()), headers);
      return send(res, 200, page(p.name, partPage(p), count(), flash), headers);
    }

    if (req.method === 'GET' && url.pathname === '/cart') {
      const cart = cartFor(cartId);
      return send(res, 200, page('Cart', cartPage(cart), cart.count, flash), headers);
    }

    if (req.method === 'GET' && url.pathname === '/checkout') {
      return send(res, 200, page('Checkout', '<h1>Checkout</h1><p>Checkout is coming in a later week. <a href="/cart">Back to cart</a></p>', count()), headers);
    }

    if (req.method === 'POST' && url.pathname === '/cart/add') {
      const body = await readBody(req);
      const id = body.get('id');
      const error = addToCart(cartId, id, parseInt(body.get('qty') || '1', 10));
      const back = phones.some(p => p.id === id) ? `/phone/${id}` : `/part/${id}`;
      setCookie.push(error ? flashCookie('error', error) : flashCookie('ok', 'Added to cart'));
      return redirect(res, back, { 'Set-Cookie': setCookie });
    }

    if (req.method === 'POST' && url.pathname === '/cart/update') {
      const body = await readBody(req);
      updateQty(cartId, body.get('id'), parseInt(body.get('qty'), 10));
      return redirect(res, '/cart', headers);
    }

    if (req.method === 'POST' && url.pathname === '/cart/remove') {
      const body = await readBody(req);
      removeFromCart(cartId, body.get('id'));
      setCookie.push(flashCookie('ok', 'Item removed'));
      return redirect(res, '/cart', { 'Set-Cookie': setCookie });
    }

    send(res, 404, page('Not found', '<p>Page not found. <a href="/">Go home</a></p>', count()), headers);
  } catch (err) {
    console.error(err);
    send(res, 500, '<p>Something went wrong. Check the terminal for details.</p>');
  }
});

server.listen(PORT, () => {
  console.log(`PhoneRevive is running at http://localhost:${PORT}`);
  console.log(`Loaded ${phones.length} phones and ${parts.length} parts from the data folder.`);
});
