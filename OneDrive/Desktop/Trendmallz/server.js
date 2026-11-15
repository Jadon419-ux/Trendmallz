'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const db       = require('./db');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
// Railway sits in front of the app as one proxy; trusting it lets secure cookies work over https
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({
  limit: '50mb',
  // Paystack webhooks are signed over the exact raw body
  verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/paystack/webhook')) req.rawBody = buf; },
}));
const _SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
app.use(session({
  store:             new db.PgSessionStore(_SESSION_TTL_MS),
  secret:            process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   _SESSION_TTL_MS,
  },
}));

// Lets async route handlers pass errors to the error handler
function _async(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ── Config ────────────────────────────────────────────────────────────────────
const FASHN_API_KEY = process.env.FASHN_API_KEY || '';

const SNAP_CLIENT_ID     = process.env.SNAP_CLIENT_ID     || '';
const SNAP_CLIENT_SECRET = process.env.SNAP_CLIENT_SECRET || '';
const SNAP_REDIRECT_URI  = process.env.SNAP_REDIRECT_URI  || 'http://localhost:3000/auth/snap/callback';
const SNAP_SCOPE = process.env.SNAP_SCOPE ||
  'https://auth.snapchat.com/oauth2/api/user.display_name ' +
  'https://auth.snapchat.com/oauth2/api/user.bitmoji.avatar';

const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';

const SNAP_AUTH_URL  ='https://accounts.snapchat.com/accounts/oauth2/auth';
const SNAP_TOKEN_URL = 'https://accounts.snapchat.com/accounts/oauth2/token';
const SNAP_ME_URL    = 'https://api.snapkit.com/v1/me';

// ── Helpers ───────────────────────────────────────────────────────────────────
function pkcePair() {
  const verifier  = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function fallbackBodyStats() {
  const builds = ['Athletic', 'Slim', 'Regular', 'Broad'];
  const tones  = ['#c68642', '#8d5524', '#f1c27d', '#e0ac69', '#ffdbac', '#4a2912'];
  return {
    height:   Math.round((1.68 + Math.random() * 0.22) * 100) / 100,
    shoulder: Math.floor(42 + Math.random() * 12),
    build:    builds[Math.floor(Math.random() * builds.length)],
    skin:     tones [Math.floor(Math.random() * tones.length)],
  };
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname), {
  index: false,
  dotfiles: 'deny',
}));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'trendz.html')));

// ── /api/process-photo ────────────────────────────────────────────────────────
// Node.js has no MediaPipe or rembg — returns fallback body stats + original image
app.post('/api/process-photo', (req, res) => {
  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'No image provided' });
  res.json({
    success:            true,
    processedImage:     image,
    landmarks:          [],
    bodyStats:          fallbackBodyStats(),
    poseDetected:       false,
    mediapipeAvailable: false,
    rembgAvailable:     false,
  });
});

// ── /api/brands ───────────────────────────────────────────────────────────────
app.get('/api/brands', (_req, res) => {
  const brandsDir = path.join(__dirname, 'brands');
  if (!fs.existsSync(brandsDir)) return res.json([]);
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);
  const files = fs.readdirSync(brandsDir)
    .filter(f => exts.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => `/brands/${f}`);
  res.json(files);
});

// ── Vendor products ───────────────────────────────────────────────────────────
// Products added by vendors are stored in the database and held here in memory, so the
// catalogue can be built without waiting. They survive restarts and redeploys.
let _vendorProducts = [];
async function _loadVendorProducts() {
  // One-time import of products saved by the old file-based version, if the file is still there
  try {
    const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'custom_products.json'), 'utf8'));
    for (const cp of Array.isArray(old) ? old : []) {
      if (cp && cp.id && cp.brand) {
        await db.query('INSERT INTO vendor_products (id, brand, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [String(cp.id), String(cp.brand), JSON.stringify(cp)]);
      }
    }
  } catch (_x) {}
  const rows = await db.query('SELECT data FROM vendor_products ORDER BY created_at');
  _vendorProducts = rows.map(r => { try { return JSON.parse(r.data); } catch (_x) { return null; } }).filter(Boolean);
  return _vendorProducts.length;
}

// ── /api/products ─────────────────────────────────────────────────────────────
// What kind of item a product is, for outfits: from its category folder and name.
// Unknown clothing counts as a top and the try-on model works out the rest.
const _PRODUCT_GENDERS = ['male', 'female', 'unisex'];
const _SLOT_RULES = [
  // Outer layers come first: a "jeans jacket" is a jacket, not jeans
  ['outerwear', /\b(jackets?|blazers?|coats?|overcoats?|cardigans?|kimonos?|parkas?|windbreakers?|bombers?|outerwear)\b/],
  ['one-piece', /\b(dress(es)?|gowns?|jumpsuits?|rompers?|overalls?|kaftans?|abayas?|boubous?|agbadas?|onesies?)\b/],
  ['bottoms',   /\b(trousers?|pants|jeans|shorts|skirts?|joggers?|leggings|chinos|cargos?|sweatpants|bottoms?)\b/],
  ['shoes',     /\b(shoes?|sneakers?|trainers?|boots?|sandals?|heels|loafers?|slides?|slippers?|footwear|kicks)\b/],
  ['hats',      /\b(caps?|hats?|beanies?|berets?|headwear|durags?|bucket)\b/],
  ['jewelry',   /\b(rings?|necklaces?|chains?|bracelets?|earrings?|watch(es)?|pendants?|jewell?ery|anklets?|bangles?)\b/],
  ['bags',      /\b(bags?|handbags?|backpacks?|purses?|totes?|clutch(es)?)\b/],
  ['tops',      /\b(shirts?|tees?|tops?|hoodies?|sweaters?|polos?|jerseys?|sweatshirts?|vests?|blouses?|tanks?)\b/],
];
function _productSlot(p) {
  const text = (String(p.category || '') + ' ' + String(p.name || '')).toLowerCase().replace(/[_-]/g, ' ');
  for (const [slot, re] of _SLOT_RULES) if (re.test(text)) return [slot, true];
  return ['tops', false];
}

function _buildCatalog() {
  const productsDir = path.join(__dirname, 'products');
  if (!fs.existsSync(productsDir)) return [];
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
  // Group images by product base name, stripping view suffixes
  // e.g. calvary_front + calvary_back → one product with images array
  const groups = new Map();

  for (const brandName of fs.readdirSync(productsDir).sort()) {
    const brandPath = path.join(productsDir, brandName);
    if (!fs.statSync(brandPath).isDirectory()) continue;

    for (const catName of fs.readdirSync(brandPath).sort()) {
      const catPath = path.join(brandPath, catName);
      if (!fs.statSync(catPath).isDirectory()) continue;

      for (const filename of fs.readdirSync(catPath).sort()) {
        if (!exts.has(path.extname(filename).toLowerCase())) continue;

        const stem = path.parse(filename).name;
        const base = stem.replace(/[_\s-]*(tryon|try-on)$/i, '').replace(/[_\s]*(front|back|side|left|right|view|\d+)$/i, '').replace(/[_\s]+$/, '') || stem;
        const key = `${brandName}/${catName}/${base.toLowerCase()}`;

        if (!groups.has(key)) {
          groups.set(key, { brandName, catName, base, files: [] });
        }
        groups.get(key).files.push(filename);
      }
    }
  }

  const viewRank = fn => {
    const l = fn.toLowerCase();
    if (l.includes('front')) return 0;
    if (l.includes('back'))  return 2;
    return 1;
  };

  // Load per-brand prices from prices.json
  const _brandPrices = new Map();
  for (const [, _pg] of groups) {
    const _bn = _pg.brandName;
    if (_brandPrices.has(_bn)) continue;
    try {
      const _raw = JSON.parse(fs.readFileSync(path.join(productsDir, _bn, 'prices.json'), 'utf8'));
      const _pm = {};
      for (const [k, v] of Object.entries(_raw)) _pm[k.toLowerCase()] = Number(v) || 0;
      _brandPrices.set(_bn, _pm);
    } catch (_x) { _brandPrices.set(_bn, {}); }
  }
  // Who each folder product is for: products/<Brand>/genders.json, e.g. {"red-heels": "female"}
  const _brandGenders = new Map();
  const _genderOf = (brand, base) => {
    if (!_brandGenders.has(brand)) {
      const m = {};
      try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(productsDir, brand, 'genders.json'), 'utf8')))) m[k.toLowerCase()] = String(v).toLowerCase(); } catch (_x) {}
      _brandGenders.set(brand, m);
    }
    return _brandGenders.get(brand)[base.toLowerCase()];
  };
  const items = [];
  for (const [key, g] of groups) {
    g.files.sort((a, b) => viewRank(a) - viewRank(b));
    const { brandName, catName, base, files } = g;
    // A file named "<product>_tryon.jpg" is only for virtual try-on (one clean view)
    const isTryon = fn => /[_\s-](tryon|try-on)\.[a-z]+$/i.test(fn);
    const shopFiles = files.filter(fn => !isTryon(fn));
    const tryonFile = files.find(isTryon);
    const images = (shopFiles.length ? shopFiles : files).map(fn => `/products/${brandName}/${catName}/${fn}`);
    const name = base.replace(/[-_]/g, ' ').split(' ').filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const uid = parseInt(
      crypto.createHash('md5').update(key).digest('hex').slice(0, 8), 16
    );
    const _price = (_brandPrices.get(brandName) || {})[base.toLowerCase()] || 0;
    items.push({
      id:          uid,
      name,
      brand:       brandName,
      gender:      _genderOf(brandName, base),
      category:    catName,
      img:         images[0],
      images,
      ...(tryonFile ? { tryonImg: `/products/${brandName}/${catName}/${tryonFile}` } : {}),
      price:       _price,
      compare:     _price,
      discount:    0,
      rating:      0,
      reviews:     0,
      stock:       99,
      sizes:       ['XS', 'S', 'M', 'L', 'XL'],
      colors:      ['Default'],
      description: `${name} — by ${brandName}.`,
      tags:        [brandName.toLowerCase(), catName.toLowerCase()],
    });
  }
  // Add the products vendors have posted
  for (const cp of _vendorProducts) {
    if (!items.find(p => p.id === cp.id)) items.push({ ...cp });
  }
  for (const p of items) {
    if (!_PRODUCT_GENDERS.includes(p.gender)) p.gender = 'unisex'; // every product is for men, women or both
    if (!p.tryonSlot) { const [slot, known] = _productSlot(p); p.tryonSlot = slot; p.tryonKnown = known; }
    else p.tryonKnown = true;
  }
  items.sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  return items;
}

