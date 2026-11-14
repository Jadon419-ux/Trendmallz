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
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const REPLICATE_AVAILABLE = !!REPLICATE_API_TOKEN;

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

async function replicateRequest(method, endpoint, body) {
  const resp = await fetch(`https://api.replicate.com${endpoint}`, {
    method,
    headers: {
      Authorization:  `Token ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

async function uploadToReplicate(buffer, filename, mimeType) {
  const resp = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: {
      Authorization:         `Token ${REPLICATE_API_TOKEN}`,
      'Content-Type':        mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: buffer,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || 'Replicate file upload failed');
  return data.urls?.source;
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

// ── /api/products ─────────────────────────────────────────────────────────────
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
        const base = stem.replace(/[_\s]*(front|back|side|left|right|view|\d+)$/i, '').replace(/[_\s]+$/, '') || stem;
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
  const items = [];
  for (const [key, g] of groups) {
    g.files.sort((a, b) => viewRank(a) - viewRank(b));
    const { brandName, catName, base, files } = g;
    const images = files.map(fn => `/products/${brandName}/${catName}/${fn}`);
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
      category:    catName,
      img:         images[0],
      images,
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
  // Merge vendor-added products stored in custom_products.json
  try {
    const custom = JSON.parse(fs.readFileSync(path.join(__dirname, 'custom_products.json'), 'utf8'));
    for (const cp of custom) {
      if (!items.find(p => p.id === cp.id)) items.push(cp);
    }
  } catch (_) {}
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

// ── /api/tryon ────────────────────────────────────────────────────────────────
app.post('/api/tryon', async (req, res) => {
  if (!REPLICATE_AVAILABLE)
    return res.status(503).json({ error: 'Set REPLICATE_API_TOKEN env var and restart.' });

  const { person_image, garment_url, garment_desc = 'clothing item' } = req.body || {};
  if (!person_image || !garment_url)
    return res.status(400).json({ error: 'person_image and garment_url are required' });

  try {
    // Decode person photo from base64
    const b64       = person_image.includes(',') ? person_image.split(',')[1] : person_image;
    const personBuf = Buffer.from(b64, 'base64');

    // Load garment image as buffer (local path or remote URL)
    let garmentBuf, garmentFilename;
    if (/^https?:\/\//.test(garment_url)) {
      const r = await fetch(garment_url);
      if (!r.ok) throw new Error(`Garment fetch failed: ${r.status}`);
      garmentBuf      = Buffer.from(await r.arrayBuffer());
      garmentFilename = path.basename(new URL(garment_url).pathname) || 'garment.jpg';
    } else {
      // Local path like /products/FLY/Streetwear/FLY T-shirt.jpeg
      const localPath = path.join(__dirname, ...garment_url.replace(/^\//, '').split('/'));
      garmentBuf      = fs.readFileSync(localPath);
      garmentFilename = path.basename(localPath);
    }

    // Upload both images to Replicate's file storage
    const personFileUrl  = await uploadToReplicate(personBuf, 'person.jpg', 'image/jpeg');
    const garmentMime    = path.extname(garmentFilename).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    const garmentFileUrl = await uploadToReplicate(garmentBuf, garmentFilename, garmentMime);

    // Create prediction
    const pred = await replicateRequest('POST', '/v1/predictions', {
      version: '139cb1163486954531b765d4ac3bb6d3e02fe121151665adfc3b47e9ba3ebf67',
      input: {
        human_img:       personFileUrl,
        garm_img:        garmentFileUrl,
        garment_des:     garment_desc,
        is_checked:      true,
        is_checked_crop: false,
        denoise_steps:   30,
        seed:            42,
      },
    });
    res.json({ prediction_id: pred.id, status: pred.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /api/tryon-status/:id ─────────────────────────────────────────────────────
app.get('/api/tryon-status/:prediction_id', async (req, res) => {
  if (!REPLICATE_AVAILABLE)
    return res.status(503).json({ error: 'Replicate not configured' });
  try {
    const pred   = await replicateRequest('GET', `/v1/predictions/${req.params.prediction_id}`);
    const result = { status: pred.status, prediction_id: pred.id };
    if (pred.status === 'succeeded')
      result.image_url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    else if (pred.status === 'failed')
      result.error = pred.error || 'Generation failed';
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
app.get('/auth/snap', (req, res) => {
  if (!SNAP_CLIENT_ID || !SNAP_CLIENT_SECRET)
    return res.redirect('/?snap_error=config_missing');

  const uid   = req.query.uid || '';
  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge } = pkcePair();

  req.session.snap_state         = state;
  req.session.snap_uid           = uid;
  req.session.snap_code_verifier = verifier;

  const params = new URLSearchParams({
    client_id:             SNAP_CLIENT_ID,
    redirect_uri:          SNAP_REDIRECT_URI,
    response_type:         'code',
    scope:                 SNAP_SCOPE,
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`${SNAP_AUTH_URL}?${params}`);
});

// ── /auth/snap/callback ───────────────────────────────────────────────────────
app.get('/auth/snap/callback', async (req, res) => {
  const { error, error_description, code, state } = req.query;

  if (error)
    return res.redirect(
      `/?snap_error=${encodeURIComponent(error)}&snap_error_desc=${encodeURIComponent(error_description || '')}`
    );

  const saved    = req.session.snap_state;
  const verifier = req.session.snap_code_verifier;
  const uid      = req.session.snap_uid || '';
  delete req.session.snap_state;
  delete req.session.snap_code_verifier;
  delete req.session.snap_uid;

  if (!code || !saved || state !== saved || !verifier)
    return res.redirect('/?snap_error=invalid_state');

  try {
    // Exchange code for tokens
    const tokResp = await fetch(SNAP_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  SNAP_REDIRECT_URI,
        client_id:     SNAP_CLIENT_ID,
        client_secret: SNAP_CLIENT_SECRET,
        code_verifier: verifier,
      }),
    });
    if (!tokResp.ok) throw new Error(await tokResp.text());
    const tokens = await tokResp.json();
    if (!tokens.access_token) return res.redirect('/?snap_error=no_access_token');

    // Fetch displayName + Bitmoji
    const meResp = await fetch(SNAP_ME_URL, {
      method:  'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: '{me{displayName, bitmoji{avatar}}}' }),
    });
    const meData     = await meResp.json();
    const me         = ((meData.data || {}).me) || {};
    const displayName = me.displayName;
    const bitmojiUrl  = (me.bitmoji || {}).avatar;

    req.session.snap_access_token  = tokens.access_token;
    req.session.snap_refresh_token = tokens.refresh_token;
    req.session.snap_display_name  = displayName;
    req.session.snap_bitmoji_url   = bitmojiUrl;
    req.session.snap_uid           = uid;

    const qs = new URLSearchParams({
      snap_connected: '1',
      uid,
      name:    displayName || '',
      bitmoji: bitmojiUrl  || '',
    });
    res.redirect(`/?${qs}`);
  } catch (err) {
    res.redirect(`/?snap_error=callback_failed&snap_error_desc=${encodeURIComponent(err.message)}`);
  }
});

// ── /api/snap-me ──────────────────────────────────────────────────────────────
app.get('/api/snap-me', (req, res) => {
  res.json({
    connected:   !!req.session.snap_access_token,
    displayName: req.session.snap_display_name || null,
    bitmojiUrl:  req.session.snap_bitmoji_url  || null,
    uid:         req.session.snap_uid          || null,
  });
});

// ── /api/add-product ─────────────────────────────────────────────────────────
// images[] is now an array of permanent Cloudinary URLs — no disk writes needed
app.post('/api/add-product', _requireUser(['vendor', 'admin']), (req, res) => {
  const {
    brandName, category, name: productName,
    price = 0, compare = 0, discount = 0, description = '',
    sizes = ['S','M','L','XL'], colors = ['Default'], stock = 99,
    images = []
  } = req.body || {};

  if (!brandName || !category || !productName || !images.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (req.user.role === 'vendor' && String(brandName).toLowerCase() !== (req.user.brand_name || '').toLowerCase()) {
    return res.status(403).json({ error: 'You can only add products for your own brand' });
  }
  if (!(Number(price) > 0)) return res.status(400).json({ error: 'Please enter a price' });
  const validImages = images.filter(u => typeof u === 'string' && u.startsWith('https://'));
  if (!validImages.length) return res.status(400).json({ error: 'No valid image URLs' });

  const newProduct = {
    id:          Date.now(),
    name:        productName,
    brand:       brandName,
    category,
    img:         validImages[0],
    images:      validImages,
    price:       Number(price)   || 0,
    compare:     Number(compare) || Number(price) || 0,
    discount:    Number(discount) || 0,
    description: description || `${productName} — by ${brandName}.`,
    sizes:       Array.isArray(sizes)  ? sizes  : ['S','M','L','XL'],
    colors:      Array.isArray(colors) ? colors : ['Default'],
    stock:       Number(stock) || 99,
    rating:      0,
    reviews:     0,
    tags:        [brandName.toLowerCase(), category.toLowerCase()],
  };

  const customFile = path.join(__dirname, 'custom_products.json');
  let custom = [];
  try { custom = JSON.parse(fs.readFileSync(customFile, 'utf8')); } catch (_) {}
  custom.push(newProduct);
  try { fs.writeFileSync(customFile, JSON.stringify(custom, null, 2)); } catch (_) {}

  res.json({ success: true, product: newProduct });
});

// ── /api/update-price ────────────────────────────────────────────────────────
app.post('/api/update-price', _requireUser(['vendor', 'admin']), (req, res) => {
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

  // Try custom_products.json first
  const customFile = path.join(__dirname, 'custom_products.json');
  let updatedCustom = false;
  try {
    let custom = JSON.parse(fs.readFileSync(customFile, 'utf8'));
    const idx = custom.findIndex(cp => cp.id === productId && (isAdmin || String(cp.brand).toLowerCase() === String(brandName).toLowerCase()));
    if (idx !== -1) {
      custom[idx].price = p; custom[idx].compare = c; custom[idx].discount = disc;
      fs.writeFileSync(customFile, JSON.stringify(custom, null, 2));
      updatedCustom = true;
    }
  } catch (_x) {}

  // Fall back to prices.json in the brand folder (folder brands are managed by admins)
  if (!updatedCustom && !isAdmin) return res.status(404).json({ error: 'Product not found in your store' });
  if (!updatedCustom && productBase) {
    const priceFile = path.join(__dirname, 'products', brandName, 'prices.json');
    let prices = {};
    try { prices = JSON.parse(fs.readFileSync(priceFile, 'utf8')); } catch (_x) {}
    prices[productBase] = p;
    try { fs.writeFileSync(priceFile, JSON.stringify(prices, null, 2)); } catch (_x) {}
  }

  res.json({ success: true, price: p, compare: c, discount: disc });
});

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
function _findUserByEmail(email) { return db.one('SELECT * FROM users WHERE email = $1', [_normEmail(email)]); }
function _findUserById(id) { return db.one('SELECT * FROM users WHERE id = $1', [id]); }
function _insertUser(u) {
  return db.query(
    'INSERT INTO users (id, email, password_hash, salt, fname, lname, role, brand_name, country_code, referral_code) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [u.id, u.email, u.password_hash, u.salt, u.fname, u.lname, u.role, u.brand_name, u.country_code, u.referral_code]
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
    countryCode: u.country_code || 'NG', referralCode: u.referral_code || '',
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
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
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
    country_code: String(countryCode || 'NG').slice(0, 2),
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
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
db.init().then(async dbKind => {
  if (_DEMO_ENABLED) await _seedDemoUsers();
  app.listen(PORT, () => {
  console.log(`\n  TrendMallz  →  http://localhost:${PORT}`);
  console.log(`  Database   : ${dbKind}`);
  console.log(`  Admins     : ${_ADMIN_EMAILS.length ? _ADMIN_EMAILS.length + ' (ADMIN_EMAILS)' : 'none (set ADMIN_EMAILS)'}`);
  console.log(`  Demo users : ${_DEMO_ENABLED ? 'ON (DEMO_ACCOUNTS=on) — never enable in production' : 'off'}`);
  console.log(`  Replicate  : ${REPLICATE_AVAILABLE ? 'ready' : 'not configured (set REPLICATE_API_TOKEN)'}`);
  console.log(`  Snap Kit   : ${SNAP_CLIENT_ID ? 'configured' : 'not configured'}`);
  console.log(`  Paystack   : ${PAYSTACK_PUBLIC_KEY && PAYSTACK_SECRET_KEY ? 'configured' : 'not configured (set PAYSTACK_PUBLIC_KEY / PAYSTACK_SECRET_KEY)'}\n`);
  });
}).catch(err => {
  console.error('Database setup failed:', err.message);
  process.exit(1);
});

module.exports = app;
