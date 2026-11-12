'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret:            process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   15 * 60 * 1000, // 15 minutes (enough for OAuth flow)
  },
}));

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
app.get('/api/products', (_req, res) => {
  const productsDir = path.join(__dirname, 'products');
  if (!fs.existsSync(productsDir)) return res.json([]);
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
  res.json(items);
});

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
app.post('/api/add-product', (req, res) => {
  const {
    brandName, category, name: productName,
    price = 0, compare = 0, discount = 0, description = '',
    sizes = ['S','M','L','XL'], colors = ['Default'], stock = 99,
    images = []
  } = req.body || {};

  if (!brandName || !category || !productName || !images.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
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
app.post('/api/update-price', (req, res) => {
  const { productId, brandName, productBase, price = 0, compare = 0 } = req.body || {};
  if (!productId || !brandName) return res.status(400).json({ error: 'Missing fields' });
  const p = Number(price) || 0;
  const c = Number(compare) || p;
  const disc = c > p ? Math.round((1 - p / c) * 100) : 0;

  // Try custom_products.json first
  const customFile = path.join(__dirname, 'custom_products.json');
  let updatedCustom = false;
  try {
    let custom = JSON.parse(fs.readFileSync(customFile, 'utf8'));
    const idx = custom.findIndex(cp => cp.id === productId);
    if (idx !== -1) {
      custom[idx].price = p; custom[idx].compare = c; custom[idx].discount = disc;
      fs.writeFileSync(customFile, JSON.stringify(custom, null, 2));
      updatedCustom = true;
    }
  } catch (_x) {}

  // Fall back to prices.json in the brand folder
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

// ── User store ────────────────────────────────────────────────────────────────
const _usersFile = path.join(__dirname, 'users.json');
const _DEMO_USERS = [
  { id:'u1', email:'customer@demo.com', passwordHash:'demo', salt:'demo', fname:'Emeka', lname:'Johnson', role:'customer', countryCode:'NG', referralCode:'REF-EJ2024', wallet:6500, referralEarnings:4000, referralCount:2, orders:['o1','o2'], createdAt:'2024-01-15', verified:true },
  { id:'u2', email:'vendor@demo.com', passwordHash:'demo', salt:'demo', fname:'Adaeze', lname:'Obi', role:'vendor', countryCode:'NG', brandName:'NOX Apparel', referralCode:'REF-AO2024', wallet:185000, referralEarnings:0, referralCount:0, orders:[], storeSales:12, storeRevenue:285000, commissionPaid:28500, createdAt:'2023-11-01', verified:true },
  { id:'u3', email:'admin@trendmallz.com', passwordHash:'demo', salt:'demo', fname:'Admin', lname:'TrendMallz', role:'admin', countryCode:'NG', referralCode:'REF-ADMIN', wallet:0, orders:[], totalCommission:85000, totalOrders:142, totalRevenue:950000, createdAt:'2023-01-01', verified:true }
];
function _loadUsers() {
  try { return JSON.parse(fs.readFileSync(_usersFile, 'utf8')); } catch (_x) { return []; }
}
function _saveUsers(arr) {
  try { fs.writeFileSync(_usersFile, JSON.stringify(arr, null, 2)); } catch (_x) {}
}
function _findUser(email) {
  const demo = _DEMO_USERS.find(u => u.email === email);
  if (demo) return demo;
  return _loadUsers().find(u => u.email === email) || null;
}
function _hashPass(pass, salt) {
  return crypto.scryptSync(pass, salt, 64).toString('hex');
}
function _toSessionUser(u) {
  return {
    id: u.id, fname: u.fname, lname: u.lname, email: u.email,
    role: u.role, brandName: u.brandName || '', wallet: u.wallet || 0,
    countryCode: u.countryCode || 'NG', referralCode: u.referralCode || '',
    referralEarnings: u.referralEarnings || 0, referralCount: u.referralCount || 0,
    orders: u.orders || [],
    ...(u.role === 'vendor' ? { storeSales: u.storeSales || 0, storeRevenue: u.storeRevenue || 0, commissionPaid: u.commissionPaid || 0 } : {}),
    ...(u.role === 'admin' ? { totalCommission: u.totalCommission || 0, totalOrders: u.totalOrders || 0, totalRevenue: u.totalRevenue || 0 } : {})
  };
}

// ── Email verification codes ──────────────────────────────────────────────────
// One pending code per email+purpose; held in memory, so a restart cancels it
const _CODE_TTL_MS    = 10 * 60 * 1000;
const _CODE_MAX_TRIES = 5;
const _CODE_RESEND_MS = 60 * 1000;
const _pendingCodes = new Map();

function _codeKey(email, purpose) { return purpose + ':' + String(email).toLowerCase(); }
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
  if (!payload || !sig) return false;
  const expected = _signDevice(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
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

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  const { fname, lname, email, password, role = 'customer', brandName = '', countryCode = 'NG' } = req.body || {};
  if (!fname || !lname || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (_findUser(email)) return res.status(409).json({ error: 'Email already registered' });
  const salt = crypto.randomBytes(16).toString('hex');
  const ref = (fname + lname).replace(/\s/g, '').toUpperCase().slice(0, 5) + Math.random().toString(36).slice(2, 5).toUpperCase();
  const userData = {
    id: 'u' + Date.now(), fname, lname, email,
    passwordHash: _hashPass(password, salt), salt, role,
    brandName: role === 'vendor' ? brandName : '',
    countryCode, referralCode: ref, wallet: 0,
    referralEarnings: 0, referralCount: 0, orders: [],
    createdAt: new Date().toISOString().split('T')[0], verified: false,
    ...(role === 'vendor' ? { storeSales: 0, storeRevenue: 0, commissionPaid: 0 } : {})
  };
  if (!process.env.RESEND_API_KEY) {
    // No email provider configured (local dev): create the account straight away
    userData.verified = true;
    const arr = _loadUsers();
    arr.push(userData);
    _saveUsers(arr);
    req.session.user = _toSessionUser(userData);
    return res.json({ success: true, autoVerified: true, user: req.session.user });
  }
  try {
    await _issueCode(email, 'signup', fname, userData);
    res.json({ success: true, needsCode: true, email });
  } catch (err) {
    console.error('Mail error:', err.message);
    res.status(500).json({ error: 'Email delivery failed: ' + err.message });
  }
});

// ── POST /api/auth/verify-signup ──────────────────────────────────────────────
app.post('/api/auth/verify-signup', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });
  const result = _checkCode(email, 'signup', code);
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (_findUser(email)) return res.status(409).json({ error: 'Email already registered. Please sign in.' });
  const userData = { ...result.data, verified: true };
  const arr = _loadUsers();
  arr.push(userData);
  _saveUsers(arr);
  req.session.user = _toSessionUser(userData);
  _trustDevice(res, userData.id);
  res.json({ success: true, user: req.session.user });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = _findUser(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const isDemoPass = user.salt === 'demo' && (
    (email === 'admin@trendmallz.com' && password === 'admin123') ||
    (email !== 'admin@trendmallz.com' && password === 'demo123')
  );
  const isValidPass = user.salt !== 'demo' && _hashPass(password, user.salt) === user.passwordHash;
  if (!isDemoPass && !isValidPass) return res.status(401).json({ error: 'Invalid email or password' });
  if (!user.verified) return res.status(403).json({ error: 'Please verify your email first.' });
  // Demo accounts can't receive email; real accounts on a new device must enter a code
  if (!isDemoPass && process.env.RESEND_API_KEY && !_isTrustedDevice(req, user.id)) {
    try {
      await _issueCode(email, 'login', user.fname, { userId: user.id });
      return res.json({ success: true, needsCode: true, email });
    } catch (err) {
      console.error('Mail error:', err.message);
      return res.status(500).json({ error: 'Could not send sign-in code: ' + err.message });
    }
  }
  req.session.user = _toSessionUser(user);
  res.json({ success: true, user: req.session.user });
});

// ── POST /api/auth/verify-login ───────────────────────────────────────────────
app.post('/api/auth/verify-login', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });
  const result = _checkCode(email, 'login', code);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const user = _findUser(email);
  if (!user || user.id !== result.data.userId) return res.status(401).json({ error: 'Account not found' });
  req.session.user = _toSessionUser(user);
  _trustDevice(res, user.id);
  res.json({ success: true, user: req.session.user });
});

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
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