app.get('/api/products', (_req, res) => res.json(_buildCatalog()));

// ── /api/category-images/:category ───────────────────────────────────────────
app.get('/api/category-images/:category', (req, res) => {
  const safe = req.params.category.replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  if (!safe) return res.json([]);
  const catDir = path.join(__dirname, safe);
  if (!fs.existsSync(catDir)) return res.json([]);
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);
  const files = fs.readdirSync(catDir)
    .filter(f => exts.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => `/${safe}/${f}`);
  res.json(files);
});

// ── /api/avatar ───────────────────────────────────────────────────────────────
app.get('/api/avatar', (req, res) => {
  const seed  = req.query.seed  || 'default';
  const style = req.query.style || 'adventurer';
  res.redirect(
    `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}&backgroundColor=1a1a1a&backgroundType=solid`
  );
});

// ── /api/snap-configured ─────────────────────────────────────────────────────
app.get('/api/snap-configured', (_req, res) => {
  res.json({
    configured:        !!(SNAP_CLIENT_ID && SNAP_CLIENT_SECRET),
    has_client_id:     !!SNAP_CLIENT_ID,
    has_client_secret: !!SNAP_CLIENT_SECRET,
    redirect_uri:      SNAP_REDIRECT_URI,
    scope:             SNAP_SCOPE,
  });
});

// ── /auth/snap ────────────────────────────────────────────────────────────────
// Connects the signed-in customer's Snapchat so their 2D Bitmoji becomes their profile
// picture. The picture's address is saved on the account; no Snapchat tokens are kept.
app.get('/auth/snap', _async(async (req, res) => {
  if (!SNAP_CLIENT_ID || !SNAP_CLIENT_SECRET) return res.redirect('/?snap_error=config_missing');
  if (!(await _currentUser(req))) return res.redirect('/?snap_error=login_required');

  const state = crypto.randomBytes(32).toString('base64url');
  req.session.snap_state = state;

  const params = new URLSearchParams({
    client_id:             SNAP_CLIENT_ID,
    redirect_uri:          SNAP_REDIRECT_URI,
    response_type:         'code',
    scope:                 SNAP_SCOPE,
    state,
  });
  res.redirect(`${SNAP_AUTH_URL}?${params}`);
}));

// ── /auth/snap/callback ───────────────────────────────────────────────────────
app.get('/auth/snap/callback', _async(async (req, res) => {
  const { error, code, state } = req.query;
  if (error) return res.redirect('/?snap_error=' + (error === 'access_denied' ? 'access_denied' : 'auth_failed'));

  const saved = req.session.snap_state;
  delete req.session.snap_state;
  if (!code || !saved || state !== saved) return res.redirect('/?snap_error=invalid_state');

  const user = await _currentUser(req);
  if (!user) return res.redirect('/?snap_error=login_required');

  try {
    const tokResp = await fetch(SNAP_TOKEN_URL, {
      method:  'POST',
      // As Snap documents it: the app's id and secret go in a Basic Authorization header
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(SNAP_CLIENT_ID + ':' + SNAP_CLIENT_SECRET).toString('base64'),
      },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code:          String(code),
        redirect_uri:  SNAP_REDIRECT_URI,
        client_id:     SNAP_CLIENT_ID,
      }),
    });
    if (!tokResp.ok) { console.error('Snap token exchange failed:', tokResp.status, (await tokResp.text()).slice(0, 300)); return res.redirect('/?snap_error=token_exchange'); }
    const tokens = await tokResp.json();
    if (!tokens.access_token) return res.redirect('/?snap_error=no_access_token');

    const meResp = await fetch(SNAP_ME_URL, {
      method:  'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: '{me{displayName, bitmoji{avatar}}}' }),
    });
    if (!meResp.ok) { console.error('Snap profile fetch failed:', meResp.status); return res.redirect('/?snap_error=identity_fetch'); }
    const me = (((await meResp.json()).data || {}).me) || {};
    const bitmojiUrl = String((me.bitmoji || {}).avatar || '');
    // Only a normal https picture address is accepted (it is shown as an <img> to everyone who sees this customer)
    if (!/^https:\/\/[^\s"'<>]+$/.test(bitmojiUrl) || bitmojiUrl.length > 1000) return res.redirect('/?snap_error=no_bitmoji');

    await db.query("UPDATE users SET avatar_url = $2, avatar_source = 'snap' WHERE id = $1", [user.id, bitmojiUrl]);
    res.redirect('/?snap_connected=1');
  } catch (err) {
    console.error('Snap callback failed:', err.message);
    res.redirect('/?snap_error=callback_failed');
  }
}));

// Removes the Bitmoji from the account; the profile goes back to the default avatar
app.delete('/api/account/snap', _requireUser(), _async(async (req, res) => {
  await db.query("UPDATE users SET avatar_url = '', avatar_source = '' WHERE id = $1 AND avatar_source = 'snap'", [req.user.id]);
  res.json({ success: true });
}));

// ── /api/add-product ─────────────────────────────────────────────────────────
// images[] is an array of permanent Cloudinary URLs — no disk writes needed.
// The vendor says what kind of item it is; that decides how Virtual Try-On wears it.
const _ITEM_TYPES = {
  shirt:     ['Shirt / T-shirt / Blouse', 'tops'],
  hoodie:    ['Hoodie / Sweater', 'tops'],
  jacket:    ['Jacket / Blazer / Coat', 'outerwear'],
  trousers:  ['Trousers / Jeans / Shorts', 'bottoms'],
  skirt:     ['Skirt', 'bottoms'],
  dress:     ['Dress / Gown / Jumpsuit', 'one-piece'],
  native:    ['Native wear (kaftan, agbada, abaya)', 'one-piece'],
  shoes:     ['Shoes', 'shoes'],
  hat:       ['Cap / Hat', 'hats'],
  jewellery: ['Jewellery / Watch', 'jewelry'],
  bag:       ['Bag', 'bags'],
};
const _PRODUCT_FITS = ['', 'Slim', 'Regular', 'Loose', 'Oversized'];
const _DESCRIPTION_MIN = 40;
const _line = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

app.get('/api/item-types', (_req, res) => res.json({
  types: Object.entries(_ITEM_TYPES).map(([id, [label]]) => ({ id, label })), fits: _PRODUCT_FITS.filter(Boolean), descriptionMin: _DESCRIPTION_MIN,
}));

app.post('/api/add-product', _requireUser(['vendor', 'admin']), _async(async (req, res) => {
  const {
    brandName, category, name: rawName, itemType,
    price = 0, compare = 0, discount = 0,
    sizes = [], colors = ['Default'], stock = 99,
    images = []
  } = req.body || {};
  const productName = _line(rawName, 80);
  const description = String((req.body || {}).description || '').trim().slice(0, 1500);
  const material = _line((req.body || {}).material, 80);
  const care = _line((req.body || {}).care, 200);
  const fit = _PRODUCT_FITS.includes((req.body || {}).fit) ? req.body.fit : '';

  if (!brandName || !category || !productName) return res.status(400).json({ error: 'Missing required fields' });
  if (req.user.role === 'vendor' && String(brandName).toLowerCase() !== (req.user.brand_name || '').toLowerCase()) {
    return res.status(403).json({ error: 'You can only add products for your own brand' });
  }
  const type = Object.prototype.hasOwnProperty.call(_ITEM_TYPES, itemType) ? _ITEM_TYPES[itemType] : null;
  if (!type) return res.status(400).json({ error: 'Choose what kind of item this is (shirt, jacket, trousers…)' });
  const gender = (req.body || {}).gender;
  if (!_PRODUCT_GENDERS.includes(gender)) return res.status(400).json({ error: 'Choose who the item is for: men, women or unisex' });
  if (!(Number(price) > 0)) return res.status(400).json({ error: 'Please enter a price' });
  if (description.length < _DESCRIPTION_MIN) return res.status(400).json({ error: 'Write a description of at least ' + _DESCRIPTION_MIN + ' characters so buyers know what they are getting' });
  if (!material) return res.status(400).json({ error: 'Say what the item is made of' });
  const cleanSizes = (Array.isArray(sizes) ? sizes : []).map(s => _line(s, 20)).filter(Boolean).slice(0, 30);
  if (!cleanSizes.length) return res.status(400).json({ error: 'Enter the sizes you have' });
  const cleanColors = (Array.isArray(colors) ? colors : []).map(s => _line(s, 30)).filter(Boolean).slice(0, 30);
  const validImages = (Array.isArray(images) ? images : []).filter(u => typeof u === 'string' && u.startsWith('https://')).slice(0, 8);
  if (!validImages.length) return res.status(400).json({ error: 'Add the main picture of the item on a white background' });

  const newProduct = {
    id:          Date.now(),
    name:        productName,
    brand:       brandName,
    category:    _line(category, 40),
    itemType,
    itemTypeLabel: type[0],
    tryonSlot:   type[1],
    gender,
    img:         validImages[0],
    images:      validImages,
    price:       Number(price)   || 0,
    compare:     Number(compare) || Number(price) || 0,
    discount:    Number(discount) || 0,
    description,
    material,
    fit,
    care,
    sizes:       cleanSizes,
    colors:      cleanColors.length ? cleanColors : ['Default'],
    stock:       Number(stock) || 99,
    rating:      0,
    reviews:     0,
    tags:        [String(brandName).toLowerCase(), String(category).toLowerCase(), itemType],
  };

  await db.query('INSERT INTO vendor_products (id, brand, data) VALUES ($1, $2, $3)', [String(newProduct.id), String(brandName), JSON.stringify(newProduct)]);
  _vendorProducts.push(newProduct);

  res.json({ success: true, product: newProduct });
}));

// ── /api/update-price ────────────────────────────────────────────────────────
app.post('/api/update-price', _requireUser(['vendor', 'admin']), _async(async (req, res) => {
  const { productId, brandName, productBase, price = 0, compare = 0 } = req.body || {};
  if (!productId || !brandName) return res.status(400).json({ error: 'Missing fields' });
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && String(brandName).toLowerCase() !== (req.user.brand_name || '').toLowerCase()) {
    return res.status(403).json({ error: 'You can only change prices for your own brand' });
  }
  if (!(Number(price) > 0)) return res.status(400).json({ error: 'Please enter a price' });
  const p = Number(price) || 0;
  const c = Number(compare) || p;
  const disc = c > p ? Math.round((1 - p / c) * 100) : 0;

  // A vendor-added product (kept in the database)
  const mine = _vendorProducts.find(cp => String(cp.id) === String(productId) &&
    (isAdmin || String(cp.brand).toLowerCase() === String(brandName).toLowerCase()));
  if (mine) {
    const next = { ...mine, price: p, compare: c, discount: disc };
    await db.query('UPDATE vendor_products SET data = $2 WHERE id = $1', [String(mine.id), JSON.stringify(next)]);
    Object.assign(mine, next);
    return res.json({ success: true, price: p, compare: c, discount: disc });
  }

  // Otherwise prices.json in the brand folder (folder brands are managed by admins)
  if (!isAdmin) return res.status(404).json({ error: 'Product not found in your store' });
  if (productBase) {
    const priceFile = path.join(__dirname, 'products', brandName, 'prices.json');
    let prices = {};
    try { prices = JSON.parse(fs.readFileSync(priceFile, 'utf8')); } catch (_x) {}
    prices[productBase] = p;
    try { fs.writeFileSync(priceFile, JSON.stringify(prices, null, 2)); } catch (_x) {}
  }

  res.json({ success: true, price: p, compare: c, discount: disc });
}));

// ── Resend (email delivery via HTTP API — no SMTP needed) ────────────────────
async function _sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'TrendMallz <onboarding@resend.dev>', to, subject, html })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'Resend error');
  return data;
}

// ── Users ─────────────────────────────────────────────────────────────────────
// Admins are whoever is listed in ADMIN_EMAILS; nobody can sign up as one.
// Demo accounts only exist when DEMO_ACCOUNTS=on, which should never be set live.
const _ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const _DEMO_ENABLED = process.env.DEMO_ACCOUNTS === 'on';
const _DEMO_USERS = [
  { id: 'u1', email: 'customer@demo.com',    fname: 'Emeka',  lname: 'Johnson',    role: 'customer', brand_name: '',            referral_code: 'REF-EJ2024', password: 'demo123' },
  { id: 'u2', email: 'vendor@demo.com',      fname: 'Adaeze', lname: 'Obi',        role: 'vendor',   brand_name: 'NOX Apparel', referral_code: 'REF-AO2024', password: 'demo123' },
  { id: 'u3', email: 'admin@trendmallz.com', fname: 'Admin',  lname: 'TrendMallz', role: 'admin',    brand_name: '',            referral_code: 'REF-ADMIN',  password: 'admin123' },
];

function _normEmail(email) { return String(email || '').trim().toLowerCase(); }
function _hashPass(pass, salt) {
  return crypto.scryptSync(pass, salt, 64).toString('hex');
}
function _safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function _roleOf(u) {
  if (_ADMIN_EMAILS.includes(u.email)) return 'admin';
  if (u.role === 'admin' && u.salt === 'demo' && _DEMO_ENABLED) return 'admin';
  return u.role === 'vendor' ? 'vendor' : 'customer';
}
// Asked at signup: decides which products are shown first and the default avatar
const _userGender = v => (['male', 'female', 'unspecified'].includes(v) ? v : '');
function _findUserByEmail(email) { return db.one('SELECT * FROM users WHERE email = $1', [_normEmail(email)]); }
function _findUserById(id) { return db.one('SELECT * FROM users WHERE id = $1', [id]); }
function _insertUser(u) {
  return db.query(
    'INSERT INTO users (id, email, password_hash, salt, fname, lname, role, brand_name, country_code, referral_code, gender) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
    [u.id, u.email, u.password_hash, u.salt, u.fname, u.lname, u.role, u.brand_name, u.country_code, u.referral_code, _userGender(u.gender)]
  );
}
async function _seedDemoUsers() {
  for (const d of _DEMO_USERS) {
    await db.query(
      'INSERT INTO users (id, email, password_hash, salt, fname, lname, role, brand_name, country_code, referral_code) ' +
      "VALUES ($1, $2, 'demo', 'demo', $3, $4, $5, $6, 'NG', $7) ON CONFLICT (id) DO NOTHING",
      [d.id, d.email, d.fname, d.lname, d.role, d.brand_name, d.referral_code]
    );
  }
}
function _toSessionUser(u) {
  return {
    id: u.id, fname: u.fname, lname: u.lname, email: u.email,
    role: _roleOf(u), brandName: u.brand_name || '', wallet: u.wallet || 0,
    countryCode: u.country_code || 'NG', gender: u.gender || '',
    avatarUrl: u.avatar_url || '', snapBitmoji: u.avatar_source === 'snap' ? (u.avatar_url || '') : '',
    referralCode: u.referral_code || '',
    referralEarnings: u.referral_earnings || 0, referralCount: u.referral_count || 0,
    orders: [],
  };
}
// Reloads the signed-in user from the database so roles are always current
async function _currentUser(req) {
  const id = req.session.user && req.session.user.id;
  if (!id) return null;
  const u = await _findUserById(id);
  return u ? { ...u, role: _roleOf(u) } : null;
}
function _requireUser(roles) {
  return _async(async (req, res, next) => {
    const u = await _currentUser(req);
    if (!u) return res.status(401).json({ error: 'Please sign in first' });
    if (roles && !roles.includes(u.role)) return res.status(403).json({ error: 'You are not allowed to do that' });
    req.user = u;
    next();
  });
}
function _signIn(req, u) { req.session.user = _toSessionUser(u); return req.session.user; }

// ── Email verification codes ──────────────────────────────────────────────────
// One pending code per email+purpose; held in memory, so a restart cancels it
const _CODE_TTL_MS    = 10 * 60 * 1000;
const _CODE_MAX_TRIES = 5;
const _CODE_RESEND_MS = 60 * 1000;
const _pendingCodes = new Map();

function _codeKey(email, purpose) { return purpose + ':' + _normEmail(email); }
function _hashCode(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }

async function _issueCode(email, purpose, fname, data) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  _pendingCodes.set(_codeKey(email, purpose), {
    codeHash: _hashCode(code), expires: Date.now() + _CODE_TTL_MS,
    sentAt: Date.now(), tries: 0, fname, data,
  });
  const heading = purpose === 'signup' ? 'confirm your email' : 'here is your sign-in code';
  const intro = purpose === 'signup'
    ? 'Enter this code on TrendMallz to finish creating your account.'
    : 'Someone (hopefully you) is signing in to TrendMallz from a new device. Enter this code to continue.';
  await _sendEmail(
    email,
    code + ' is your TrendMallz code',
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#111;color:#f5f4f0;padding:32px;border-radius:16px">' +
    '<h1 style="color:#FF6B00;margin:0 0 4px">TrendMallz</h1>' +
    '<p style="color:#888;margin:0 0 28px;font-size:13px">Africa\'s premier fashion marketplace</p>' +
    '<h2 style="font-size:20px;margin:0 0 12px">Hi ' + fname + ', ' + heading + '</h2>' +
    '<p style="color:#ccc;line-height:1.6;margin:0 0 24px">' + intro + '</p>' +
    '<div style="font-size:34px;font-weight:700;letter-spacing:10px;color:#FF6B00;background:#1c1c1c;padding:16px 24px;border-radius:10px;text-align:center">' + code + '</div>' +
    '<p style="color:#555;font-size:12px;margin:28px 0 0">This code expires in 10 minutes. If you didn\'t request it, you can ignore this email.</p>' +
    '</div>'
  );
}

// Returns the pending entry on success, or { error, status } on failure
function _checkCode(email, purpose, code) {
  const key = _codeKey(email, purpose);
  const p = _pendingCodes.get(key);
  if (!p || Date.now() > p.expires) {
    _pendingCodes.delete(key);
    return { error: 'Code expired. Please request a new one.', status: 410 };
  }
  const given = Buffer.from(_hashCode(String(code || '').trim()), 'hex');
  if (!crypto.timingSafeEqual(given, Buffer.from(p.codeHash, 'hex'))) {
    p.tries += 1;
    if (p.tries >= _CODE_MAX_TRIES) {
      _pendingCodes.delete(key);
      return { error: 'Too many wrong attempts. Please request a new code.', status: 429 };
    }
    return { error: 'Incorrect code. ' + (_CODE_MAX_TRIES - p.tries) + ' attempt(s) left.', status: 400 };
  }
  _pendingCodes.delete(key);
  return p;
}