// ── GET /api/paystack/config ──────────────────────────────────────────────────
app.get('/api/paystack/config', (_req, res) => {
  res.json({ publicKey: PAYSTACK_PUBLIC_KEY });
});

// ── POST /api/paystack/verify ─────────────────────────────────────────────────
// Confirms a transaction with Paystack before the client records the order
const _usedPaystackRefs = new Set();
app.post('/api/paystack/verify', async (req, res) => {
  const { reference, amount } = req.body || {};
  if (!PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Paystack is not configured' });
  if (!reference) return res.status(400).json({ error: 'Missing reference' });
  if (_usedPaystackRefs.has(reference)) return res.status(409).json({ error: 'Payment reference already used' });
  try {
    const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET_KEY },
    });
    const data = await r.json();
    if (!r.ok || !data.status) return res.status(502).json({ error: data.message || 'Paystack verification failed' });
    const tx = data.data;
    if (tx.status !== 'success') return res.status(402).json({ error: 'Payment not successful (' + tx.status + ')' });
    // requested_amount excludes fees added when "pass charges to customer" is on
    const paidFor = tx.requested_amount ?? tx.amount;
    if (amount != null && paidFor !== Math.round(Number(amount) * 100)) {
      return res.status(400).json({ error: 'Amount paid does not match order total' });
    }
    _usedPaystackRefs.add(reference);
    res.json({
      success:  true,
      reference: tx.reference,
      amount:   tx.amount / 100,
      currency: tx.currency,
      channel:  tx.channel,
      paidAt:   tx.paid_at,
    });
  } catch (err) {
    console.error('Paystack verify error:', err.message);
    res.status(502).json({ error: 'Could not reach Paystack' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  TrendMallz  →  http://localhost:${PORT}`);
  console.log(`  Replicate  : ${REPLICATE_AVAILABLE ? 'ready' : 'not configured (set REPLICATE_API_TOKEN)'}`);
  console.log(`  Snap Kit   : ${SNAP_CLIENT_ID ? 'configured' : 'not configured'}`);
  console.log(`  Paystack   : ${PAYSTACK_PUBLIC_KEY && PAYSTACK_SECRET_KEY ? 'configured' : 'not configured (set PAYSTACK_PUBLIC_KEY / PAYSTACK_SECRET_KEY)'}\n`);
});

module.exports = app;