// ── Trusted devices ───────────────────────────────────────────────────────────
// A signed cookie marks a browser that has passed a code for a given user
const _DEVICE_COOKIE = 'tm_device';
const _DEVICE_TTL_MS = 30 * 24 * 3600 * 1000;
const _DEVICE_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function _signDevice(payload) {
  return crypto.createHmac('sha256', _DEVICE_SECRET).update(payload).digest('base64url');
}
function _readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function _isTrustedDevice(req, userId) {
  const [payload, sig] = _readCookie(req, _DEVICE_COOKIE).split('.');
  if (!payload || !sig || !_safeEqual(sig, _signDevice(payload))) return false;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return u === userId && Date.now() < exp;
  } catch (_x) { return false; }
}
function _trustDevice(res, userId) {
  const payload = Buffer.from(JSON.stringify({ u: userId, exp: Date.now() + _DEVICE_TTL_MS })).toString('base64url');
  res.cookie(_DEVICE_COOKIE, payload + '.' + _signDevice(payload), {
    httpOnly: true, sameSite: 'lax', maxAge: _DEVICE_TTL_MS,
    secure: process.env.NODE_ENV === 'production',
  });
}

// ── GET /api/config ───────────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({ demoAccounts: _DEMO_ENABLED });
});

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
app.post('/api/auth/signup', _async(async (req, res) => {
  const { fname, lname, password, countryCode = 'NG' } = req.body || {};
  const email = _normEmail(req.body && req.body.email);
  const role = req.body && req.body.role === 'vendor' ? 'vendor' : 'customer';
  const brandName = role === 'vendor' ? String((req.body && req.body.brandName) || '').trim() : '';
  if (!fname || !lname || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const gender = _userGender(req.body && req.body.gender);
  if (!gender) return res.status(400).json({ error: 'Please choose your gender' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (await _findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });
  if (role === 'vendor') {
    if (!brandName) return res.status(400).json({ error: 'Please enter your brand name' });
    const taken = _buildCatalog().some(p => p.brand.toLowerCase() === brandName.toLowerCase()) ||
      await db.one('SELECT 1 FROM users WHERE lower(brand_name) = lower($1)', [brandName]);
    if (taken) return res.status(409).json({ error: 'That brand name is already registered on TrendMallz' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const userData = {
    id: 'u' + Date.now() + crypto.randomBytes(2).toString('hex'), email,
    password_hash: _hashPass(password, salt), salt,
    fname: String(fname).trim(), lname: String(lname).trim(), role, brand_name: brandName,
    country_code: String(countryCode || 'NG').slice(0, 2), gender,
    referral_code: (fname + lname).replace(/\s/g, '').toUpperCase().slice(0, 5) + crypto.randomBytes(2).toString('hex').toUpperCase(),
  };
  if (!process.env.RESEND_API_KEY) {
    // No email provider configured (local dev): create the account straight away
    await _insertUser(userData);
    return res.json({ success: true, autoVerified: true, user: _signIn(req, userData) });
  }
  try {
    await _issueCode(email, 'signup', userData.fname, userData);
    res.json({ success: true, needsCode: true, email });
  } catch (err) {
    console.error('Mail error:', err.message);
    res.status(500).json({ error: 'Email delivery failed: ' + err.message });
  }
}));

// Lets an existing account set or change its gender
app.put('/api/account/gender', _requireUser(), _async(async (req, res) => {
  const gender = _userGender(req.body && req.body.gender);
  if (!gender) return res.status(400).json({ error: 'Please choose your gender' });
  await db.query('UPDATE users SET gender = $2 WHERE id = $1', [req.user.id, gender]);
  res.json({ success: true, gender });
}));

// ── POST /api/auth/verify-signup ──────────────────────────────────────────────
app.post('/api/auth/verify-signup', _async(async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });
  const result = _checkCode(email, 'signup', code);
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (await _findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered. Please sign in.' });
  await _insertUser(result.data);
  _trustDevice(res, result.data.id);
  res.json({ success: true, user: _signIn(req, result.data) });
}));

// ── POST /api/auth/login ──────────────────────────────────────────────────────
app.post('/api/auth/login', _async(async (req, res) => {
  const { password } = req.body || {};
  const email = _normEmail(req.body && req.body.email);
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = await _findUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const isDemo = user.salt === 'demo';
  if (isDemo && !_DEMO_ENABLED) return res.status(401).json({ error: 'Invalid email or password' });
  const demoPass = user.role === 'admin' ? 'admin123' : 'demo123';
  const ok = isDemo ? password === demoPass : _safeEqual(_hashPass(password, user.salt), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  // Demo accounts can't receive email; real accounts on a new device must enter a code
  if (!isDemo && process.env.RESEND_API_KEY && !_isTrustedDevice(req, user.id)) {
    try {
      await _issueCode(email, 'login', user.fname, { userId: user.id });
      return res.json({ success: true, needsCode: true, email });
    } catch (err) {
      console.error('Mail error:', err.message);
      return res.status(500).json({ error: 'Could not send sign-in code: ' + err.message });
    }
  }
  res.json({ success: true, user: _signIn(req, user) });
}));

// ── POST /api/auth/verify-login ───────────────────────────────────────────────
app.post('/api/auth/verify-login', _async(async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });
  const result = _checkCode(email, 'login', code);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const user = await _findUserByEmail(email);
  if (!user || user.id !== result.data.userId) return res.status(401).json({ error: 'Account not found' });
  _trustDevice(res, user.id);
  res.json({ success: true, user: _signIn(req, user) });
}));

// ── POST /api/auth/resend-code ────────────────────────────────────────────────
app.post('/api/auth/resend-code', async (req, res) => {
  const { email, purpose } = req.body || {};
  if (!email || !['signup', 'login'].includes(purpose)) return res.status(400).json({ error: 'Invalid request' });
  const p = _pendingCodes.get(_codeKey(email, purpose));
  if (!p) return res.status(410).json({ error: 'Session expired. Please start again.' });
  const wait = Math.ceil((p.sentAt + _CODE_RESEND_MS - Date.now()) / 1000);
  if (wait > 0) return res.status(429).json({ error: 'Please wait ' + wait + 's before requesting another code.' });
  try {
    await _issueCode(email, purpose, p.fname, p.data);
    res.json({ success: true });
  } catch (err) {
    console.error('Mail error:', err.message);
    res.status(500).json({ error: 'Email delivery failed: ' + err.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
app.get('/api/auth/me', _async(async (req, res) => {
  const u = await _currentUser(req);
  if (!u) { delete req.session.user; return res.json({ user: null }); }
  res.json({ user: _signIn(req, u) });
}));

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

// ── Pricing ───────────────────────────────────────────────────────────────────
// The server prices every order from the catalog; the browser only says what it wants
const _DELIVERY_FEE       = 2500;
const _FREE_DELIVERY_FROM = 30000;
const _COMMISSION_RATE    = 0.1;
const _COUPONS = {
  WELCOME10: { discount: 0.1, label: '10% off' },
  FREESHIP:  { freeShip: true, label: 'Free delivery' },
};
const _ORDER_STATUSES = ['Processing', 'In Transit', 'Delivered', 'Cancelled'];

function _priceOrder(rawItems, couponCode) {
  if (!Array.isArray(rawItems) || !rawItems.length) return { error: 'Your cart is empty' };
  if (rawItems.length > 50) return { error: 'Too many items in one order' };
  const catalog = new Map(_buildCatalog().map(p => [p.id, p]));
  const items = [];
  for (const it of rawItems) {
    const p = catalog.get(Number(it && it.productId));
    if (!p || !(p.price > 0)) {
      return { error: 'An item in your cart is no longer available. Please remove it and try again.' };
    }
    const qty = Math.floor(Number(it.qty));
    if (!(qty >= 1 && qty <= 20)) return { error: 'Invalid quantity for ' + p.name };
    items.push({
      productId: p.id, name: p.name, brand: p.brand, img: p.img, price: p.price, qty,
      size: String(it.size || '').slice(0, 20), color: String(it.color || '').slice(0, 30),
    });
  }
  const code = String(couponCode || '').trim().toUpperCase();
  const coupon = code ? _COUPONS[code] : null;
  if (code && !coupon) return { error: 'Invalid coupon code' };
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = coupon && coupon.discount ? Math.round(subtotal * coupon.discount) : 0;
  const delivery = (coupon && coupon.freeShip) || subtotal >= _FREE_DELIVERY_FROM ? 0 : _DELIVERY_FEE;
  return {
    items, subtotal, discount, delivery,
    total: subtotal - discount + delivery,
    commission: Math.round(subtotal * _COMMISSION_RATE),
    coupon: coupon ? { code, label: coupon.label } : null,
  };
}

const _SHIPPING_FIELDS = {
  fname: 'first name', lname: 'last name', phone: 'phone', address: 'delivery address', city: 'city', state: 'state',
};
function _cleanShipping(s) {
  s = s || {};
  const out = {};
  for (const k of ['fname', 'lname', 'email', 'phone', 'address', 'city', 'state']) out[k] = String(s[k] || '').trim().slice(0, 200);
  const missing = Object.keys(_SHIPPING_FIELDS).filter(k => !out[k]);
  if (missing.length) return { error: 'Please enter your ' + missing.map(k => _SHIPPING_FIELDS[k]).join(', ') };
  return { shipping: out };
}

// ── Orders ────────────────────────────────────────────────────────────────────
function _orderOut(o) {
  return {
    id: o.id, userId: o.user_id, reference: o.reference, trackingId: o.reference,
    date: new Date(o.created_at).toISOString().split('T')[0],
    status: o.status, paymentStatus: o.payment_status,
    items: o.items, subtotal: o.subtotal, discount: o.discount, delivery: o.delivery,
    total: o.total, commission: o.commission, coupon: o.coupon, shipping: o.shipping,
    customerName: o.shipping.fname + ' ' + o.shipping.lname,
  };
}

// ── POST /api/orders/quote ────────────────────────────────────────────────────
app.post('/api/orders/quote', (req, res) => {
  const { items, coupon } = req.body || {};
  const priced = _priceOrder(items, coupon);
  if (priced.error) return res.status(400).json({ error: priced.error });
  res.json(priced);
});

// ── POST /api/orders ──────────────────────────────────────────────────────────
// Creates an order awaiting payment; Paystack is then opened for its reference
app.post('/api/orders', _requireUser(), _async(async (req, res) => {
  if (!PAYSTACK_PUBLIC_KEY || !PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Payments are not configured yet' });
  const { items, coupon, shipping } = req.body || {};
  const priced = _priceOrder(items, coupon);
  if (priced.error) return res.status(400).json({ error: priced.error });
  const ship = _cleanShipping(shipping);
  if (ship.error) return res.status(400).json({ error: ship.error });
  const reference = 'TM-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
  const row = await db.one(
    'INSERT INTO orders (id, reference, user_id, items, subtotal, discount, delivery, total, commission, coupon, shipping) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
    ['o' + Date.now() + crypto.randomBytes(2).toString('hex'), reference, req.user.id, JSON.stringify(priced.items),
     priced.subtotal, priced.discount, priced.delivery, priced.total, priced.commission,
     priced.coupon ? priced.coupon.code : null, JSON.stringify(ship.shipping)]
  );
  res.json({
    order: _orderOut(row), reference, amount: priced.total * 100,
    email: req.user.email, publicKey: PAYSTACK_PUBLIC_KEY,
  });
}));

// Checks a reference with Paystack and marks the matching order paid.
// Used by both the browser callback and the webhook; safe to call repeatedly.
async function _confirmPayment(reference) {
  const order = await db.one('SELECT * FROM orders WHERE reference = $1', [reference]);
  if (!order) return { status: 404, error: 'Order not found' };
  if (order.payment_status === 'paid') return { order };
  const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET_KEY },
  });
  const data = await r.json();
  if (!r.ok || !data.status) return { status: 502, error: data.message || 'Paystack verification failed' };
  const tx = data.data;
  if (tx.status !== 'success') return { status: 402, error: 'Payment not successful (' + tx.status + ')' };
  // requested_amount excludes fees added when "pass charges to customer" is on
  const paidFor = tx.requested_amount ?? tx.amount;
  if (tx.currency !== 'NGN' || paidFor !== order.total * 100) {
    console.error('Paystack amount mismatch for ' + reference + ': paid ' + paidFor + ' ' + tx.currency + ', expected ' + order.total * 100);
    await db.query("UPDATE orders SET payment_status = 'amount_mismatch' WHERE id = $1 AND payment_status = 'pending'", [order.id]);
    return { status: 400, error: 'Amount paid does not match the order total. Please contact support with reference ' + reference };
  }
  const updated = await db.one(
    "UPDATE orders SET payment_status = 'paid', status = 'Processing', paid_amount = $2, paid_at = now() " +
    "WHERE id = $1 AND payment_status <> 'paid' RETURNING *",
    [order.id, tx.amount]
  );
  return { order: updated || await db.one('SELECT * FROM orders WHERE id = $1', [order.id]) };
}

// ── GET /api/paystack/config ──────────────────────────────────────────────────
app.get('/api/paystack/config', (_req, res) => {
  res.json({ publicKey: PAYSTACK_PUBLIC_KEY });
});

// ── POST /api/paystack/verify ─────────────────────────────────────────────────
app.post('/api/paystack/verify', _requireUser(), _async(async (req, res) => {
  const { reference } = req.body || {};
  if (!PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Paystack is not configured' });
  if (!reference) return res.status(400).json({ error: 'Missing reference' });
  const owner = await db.one('SELECT user_id FROM orders WHERE reference = $1', [reference]);
  if (!owner || owner.user_id !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  const result = await _confirmPayment(reference);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ success: true, order: _orderOut(result.order) });
}));

// ── POST /api/paystack/webhook ────────────────────────────────────────────────
// Paystack calls this when a charge succeeds, so orders are marked paid even if
// the customer closes the tab first. Set the URL in Paystack → Settings → API Keys.
app.post('/api/paystack/webhook', (req, res) => {
  const sig = req.get('x-paystack-signature') || '';
  const expected = PAYSTACK_SECRET_KEY && req.rawBody
    ? crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(req.rawBody).digest('hex') : '';
  if (!expected || !_safeEqual(sig, expected)) return res.sendStatus(401);
  res.sendStatus(200);
  const event = req.body || {};
  if (event.event === 'charge.success' && event.data && event.data.reference) {
    _confirmPayment(event.data.reference)
      .then(r => { if (r.error && r.status !== 404) console.error('Webhook confirm ' + event.data.reference + ':', r.error); })
      .catch(err => console.error('Webhook error:', err.message));
  }
});

// ── GET /api/orders ───────────────────────────────────────────────────────────
// Customers see their own paid orders, vendors the paid orders containing their
// products (only their items), and admins every paid order.
app.get('/api/orders', _requireUser(), _async(async (req, res) => {
  const u = req.user;
  if (u.role === 'admin') {
    const rows = await db.query("SELECT * FROM orders WHERE payment_status = 'paid' ORDER BY created_at");
    return res.json({ orders: rows.map(_orderOut) });
  }
  if (u.role === 'vendor') {
    const brand = (u.brand_name || '').toLowerCase();
    const rows = await db.query("SELECT * FROM orders WHERE payment_status = 'paid' ORDER BY created_at");
    const orders = rows.map(_orderOut).map(o => {
      const items = o.items.filter(i => String(i.brand).toLowerCase() === brand);
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      return { ...o, items, subtotal, commission: Math.round(subtotal * _COMMISSION_RATE) };
    }).filter(o => o.items.length);
    return res.json({ orders });
  }
  const rows = await db.query("SELECT * FROM orders WHERE user_id = $1 AND payment_status = 'paid' ORDER BY created_at", [u.id]);
  res.json({ orders: rows.map(_orderOut) });
}));

// ── PATCH /api/orders/:id/status ──────────────────────────────────────────────
app.patch('/api/orders/:id/status', _requireUser(['admin']), _async(async (req, res) => {
  const { status } = req.body || {};
  if (!_ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const row = await db.one(
    "UPDATE orders SET status = $2 WHERE id = $1 AND payment_status = 'paid' RETURNING *", [req.params.id, status]
  );
  if (!row) return res.status(404).json({ error: 'Order not found' });
  res.json({ success: true, order: _orderOut(row) });
}));

// ── GET /api/admin/users ──────────────────────────────────────────────────────
app.get('/api/admin/users', _requireUser(['admin']), _async(async (_req, res) => {
  const [users, paid] = await Promise.all([
    db.query('SELECT * FROM users ORDER BY created_at'),
    db.query("SELECT id, user_id, items FROM orders WHERE payment_status = 'paid'"),
  ]);
  res.json({
    users: users.map(u => {
      const brand = (u.brand_name || '').toLowerCase();
      const storeRevenue = brand ? paid.reduce((s, o) => s + o.items
        .filter(i => String(i.brand).toLowerCase() === brand)
        .reduce((t, i) => t + i.price * i.qty, 0), 0) : 0;
      return {
        id: u.id, email: u.email, fname: u.fname, lname: u.lname, role: _roleOf(u),
        brandName: u.brand_name, countryCode: u.country_code, wallet: u.wallet,
        referralCount: u.referral_count, createdAt: new Date(u.created_at).toISOString().split('T')[0],
        orders: paid.filter(o => o.user_id === u.id).map(o => o.id), storeRevenue,
      };
    }),
  });
}));

// ── Errors ────────────────────────────────────────────────────────────────────
// ── Virtual try-on (FASHN) ────────────────────────────────────────────────────
// Each customer saves one try-on photo to their account. A try-on sends that photo
// and the product image to FASHN; results are kept so repeating a try-on is free.
const _TRYON_PHOTO_MAX   = 4 * 1024 * 1024; // bytes of base64 text

const _FASHN_ERRORS = {
  PoseError:         "We couldn't see your body clearly. Use a full-body photo, standing straight and facing the camera.",
  ImageLoadError:    "The photo couldn't be read. Try uploading it again.",
  ContentModerationError: 'This photo was rejected by the safety filter. Please use a different photo.',
};

async function _fashn(method, endpoint, body) {
  const r = await fetch('https://api.fashn.ai/v1' + endpoint, {
    method,
    headers: { Authorization: 'Bearer ' + FASHN_API_KEY, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data.error && (data.error.message || data.error)) || data.message || ('FASHN request failed (' + r.status + ')');
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

function _tryonErrorText(err) {
  if (!err) return 'Try-on failed. Please try again.';
  return _FASHN_ERRORS[err.name] || err.message || 'Try-on failed. Please try again.';
}

// Product image as something FASHN can load: catalog files become data URIs
function _garmentImage(product) {
  const img = product.tryonImg || product.img || (product.images || [])[0];
  if (!img) return null;
  if (/^https?:\/\//.test(img)) return img;
  const productsDir = path.join(__dirname, 'products');
  const file = path.join(__dirname, ...decodeURIComponent(img).replace(/^\//, '').split('/'));
  if (!file.startsWith(productsDir + path.sep) || !fs.existsSync(file)) return null;
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
}

// '' (own hair) or a #rrggbb colour picked on the site
function _hairColour(v) {
  const s = String(v || '').toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : '';
}

app.get('/api/tryon/config', (_req, res) => res.json({ available: !!FASHN_API_KEY, free: _TRYON_FREE, notesMax: _TRYON_NOTES_MAX }));

app.get('/api/tryon/allowance', _requireUser(), _async(async (req, res) => {
  const photo = await db.one('SELECT ver FROM tryon_photos WHERE user_id = $1', [req.user.id]);
  res.json({ ...(await _tryonAllowance(req.user.id)), hasPhoto: !!photo, notesMax: _TRYON_NOTES_MAX });
}));

app.get('/api/tryon/photo', _requireUser(), _async(async (req, res) => {
  const row = await db.one('SELECT photo FROM tryon_photos WHERE user_id = $1', [req.user.id]);
  res.json({ photo: row ? row.photo : null });
}));

app.put('/api/tryon/photo', _requireUser(), _async(async (req, res) => {
  const photo = String((req.body || {}).photo || '');
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) return res.status(400).json({ error: 'Please upload a JPG, PNG or WebP photo' });
  if (photo.length > _TRYON_PHOTO_MAX) return res.status(413).json({ error: 'That photo is too large. Please use a smaller one.' });
  // Results are tied to the exact picture: the same picture always gets the same id, so
  // its saved looks are reused, and a different picture can never get another one's results.
  // The browser sends a fingerprint of the original file (its resized copy can vary by device).
  const sourceHash = String((req.body || {}).sourceHash || '');
  const ver = /^[0-9a-f]{64}$/.test(sourceHash)
    ? sourceHash.slice(0, 32)
    : crypto.createHash('sha256').update(photo).digest('hex').slice(0, 32);
  await db.query(
    'INSERT INTO tryon_photos (user_id, photo, ver, updated_at) VALUES ($1, $2, $3, now()) ' +
    'ON CONFLICT (user_id) DO UPDATE SET photo = EXCLUDED.photo, ver = EXCLUDED.ver, updated_at = now()',
    [req.user.id, photo, ver]
  );
  await db.query(
    'INSERT INTO tryon_photo_versions (user_id, ver, photo) VALUES ($1, $2, $3) ON CONFLICT (user_id, ver) DO NOTHING',
    [req.user.id, ver, photo]
  );
  res.json({ success: true });
}));

// ── Outfits ──────────────────────────────────────────────────────────────────
// A try-on is an outfit of one or more items. The photo is dressed one item at a time,
// each step starting from the previous result. Every step is saved per exact picture,
// so an outfit that shares a start with an earlier one (same picture, same first items)
// only pays for the new items.
// Items added on top of the clothes, one at a time, always with the Quality settings
const _ACCESSORY_SLOTS = new Set(['outerwear', 'shoes', 'hats', 'jewelry', 'bags']);
const _DRESS_ORDER = ['one-piece', 'bottoms', 'tops', 'outerwear', 'shoes', 'hats', 'jewelry', 'bags'];
const _SLOT_LABELS = { 'one-piece': 'dress/jumpsuit', bottoms: 'bottom', tops: 'top', outerwear: 'jacket or coat', shoes: 'pair of shoes', hats: 'hat', jewelry: 'piece of jewellery', bags: 'bag' };

function _outfitIds(body) {
  const raw = Array.isArray(body.productIds) ? body.productIds : (body.productId !== undefined ? [body.productId] : []);
  return [...new Set(raw.map(String).filter(Boolean))];
}

// ── Quick preview and Quality ────────────────────────────────────────────────
// Quick preview: the standard model, which takes no instructions.
// Quality: Try-On Max with a detailed instruction, plus anything the customer asked for.
// Every account gets a number of each for free; opening a saved look again costs nothing.
function _envCount(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const _TRYON_FREE = { quick: _envCount('TRYON_FREE_QUICK', 5), quality: _envCount('TRYON_FREE_QUALITY', 2) };
const _TRYON_MODE_NAMES = { quick: 'quick previews', quality: 'Quality try-ons' };
const _TRYON_QUALITY_MODE = ['fast', 'balanced', 'quality'].includes(process.env.TRYON_QUALITY_MODE) ? process.env.TRYON_QUALITY_MODE : 'balanced';
const _TRYON_NOTES_MAX = 240;

function _tryonMode(v) { return v === 'quality' ? 'quality' : 'quick'; }

// The customer's own instruction: one plain line, no quotes or markup
function _tryonNotes(v) {
  return String(v || '').replace(/[\u0000-\u001f"\u201c\u201d`<>{}\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, _TRYON_NOTES_MAX);
}

// Steps made with different settings must never be mixed up
function _tryonVariant(mode, notes) {
  if (mode !== 'quality') return '';
  return 'q' + crypto.createHash('sha256').update(_TRYON_QUALITY_MODE + '|' + notes).digest('hex').slice(0, 16);
}

const _WEAR = {
  tops: {
    what: 'the upper-body garment shown in the product image, worn as their top',
    remove: 'Completely remove the top they are wearing now, including any jacket, blazer, tie, scarf, collar or sleeves that go with it, so that no part of the old top shows anywhere: not at the neck, the wrists or the waist.',
    keep: 'Keep their trousers, skirt or shorts and their shoes exactly as they are.',
  },
  bottoms: {
    what: 'the lower-body garment shown in the product image, worn as their trousers, skirt or shorts',
    remove: 'Completely remove the trousers, skirt or shorts they are wearing now, so that no part of the old one shows anywhere.',
    keep: 'Keep their top and their shoes exactly as they are.',
  },
  'one-piece': {
    what: 'the dress, jumpsuit or full outfit shown in the product image',
    remove: 'Completely remove the top and the bottom they are wearing now, so that no part of the old clothes shows anywhere.',
    keep: 'Keep their shoes exactly as they are.',
  },
  outerwear: {
    what: 'the jacket, coat or outer layer shown in the product image, worn as a second layer over the clothes they already have on',
    remove: 'Do not remove the top or dress they are wearing: it stays on underneath, unchanged, and stays visible wherever the outer layer does not cover it: at the neck, down the open front and below the hem. If the person is already wearing a jacket, blazer or coat, the new one replaces that jacket only, and the shirt or top under it stays.',
    keep: 'Keep their trousers, skirt or shorts and their shoes exactly as they are. Unless the customer asks otherwise below, wear the outer layer open at the front, with both arms in the sleeves, hanging naturally from the shoulders at its full length, with realistic folds and shadows that match the light in the photo.',
  },
  shoes: {
    what: 'the shoes shown in the product image, one on each foot',
    remove: 'They replace the shoes the person is wearing now.',
    keep: 'Keep all of their clothes exactly as they are. If the feet are not in the photo, change nothing.',
  },
  hats: {
    what: 'the hat or headwear shown in the product image, on their head',
    remove: 'It replaces any hat they are wearing now.',
    keep: 'Keep all of their clothes exactly as they are, and keep the hair that would still show around the hat.',
  },
  jewelry: {
    what: 'the jewellery shown in the product image, worn where that kind of jewellery is normally worn',
    remove: 'It replaces only jewellery of the same kind in the same place.',
    keep: 'Keep all of their clothes exactly as they are.',
  },
  bags: {
    what: 'the bag shown in the product image, carried or worn the natural way for that kind of bag',
    remove: 'It replaces any bag they are carrying now.',
    keep: 'Keep all of their clothes exactly as they are.',
  },
};

// The instruction sent to Try-On Max for one item
function _qualityPrompt(product, notes) {
  const slot = _WEAR[product.tryonSlot] ? product.tryonSlot : 'tops';
  const w = _WEAR[slot];
  const parts = [
    'Virtual try-on. Dress the person in the photo in ' + w.what + '. ' + w.remove + ' ' + w.keep,
    'Copy the product exactly: the same colour, material, pattern, cut, length, sleeve length, collar, pockets, buttons and zips. Keep any logo, print or text exactly as it is in the product image: the same words, the same size, the same position, on the same side, not mirrored and not redrawn.',
  ];
  if (!_ACCESSORY_SLOTS.has(slot)) {
    parts.push('Unless the customer asks otherwise below, wear it the usual way: closed, with any buttons or zip done up, at its full length, hanging naturally on the body with realistic folds and shadows that match the light in the photo. Do not shorten it or show bare skin that the garment would cover.');
  }
  parts.push(
    'Show the product only on the parts of the body that are visible in the photo. If the photo is cut off, for example at the waist or the knees, the product is cut off at the same place. Never paste the flat product picture into the photo, never show its background, and never extend, crop, zoom or re-frame the photo.',
    'Do not change the person: keep the same face, expression, hairstyle, hair colour, skin tone, body shape, hands, pose, arm and leg positions, and anything they are holding. Keep the same background, lighting, camera angle and picture size. Do not add tattoos, jewellery, accessories, text or any clothing that is not in the product image. The person must stay fully and decently dressed.'
  );
  if (notes) {
    parts.push('The customer asks: "' + notes + '". Follow this for how the product is worn, fitted or styled, even where it differs from the usual way described above. Ignore any part of it that would change the person\'s face, body or identity, undress them, or add something that is not in the product image.');
  }
  return parts.join(' ');
}

// ── Outfit sheet (quick preview of 2+ items in one call) ─────────────────────
// The browser lays every item of the outfit on one white picture, top to bottom in
// _SHEET_ORDER, and the whole outfit is put on in a single Try-On Max call. The prompt
// is written from the items that are actually on the sheet.
const _SHEET_ORDER = ['hats', 'tops', 'one-piece', 'bottoms', 'shoes', 'jewelry', 'bags'];
const _SHEET_MAX = 2 * 1024 * 1024; // bytes of base64 text
const _SHEET_ITEMS = {
  hats: {
    name: 'a hat or piece of headwear',
    wear: "The hat goes on the person's head, at the right size and angle for the head, replacing any hat they are wearing now. Keep the hair that would still show around it.",
  },
  tops: {
    name: 'an upper-body garment',
    wear: "The upper-body garment is their top. Put it on the torso and arms: closed, with any buttons or zip done up, at its full length, with the sleeves on the arms. Completely remove the top they are wearing now, including any jacket, blazer, tie, scarf, collar or long sleeves that go with it, so that no part of the old top shows anywhere: not at the neck, not on the arms or wrists, not at the waist.",
  },
  'one-piece': {
    name: 'a dress, jumpsuit or full outfit',
    wear: "The dress, jumpsuit or full outfit covers the body the way it is cut, at its full length. Completely remove the top and the bottom they are wearing now, so that no part of the old clothes shows anywhere.",
  },
  bottoms: {
    name: 'a lower-body garment',
    wear: "The lower-body garment is their trousers, skirt or shorts. Put it on the hips and legs, starting at the waist and running down at its full length. Each trouser leg wraps all the way round one of the person's legs and follows that leg's exact position, direction and bend, with natural creases at the hips and knees and the hem resting where it would on a real leg. It must look like real cloth worn on a body with depth and shadow, never a flat cut-out laid over the legs, and its shape must come from the person's legs, not from how it lies on the sheet. Completely remove the trousers, skirt or shorts they are wearing now, including any belt, so that none of the old one shows.",
  },
  shoes: {
    name: 'a pair of shoes',
    wear: "The shoes go on the person's feet, one on each foot, at the right size and angle for each foot and standing on the same ground, replacing the shoes they are wearing now. The hem of the trousers falls naturally over or just above them. If the feet are not in the photo, leave the shoes out.",
  },
  jewelry: {
    name: 'a piece of jewellery',
    wear: "The jewellery is worn where that kind of jewellery is normally worn, at its real size, lying on top of the clothes or skin, replacing only jewellery of the same kind in the same place.",
  },
  bags: {
    name: 'a bag',
    wear: "The bag is carried or worn the natural way for that kind of bag, at its real size, without changing the position of the person's arms more than is needed to hold it.",
  },
};
const _COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

function _tryonSheet(v) {
  const s = String(v || '');
  return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= _SHEET_MAX ? s : null;
}

// The instruction for an outfit sheet, written from the items on it
function _sheetPrompt(products) {
  const slots = _SHEET_ORDER.filter(s => products.some(p => p.tryonSlot === s));
  const has = s => slots.includes(s);
  const n = _COUNT_WORDS[slots.length] || String(slots.length);
  const list = slots.map((s, i) => '(' + (i + 1) + ') ' + _SHEET_ITEMS[s].name).join(', ');
  const keep = [];
  if (!has('tops') && !has('one-piece')) keep.push('top');
  if (!has('bottoms') && !has('one-piece')) keep.push('trousers, skirt or shorts');
  if (!has('shoes')) keep.push('shoes');
  const parts = [
    'Virtual try-on of a complete outfit. The product image is a sheet with ' + n + ' separate products on a plain white background, arranged from the top of the sheet to the bottom in this order: ' + list + '. ' +
      'Dress the person in the photo in all ' + n + ' products at the same time. Every product on the sheet must end up worn by the person, each one in its own place on the body; do not leave any out and do not merge them into one garment.',
    ...slots.map(s => _SHEET_ITEMS[s].wear),
  ];
  if (has('tops') && has('bottoms')) parts.push("Where the top meets the trousers, the bottom edge of the top hangs loose over the waistband, and the top keeps its full length. The two stay clearly separate garments in their own colours.");
  if (keep.length) parts.push("Keep the person's own " + keep.join(' and their own ') + ' exactly as they are.');
  parts.push(
    'Copy every product exactly: the same colour, material, pattern, cut, length, sleeve length, collar, pockets, buttons, zips and drawstrings. Keep any logo, print or text exactly as it is on the sheet: the same words, the same size, the same position, on the same side, not mirrored and not redrawn.',
    'Show each product only on the parts of the body that are visible in the photo. If the photo is cut off, for example at the waist or the knees, the product is cut off at the same place. Never paste the sheet or any flat product picture into the photo, never show the white background of the sheet, and never extend, crop, zoom or re-frame the photo.',
    'Do not change the person: keep the same face, expression, hairstyle, hair colour, skin tone, body shape, hands, pose, arm and leg positions, and anything they are holding. Keep the same background, lighting, camera angle and picture size. Do not add tattoos, jewellery, accessories, text or any clothing that is not on the sheet. The person must stay fully and decently dressed.'
  );
  return parts.join(' ');
}

// Free try-ons left for this account, per mode
async function _tryonAllowance(userId) {
  const rows = await db.query("SELECT mode, count(*)::int AS n FROM tryon_outfits WHERE user_id = $1 AND status <> 'failed' GROUP BY mode", [userId]);
  const used = { quick: 0, quality: 0 };
  for (const r of rows) if (r.mode in used) used[r.mode] = r.n;
  const view = m => ({ free: _TRYON_FREE[m], used: used[m], left: Math.max(0, _TRYON_FREE[m] - used[m]) });
  return { quick: view('quick'), quality: view('quality') };
}

// Orders items the way a person dresses; rejects two items of the same type
function _orderOutfit(products) {
  const bySlot = new Map();
  for (const p of products) {
    if (bySlot.has(p.tryonSlot)) throw new Error('Pick only one ' + (_SLOT_LABELS[p.tryonSlot] || 'item') + ' per outfit.');
    bySlot.set(p.tryonSlot, p);
  }
  if (bySlot.has('one-piece') && (bySlot.has('tops') || bySlot.has('bottoms'))) {
    throw new Error('A dress or jumpsuit replaces the top and bottom. Remove one of them.');
  }
  return _DRESS_ORDER.filter(s => bySlot.has(s)).map(s => bySlot.get(s));
}

// The FASHN request that puts one item on the current image
function _stepRequest(product, modelImage, outfit) {
  const garment = _garmentImage(product);
  // Shoes and accessories always get the Quality settings, even in a quick preview:
  // without the detailed instruction they are often pasted in flat.
  const accessory = _ACCESSORY_SLOTS.has(product.tryonSlot);
  if (accessory || (outfit && outfit.mode === 'quality')) {
    return { model_name: 'tryon-max', inputs: {
      product_image: garment, model_image: modelImage, prompt: _qualityPrompt(product, outfit && outfit.mode === 'quality' ? outfit.notes : ''),
      generation_mode: _TRYON_QUALITY_MODE, resolution: '1k', output_format: 'jpeg', return_base64: true,
    } };
  }
  const category = product.tryonSlot === 'one-piece' ? 'one-pieces'
    : product.tryonSlot === 'bottoms' ? 'bottoms'
    : (product.tryonKnown ? 'tops' : 'auto');
  return { model_name: 'tryon-v1.6', inputs: {
    model_image: modelImage, garment_image: garment, category,
    mode: 'balanced', garment_photo_type: 'auto', output_format: 'jpeg', return_base64: true,
  } };
}

// Saved step for this item on this base (a picture, or an earlier step's result)
function _findStep(userId, productId, base, variant) {
  return db.one(
    "SELECT * FROM tryon_jobs WHERE user_id = $1 AND product_id = $2 AND photo_ver = $3 AND variant = $4 " +
    "AND (status = 'processing' OR (status = 'completed' AND image IS NOT NULL)) ORDER BY created_at DESC LIMIT 1",
    [userId, String(productId), base, variant || '']);
}

// Asks FASHN how a running step is doing and records the answer
async function _pollStep(step) {
  if (step.status !== 'processing') return step;
  let st;
  try { st = await _fashn('GET', '/status/' + encodeURIComponent(step.id)); }
  catch (err) { console.error('FASHN status failed:', err.message); return step; }
  if (st.status === 'completed' && Array.isArray(st.output) && st.output[0]) {
    return db.one("UPDATE tryon_jobs SET status = 'completed', image = $2 WHERE id = $1 RETURNING *", [step.id, st.output[0]]);
  }
  if (st.status === 'failed' || st.error) {
    return db.one("UPDATE tryon_jobs SET status = 'failed', error = $2 WHERE id = $1 RETURNING *", [step.id, _tryonErrorText(st.error)]);
  }
  if (Date.now() - new Date(step.created_at).getTime() > 5 * 60 * 1000) {
    return db.one("UPDATE tryon_jobs SET status = 'failed', error = $2 WHERE id = $1 RETURNING *", [step.id, 'Try-on took too long. Please try again.']);
  }
  return step;
}

async function _setOutfit(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => k + ' = $' + (i + 2)).join(', ');
  return db.one('UPDATE tryon_outfits SET ' + sets + ', updated_at = now() WHERE id = $1 RETURNING *', [id, ...keys.map(k => fields[k])]);
}

// The steps that dress an outfit, in order. Each one starts from the previous result.
// Quick preview with a sheet: the clothes go on together in one call; shoes and
// accessories always follow one at a time.
function _outfitStages(outfit, catalog) {
  const products = outfit.items.split(',').map(id => catalog.get(id));
  if (products.some(p => !p)) return null;
  const variant = _tryonVariant(outfit.mode, outfit.notes);
  const clothes = products.filter(p => !_ACCESSORY_SLOTS.has(p.tryonSlot));
  const useSheet = !!outfit.sheet && outfit.mode !== 'quality' && clothes.length > 1;
  const stages = [];
  if (useSheet) {
    stages.push({
      key: 'sheet:' + clothes.map(p => p.id).join(','), variant: 'sheet', sheet: true, label: clothes.map(p => p.name).join(' + '),
      request: modelImage => ({ model_name: 'tryon-max', inputs: {
        product_image: outfit.sheet, model_image: modelImage, prompt: _sheetPrompt(clothes),
        generation_mode: 'fast', resolution: '1k', output_format: 'jpeg', return_base64: true,
      } }),
    });
  }
  for (const p of products) {
    if (useSheet && clothes.includes(p)) continue;
    stages.push({ key: String(p.id), variant, product: p, label: p.name, request: modelImage => _stepRequest(p, modelImage, outfit) });
  }
  return stages;
}

// Moves an outfit forward: reuses saved steps, checks the running one, starts the next
async function _advanceOutfit(outfit) {
  if (outfit.status !== 'processing') return outfit;
  const stages = _outfitStages(outfit, new Map(_buildCatalog().map(p => [String(p.id), p])));
  if (!stages) return _setOutfit(outfit.id, { status: 'failed', error: 'An item in this outfit is no longer available.' });
  let base = outfit.photo_ver, prevImage = null;
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    let step = await _findStep(outfit.user_id, stage.key, base, stage.variant);
    if (step) step = await _pollStep(step);
    if (step && step.status === 'failed') return _setOutfit(outfit.id, { status: 'failed', step: i, error: step.error });
    if (step && step.status === 'processing') return outfit.step === i ? outfit : _setOutfit(outfit.id, { step: i });
    if (!step) {
      let modelImage = prevImage;
      if (!modelImage) {
        const pic = await db.one('SELECT photo FROM tryon_photo_versions WHERE user_id = $1 AND ver = $2', [outfit.user_id, outfit.photo_ver]);
        if (!pic) return _setOutfit(outfit.id, { status: 'failed', error: 'Your photo is missing. Please upload it again.' });
        modelImage = pic.photo;
      }
      if (stage.sheet && !_tryonSheet(outfit.sheet)) return _setOutfit(outfit.id, { status: 'failed', error: 'Try-on failed. Please try again.' });
      if (stage.product && !_garmentImage(stage.product)) return _setOutfit(outfit.id, { status: 'failed', error: stage.product.name + ' has no image to try on.' });
      let run;
      try { run = await _fashn('POST', '/run', stage.request(modelImage)); }
      catch (err) {
        console.error('FASHN run failed:', err.message);
        return _setOutfit(outfit.id, { status: 'failed', step: i, error: 'The try-on service is busy. Please try again in a moment.' });
      }
      if (run.error || !run.id) return _setOutfit(outfit.id, { status: 'failed', step: i, error: _tryonErrorText(run.error) });
      await db.query("INSERT INTO tryon_jobs (id, user_id, product_id, photo_ver, status, variant) VALUES ($1, $2, $3, $4, 'processing', $5)",
        [run.id, outfit.user_id, stage.key, base, stage.variant]);
      return _setOutfit(outfit.id, { step: i });
    }
    base = 'job:' + step.id;
    prevImage = step.image;
  }
  // The sheet picture is no longer needed; 'used' keeps the outfit on the same steps if it is opened again
  return _setOutfit(outfit.id, { status: 'completed', step: stages.length, image: prevImage, error: null, ...(outfit.sheet ? { sheet: 'used' } : {}) });
}

function _outfitView(o, catalog) {
  const ids = o.items.split(',');
  const items = ids.map(id => {
    const p = catalog.get(id);
    return p ? { id: p.id, name: p.name, brand: p.brand, price: p.price, img: p.img, slot: p.tryonSlot } : { id, name: 'No longer available', missing: true };
  });
  const stages = _outfitStages(o, catalog);
  const total = stages ? stages.length : ids.length;
  return {
    jobId: o.id, status: o.status, image: o.image || null, error: o.error || null, hairColour: o.hair_colour || '',
    mode: o.mode || 'quick', notes: o.notes || '',
    step: Math.min(o.step, total), total, stepLabel: stages && stages[o.step] ? stages[o.step].label : '', items,
    productId: items[0] && items[0].id, productName: items.map(i => i.name).join(' + '),
    brand: [...new Set(items.filter(i => i.brand).map(i => i.brand))].join(', '),
    price: items.reduce((s, i) => s + (i.price || 0), 0), createdAt: o.created_at,
  };
}

app.post('/api/tryon', _requireUser(), _async(async (req, res) => {
  if (!FASHN_API_KEY) return res.status(503).json({ error: "Virtual try-on isn't available yet." });
  const body = req.body || {};
  const ids = _outfitIds(body);
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one item to try on' });
  if (ids.length > _DRESS_ORDER.length) return res.status(400).json({ error: 'That is too many items for one outfit' });
  const catalog = new Map(_buildCatalog().map(p => [String(p.id), p]));
  const products = ids.map(id => catalog.get(id));
  if (products.some(p => !p)) return res.status(404).json({ error: 'Product not found' });
  let ordered;
  try { ordered = _orderOutfit(products); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const photo = await db.one('SELECT ver FROM tryon_photos WHERE user_id = $1', [req.user.id]);
  if (!photo) return res.status(409).json({ error: 'Upload your try-on photo first', needPhoto: true });
  const items = ordered.map(p => String(p.id)).join(',');
  const hairColour = _hairColour(body.hairColour);
  const mode = _tryonMode(body.mode);
  const notes = mode === 'quality' ? _tryonNotes(body.notes) : '';
  // A quick preview of several items is done in one call, from the sheet the browser made
  const sheet = mode === 'quick' && ordered.length > 1 ? _tryonSheet(body.sheet) : null;
  const send = async o => res.json({ ..._outfitView(await _advanceOutfit(o), catalog), allowance: await _tryonAllowance(req.user.id) });

  // The same outfit on the same picture, made the same way: reuse it (even a removed look)
  let outfit = await db.one('SELECT * FROM tryon_outfits WHERE user_id = $1 AND photo_ver = $2 AND items = $3 AND mode = $4 AND notes = $5',
    [req.user.id, photo.ver, items, mode, notes]);
  if (outfit && outfit.status !== 'failed') {
    return send(await _setOutfit(outfit.id, { hidden: false, hair_colour: hairColour }));
  }

  const allowance = await _tryonAllowance(req.user.id);
  if (!allowance[mode].left) {
    const other = mode === 'quality' ? 'quick' : 'quality';
    return res.status(429).json({ allowance, limitReached: mode, error: "You've used all " + _TRYON_FREE[mode] + ' of your free ' + _TRYON_MODE_NAMES[mode] + '.' +
      (allowance[other].left ? ' You still have ' + allowance[other].left + ' free ' + _TRYON_MODE_NAMES[other] + '.' : '') });
  }

  outfit = outfit
    ? await _setOutfit(outfit.id, { status: 'processing', step: 0, error: null, image: null, hidden: false, hair_colour: hairColour, sheet })
    : await db.one(
      'INSERT INTO tryon_outfits (id, user_id, photo_ver, items, hair_colour, mode, notes, sheet) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [crypto.randomBytes(12).toString('hex'), req.user.id, photo.ver, items, hairColour, mode, notes, sheet]);
  send(outfit);
}));

// Saved looks. Looks with an item that's no longer sold are dropped (image deleted).
// Removed looks are only hidden; they still count towards the free try-ons used.
app.get('/api/tryon/looks', _requireUser(), _async(async (req, res) => {
  const catalog = new Map(_buildCatalog().map(p => [String(p.id), p]));
  const rows = await db.query(
    "SELECT * FROM tryon_outfits WHERE user_id = $1 AND status = 'completed' AND image IS NOT NULL AND NOT hidden ORDER BY updated_at DESC",
    [req.user.id]);
  const onSale = r => r.items.split(',').every(id => catalog.has(id));
  const gone = rows.filter(r => !onSale(r)).map(r => r.id);
  if (gone.length) await db.query('UPDATE tryon_outfits SET hidden = true, image = NULL WHERE id = ANY($1)', [gone]);
  res.json({ looks: rows.filter(onSale).slice(0, 60).map(r => _outfitView(r, catalog)) });
}));

app.get('/api/tryon/:id', _requireUser(), _async(async (req, res) => {
  let outfit = await db.one('SELECT * FROM tryon_outfits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!outfit) return res.status(404).json({ error: 'Try-on not found' });
  outfit = await _advanceOutfit(outfit);
  res.json(_outfitView(outfit, new Map(_buildCatalog().map(p => [String(p.id), p]))));
}));

app.patch('/api/tryon/:id', _requireUser(), _async(async (req, res) => {
  const outfit = await db.one('UPDATE tryon_outfits SET hair_colour = $3 WHERE id = $1 AND user_id = $2 RETURNING *',
    [req.params.id, req.user.id, _hairColour((req.body || {}).hairColour)]);
  if (!outfit) return res.status(404).json({ error: 'Look not found' });
  res.json({ success: true, hairColour: outfit.hair_colour });
}));

app.delete('/api/tryon/:id', _requireUser(), _async(async (req, res) => {
  const outfit = await db.one('UPDATE tryon_outfits SET hidden = true WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
  if (!outfit) return res.status(404).json({ error: 'Look not found' });
  res.json({ success: true });
}));

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
db.init().then(async dbKind => {
  if (_DEMO_ENABLED) await _seedDemoUsers();
  await _loadVendorProducts();
  app.listen(PORT, () => {
  console.log(`\n  TrendMallz  →  http://localhost:${PORT}`);
  console.log(`  Database   : ${dbKind}`);
  console.log(`  Admins     : ${_ADMIN_EMAILS.length ? _ADMIN_EMAILS.length + ' (ADMIN_EMAILS)' : 'none (set ADMIN_EMAILS)'}`);
  console.log(`  Demo users : ${_DEMO_ENABLED ? 'ON (DEMO_ACCOUNTS=on) — never enable in production' : 'off'}`);
  console.log(`  Try-on     : ${FASHN_API_KEY ? 'FASHN ready (free per account: ' + _TRYON_FREE.quick + ' quick, ' + _TRYON_FREE.quality + ' quality [' + _TRYON_QUALITY_MODE + '])' : 'not configured (set FASHN_API_KEY)'}`);
  console.log(`  Snap Kit   : ${SNAP_CLIENT_ID ? 'configured' : 'not configured'}`);
  console.log(`  Paystack   : ${PAYSTACK_PUBLIC_KEY && PAYSTACK_SECRET_KEY ? 'configured' : 'not configured (set PAYSTACK_PUBLIC_KEY / PAYSTACK_SECRET_KEY)'}\n`);
  });
}).catch(err => {
  console.error('Database setup failed:', err.message);
  process.exit(1);
});

module.exports = app;
