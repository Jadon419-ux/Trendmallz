// TrendMallz — Application JavaScript
// =================== DATA ===================
let PRODUCTS = [];

let BRANDS = [];

// =================== STATE ===================
let state = {
  currentUser: null,
  cart: [],
  wishlist: [],
  orders: [],
  snapConfigured: null,
  currentPage: 'home',
  shopFilter: { category: '', brand: '', priceMin: '', priceMax: '' },
  shopSort: 'default',
  signupType: 'customer',
  cartOpen: false,
  userMenuOpen: false,
  shopFiltersSidebarOpen: false,
};

// Pre-seed demo data
let users = JSON.parse(localStorage.getItem('tm_users') || '[]');
if (!users.length) {
  users = [
    {id:'u1',email:'customer@demo.com',password:'demo123',fname:'Emeka',lname:'Johnson',role:'customer',countryCode:'NG',referralCode:'REF-EJ2024',referredBy:null,referralEarnings:4000,referralCount:2,wallet:6500,createdAt:'2024-01-15',orders:['o1','o2']},
    {id:'u2',email:'vendor@demo.com',password:'demo123',fname:'Adaeze',lname:'Obi',role:'vendor',countryCode:'NG',referralCode:'REF-AO2024',brandName:'NOX Apparel',referredBy:null,referralEarnings:0,referralCount:0,wallet:185000,createdAt:'2023-11-01',storeSales:12,storeRevenue:285000,commissionPaid:28500},
    {id:'u3',email:'admin@trendmallz.com',password:'admin123',fname:'Admin',lname:'TrendMallz',role:'admin',countryCode:'NG',referralCode:'REF-ADMIN',referredBy:null,referralEarnings:0,wallet:0,totalCommission:85000,totalOrders:142,totalRevenue:950000},
  ];
  localStorage.setItem('tm_users', JSON.stringify(users));
}
// Orders (and, for admins, the user list) are loaded from the server by loadOrders()
let orders = [];
let adminUsers = [];
const NG_STATES = ['Abia','Abuja (FCT)','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];

// =================== UTILITIES ===================
const CURRENCY_BY_COUNTRY = {
  NG: { locale: 'en-NG', currency: 'NGN' },
  GH: { locale: 'en-GH', currency: 'GHS' },
  KE: { locale: 'en-KE', currency: 'KES' },
  ZA: { locale: 'en-ZA', currency: 'ZAR' },
  US: { locale: 'en-US', currency: 'USD' },
  GB: { locale: 'en-GB', currency: 'GBP' },
  CA: { locale: 'en-CA', currency: 'CAD' },
  EU: { locale: 'en-IE', currency: 'EUR' },
};
const COUNTRY_LABELS = {
  NG: 'Nigeria',
  GH: 'Ghana',
  KE: 'Kenya',
  ZA: 'South Africa',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  EU: 'Eurozone',
};
const DEFAULT_COUNTRY_CODE = 'NG';

function normalizeCountryCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return CURRENCY_BY_COUNTRY[c] ? c : DEFAULT_COUNTRY_CODE;
}

function getPreferredCountryFromBrowser() {
  const lang = (navigator.language || '').toUpperCase();
  if (lang.includes('-')) {
    const region = lang.split('-')[1];
    if (CURRENCY_BY_COUNTRY[region]) return region;
    if (region === 'IE') return 'EU';
  }
  return DEFAULT_COUNTRY_CODE;
}

function getCurrencyProfile(user = state.currentUser) {
  const code = normalizeCountryCode(user?.countryCode || user?.country);
  return CURRENCY_BY_COUNTRY[code];
}

function fmt(n, user = state.currentUser) {
  const profile = getCurrencyProfile(user);
  const amount = Number(n) || 0;
  return new Intl.NumberFormat(profile.locale, {
    style: 'currency',
    currency: profile.currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function countryOptions(selectedCode = DEFAULT_COUNTRY_CODE) {
  const active = normalizeCountryCode(selectedCode);
  return Object.keys(CURRENCY_BY_COUNTRY).map(code => {
    const selected = code === active ? 'selected' : '';
    return `<option value="${code}" ${selected}>${COUNTRY_LABELS[code]} (${CURRENCY_BY_COUNTRY[code].currency})</option>`;
  }).join('');
}

function bootstrapUserCountries() {
  let changed = false;
  users.forEach(u => {
    const normalized = normalizeCountryCode(u.countryCode || u.country);
    if (u.countryCode !== normalized || u.country) {
      u.countryCode = normalized;
      delete u.country;
      changed = true;
    }
  });
  if (changed) saveUsers();
}

function initSignupCountryDefault() {
  const sel = document.getElementById('signup-country');
  if (!sel) return;
  const preferred = getPreferredCountryFromBrowser();
  if ([...sel.options].some(o => o.value === preferred)) {
    sel.value = preferred;
  }
}

bootstrapUserCountries();

// Default avatar; it follows the gender given at signup
function getBitmoji(seed, gender) {
  var look = gender === 'female' ? '&top=longButNotTooLong,bob,curly,curvy,straight01,straight02,bigHair,miaWallace,bun&facialHairProbability=0'
    : gender === 'male' ? '&top=shortFlat,shortRound,shortWaved,shortCurly,theCaesar,theCaesarAndSidePart,sides,frizzle,dreads01&facialHairProbability=30'
    : '';
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1a1a1a&backgroundType=solid&radius=50${look}`;
}
const PRODUCT_GENDER_LABELS = { male: 'Men', female: 'Women', unisex: 'Unisex' };

// Shows the signed-in customer's own products first: theirs, then unisex, then the rest
function applyGenderOrder() {
  var g = state.currentUser && state.currentUser.gender;
  var rank = function(p) {
    if (g !== 'male' && g !== 'female') return 0;
    var pg = p.gender || 'unisex';
    return pg === g ? 0 : pg === 'unisex' ? 1 : 2;
  };
  PRODUCTS.sort(function(a, b) {
    return rank(a) - rank(b) || String(a.brand).localeCompare(String(b.brand)) || String(a.name).localeCompare(String(b.name));
  });
}

// Profile: set or change gender
function setGender(value) {
  fetch('/api/account/gender', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gender: value }) })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.error) { showToast(res.error, 'error'); return; }
      state.currentUser.gender = res.gender;
      updateNavForUser(state.currentUser);
      if (typeof renderDashboard === 'function' && document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
      showToast('Saved');
    })
    .catch(function() { showToast('Connection error. Please try again.', 'error'); });
}
const genId = () => Math.random().toString(36).substr(2, 9);
const genRef = (name) => 'REF-' + name.substr(0,2).toUpperCase() + Math.random().toString(36).substr(2,4).toUpperCase();

function saveUsers(){ localStorage.setItem('tm_users', JSON.stringify(users)); }
// Refreshes the shared orders list for the signed-in user from the server
function loadOrders() {
  if(!state.currentUser) { orders = []; adminUsers = []; return Promise.resolve(); }
  var reqs = [fetch('/api/orders').then(function(r){return r.json();}).then(function(res){ orders = res.orders || []; })];
  if(state.currentUser.role==='admin') {
    reqs.push(fetch('/api/admin/users').then(function(r){return r.json();}).then(function(res){ adminUsers = res.users || []; }));
  }
  return Promise.all(reqs).catch(function(){ showToast('Could not load orders. Please refresh the page.','error'); });
}

function disconnectSnap() {
  fetch('/api/account/snap', { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.error) { showToast(res.error, 'error'); return; }
      var u = state.currentUser;
      if (!u) return;
      u.snapBitmoji = ''; u.avatarUrl = '';
      updateNavForUser(u);
      showToast('Snapchat disconnected', 'info');
      var el = document.getElementById('dash-content');
      if (el && document.getElementById('page-dashboard').classList.contains('active')) renderCustomerSection('profile', el, u);
    })
    .catch(function() { showToast('Connection error. Please try again.', 'error'); });
}
function handleProfilePhotoUpload(evt, userId) {
  const file = evt.target.files[0];
  if (!file) return;
  showToast('Generating your 2D avatar…', 'info');
  const reader = new FileReader();
  reader.onload = (e) => {
    const seed = userId + '-' + file.name + '-' + file.size;
    const avatarUrl = `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1a1a1a&backgroundType=solid&radius=50`;
    const wrap = document.getElementById('profile-avatar-wrap');
    if (wrap) wrap.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover rounded-full" alt="avatar"/>`;
    const u = users.find(u => u.id === userId);
    if (u) { u.avatarUrl = avatarUrl; saveUsers(); }
    // Update navbar avatar if it's the current user
    if (state.currentUser && state.currentUser.id === userId) {
      state.currentUser.avatarUrl = avatarUrl;
      const navAvatar = document.getElementById('user-avatar');
      if (navAvatar) navAvatar.src = avatarUrl;
    }
    showToast('Profile photo updated!', 'success');
  };
  reader.readAsDataURL(file);
}

function saveProfileChanges(userId) {
  const u = users.find(x => x.id === userId);
  if (!u) return;
  const fname = document.getElementById('prof-fname')?.value.trim();
  const lname = document.getElementById('prof-lname')?.value.trim();
  const countryCode = normalizeCountryCode(document.getElementById('prof-country')?.value);
  if (!fname || !lname) {
    showToast('First and last name are required', 'error');
    return;
  }
  u.fname = fname;
  u.lname = lname;
  u.countryCode = countryCode;
  saveUsers();
  if (state.currentUser && state.currentUser.id === userId) {
    state.currentUser = u;
    updateNavForUser(u);
  }
  showToast(`Profile updated. Currency set to ${CURRENCY_BY_COUNTRY[countryCode].currency}.`, 'success');
  const el = document.getElementById('dash-content');
  if (el) renderCustomerSection('profile', el, u);
}

function stars(r, s='w-3 h-3') {
  let h='';
  for(let i=1;i<=5;i++) {
    if(i<=Math.floor(r)) h+=`<svg class="${s} star-full" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
    else h+=`<svg class="${s} star-empty" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
  }
  return h;
}

function showToast(msg, type='success') {
  const c = document.getElementById('toast-container');
  const colors = {success:'bg-citrine text-black', error:'bg-red-500 text-white', info:'bg-charcoal-light text-white border border-charcoal-border', warning:'bg-yellow-500 text-black'};
  const icons = {success:'check-circle',error:'x-circle',info:'info',warning:'alert-triangle'};
  const t = document.createElement('div');
  t.className = `toast flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium shadow-2xl ${colors[type]||colors.info}`;
  t.innerHTML = `<i data-lucide="${icons[type]||'info'}" class="w-4 h-4 shrink-0"></i><span>${msg}</span>`;
  c.appendChild(t);
  lucide.createIcons({el: t});
  setTimeout(() => t.remove(), 3200);
}

// =================== PAGE ROUTING ===================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-' + id);
  if(pg) {
    pg.classList.add('active');
    state.currentPage = id;
    window.scrollTo({top:0,behavior:'smooth'});
    onPageEnter(id);
  }
  document.querySelectorAll('[data-navpage]').forEach(el => {
    const active = el.dataset.navpage === id;
    el.classList.toggle('text-citrine', active);
    el.classList.toggle('text-neutral-400', !active);
  });
  lucide.createIcons();
}

function onPageEnter(id) {
  if(id==='home') startHeroTypewriter();
  if(id==='shop') renderShopGrid();
  if(id==='brands') renderBrandsPage();
  if(id==='wishlist') renderWishlist();
  if(id==='orders-page') loadOrders().then(renderOrders);
  if(id==='referral') renderReferral();
  if(id==='dashboard') Promise.all([loadOrders(), loadTryonPhoto()]).then(renderDashboard);
  if(id==='checkout') renderCheckout();
  if(id==='fashionai') initFashionAIPage();
}

// =================== AUTH ===================
function openAuthModal(tab='login') {
  document.getElementById('auth-modal').classList.remove('hidden');
  switchAuthTab(tab);
  lucide.createIcons();
}
function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
}
function switchAuthTab(tab) {
  document.getElementById('auth-login').classList.toggle('hidden', tab!=='login');
  document.getElementById('auth-signup').classList.toggle('hidden', tab!=='signup');
  document.getElementById('auth-code').classList.toggle('hidden', tab!=='code');
  if(tab==='code') return;
  document.getElementById('auth-tab-login').classList.toggle('active', tab==='login');
  document.getElementById('auth-tab-signup').classList.toggle('active', tab==='signup');
  document.querySelectorAll('#auth-tab-login, #auth-tab-signup').forEach(b => b.classList.toggle('text-neutral-400', !b.classList.contains('active')));
}
function setSignupType(type) {
  state.signupType = type;
  document.getElementById('stype-customer').className = type==='customer' ? 'flex-1 py-2.5 rounded-xl border border-citrine bg-citrine/10 text-citrine text-xs font-semibold transition-all' : 'flex-1 py-2.5 rounded-xl border border-charcoal-border text-neutral-400 text-xs font-semibold transition-all hover:border-citrine';
  document.getElementById('stype-vendor').className = type==='vendor' ? 'flex-1 py-2.5 rounded-xl border border-citrine bg-citrine/10 text-citrine text-xs font-semibold transition-all' : 'flex-1 py-2.5 rounded-xl border border-charcoal-border text-neutral-400 text-xs font-semibold transition-all hover:border-citrine';
  document.getElementById('vendor-fields').classList.toggle('hidden', type!=='vendor');
}
// Eye button on password boxes: shows or hides what was typed
function togglePw(id, btn) {
  const el = document.getElementById(id);
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  if (btn) {
    const label = show ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-label', label); btn.title = label;
    btn.innerHTML = '<i data-lucide="' + (show ? 'eye-off' : 'eye') + '" class="w-4 h-4"></i>';
    lucide.createIcons();
  }
}
function quickLogin(email, pass, role) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = pass;
  doLogin();
}
function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass = document.getElementById('login-password').value;
  if(!email||!pass){showToast('Please enter email and password','error');return;}
  fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,password:pass})})
  .then(function(r){return r.json();})
  .then(function(res){
    if(res.error){showToast(res.error,'error');return;}
    if(res.needsCode){showAuthCode('login',res.email);return;}
    loginUser(res.user);
  })
  .catch(function(){showToast('Connection error. Please try again.','error');});
}
// ── Emailed 6-digit code step (signup, and login from a new device) ──────────
function showAuthCode(purpose, email) {
  state.authCode = {purpose:purpose, email:email};
  document.getElementById('auth-code-title').textContent = purpose==='signup' ? 'Verify your email' : 'New device sign-in';
  document.getElementById('auth-code-intro').textContent = purpose==='signup' ? 'To finish creating your account, enter the 6-digit code we sent to' : "We don't recognise this device. Enter the 6-digit code we sent to";
  document.getElementById('auth-code-email').textContent = email;
  document.getElementById('auth-code-input').value = '';
  switchAuthTab('code');
  document.getElementById('auth-code-input').focus();
}
function submitAuthCode() {
  var ac = state.authCode;
  var code = document.getElementById('auth-code-input').value.replace(/\D/g,'');
  if(!ac) return;
  if(code.length!==6){showToast('Enter the 6-digit code from your email','error');return;}
  var btn = document.getElementById('auth-code-submit');
  btn.disabled = true; btn.textContent = 'Verifying...';
  fetch('/api/auth/verify-'+ac.purpose,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:ac.email,code:code})})
  .then(function(r){return r.json();})
  .then(function(res){
    btn.disabled = false; btn.textContent = 'Verify';
    if(res.error){showToast(res.error,'error');return;}
    state.authCode = null;
    loginUser(res.user);
    if(ac.purpose==='signup') showToast('Email verified! Welcome to TrendMallz, '+res.user.fname+'!');
  })
  .catch(function(){
    btn.disabled = false; btn.textContent = 'Verify';
    showToast('Connection error. Please try again.','error');
  });
}
function resendAuthCode() {
  var ac = state.authCode;
  if(!ac) return;
  fetch('/api/auth/resend-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:ac.email,purpose:ac.purpose})})
  .then(function(r){return r.json();})
  .then(function(res){
    if(res.error){showToast(res.error,'error');return;}
    showToast('New code sent to '+ac.email,'info');
  })
  .catch(function(){showToast('Connection error. Please try again.','error');});
}
// Live feedback under "Confirm Password" while typing
function checkSignupPasswords() {
  var p1 = document.getElementById('signup-password').value;
  var p2 = document.getElementById('signup-password2').value;
  var hint = document.getElementById('signup-pass-hint');
  var box2 = document.getElementById('signup-password2');
  if (!p2) { hint.style.display = 'none'; box2.style.borderColor = ''; return; }
  var same = p1 === p2;
  hint.style.display = '';
  hint.textContent = same ? '✓ Passwords match' : 'Passwords do not match';
  hint.style.color = same ? '#4ade80' : '#f87171';
  box2.style.borderColor = same ? '#4ade80' : '#f87171';
}

function doSignup() {
  var fname = document.getElementById('signup-fname').value.trim();
  var lname = document.getElementById('signup-lname').value.trim();
  var email = document.getElementById('signup-email').value.trim();
  var pass = document.getElementById('signup-password').value;
  var pass2 = document.getElementById('signup-password2').value;
  var countryCode = normalizeCountryCode(document.getElementById('signup-country') ? document.getElementById('signup-country').value : '');
  var terms = document.getElementById('signup-terms').checked;
  var gender = document.getElementById('signup-gender').value;
  if(!fname||!lname||!email||!pass){showToast('Please fill all required fields','error');return;}
  if(!gender){showToast('Please choose your gender','error');document.getElementById('signup-gender').focus();return;}
  if(pass.length<8){showToast('Password must be at least 8 characters','error');return;}
  if(pass!==pass2){showToast('Passwords do not match','error');document.getElementById('signup-password2').focus();return;}
  if(!terms){showToast('Please accept the terms','error');return;}
  var brandName = state.signupType==='vendor' ? (document.getElementById('signup-brand') ? document.getElementById('signup-brand').value.trim() : '') : '';
  var _sbtn = document.querySelector('#auth-signup .btn-primary') || Array.from(document.querySelectorAll('#auth-signup button')).find(function(b){return b.type==='button'&&b.textContent.includes('Create');});
  if(_sbtn){_sbtn.disabled=true;_sbtn.textContent='Creating account...';}
  fetch('/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fname:fname,lname:lname,email:email,password:pass,role:state.signupType,brandName:brandName,countryCode:countryCode,gender:gender})})
  .then(function(r){return r.json();})
  .then(function(res){
    if(_sbtn){_sbtn.disabled=false;_sbtn.textContent='Create Account';}
    if(res.error){showToast(res.error,'error');return;}
    if(res.autoVerified){loginUser(res.user);showToast('Welcome to TrendMallz, '+fname+'!');return;}
    if(res.needsCode) showAuthCode('signup',res.email);
  })
  .catch(function(){
    if(_sbtn){_sbtn.disabled=false;_sbtn.textContent='Create Account';}
    showToast('Connection error. Please try again.','error');
  });
}
function loginUser(user) {
  state.currentUser = user;
  closeAuthModal();
  updateNavForUser(user);
  showToast(`Welcome back, ${user.fname}!`);
  lucide.createIcons();
}
function doLogout() {
  fetch('/api/auth/logout',{method:'POST'}).catch(function(){});
  state.currentUser = null;
  state.cart = [];
  state.wishlist = [];
  orders = [];
  state.tryonPhoto = null;
  state.looks = null;
  adminUsers = [];
  updateNavForUser(null);
  showPage('home');
  updateCartBadge();
  updateWishlistBadge();
  showToast('Signed out successfully', 'info');
}
function updateNavForUser(user) {
  // The order of the shop follows who is signed in
  try { applyGenderOrder(); renderHome(); renderShopGrid(); } catch (_) {}
  const signInBtn = document.getElementById('signin-btn');
  const userMenuBtn = document.getElementById('user-menu-btn');
  const avatar = document.getElementById('user-avatar');
  const mobileLoginBtn = document.getElementById('mobile-login-btn');
  if(user) {
    signInBtn.classList.add('hidden');
    userMenuBtn.classList.remove('hidden');
    avatar.src = user.avatarUrl || getBitmoji(user.id || user.email, user.gender);
    avatar.alt = user.fname;
    document.getElementById('dropdown-name').textContent = user.fname + ' ' + user.lname;
    document.getElementById('dropdown-email').textContent = user.email;
    if(mobileLoginBtn) { mobileLoginBtn.textContent = 'Dashboard'; mobileLoginBtn.onclick = () => {openDashboard();closeMobileNav()}; }
  } else {
    signInBtn.classList.remove('hidden');
    userMenuBtn.classList.add('hidden');
    if(mobileLoginBtn) { mobileLoginBtn.textContent = 'Sign In'; mobileLoginBtn.onclick = () => {openAuthModal('login');closeMobileNav()}; }
  }
}
function toggleUserMenu() {
  state.userMenuOpen = !state.userMenuOpen;
  document.getElementById('user-dropdown').classList.toggle('open', state.userMenuOpen);
}
document.addEventListener('click', e => {
  if(!document.getElementById('user-menu-wrap').contains(e.target)) {
    state.userMenuOpen = false;
    document.getElementById('user-dropdown').classList.remove('open');
  }
});

// =================== PRODUCT CARD ===================
function productCard(p, size='') {
  const inWishlist = state.wishlist.includes(p.id);
  const hasDiscount = p.discount > 0;
  const lowStock = p.stock != null && p.stock < 10;
  const hasCompare = p.compare > p.price;
  const hasRating = p.rating > 0;
  return `
  <div class="group${size}">
    <div class="relative aspect-[3/4] rounded-2xl overflow-hidden bg-charcoal cursor-pointer" onclick="openProductModal(${p.id})">
      <img src="${p.img}" alt="${p.name}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy">
      ${hasDiscount ? `<span class="absolute top-3 left-3 px-2.5 py-1 bg-citrine text-black text-xs font-bold rounded-lg">-${p.discount}%</span>` : ''}
      ${lowStock ? `<span class="absolute top-3 ${hasDiscount ? 'left-16' : 'left-3'} px-2.5 py-1 bg-red-500/90 text-white text-xs font-bold rounded-lg">${p.stock} left</span>` : ''}
      <button onclick="event.stopPropagation();toggleWishlist(${p.id})" class="wishlist-btn absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${inWishlist?'active':''}">
        <svg class="w-4 h-4 ${inWishlist?'fill-red-500 text-red-500':'text-white'} transition-colors" fill="${inWishlist?'currentColor':'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
      <div class="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center gap-2 pb-3">
        <button onclick="event.stopPropagation();startTryOn(${p.id})" class="px-3 py-2 bg-white/15 backdrop-blur-sm border border-white/20 text-white text-xs font-bold rounded-lg uppercase tracking-wider hover:bg-citrine hover:text-black hover:border-citrine transition-all">Try On</button>
        <button onclick="event.stopPropagation();quickAddToCart(${p.id})" class="px-3 py-2 bg-citrine text-black text-xs font-bold rounded-lg uppercase tracking-wider hover:bg-citrine-dark transition-colors">Add</button>
      </div>
    </div>
    <div class="mt-3 space-y-1">
      <p class="text-xs text-neutral-500">${p.brand}</p>
      <h3 class="text-sm font-medium line-clamp-1 group-hover:text-citrine transition-colors cursor-pointer" onclick="openProductModal(${p.id})">${p.name}</h3>
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">${p.price > 0 ? fmt(p.price) : 'Price on request'}</span>
        ${hasCompare ? `<span class="text-xs text-neutral-600 line-through">${fmt(p.compare)}</span>` : ''}
      </div>
      ${hasRating ? `<div class="flex items-center gap-1">${stars(p.rating)}<span class="text-xs text-neutral-600">(${p.reviews})</span></div>` : ''}
    </div>
  </div>`;
}

// =================== HOME RENDERS ===================
function renderHome() {
  const hg = document.getElementById('home-product-grid');
  if(hg) hg.innerHTML = PRODUCTS.slice(0,8).map(p => productCard(p)).join('');
  renderHomeBrands();
  lucide.createIcons();
}

function renderHomeBrands() {
  const bg = document.getElementById('home-brands-grid');
  if(!bg) return;
  if(!BRANDS.length) { bg.innerHTML = ''; return; }
  bg.innerHTML = BRANDS.map(b => `
    <button onclick="showPage('brands')" class="group relative aspect-[4/5] rounded-2xl overflow-hidden text-left w-full">
      <img src="${b.img}" alt="${b.name}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700">
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
      <div class="absolute top-4 right-4">
        <div class="w-10 h-10 rounded-full border-2 border-white/20 overflow-hidden shadow-lg">
          <img src="${b.img}" alt="" class="w-full h-full object-cover">
        </div>
      </div>
      <div class="absolute bottom-0 left-0 right-0 p-5">
        <h3 class="font-display font-bold text-lg leading-tight text-white">${b.name}</h3>
        <p class="text-[11px] text-citrine mt-1 font-medium tracking-wide uppercase flex items-center gap-1">View collection <span class="inline-block group-hover:translate-x-1 transition-transform">→</span></p>
      </div>
    </button>`).join('');
  lucide.createIcons();
}

// =================== SHOP PAGE ===================
let activeCategories = new Set(), activeBrands = new Set();

function filterCategory(cat) {
  activeCategories.clear();
  if(cat) activeCategories.add(cat);
  document.getElementById('shop-filter-label').textContent = cat ? `Showing: ${cat}` : 'Browse our full collection';
}
function renderShopGrid() {
  const sort = document.getElementById('shop-sort')?.value || 'default';
  const priceMin = parseFloat(document.getElementById('price-min')?.value) || 0;
  const priceMax = parseFloat(document.getElementById('price-max')?.value) || Infinity;
  let prods = PRODUCTS.filter(p => {
    if(activeCategories.size && !activeCategories.has(p.category)) return false;
    if(activeBrands.size && !activeBrands.has(p.brand)) return false;
    if(p.price < priceMin || p.price > priceMax) return false;
    return true;
  });
  if(sort==='price-asc') prods.sort((a,b)=>a.price-b.price);
  else if(sort==='price-desc') prods.sort((a,b)=>b.price-a.price);
  else if(sort==='rating') prods.sort((a,b)=>b.rating-a.rating);
  
  const grid = document.getElementById('shop-grid');
  const empty = document.getElementById('shop-empty');
  if(prods.length===0) { grid.innerHTML=''; empty.classList.remove('hidden'); }
  else { empty.classList.add('hidden'); grid.innerHTML = prods.map(p => productCard(p)).join(''); }
  
  // Render filter checkboxes
  const cats = [...new Set(PRODUCTS.map(p=>p.category))];
  const brnds = [...new Set(PRODUCTS.map(p=>p.brand))];
  const catEl = document.getElementById('category-filters');
  const brdEl = document.getElementById('brand-filters');
  if(catEl) catEl.innerHTML = cats.map(c => `<label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer hover:text-white"><input type="checkbox" onchange="toggleCategoryFilter('${c}',this.checked)" ${activeCategories.has(c)?'checked':''}> ${c}</label>`).join('');
  if(brdEl) brdEl.innerHTML = brnds.map(b => `<label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer hover:text-white"><input type="checkbox" onchange="toggleBrandFilter('${b}',this.checked)" ${activeBrands.has(b)?'checked':''}> ${b}</label>`).join('');
  lucide.createIcons();
}
function toggleCategoryFilter(cat, checked) { if(checked) activeCategories.add(cat); else activeCategories.delete(cat); renderShopGrid(); }
function toggleBrandFilter(brand, checked) { if(checked) activeBrands.add(brand); else activeBrands.delete(brand); renderShopGrid(); }
function resetFilters() { activeCategories.clear(); activeBrands.clear(); if(document.getElementById('price-min')) document.getElementById('price-min').value=''; if(document.getElementById('price-max')) document.getElementById('price-max').value=''; document.getElementById('shop-filter-label').textContent = 'Browse our full collection'; renderShopGrid(); }
function toggleShopFilters() { document.getElementById('shop-filters-sidebar').classList.toggle('hidden'); }

// =================== BRANDS PAGE ===================
function renderBrandsPage() {
  const g = document.getElementById('brands-grid');
  if(!g) return;
  if(!BRANDS.length) { g.innerHTML = ''; return; }
  g.innerHTML = BRANDS.map(b => `
    <div class="bg-charcoal rounded-2xl overflow-hidden border border-charcoal-border hover:border-citrine/30 transition-all duration-300 group cursor-pointer" onclick="filterCategory('');activeBrands.clear();activeBrands.add('${b.name}');showPage('shop')">
      <div class="relative h-52 overflow-hidden">
        <img src="${b.img}" alt="${b.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700">
        <div class="absolute inset-0 bg-gradient-to-t from-charcoal via-charcoal/20 to-transparent"></div>
        <div class="absolute top-4 left-4">
          <span class="text-[10px] font-semibold uppercase tracking-[0.25em] text-neutral-400 bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded-full">Fashion Brand</span>
        </div>
      </div>
      <div class="p-5 flex items-center gap-4">
        <div class="w-12 h-12 rounded-full border-2 border-charcoal-border overflow-hidden flex-shrink-0 shadow-md">
          <img src="${b.img}" alt="" class="w-full h-full object-cover">
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-display font-bold text-base leading-tight truncate">${b.name}</h3>
          <p class="text-[11px] text-citrine mt-0.5 font-medium uppercase tracking-wide">View collection</p>
        </div>
        <i data-lucide="arrow-right" class="w-4 h-4 text-neutral-600 group-hover:text-citrine group-hover:translate-x-1 transition-all flex-shrink-0"></i>
      </div>
    </div>`).join('');
  lucide.createIcons();
}

// =================== PRODUCT MODAL ===================
function openProductModal(id) {
  const p = PRODUCTS.find(x => x.id===id);
  if(!p) return;
  const sizes = p.sizes && p.sizes.length ? p.sizes : ['S','M','L','XL'];
  const colors = p.colors && p.colors.length ? p.colors : ['Default'];
  const hasDiscount = p.discount > 0;
  const hasCompare = p.compare > p.price;
  const hasRating = p.rating > 0;
  const showStock = p.stock != null && p.stock < 99;
  const imgs = (p.images && p.images.length) ? p.images : [p.img];
  const _carCtrl = imgs.length > 1 ? '<button onclick="modalImgGo(-1)" class="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white text-xl leading-none transition-colors z-10">&#8249;</button><button onclick="modalImgGo(1)" class="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white text-xl leading-none transition-colors z-10">&#8250;</button>' : '';
  const _carDots = imgs.length > 1 ? '<div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">' + imgs.map(function(_,i){return '<div class="modal-dot w-2 h-2 rounded-full transition-colors ' + (i===0?'bg-citrine':'bg-white/40') + '"></div>';}).join('') + '</div>' : '';
  const _carThumbs = imgs.length > 1 ? '<div class="flex gap-2 p-3 overflow-x-auto scrollbar-hide">' + imgs.map(function(src,i){return '<img src="' + src + '" onclick="modalImgSet(' + i + ')" class="modal-thumb w-14 rounded-lg object-cover cursor-pointer shrink-0 border-2 ' + (i===0?'border-citrine':'border-transparent opacity-60 hover:opacity-90') + '" style="height:4.5rem">';}).join('') + '</div>' : '';
  const modal = document.getElementById('product-modal');
  document.getElementById('product-modal-body').innerHTML = `
  <div class="flex flex-col sm:flex-row">
    <div class="sm:w-1/2 flex flex-col">
      <div class="relative aspect-[3/4] overflow-hidden sm:rounded-tl-2xl sm:rounded-bl-2xl bg-obsidian">
        <img id="modal-img-display" src="${imgs[0]}" alt="${p.name}" class="w-full h-full object-cover">
        ${_carCtrl}${_carDots}
      </div>
      ${_carThumbs}
    </div>
    <div class="sm:w-1/2 p-6 sm:p-8 flex flex-col">
      <p class="text-xs text-citrine font-semibold uppercase tracking-wider mb-1">${p.brand} · ${p.category}</p>
      <h2 class="font-display text-2xl font-bold mb-2">${p.name}</h2>
      <div class="flex items-center gap-2 mb-3">
        ${hasRating ? `<div class="flex items-center gap-1">${stars(p.rating,'w-4 h-4')}</div><span class="text-sm text-neutral-400">${p.rating} (${p.reviews} reviews)</span>` : `<span class="text-sm text-neutral-500">No reviews yet</span>`}
      </div>
      <div class="flex items-baseline gap-3 mb-4">
        <span class="text-3xl font-bold">${p.price > 0 ? fmt(p.price) : 'Price on request'}</span>
        ${hasCompare ? `<span class="text-neutral-500 line-through">${fmt(p.compare)}</span>` : ''}
        ${hasDiscount ? `<span class="badge badge-yellow">-${p.discount}%</span>` : ''}
      </div>
      <p class="text-sm text-neutral-400 leading-relaxed mb-3" style="white-space:pre-line">${escHtml(p.description || `${p.name} by ${p.brand}.`)}</p>
      ${[['For', PRODUCT_GENDER_LABELS[p.gender]], ['Type', p.itemTypeLabel], ['Material', p.material], ['Fit', p.fit], ['Care', p.care]].filter(d => d[1]).length ? `<dl class="text-xs text-neutral-400 mb-5 grid gap-y-1" style="grid-template-columns:auto 1fr;column-gap:12px">${[['For', PRODUCT_GENDER_LABELS[p.gender]], ['Type', p.itemTypeLabel], ['Material', p.material], ['Fit', p.fit], ['Care', p.care]].filter(d => d[1]).map(d => `<dt class="text-neutral-500">${d[0]}</dt><dd>${escHtml(d[1])}</dd>`).join('')}</dl>` : '<div class="mb-2"></div>'}
      <!-- Size Picker -->
      <div class="mb-4">
        <p class="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Size</p>
        <div class="flex flex-wrap gap-2" id="size-picker-${p.id}">
          ${sizes.map((s,i) => `<button onclick="selectSize('${p.id}','${s}')" class="size-btn px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${i===0?'border-citrine bg-citrine/10 text-citrine':'border-charcoal-border text-neutral-400 hover:border-neutral-500'}">${s}</button>`).join('')}
        </div>
      </div>
      <!-- Color Picker -->
      <div class="mb-5">
        <p class="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Color: <span id="color-label-${p.id}">${colors[0]}</span></p>
        <div class="flex flex-wrap gap-2">
          ${colors.map((c,i) => `<button onclick="selectColor('${p.id}','${c}',this)" class="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${i===0?'border-citrine bg-citrine/10 text-citrine':'border-charcoal-border text-neutral-400 hover:border-neutral-500'}">${c}</button>`).join('')}
        </div>
      </div>
      <!-- Qty -->
      <div class="flex items-center gap-4 mb-5">
        <p class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Qty</p>
        <div class="flex items-center gap-3">
          <div class="qty-btn" onclick="changeModalQty('${p.id}',-1)">−</div>
          <span id="modal-qty-${p.id}" class="w-8 text-center font-semibold">1</span>
          <div class="qty-btn" onclick="changeModalQty('${p.id}',1)">+</div>
        </div>
        ${showStock ? `<span class="text-xs text-neutral-600">${p.stock} in stock</span>` : ''}
      </div>
      <div class="flex gap-3 mt-auto">
        <button onclick="addToCartFromModal(${p.id})" class="flex-1 py-3.5 bg-citrine text-black font-bold rounded-xl hover:bg-citrine-dark transition-colors text-sm uppercase tracking-wider">Add to Cart</button>
        <button onclick="toggleWishlist(${p.id})" class="px-4 py-3.5 bg-charcoal-light rounded-xl hover:bg-charcoal-lighter transition-colors">
          <svg class="w-5 h-5 ${state.wishlist.includes(p.id)?'fill-red-500 text-red-500':'text-neutral-400'}" fill="${state.wishlist.includes(p.id)?'currentColor':'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      <div class="mt-4 flex flex-wrap gap-3 text-xs text-neutral-500">
        <span class="flex items-center gap-1"><i data-lucide="truck" class="w-3.5 h-3.5 text-citrine"></i>Free delivery over ₦30k</span>
        <span class="flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3.5 h-3.5 text-citrine"></i>30-day returns</span>
        <span class="flex items-center gap-1"><i data-lucide="shield-check" class="w-3.5 h-3.5 text-citrine"></i>Authentic guaranteed</span>
      </div>
    </div>
  </div>`;
    document.getElementById('product-modal-body').innerHTML += buildReviewsSection(p.id);
modal.classList.remove('hidden');
  lucide.createIcons();
  modal._selectedSize = sizes[0];
  modal._selectedColor = colors[0];
  modal._productId = p.id;
  modal._qty = 1;
  modal._imgs = imgs;
  modal._imgIdx = 0;
}
function closeProductModal() { document.getElementById('product-modal').classList.add('hidden'); }
function modalImgGo(dir) {
  var modal = document.getElementById('product-modal');
  var imgs = modal._imgs || [];
  if (imgs.length < 2) return;
  modal._imgIdx = ((modal._imgIdx || 0) + dir + imgs.length) % imgs.length;
  modalImgSet(modal._imgIdx);
}
function modalImgSet(idx) {
  var modal = document.getElementById('product-modal');
  var imgs = modal._imgs || [];
  modal._imgIdx = idx;
  var disp = document.getElementById('modal-img-display');
  if (disp && imgs[idx]) disp.src = imgs[idx];
  document.querySelectorAll('.modal-thumb').forEach(function(t, i) {
    t.style.borderColor = i === idx ? '#FF6B00' : 'transparent';
    t.style.opacity = i === idx ? '1' : '0.6';
  });
  document.querySelectorAll('.modal-dot').forEach(function(d, i) {
    d.style.backgroundColor = i === idx ? '#FF6B00' : 'rgba(255,255,255,0.4)';
  });
}
function selectSize(pid, size) {
  document.querySelectorAll(`#size-picker-${pid} .size-btn`).forEach(b => {
    b.className = b.textContent.trim()===size ? 'size-btn px-3 py-1.5 rounded-lg border text-sm font-medium transition-all border-citrine bg-citrine/10 text-citrine' : 'size-btn px-3 py-1.5 rounded-lg border text-sm font-medium transition-all border-charcoal-border text-neutral-400 hover:border-neutral-500';
  });
  document.getElementById('product-modal')._selectedSize = size;
}
function selectColor(pid, color, btn) {
  btn.closest('.flex').querySelectorAll('button').forEach(b => b.className = 'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all border-charcoal-border text-neutral-400 hover:border-neutral-500');
  btn.className = 'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all border-citrine bg-citrine/10 text-citrine';
  document.getElementById(`color-label-${pid}`).textContent = color;
  document.getElementById('product-modal')._selectedColor = color;
}
function changeModalQty(pid, delta) {
  const modal = document.getElementById('product-modal');
  modal._qty = Math.max(1, (modal._qty||1) + delta);
  document.getElementById(`modal-qty-${pid}`).textContent = modal._qty;
}
function addToCartFromModal(id) {
  const modal = document.getElementById('product-modal');
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  const sizes = p.sizes && p.sizes.length ? p.sizes : ['M'];
  const colors = p.colors && p.colors.length ? p.colors : ['Default'];
  addToCart(id, modal._selectedSize||sizes[0], modal._selectedColor||colors[0], modal._qty||1);
  closeProductModal();
}
function quickAddToCart(id) {
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  const size = (p.sizes && p.sizes.length ? p.sizes : ['M'])[0];
  const color = (p.colors && p.colors.length ? p.colors : ['Default'])[0];
  addToCart(id, size, color, 1);
}


// =================== REVIEWS ===================
function getProductReviews(id) {
  try { return JSON.parse(localStorage.getItem('tm_reviews_' + id) || '[]'); } catch(_) { return []; }
}
function saveProductReview(id, review) {
  var reviews = getProductReviews(id);
  reviews.unshift(review);
  localStorage.setItem('tm_reviews_' + id, JSON.stringify(reviews));
}
function avgRating(reviews) {
  if (!reviews.length) return 0;
  return reviews.reduce(function(s, r) { return s + r.rating; }, 0) / reviews.length;
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
var _reviewStar = 0;
function setReviewStar(n) {
  _reviewStar = n;
  document.querySelectorAll('.star-pick').forEach(function(s, i) {
    s.classList.toggle('star-full', i < n);
    s.classList.toggle('star-empty', i >= n);
  });
}
function hoverReviewStar(n) {
  document.querySelectorAll('.star-pick').forEach(function(s, i) {
    s.classList.toggle('star-full', i < n);
    s.classList.toggle('star-empty', i >= n);
  });
}
function clearReviewStarHover() { setReviewStar(_reviewStar); }
function submitReview(pid) {
  var nameEl = document.getElementById('review-name');
  var textEl = document.getElementById('review-text');
  var name = nameEl ? nameEl.value.trim() : '';
  var text = textEl ? textEl.value.trim() : '';
  if (!_reviewStar) { showToast('Please select a star rating', 'warning'); return; }
  if (!text) { showToast('Please write a comment', 'warning'); return; }
  if (!name) name = 'Anonymous';
  var review = {
    name: name,
    rating: _reviewStar,
    text: text,
    date: new Date().toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })
  };
  saveProductReview(pid, review);
  _reviewStar = 0;
  var container = document.getElementById('product-reviews-' + pid);
  if (container) container.outerHTML = buildReviewsSection(pid);
  showToast('Review submitted! Thank you.', 'success');
}
function buildReviewsSection(pid) {
  var reviews = getProductReviews(pid);
  var avg = avgRating(reviews);
  var avgStr = avg > 0 ? avg.toFixed(1) : '';
  var starPickHtml = '';
  for (var si = 1; si <= 5; si++) {
    starPickHtml += '<svg onclick="setReviewStar(' + si + ')" onmouseenter="hoverReviewStar(' + si + ')" onmouseleave="clearReviewStarHover()" class="star-pick star-empty w-6 h-6 cursor-pointer transition-colors" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
  }
  var listHtml = reviews.length ? reviews.map(function(r) {
    return '<div class="py-4 border-b border-charcoal-border last:border-0">' +
      '<div class="flex items-center justify-between mb-1">' +
      '<span class="font-semibold text-sm text-white">' + escHtml(r.name) + '</span>' +
      '<span class="text-xs text-neutral-500">' + escHtml(r.date) + '</span>' +
      '</div>' +
      '<div class="flex gap-0.5 mb-2">' + stars(r.rating, 'w-3.5 h-3.5') + '</div>' +
      '<p class="text-sm text-neutral-400 leading-relaxed">' + escHtml(r.text) + '</p>' +
      '</div>';
  }).join('') : '<p class="text-sm text-neutral-500 text-center py-6">No reviews yet. Be the first!</p>';
  var summaryHtml = avgStr ? ('<div class="flex items-center gap-4 mb-6 p-4 bg-charcoal-light rounded-xl">' +
    '<span class="font-display text-4xl font-bold text-white">' + avgStr + '</span>' +
    '<div><div class="flex gap-0.5 mb-1">' + stars(avg, 'w-5 h-5') + '</div>' +
    '<p class="text-xs text-neutral-500">' + reviews.length + ' review' + (reviews.length !== 1 ? 's' : '') + '</p></div>' +
    '</div>') : '';
  return '<div id="product-reviews-' + pid + '" class="border-t border-charcoal-border p-6 sm:p-8">' +
    '<h3 class="font-display text-lg font-bold mb-5">Customer Reviews</h3>' +
    summaryHtml +
    '<div class="mb-6">' + listHtml + '</div>' +
    '<div class="bg-charcoal-light rounded-xl p-5">' +
    '<p class="text-sm font-semibold mb-3 text-white">Write a Review</p>' +
    '<div class="flex items-center gap-1 mb-3">' + starPickHtml + '</div>' +
    '<input id="review-name" type="text" placeholder="Your name (optional)" class="w-full bg-charcoal border border-charcoal-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-600 mb-3 focus:outline-none focus:border-citrine/50">' +
    '<textarea id="review-text" rows="3" placeholder="Share your thoughts about this product..." class="w-full bg-charcoal border border-charcoal-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-600 mb-3 focus:outline-none focus:border-citrine/50 resize-none"></textarea>' +
    '<button onclick="submitReview(' + pid + ')" class="px-6 py-2.5 bg-citrine text-black text-sm font-bold rounded-xl hover:bg-citrine-dark transition-colors uppercase tracking-wider">Submit Review</button>' +
    '</div>' +
    '</div>';
}
// =================== CART ===================
function addToCart(id, size, color, qty=1) {
  const p = PRODUCTS.find(x=>x.id===id);
  const key = `${id}_${size}_${color}`;
  const existing = state.cart.find(i => i.key===key);
  if(existing) existing.qty += qty;
  else state.cart.push({key, productId:id, name:p.name, brand:p.brand, price:p.price, img:p.img, size, color, qty});
  updateCartBadge();
  renderCartDrawer();
  showToast(`${p.name} added to cart`);
  toggleCart(true);
}
function removeFromCart(key) { state.cart = state.cart.filter(i=>i.key!==key); updateCartBadge(); renderCartDrawer(); }
function updateCartQty(key, delta) {
  const item = state.cart.find(i=>i.key===key);
  if(item) { item.qty = Math.max(1, item.qty+delta); if(item.qty===0) removeFromCart(key); }
  updateCartBadge(); renderCartDrawer();
}
function cartTotal() { return state.cart.reduce((s,i)=>s+i.price*i.qty,0); }
function updateCartBadge() {
  const total = state.cart.reduce((s,i)=>s+i.qty,0);
  const badge = document.getElementById('cart-badge');
  badge.textContent = total;
  badge.classList.toggle('hidden', total===0);
  badge.classList.toggle('flex', total>0);
}
function toggleCart(open) {
  state.cartOpen = open;
  document.getElementById('cart-drawer').classList.toggle('open', open);
  document.getElementById('cart-overlay').classList.toggle('open', open);
  if(open) renderCartDrawer();
}
function renderCartDrawer() {
  const el = document.getElementById('cart-items');
  const footer = document.getElementById('cart-footer');
  const label = document.getElementById('cart-count-label');
  label.textContent = `(${state.cart.length} item${state.cart.length!==1?'s':''})`;
  if(state.cart.length===0) {
    el.innerHTML = `<div class="flex flex-col items-center justify-center h-full py-16 text-neutral-500">
      <i data-lucide="shopping-bag" class="w-16 h-16 mb-4 opacity-20"></i>
      <p class="text-lg font-medium">Your cart is empty</p>
      <button onclick="toggleCart(false);showPage('shop')" class="mt-4 px-6 py-2.5 bg-citrine text-obsidian text-sm font-bold rounded-xl">Browse Products</button>
    </div>`;
    footer.innerHTML = '';
  } else {
    el.innerHTML = state.cart.map(item => `
    <div class="flex gap-4 items-start">
      <img src="${item.img}" class="w-20 h-24 object-cover rounded-xl shrink-0">
      <div class="flex-1 min-w-0">
        <h4 class="text-sm font-medium line-clamp-1">${item.name}</h4>
        <p class="text-xs text-neutral-500 mt-0.5">${item.brand} · ${item.size} · ${item.color}</p>
        <div class="flex items-center justify-between mt-3">
          <div class="flex items-center gap-2">
            <div class="qty-btn text-sm" onclick="updateCartQty('${item.key}',-1)" style="width:28px;height:28px">−</div>
            <span class="w-5 text-center text-sm font-semibold">${item.qty}</span>
            <div class="qty-btn text-sm" onclick="updateCartQty('${item.key}',1)" style="width:28px;height:28px">+</div>
          </div>
          <span class="text-sm font-bold">${fmt(item.price*item.qty)}</span>
        </div>
      </div>
      <button onclick="removeFromCart('${item.key}')" class="shrink-0 text-neutral-600 hover:text-red-400 transition-colors mt-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
    </div>`).join('');
    const subtotal = cartTotal();
    const delivery = subtotal >= 30000 ? 0 : 2500;
    footer.innerHTML = `
    <div class="space-y-2 text-sm">
      <div class="flex justify-between text-neutral-400"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
      <div class="flex justify-between text-neutral-400"><span>Delivery</span><span class="${delivery===0?'text-green-400':''}">${delivery===0?'FREE':fmt(delivery)}</span></div>
      <div class="flex justify-between font-bold text-base border-t border-charcoal-border pt-2"><span>Total</span><span>${fmt(subtotal+delivery)}</span></div>
    </div>
    <button onclick="proceedToCheckout()" class="w-full py-3.5 bg-citrine text-obsidian font-bold rounded-xl hover:bg-citrine-dark transition-colors text-sm uppercase tracking-wider">Proceed to Checkout</button>
    <button onclick="toggleCart(false)" class="w-full py-2.5 text-sm text-neutral-400 hover:text-white transition-colors">Continue Shopping</button>`;
  }
  lucide.createIcons();
}

function proceedToCheckout() {
  if(!state.currentUser) { toggleCart(false); openAuthModal('login'); return; }
  toggleCart(false);
  showPage('checkout');
}

// =================== CHECKOUT ===================
function renderCheckout() {
  const el = document.getElementById('checkout-content');
  state.coupon = null;
  if(state.cart.length===0) { el.innerHTML = '<div class="text-center py-20 text-neutral-500">Your cart is empty. <button onclick="showPage(\'shop\')" class="text-citrine hover:underline">Shop now</button></div>'; return; }
  const subtotal = cartTotal();
  const delivery = subtotal >= 30000 ? 0 : 2500;
  const total = subtotal + delivery;
  const commission = Math.round(total * 0.1);
  el.innerHTML = `
  <div class="grid lg:grid-cols-5 gap-8">
    <div class="lg:col-span-3 space-y-6">
      <!-- Contact -->
      <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border">
        <h3 class="font-display font-bold text-lg mb-4">Contact & Shipping</h3>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">First Name</label><input id="co-fname" type="text" value="${escHtml(state.currentUser?.fname||'')}" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
          <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">Last Name</label><input id="co-lname" type="text" value="${escHtml(state.currentUser?.lname||'')}" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
          <div class="col-span-2"><label class="text-xs text-neutral-400 font-medium mb-1.5 block">Email</label><input id="co-email" type="email" value="${escHtml(state.currentUser?.email||'')}" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
          <div class="col-span-2"><label class="text-xs text-neutral-400 font-medium mb-1.5 block">Phone</label><input id="co-phone" type="tel" placeholder="+234 000 000 0000" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
          <div class="col-span-2"><label class="text-xs text-neutral-400 font-medium mb-1.5 block">Delivery Address</label><input id="co-address" type="text" placeholder="Street address" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
          <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">City</label><input id="co-city" type="text" placeholder="Lagos" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
          <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">State</label><select id="co-state" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine">${NG_STATES.map(st=>`<option ${st==='Lagos'?'selected':''}>${st}</option>`).join('')}</select></div>
        </div>
      </div>
      <!-- Payment -->
      <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border">
        <h3 class="font-display font-bold text-lg mb-4">Payment Method</h3>
        <div class="space-y-3">
          <label class="flex items-center gap-4 p-4 rounded-xl border border-citrine bg-citrine/5 cursor-pointer">
            <input type="radio" name="payment" value="paystack" checked class="accent-citrine"> 
            <div class="flex-1"><div class="font-semibold text-sm">Paystack</div><div class="text-xs text-neutral-400">Card, bank transfer, USSD</div></div>
            <span class="text-xs text-citrine font-semibold">Recommended</span>
          </label>
        </div>
      </div>
      <!-- Coupon -->
      <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border">
        <h3 class="font-display font-bold text-lg mb-4">Coupon Code</h3>
        <div class="flex gap-3">
          <input id="coupon-input" type="text" placeholder="Enter coupon code" class="flex-1 px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine uppercase">
          <button onclick="applyCoupon()" class="px-5 py-3 bg-charcoal-light border border-charcoal-border rounded-xl text-sm font-semibold hover:border-citrine transition-colors">Apply</button>
        </div>
        <p class="text-xs text-neutral-600 mt-2">Try: WELCOME10 (10% off) · FREESHIP (free delivery)</p>
      </div>
    </div>
    <!-- Order Summary -->
    <div class="lg:col-span-2">
      <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border sticky top-24">
        <h3 class="font-display font-bold text-lg mb-5">Order Summary</h3>
        <div class="space-y-4 mb-5">
          ${state.cart.map(i=>`<div class="flex gap-3 items-center"><img src="${i.img}" class="w-14 h-16 object-cover rounded-xl shrink-0"><div class="flex-1 min-w-0"><p class="text-xs font-medium line-clamp-1">${i.name}</p><p class="text-xs text-neutral-500">${i.size} · ×${i.qty}</p></div><span class="text-sm font-bold shrink-0">${fmt(i.price*i.qty)}</span></div>`).join('')}
        </div>
        <div class="space-y-2 text-sm border-t border-charcoal-border pt-4 mb-5">
          <div class="flex justify-between text-neutral-400"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
          <div class="flex justify-between text-neutral-400"><span>Delivery</span><span class="${delivery===0?'text-green-400':''}">${delivery===0?'FREE':fmt(delivery)}</span></div>
          <div id="discount-row" class="hidden flex justify-between text-green-400"><span>Discount</span><span id="discount-amount"></span></div>
          <div class="flex justify-between font-bold text-base border-t border-charcoal-border pt-2"><span>Total</span><span id="checkout-total">${fmt(total)}</span></div>
          <div class="flex justify-between text-xs text-neutral-600"><span>Platform fee (10%)</span><span>${fmt(commission)}</span></div>
        </div>
        <button id="pay-now-btn" onclick="placeOrder()" class="w-full py-4 font-bold rounded-xl uppercase tracking-wider btn-fire text-white pulse-orange relative overflow-hidden" style="background:linear-gradient(135deg,#FF6B00,#e05e00)">
          <span class="relative z-10 flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            <span id="pay-now-label">Pay Now · ${fmt(total)}</span>
          </span>
        </button>
        <div class="mt-3 paystack-badge flex items-center justify-center gap-2 text-xs text-neutral-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#00C596" opacity="0.2"/><path d="M8 12l3 3 5-5" stroke="#00C596" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Secured by <span class="text-green-400 font-semibold">Paystack</span> · 256-bit SSL
        </div>
      </div>
    </div>
  </div>`;
  lucide.createIcons();
}

// What's being bought; the server looks up prices itself
function checkoutItems() {
  return state.cart.map(i => ({ productId: i.productId, qty: i.qty, size: i.size, color: i.color }));
}
function checkoutShipping() {
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  return { fname: v('co-fname'), lname: v('co-lname'), email: v('co-email'), phone: v('co-phone'), address: v('co-address'), city: v('co-city'), state: v('co-state') };
}

function applyCoupon() {
  const code = document.getElementById('coupon-input').value.trim().toUpperCase();
  if(!code) return;
  fetch('/api/orders/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: checkoutItems(), coupon: code }) })
    .then(r => r.json())
    .then(q => {
      if(q.error) { showToast(q.error, 'error'); return; }
      state.coupon = code;
      showToast('Coupon applied: ' + q.coupon.label + '!');
      document.getElementById('discount-row').classList.remove('hidden');
      document.getElementById('discount-amount').textContent = '-' + fmt(q.discount);
      document.getElementById('checkout-total').textContent = fmt(q.total);
      const payLabel = document.getElementById('pay-now-label');
      if (payLabel) payLabel.textContent = 'Pay Now · ' + fmt(q.total);
    })
    .catch(() => showToast('Connection error. Please try again.', 'error'));
}

async function placeOrder() {
  if(!state.currentUser) { openAuthModal('login'); return; }
  if(state.cart.length === 0) return;
  if(typeof PaystackPop === 'undefined') { showToast('Payment service failed to load. Check your connection and refresh.', 'error'); return; }

  const btn = document.getElementById('pay-now-btn');
  if (btn) btn.disabled = true;
  let res;
  try {
    const r = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: checkoutItems(), coupon: state.coupon || '', shipping: checkoutShipping() })
    });
    res = await r.json();
    if (r.status === 401) { openAuthModal('login'); showToast('Please sign in again to continue', 'info'); return; }
    if (!r.ok) { showToast(res.error || 'Could not start checkout', 'error'); return; }
  } catch(_) {
    showToast('Connection error. Please try again.', 'error');
    return;
  } finally {
    if (btn) btn.disabled = false;
  }

  const handler = PaystackPop.setup({
    key: res.publicKey,
    email: res.email,
    amount: res.amount, // kobo, set by the server
    currency: 'NGN',
    ref: res.reference,
    metadata: { custom_fields: [{ display_name: 'Order', variable_name: 'order_id', value: res.order.id }] },
    onClose: function() {
      showToast('Payment window closed. Your order was not placed.', 'info');
    },
    // PaystackPop v1 rejects async callbacks, so verification runs via a promise
    callback: function(response) {
      showToast('Confirming payment…', 'info');
      fetch('/api/paystack/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: response.reference })
      })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (!ok || !data.success) throw new Error(data.error || 'Verification failed');
          state.cart = [];
          state.coupon = null;
          updateCartBadge();
          loadOrders();
          showToast('🎉 Payment confirmed! Order ' + data.order.trackingId + ' placed!');
          showOrderSuccessModal(data.order);
        })
        .catch(err => {
          showToast('We could not confirm your payment yet (' + err.message + '). If you were charged, contact support with ref ' + response.reference, 'error');
        });
    }
  });

  handler.openIframe();
}

function showOrderSuccessModal(order) {
  const existing = document.getElementById('order-success-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'order-success-modal';
  modal.innerHTML = `
    <div class="fixed inset-0 z-[300] flex items-center justify-center">
      <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" onclick="document.getElementById('order-success-modal').remove();showPage('orders-page')"></div>
      <div class="modal-box relative w-full max-w-md mx-4 bg-charcoal border border-charcoal-border rounded-3xl overflow-hidden shadow-2xl text-center p-8">
        <div class="w-20 h-20 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-5 glow-orange">
          <svg class="w-10 h-10 text-citrine" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </div>
        <h2 class="font-display text-2xl font-bold mb-2">Order Confirmed! 🎉</h2>
        <p class="text-neutral-400 text-sm mb-4">Your payment was successful. Your order is being processed.</p>
        <div class="bg-obsidian rounded-2xl p-4 mb-6 border border-charcoal-border">
          <p class="text-xs text-neutral-500 mb-1">Order ID</p>
          <p class="font-mono font-bold text-citrine text-lg">${order.trackingId}</p>
          <p class="text-xs text-neutral-500 mt-2">Total Paid: <span class="text-white font-semibold">${fmt(order.total)}</span></p>
        </div>
        <button onclick="document.getElementById('order-success-modal').remove();showPage('orders-page')" class="w-full py-3.5 bg-citrine text-obsidian font-bold rounded-xl text-sm uppercase tracking-wider btn-fire">
          <span>Track My Order</span>
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  lucide.createIcons();
}

// =================== ORDERS PAGE ===================
function renderOrders() {
  if(!state.currentUser) { openAuthModal('login'); return; }
  const userOrders = orders.filter(o=>o.userId===state.currentUser.id);
  const el = document.getElementById('orders-list');
  const empty = document.getElementById('orders-empty');
  if(userOrders.length===0) { el.innerHTML=''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  el.innerHTML = userOrders.reverse().map(o => `
  <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border">
    <div class="flex items-center justify-between mb-4">
      <div>
        <p class="text-xs text-neutral-500">Order #${o.trackingId}</p>
        <p class="text-sm font-semibold mt-0.5">${o.date}</p>
      </div>
      <span class="badge ${o.status==='Delivered'?'badge-green':o.status==='In Transit'?'badge-blue':o.status==='Processing'?'badge-yellow':'badge-gray'}">${o.status}</span>
    </div>
    <div class="space-y-3 mb-4">
      ${o.items.map(i=>`<div class="flex gap-3 items-center"><img src="${i.img}" class="w-14 h-16 rounded-xl object-cover"><div class="flex-1"><p class="text-sm font-medium">${i.name}</p><p class="text-xs text-neutral-500">${i.size||''} · Qty ${i.qty}</p></div><span class="text-sm font-bold">${fmt(i.price*i.qty)}</span></div>`).join('')}
    </div>
    <div class="flex items-center justify-between pt-4 border-t border-charcoal-border">
      <span class="text-sm text-neutral-400">${o.items.length} item${o.items.length!==1?'s':''} · ${fmt(o.subtotal)}</span>
      <div class="flex gap-2">
        ${o.status!=='Delivered' ? `<button onclick="showToast('Tracking: ${o.trackingId}','info')" class="px-4 py-2 bg-charcoal-light rounded-xl text-xs font-semibold hover:bg-charcoal-lighter transition-colors">Track Order</button>` : ''}
        <button onclick="showToast('Invoice downloaded','info')" class="px-4 py-2 bg-charcoal-light rounded-xl text-xs font-semibold hover:bg-charcoal-lighter transition-colors">Invoice</button>
      </div>
    </div>
  </div>`).join('');
  lucide.createIcons();
}

// =================== WISHLIST ===================
function toggleWishlist(id) {
  if(state.wishlist.includes(id)) {
    state.wishlist = state.wishlist.filter(x=>x!==id);
    showToast('Removed from wishlist','info');
  } else {
    state.wishlist.push(id);
    showToast('Added to wishlist');
  }
  updateWishlistBadge();
  renderHome();
  if(state.currentPage==='wishlist') renderWishlist();
  if(state.currentPage==='shop') renderShopGrid();
}
function updateWishlistBadge() {
  const badge = document.getElementById('wishlist-count-badge');
  badge.textContent = state.wishlist.length;
  badge.classList.toggle('hidden', state.wishlist.length===0);
  badge.classList.toggle('flex', state.wishlist.length>0);
}
function renderWishlist() {
  const grid = document.getElementById('wishlist-grid');
  const empty = document.getElementById('wishlist-empty');
  if(state.wishlist.length===0) { grid.innerHTML=''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const prods = PRODUCTS.filter(p=>state.wishlist.includes(p.id));
  grid.innerHTML = prods.map(p=>productCard(p)).join('');
  lucide.createIcons();
}
function toggleWishlistPage() {
  if(state.currentPage==='wishlist') showPage('home');
  else showPage('wishlist');
}

// =================== REFERRAL ===================
function showReferralPage() {
  if(!state.currentUser) { openAuthModal('login'); return; }
  showPage('referral');
}
function renderReferral() {
  if(!state.currentUser) { document.getElementById('referral-content').innerHTML = '<div class="text-center py-20"><p class="text-neutral-500">Please sign in to access referrals</p><button onclick="openAuthModal(\'login\')" class="mt-4 px-6 py-2.5 bg-citrine text-obsidian text-sm font-bold rounded-xl">Sign In</button></div>'; return; }
  const u = state.currentUser;
  const refUrl = `https://trendmallz.com/signup?ref=${u.referralCode}`;
  document.getElementById('referral-content').innerHTML = `
  <div class="space-y-6">
    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4">
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border text-center">
        <div class="text-2xl font-bold font-display text-citrine">${u.referralCount||0}</div>
        <div class="text-xs text-neutral-500 mt-1">Total Referrals</div>
      </div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border text-center">
        <div class="text-2xl font-bold font-display text-green-400">${fmt(u.referralEarnings||0)}</div>
        <div class="text-xs text-neutral-500 mt-1">Total Earned</div>
      </div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border text-center">
        <div class="text-2xl font-bold font-display">${fmt(u.wallet||0)}</div>
        <div class="text-xs text-neutral-500 mt-1">Wallet Balance</div>
      </div>
    </div>
    <!-- Referral Link -->
    <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border">
      <h3 class="font-display font-bold text-lg mb-2">Your Referral Link</h3>
      <p class="text-sm text-neutral-400 mb-4">Share this link and earn <span class="text-citrine font-semibold">₦2,000</span> for every new user who signs up and makes their first purchase.</p>
      <div class="flex gap-3">
        <input type="text" value="${refUrl}" readonly class="flex-1 px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm text-neutral-400 focus:border-citrine" id="ref-link-input">
        <button onclick="copyRefLink()" class="px-5 py-3 bg-citrine text-obsidian font-bold rounded-xl text-sm hover:bg-citrine-dark transition-colors flex items-center gap-2"><i data-lucide="copy" class="w-4 h-4"></i>Copy</button>
      </div>
      <div class="mt-4 flex items-center gap-3">
        <span class="text-sm text-neutral-500">Your code:</span>
        <span class="px-3 py-1.5 bg-citrine/10 text-citrine border border-citrine/20 rounded-lg text-sm font-mono font-bold">${u.referralCode}</span>
      </div>
    </div>
    <!-- Share Buttons -->
    <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border">
      <h3 class="font-display font-bold text-lg mb-4">Share Via</h3>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button onclick="showToast('Opening WhatsApp...','info')" class="flex flex-col items-center gap-2 p-4 bg-green-500/10 border border-green-500/20 rounded-xl hover:bg-green-500/20 transition-colors">
          <div class="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold">W</div>
          <span class="text-xs font-medium text-green-400">WhatsApp</span>
        </button>
        <button onclick="showToast('Opening Twitter...','info')" class="flex flex-col items-center gap-2 p-4 bg-blue-400/10 border border-blue-400/20 rounded-xl hover:bg-blue-400/20 transition-colors">
          <div class="w-8 h-8 bg-blue-400 rounded-full flex items-center justify-center text-white text-xs font-bold">T</div>
          <span class="text-xs font-medium text-blue-400">Twitter/X</span>
        </button>
        <button onclick="showToast('Opening Facebook...','info')" class="flex flex-col items-center gap-2 p-4 bg-blue-600/10 border border-blue-600/20 rounded-xl hover:bg-blue-600/20 transition-colors">
          <div class="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">F</div>
          <span class="text-xs font-medium text-blue-400">Facebook</span>
        </button>
        <button onclick="showToast('Opening Instagram...','info')" class="flex flex-col items-center gap-2 p-4 bg-pink-500/10 border border-pink-500/20 rounded-xl hover:bg-pink-500/20 transition-colors">
          <div class="w-8 h-8 bg-gradient-to-br from-purple-600 to-pink-500 rounded-full flex items-center justify-center text-white text-xs font-bold">I</div>
          <span class="text-xs font-medium text-pink-400">Instagram</span>
        </button>
      </div>
    </div>
    <!-- How it works -->
    <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border">
      <h3 class="font-display font-bold text-lg mb-4">How it Works</h3>
      <div class="space-y-4">
        ${[['Share your link','Send your unique referral link to friends and family','share-2'],['They sign up','Your friend creates a TrendMallz account using your link','user-plus'],['They shop','When they complete their first purchase, you earn ₦2,000','shopping-bag'],['You withdraw','Cash out your earnings to your bank account anytime','banknote']].map((s,i)=>`<div class="flex gap-4 items-start"><div class="w-8 h-8 rounded-full bg-citrine/20 text-citrine flex items-center justify-center text-sm font-bold shrink-0">${i+1}</div><div><h4 class="font-semibold text-sm">${s[0]}</h4><p class="text-xs text-neutral-500 mt-0.5">${s[1]}</p></div></div>`).join('')}
      </div>
    </div>
    <!-- Withdrawal -->
    <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border">
      <h3 class="font-display font-bold text-lg mb-4">Withdraw Earnings</h3>
      <div class="flex items-center justify-between p-4 bg-obsidian rounded-xl mb-4">
        <div><p class="text-sm text-neutral-400">Available Balance</p><p class="text-2xl font-bold font-display text-citrine">${fmt(u.wallet||0)}</p></div>
        <button onclick="showToast('Minimum withdrawal: ₦5,000. Contact support to withdraw.','info')" class="px-5 py-2.5 bg-citrine text-obsidian font-bold rounded-xl text-sm hover:bg-citrine-dark transition-colors">Withdraw</button>
      </div>
      <p class="text-xs text-neutral-600">Minimum withdrawal: ₦5,000. Processed within 24 hours.</p>
    </div>
  </div>`;
  lucide.createIcons();
}
function copyRefLink() {
  const input = document.getElementById('ref-link-input');
  navigator.clipboard.writeText(input.value).then(()=>showToast('Referral link copied!')).catch(()=>{ input.select(); document.execCommand('copy'); showToast('Referral link copied!'); });
}

// =================== DASHBOARD ===================
function openDashboard() {
  if(!state.currentUser) { openAuthModal('login'); return; }
  showPage('dashboard');
}
function renderDashboard() {
  if(!state.currentUser) { openAuthModal('login'); return; }
  const u = state.currentUser;
  const info = document.getElementById('dash-user-info');
  info.innerHTML = `
  <div class="flex items-center gap-3">
    <img src="${u.avatarUrl || getBitmoji(u.id || u.email, u.gender)}" alt="${u.fname}" class="w-12 h-12 rounded-full border-2 border-citrine/30 object-cover bg-charcoal">
    <div><p class="text-sm font-semibold">${u.fname} ${u.lname}</p><p class="text-xs text-neutral-500 capitalize">${u.role}</p></div>
  </div>`;
  const navItems = u.role === 'admin' ? [
    {id:'overview',icon:'layout-dashboard',label:'Overview'},
    {id:'orders',icon:'package',label:'All Orders'},
    {id:'vendors',icon:'store',label:'Vendors'},
    {id:'customers',icon:'users',label:'Customers'},
    {id:'products',icon:'tag',label:'Products'},
    {id:'commissions',icon:'percent',label:'Commissions'},
    {id:'coupons',icon:'ticket',label:'Coupons'},
    {id:'settings',icon:'settings',label:'Settings'},
    {id:'profile',icon:'user',label:'My Profile'},
  ] : u.role === 'vendor' ? [
    {id:'overview',icon:'layout-dashboard',label:'Overview'},
    {id:'products',icon:'tag',label:'My Products'},
    {id:'orders',icon:'package',label:'Orders'},
    {id:'analytics',icon:'bar-chart-2',label:'Analytics'},
    {id:'payouts',icon:'banknote',label:'Payouts'},
    {id:'store',icon:'store',label:'Store Settings'},
    {id:'reviews',icon:'star',label:'Reviews'},
    {id:'referral',icon:'users',label:'Referrals'},
    {id:'profile',icon:'user',label:'My Profile'},
  ] : [
    {id:'overview',icon:'layout-dashboard',label:'Overview'},
    {id:'orders',icon:'package',label:'My Orders'},
    {id:'wishlist',icon:'heart',label:'Wishlist'},
    {id:'looks',icon:'sparkles',label:'My Looks'},
    {id:'referral',icon:'users',label:'Referrals'},
    {id:'wallet',icon:'wallet',label:'Wallet'},
    {id:'profile',icon:'user',label:'Profile'},
    {id:'addresses',icon:'map-pin',label:'Addresses'},
  ];
  const nav = document.getElementById('dash-nav');
  nav.innerHTML = navItems.map(n=>`<div class="dashboard-nav-item" onclick="renderDashSection('${n.id}',this)"><i data-lucide="${n.icon}" class="w-4 h-4 shrink-0"></i>${n.label}</div>`).join('');
  lucide.createIcons();
  // Auto-click first
  setTimeout(()=>{ const first = nav.querySelector('.dashboard-nav-item'); if(first){first.classList.add('active');renderDashSection(navItems[0].id,first);} },100);
}
function renderDashSection(id, el) {
  document.querySelectorAll('.dashboard-nav-item').forEach(n=>n.classList.remove('active'));
  if(el) el.classList.add('active');
  const u = state.currentUser;
  const content = document.getElementById('dash-content');
  // Everyone has the same profile page (picture, gender, Snapchat)
  if(id==='profile') renderCustomerSection('profile', content, u);
  else if(u.role==='admin') renderAdminSection(id, content, u);
  else if(u.role==='vendor') renderVendorSection(id, content, u);
  else renderCustomerSection(id, content, u);
}

// ---------- CUSTOMER DASHBOARD ----------
function renderCustomerSection(id, el, u) {
  const userOrders = orders.filter(o=>o.userId===u.id);
  const snapUnavailable = state.snapConfigured === false;
  const sections = {
    overview: `
    <h2 class="font-display text-2xl font-bold mb-6">Welcome back, ${u.fname}! 👋</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold text-citrine">${userOrders.length}</div><div class="text-xs text-neutral-500 mt-1">Total Orders</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold">${state.wishlist.length}</div><div class="text-xs text-neutral-500 mt-1">Wishlist</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold text-green-400">${fmt(u.wallet||0)}</div><div class="text-xs text-neutral-500 mt-1">Wallet</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold">${u.referralCount||0}</div><div class="text-xs text-neutral-500 mt-1">Referrals</div></div>
    </div>
    <h3 class="font-display font-semibold text-lg mb-4">Recent Orders</h3>
    ${userOrders.slice(-3).reverse().map(o=>`<div class="flex items-center gap-4 p-4 bg-charcoal rounded-2xl border border-charcoal-border mb-3"><div class="flex-1"><p class="text-sm font-semibold">#${o.trackingId}</p><p class="text-xs text-neutral-500">${o.date} · ${o.items.length} item${o.items.length!==1?'s':''}</p></div><span class="badge ${o.status==='Delivered'?'badge-green':o.status==='In Transit'?'badge-blue':'badge-yellow'}">${o.status}</span><span class="text-sm font-bold">${fmt(o.subtotal)}</span></div>`).join('')||'<div class="text-center py-10 text-neutral-500">No orders yet. <button onclick="showPage(\'shop\')" class="text-citrine hover:underline">Start shopping!</button></div>'}`,
    orders: `<h2 class="font-display text-2xl font-bold mb-6">My Orders</h2>${userOrders.length?userOrders.reverse().map(o=>`<div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border mb-4"><div class="flex justify-between items-start mb-4"><div><p class="font-semibold">#${o.trackingId}</p><p class="text-xs text-neutral-500">${o.date}</p></div><span class="badge ${o.status==='Delivered'?'badge-green':o.status==='In Transit'?'badge-blue':'badge-yellow'}">${o.status}</span></div>${o.items.map(i=>`<div class="flex gap-3 mb-3"><img src="${i.img}" class="w-14 h-16 rounded-xl object-cover"><div><p class="text-sm font-medium">${i.name}</p><p class="text-xs text-neutral-500">${i.size||''} · ×${i.qty}</p><p class="text-sm font-bold mt-1">${fmt(i.price*i.qty)}</p></div></div>`).join('')}<div class="flex justify-between pt-3 border-t border-charcoal-border"><span class="text-sm font-bold">Total: ${fmt(o.subtotal)}</span><button onclick="showToast('Track ${o.trackingId}','info')" class="text-citrine text-xs hover:underline">Track Order →</button></div></div>`).join(''):'<div class="text-center py-16 text-neutral-500"><i data-lucide="package" class="w-12 h-12 mx-auto mb-4 opacity-20"></i><p>No orders yet</p><button onclick="showPage(\'shop\')" class="mt-4 px-6 py-2.5 bg-citrine text-obsidian text-sm font-bold rounded-xl">Start Shopping</button></div>'}`,
    looks: `<h2 class="font-display text-2xl font-bold mb-2">My Looks</h2><p class="text-sm text-neutral-500 mb-6">Your saved try-ons. Open one to change the hair colour or download it. Looks for items we no longer sell are removed.</p><div id="dash-looks"></div>`,
    wishlist: `<h2 class="font-display text-2xl font-bold mb-6">My Wishlist</h2>${state.wishlist.length?'<div class="grid grid-cols-2 md:grid-cols-3 gap-4">'+PRODUCTS.filter(p=>state.wishlist.includes(p.id)).map(p=>productCard(p)).join('')+'</div>':'<div class="text-center py-16 text-neutral-500"><i data-lucide="heart" class="w-12 h-12 mx-auto mb-4 opacity-20"></i><p>No saved items</p><button onclick="showPage(\'shop\')" class="mt-4 px-6 py-2.5 bg-citrine text-obsidian text-sm font-bold rounded-xl">Browse Products</button></div>'}`,
    referral: `<h2 class="font-display text-2xl font-bold mb-6">Referrals</h2><div id="dash-ref"></div>`,
    wallet: `<h2 class="font-display text-2xl font-bold mb-6">Wallet</h2><div class="bg-gradient-to-br from-citrine/20 to-citrine/5 rounded-2xl p-8 border border-citrine/20 mb-6"><div class="text-4xl font-bold font-display">${fmt(u.wallet||0)}</div><div class="text-sm text-neutral-400 mt-1">Available Balance</div><button onclick="showToast('Min. ₦5,000. Bank withdrawal in 24hrs.','info')" class="mt-4 px-6 py-2.5 bg-citrine text-obsidian font-bold rounded-xl text-sm">Withdraw</button></div><div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><h3 class="font-semibold mb-4">Transaction History</h3><div class="space-y-3 text-sm">${(u.referralCount||0)>0?Array(u.referralCount).fill(0).map((_,i)=>`<div class="flex justify-between items-center py-3 border-b border-charcoal-border"><div><p class="font-medium">Referral Bonus</p><p class="text-xs text-neutral-500">New user signup</p></div><span class="text-green-400 font-bold">+${fmt(2000)}</span></div>`).join(''):'<p class="text-neutral-500 text-center py-4">No transactions yet</p>'}</div></div>`,
    profile: `<h2 class="font-display text-2xl font-bold mb-6">Profile</h2>
    <div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border max-w-lg space-y-5">

      <!-- Avatar row -->
      <div class="flex items-center gap-5">
        <div class="relative group cursor-pointer shrink-0" onclick="document.getElementById('profile-photo-input').click()">
          <div id="profile-avatar-wrap" class="w-20 h-20 rounded-full overflow-hidden bg-citrine/10 border-2 ${u.snapBitmoji ? 'border-yellow-400' : 'border-charcoal-border'} flex items-center justify-center">
            <img src="${u.avatarUrl || getBitmoji(u.id || u.email, u.gender)}" class="w-full h-full object-cover rounded-full" alt="avatar"/>
          </div>
          <div class="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <i data-lucide="camera" class="w-5 h-5 text-white"></i>
          </div>
          <input type="file" id="profile-photo-input" accept="image/*" style="display:none" onchange="handleProfilePhotoUpload(event,'${u.id}')"/>
        </div>
        <div class="min-w-0">
          <p class="font-bold text-lg">${u.fname} ${u.lname}</p>
          <p class="text-neutral-500 text-sm truncate">${u.email}</p>
          <label class="flex items-center gap-2 mt-2 text-xs text-neutral-500">Gender
            <select onchange="setGender(this.value)" class="px-2 py-1 bg-obsidian border border-charcoal-border rounded-lg text-xs text-white">
              ${!u.gender ? '<option value="">Not set</option>' : ''}
              <option value="male" ${u.gender === 'male' ? 'selected' : ''}>Male</option>
              <option value="female" ${u.gender === 'female' ? 'selected' : ''}>Female</option>
              <option value="unspecified" ${u.gender === 'unspecified' ? 'selected' : ''}>Prefer not to say</option>
            </select>
          </label>
          ${u.snapBitmoji
            ? `<span class="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-xs font-semibold text-yellow-400">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
                Snapchat Connected
               </span>`
            : `<p class="text-xs text-neutral-600 mt-1">Tap photo to upload &amp; generate 2D avatar</p>`
          }
        </div>
      </div>

      <!-- Snapchat Bitmoji connect block -->
      <div class="rounded-2xl border ${u.snapBitmoji ? 'border-yellow-400/30 bg-yellow-400/5' : 'border-charcoal-border bg-obsidian/60'} p-4">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background:#FFFC00">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#000"><path d="M12.166 3C8.339 3 5.872 5.388 5.872 9.04c0 .928.103 1.755.103 2.624 0 .103-.021.185-.031.278-.196.062-.413.093-.641.093-.413 0-.8-.103-1.131-.299l-.02.02c0 1.09.918 2.006 2.13 2.274-.227.474-.7.803-1.255.803-.124 0-.248-.02-.361-.052.33.99 1.255 1.704 2.345 1.724-.866.68-1.961 1.08-3.16 1.08-.206 0-.413-.01-.62-.031 1.142.731 2.49 1.152 3.944 1.152 4.73 0 7.32-3.918 7.32-7.32 0-.113-.003-.226-.008-.338.503-.36.939-.812 1.285-1.326-.462.206-.958.344-1.48.406.532-.319.94-.824 1.132-1.427-.499.296-1.05.51-1.636.625C13.884 3.31 13.075 3 12.166 3z"/></svg>
            </div>
            <div>
              <p class="text-sm font-semibold">${u.snapBitmoji ? 'Bitmoji Active' : 'Connect Snapchat'}</p>
              <p class="text-xs text-neutral-500 mt-0.5">${u.snapBitmoji ? 'Your Bitmoji is your profile picture' : (snapUnavailable ? 'Snapchat connect is not set up on this site yet' : 'Use your Snapchat Bitmoji as your profile picture')}</p>
            </div>
          </div>
          ${u.snapBitmoji
            ? `<button onclick="disconnectSnap()" class="shrink-0 px-3 py-1.5 text-xs text-neutral-400 border border-charcoal-border rounded-xl hover:border-red-500/40 hover:text-red-400 transition-colors">Disconnect</button>`
            : (snapUnavailable
              ? `<button type="button" onclick="showToast('Snapchat connect is not configured on this server yet.','info')" class="shrink-0 px-3 py-1.5 text-xs font-bold rounded-xl text-neutral-500 border border-charcoal-border cursor-not-allowed">Unavailable</button>`
              : `<a href="/auth/snap" class="shrink-0 flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl text-black transition-all hover:opacity-90" style="background:#FFFC00">Connect</a>`)
          }
        </div>
      </div>

      <!-- Try-On Photo Card -->
      <div class="rounded-2xl border ${state.tryonPhoto ? 'border-green-500/25 bg-green-500/5' : 'border-charcoal-border bg-obsidian/60'} p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            ${state.tryonPhoto
              ? `<img src="${escHtml(state.tryonPhoto)}" class="w-12 h-16 object-cover rounded-xl border border-charcoal-border shrink-0"/>`
              : `<div class="w-12 h-16 rounded-xl bg-obsidian border border-charcoal-border flex items-center justify-center shrink-0"><i data-lucide="user" class="w-5 h-5 text-neutral-600"></i></div>`
            }
            <div>
              <p class="text-sm font-semibold">Try-On Photo</p>
              <p class="text-xs text-neutral-500 mt-0.5 leading-relaxed">${state.tryonPhoto ? 'Ready — hover any product and click Try On' : 'Upload to try clothes on yourself virtually'}</p>
            </div>
          </div>
          <label class="shrink-0 px-3 py-1.5 text-xs font-bold rounded-xl border cursor-pointer hover:opacity-80 transition-opacity ${state.tryonPhoto ? 'border-green-500/30 text-green-400' : 'border-citrine/40 text-citrine'}">
            ${state.tryonPhoto ? 'Change' : 'Upload'}
            <input type="file" accept="image/*" style="display:none" onchange="handleTryOnPhotoUpload(event)"/>
          </label>
        </div>
      </div>

      <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">First Name</label><input type="text" id="prof-fname" value="${u.fname}" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
      <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">Last Name</label><input type="text" id="prof-lname" value="${u.lname}" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
      <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">Country / Region</label><select id="prof-country" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine">${countryOptions(u.countryCode)}</select></div>
      <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">Email</label><input type="email" value="${u.email}" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
      <div><label class="text-xs text-neutral-400 font-medium mb-1.5 block">Phone</label><input type="tel" placeholder="+234 800 000 0000" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div>
      <button onclick="saveProfileChanges('${u.id}')" class="w-full py-3 bg-citrine text-obsidian font-bold rounded-xl text-sm">Save Changes</button>
    </div>`,
    addresses: `
    <h2 class="font-display text-2xl font-bold mb-6">Saved Addresses</h2>
    <div class="space-y-4">
      <div class="bg-charcoal rounded-2xl p-5 border border-citrine/30">
        <div class="flex justify-between mb-2">
          <span class="badge badge-yellow">Default</span>
          <button onclick="showToast('Edit address','info')" class="text-xs text-citrine hover:underline">Edit</button>
        </div>
        <p class="font-semibold">Home</p>
        <p class="text-sm text-neutral-400 mt-1">12 Bode Thomas Street, Surulere<br>Lagos, Lagos State<br>Nigeria</p>
        <!-- Map preview for default address -->
        <div class="mt-4 rounded-xl overflow-hidden border border-charcoal-border" style="height:200px">
          <iframe
            title="Address Map"
            width="100%" height="200"
            style="border:0;display:block"
            loading="lazy"
            allowfullscreen
            src="https://www.openstreetmap.org/export/embed.html?bbox=3.3423%2C6.4969%2C3.3623%2C6.5169&layer=mapnik&marker=6.5069%2C3.3523">
          </iframe>
        </div>
        <a href="https://www.openstreetmap.org/?mlat=6.5069&mlon=3.3523#map=15/6.5069/3.3523" target="_blank" rel="noopener" class="text-[11px] text-neutral-500 hover:text-citrine transition-colors mt-1 inline-block">View larger map</a>
      </div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border">
        <h3 class="font-semibold text-sm mb-4">Set Location on Map</h3>
        <div class="rounded-xl overflow-hidden border border-charcoal-border" style="height:220px">
          <iframe
            title="Pick Location"
            width="100%" height="220"
            style="border:0;display:block"
            loading="lazy"
            allowfullscreen
            src="https://www.openstreetmap.org/export/embed.html?bbox=3.1500%2C6.3500%2C3.5500%2C6.7000&layer=mapnik">
          </iframe>
        </div>
        <p class="text-xs text-neutral-500 mt-2">Use the map to locate your area, then fill in your address details below.</p>
        <div class="mt-4 space-y-3">
          <input type="text" placeholder="Street address" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine transition-colors">
          <div class="grid grid-cols-2 gap-3">
            <input type="text" placeholder="City" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine transition-colors">
            <input type="text" placeholder="State" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine transition-colors">
          </div>
          <button onclick="showToast('Address saved!','success')" class="w-full py-3 bg-citrine text-obsidian font-bold rounded-xl text-sm">Save Address</button>
        </div>
      </div>
      <button onclick="showToast('Add new address','info')" class="w-full py-3 border border-dashed border-charcoal-border rounded-2xl text-sm text-neutral-500 hover:border-citrine hover:text-citrine transition-colors flex items-center justify-center gap-2"><i data-lucide="plus" class="w-4 h-4"></i>Add New Address</button>
    </div>`,
  };
  el.innerHTML = sections[id] || `<p class="text-neutral-500">Section: ${id}</p>`;
  if(id==='looks') loadLooks();
  if(id==='referral') { document.getElementById('dash-ref').innerHTML=''; renderReferral(); document.getElementById('referral-content') && (document.getElementById('dash-ref').appendChild(document.getElementById('referral-content'))); }
  lucide.createIcons();
}

// ---------- VENDOR DASHBOARD ----------
function renderVendorSection(id, el, u) {
  const vendorOrders = orders.filter(o => o.items.some(i => PRODUCTS.find(p=>p.id===i.productId)?.brand===u.brandName));
  const revenue = vendorOrders.reduce((s,o)=>s+o.subtotal,0);
  const commission = Math.round(revenue*0.1);
  const vendorProducts = PRODUCTS.filter(p=>p.brand===u.brandName);
  const sections = {
    overview: `
    <h2 class="font-display text-2xl font-bold mb-6">${u.brandName} Dashboard</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold text-citrine">${fmt(revenue)}</div><div class="text-xs text-neutral-500 mt-1">Total Revenue</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold">${vendorOrders.length}</div><div class="text-xs text-neutral-500 mt-1">Total Orders</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold text-red-400">${fmt(commission)}</div><div class="text-xs text-neutral-500 mt-1">Commission (10%)</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold text-green-400">${fmt(revenue-commission)}</div><div class="text-xs text-neutral-500 mt-1">Net Earnings</div></div>
    </div>
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border">
        <h3 class="font-semibold mb-4">Revenue (Last 7 Days)</h3>
        <div class="flex items-end gap-2 h-32">${[12,28,18,45,32,55,48].map(v=>`<div class="flex-1 bg-citrine/20 rounded-t-lg hover:bg-citrine/40 transition-colors" style="height:${v*2}px" title="₦${(v*1000).toLocaleString()}"></div>`).join('')}</div>
        <div class="flex justify-between text-xs text-neutral-600 mt-2">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<span>${d}</span>`).join('')}</div>
      </div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border">
        <h3 class="font-semibold mb-4">Top Products</h3>
        ${vendorProducts.slice(0,4).map(p=>`<div class="flex items-center gap-3 mb-3"><img src="${p.img}" class="w-10 h-12 rounded-lg object-cover"><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${p.name}</p><div class="progress-bar mt-1 w-full"><div class="progress-fill bg-citrine" style="width:${Math.random()*60+30}%"></div></div></div><span class="text-sm font-bold shrink-0">${fmt(p.price)}</span></div>`).join('')}
      </div>
    </div>`,
    products: `
    <div class="flex justify-between items-center mb-6">
      <h2 class="font-display text-2xl font-bold">My Products</h2>
      <button onclick="openAddProductModal()" class="flex items-center gap-2 px-4 py-2.5 bg-citrine text-obsidian font-bold rounded-xl text-sm"><i data-lucide="plus" class="w-4 h-4"></i>Add Product</button>
    </div>
    <div class="table-scroll bg-charcoal rounded-2xl border border-charcoal-border overflow-hidden">
      <table class="data-table w-full">
        <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Rating</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${vendorProducts.map(p=>`<tr><td><div class="flex items-center gap-3"><img src="${p.img}" class="w-10 h-12 rounded-lg object-cover"><div><p class="font-medium">${p.name}</p><p class="text-xs text-neutral-500">${p.category}</p></div></div></td><td>${fmt(p.price)}</td><td><span class="${p.stock<10?'text-red-400':''}">${p.stock}</span></td><td><div class="flex items-center gap-1">${stars(p.rating,'w-3 h-3')}<span class="text-xs ml-1">${p.rating}</span></div></td><td><span class="badge badge-green">Active</span></td><td><button onclick="openEditPriceModal(${p.id})" class="text-xs text-citrine hover:underline">Edit Price</button></td></tr>`).join('')}</tbody>
      </table>
    </div>`,
    orders: `<h2 class="font-display text-2xl font-bold mb-6">Store Orders</h2><div class="table-scroll bg-charcoal rounded-2xl border border-charcoal-border overflow-hidden"><table class="data-table w-full"><thead><tr><th>Order ID</th><th>Date</th><th>Items</th><th>Amount</th><th>Commission</th><th>Status</th></tr></thead><tbody>${vendorOrders.map(o=>`<tr><td class="font-mono text-xs">${o.trackingId}</td><td>${o.date}</td><td>${o.items.length}</td><td>${fmt(o.subtotal)}</td><td class="text-red-400">${fmt(Math.round(o.subtotal*0.1))}</td><td><span class="badge ${o.status==='Delivered'?'badge-green':o.status==='In Transit'?'badge-blue':'badge-yellow'}">${o.status}</span></td></tr>`).join('')||`<tr><td colspan="6" class="text-center py-8 text-neutral-500">No orders yet</td></tr>`}</tbody></table></div>`,
    payouts: `<h2 class="font-display text-2xl font-bold mb-6">Payouts</h2><div class="grid lg:grid-cols-3 gap-4 mb-6"><div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold text-green-400">${fmt(revenue-commission)}</div><div class="text-xs text-neutral-500 mt-1">Available for Payout</div></div><div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold">${fmt(revenue)}</div><div class="text-xs text-neutral-500 mt-1">Total Earned</div></div><div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold text-red-400">${fmt(commission)}</div><div class="text-xs text-neutral-500 mt-1">Total Commission</div></div></div><div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border max-w-md"><h3 class="font-semibold mb-4">Request Payout</h3><div class="space-y-4"><div><label class="text-xs text-neutral-400 mb-1.5 block">Bank Name</label><select class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"><option>Access Bank</option><option>GTBank</option><option>First Bank</option><option>Zenith Bank</option><option>UBA</option></select></div><div><label class="text-xs text-neutral-400 mb-1.5 block">Account Number</label><input type="text" placeholder="0000000000" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div><div><label class="text-xs text-neutral-400 mb-1.5 block">Amount</label><input type="number" placeholder="Enter amount" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div><button onclick="showToast('Payout request submitted! Processing in 24hrs.')" class="w-full py-3 bg-citrine text-obsidian font-bold rounded-xl text-sm">Request Payout</button></div></div>`,
    store: `<h2 class="font-display text-2xl font-bold mb-6">Store Settings</h2><div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border max-w-2xl space-y-4"><div><label class="text-xs text-neutral-400 mb-1.5 block">Brand Name</label><input type="text" value="${u.brandName}" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div><div><label class="text-xs text-neutral-400 mb-1.5 block">Brand Bio</label><textarea rows="3" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine resize-none" placeholder="Tell customers about your brand..."></textarea></div><div><label class="text-xs text-neutral-400 mb-1.5 block">Store Category</label><select class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"><option>Streetwear</option><option>African Wear</option><option>Evening Wear</option><option>Footwear</option><option>Accessories</option></select></div><div><label class="text-xs text-neutral-400 mb-1.5 block">Instagram Handle</label><input type="text" placeholder="@yourbrand" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div><button onclick="showToast('Store settings saved!')" class="py-3 px-8 bg-citrine text-obsidian font-bold rounded-xl text-sm">Save Changes</button></div>`,
    analytics: `<h2 class="font-display text-2xl font-bold mb-6">Analytics</h2><div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">${[['Page Views','12,450','↑ 18%','text-green-400'],['Unique Visitors','3,821','↑ 12%','text-green-400'],['Conversion','3.2%','↑ 0.4%','text-green-400'],['Avg Order','₦28,500','↓ 2%','text-red-400']].map(([l,v,c,cl])=>`<div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-xl font-bold">${v}</div><div class="text-xs text-neutral-500 mt-0.5">${l}</div><div class="text-xs ${cl} mt-1">${c} this month</div></div>`).join('')}</div><div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><h3 class="font-semibold mb-5">Monthly Sales</h3><div class="flex items-end gap-1.5 h-40">${[22,35,18,55,40,68,50,75,62,80,70,90].map((v,i)=>`<div class="flex-1 flex flex-col items-center gap-1"><div class="w-full rounded-t-lg transition-all hover:opacity-80" style="height:${v*1.5}px;background:${i===new Date().getMonth()?'#FF6B00':'#333'}"></div></div>`).join('')}</div><div class="flex justify-between text-xs text-neutral-600 mt-2">${['J','F','M','A','M','J','J','A','S','O','N','D'].map(m=>`<span>${m}</span>`).join('')}</div></div>`,
    referral: `<h2 class="font-display text-2xl font-bold mb-6">Referral Program</h2><div id="dash-vendor-ref"></div>`,

    reviews: (function() {
      var prods = PRODUCTS.filter(function(p){ return p.brand === u.brandName; });
      var allReviews = [];
      prods.forEach(function(p) {
        var rs = getProductReviews(p.id);
        rs.forEach(function(r) { allReviews.push(Object.assign({}, r, {productName: p.name, productImg: p.img})); });
      });
      allReviews.sort(function(a,b){ return (b.date||'') > (a.date||'') ? 1 : -1; });
      var avg = allReviews.length ? (allReviews.reduce(function(s,r){return s+r.rating;},0)/allReviews.length).toFixed(1) : null;
      var list = allReviews.length ? allReviews.map(function(r){
        return '<div class="flex gap-4 py-4 border-b border-charcoal-border last:border-0">' +
          '<img src="' + r.productImg + '" class="w-12 h-14 rounded-xl object-cover shrink-0">' +
          '<div class="flex-1 min-w-0">' +
          '<p class="text-xs text-citrine font-semibold uppercase tracking-wider mb-0.5">' + escHtml(r.productName) + '</p>' +
          '<div class="flex items-center justify-between">' +
          '<span class="text-sm font-semibold">' + escHtml(r.name) + '</span>' +
          '<span class="text-xs text-neutral-500">' + escHtml(r.date) + '</span>' +
          '</div>' +
          '<div class="flex gap-0.5 my-1">' + stars(r.rating,"w-3.5 h-3.5") + '</div>' +
          '<p class="text-sm text-neutral-400 leading-relaxed">' + escHtml(r.text) + '</p>' +
          '</div></div>';
      }).join('') : '<p class="text-sm text-neutral-500 text-center py-12">No customer reviews yet.</p>';
      var summary = avg ? ('<div class="flex items-center gap-4 p-5 bg-charcoal rounded-2xl border border-charcoal-border mb-6">' +
        '<span class="font-display text-5xl font-bold text-citrine">' + avg + '</span>' +
        '<div><div class="flex gap-0.5 mb-1">' + stars(parseFloat(avg),"w-5 h-5") + '</div>' +
        '<p class="text-sm text-neutral-500">' + allReviews.length + ' review' + (allReviews.length!==1?'s':'') + ' across ' + prods.length + ' product' + (prods.length!==1?'s':'') + '</p></div>' +
        '</div>') : '';
      return '<h2 class="font-display text-2xl font-bold mb-6">Customer Reviews</h2>' +
        summary +
        '<div class="bg-charcoal rounded-2xl border border-charcoal-border p-5">' + list + '</div>';
    })(),

  };
  el.innerHTML = sections[id] || `<p class="text-neutral-500">Section: ${id}</p>`;
  lucide.createIcons();
}

// ---------- ADD PRODUCT ----------
var _addProdUploading = 0; var _editPriceProductId = null;
function openAddProductModal() {
  var existing = document.getElementById('add-product-modal');
  if (existing) existing.remove();
  var m = document.createElement('div');
  m.id = 'add-product-modal';
  m.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4';
  m.innerHTML = `
    <div class="bg-obsidian rounded-2xl border border-charcoal-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between p-6 border-b border-charcoal-border sticky top-0 bg-obsidian z-10">
        <h2 class="font-display text-xl font-bold">Add New Product</h2>
        <button onclick="closeAddProductModal()" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-charcoal text-neutral-400 text-xl leading-none">&#215;</button>
      </div>
      <form onsubmit="submitAddProduct(event)" class="p-6 space-y-4">
        <div>
          <label class="text-xs text-neutral-400 mb-2 block font-semibold uppercase tracking-wider">Main Picture <span class="text-citrine">*</span></label>
          <label class="flex flex-col items-center justify-center border-2 border-dashed border-charcoal-border rounded-xl p-5 cursor-pointer hover:border-citrine transition-colors gap-1.5 text-center">
            <span class="text-sm text-neutral-300">Click to upload the main picture</span>
            <span class="text-xs text-neutral-500">The item on its own, on a plain white background, sharp and well lit. No model, no text, no watermark.</span>
            <span class="text-xs text-neutral-600">This is the picture Virtual Try-On uses to dress customers.</span>
            <input type="file" id="add-prod-main" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="addProdPickMain(event)">
          </label>
          <p id="add-prod-main-msg" class="text-xs mt-2" style="display:none"></p>
        </div>
        <div>
          <label class="text-xs text-neutral-400 mb-2 block font-semibold uppercase tracking-wider">More Pictures <span class="text-neutral-600 normal-case font-normal">(optional)</span></label>
          <label class="flex flex-col items-center justify-center border border-dashed border-charcoal-border rounded-xl p-3 cursor-pointer hover:border-citrine transition-colors text-center">
            <span class="text-xs text-neutral-400">Back view, on a model, close-ups of details (up to 5)</span>
            <input type="file" id="add-prod-imgs" accept="image/*" multiple class="hidden" onchange="addProdPickMore(event)">
          </label>
          <div id="add-prod-img-preview" class="flex gap-2 mt-3 flex-wrap"></div>
        </div>
        <div>
          <label class="text-xs text-neutral-400 mb-1.5 block">Product Name <span class="text-citrine">*</span></label>
          <input type="text" id="add-prod-name" required placeholder="e.g. Classic Ankara Blazer" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-neutral-400 mb-1.5 block">Price (&#8358;) <span class="text-citrine">*</span></label>
            <input type="number" id="add-prod-price" required min="0" placeholder="25000" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
          </div>
          <div>
            <label class="text-xs text-neutral-400 mb-1.5 block">Compare Price (&#8358;)</label>
            <input type="number" id="add-prod-compare" min="0" placeholder="30000" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
          </div>
        </div>
        <div>
          <label class="text-xs text-neutral-400 mb-1.5 block">What kind of item is it? <span class="text-citrine">*</span></label>
          <select id="add-prod-type" required class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
            <option value="">Select item type</option>
            <option value="shirt">Shirt / T-shirt / Blouse</option>
            <option value="hoodie">Hoodie / Sweater</option>
            <option value="jacket">Jacket / Blazer / Coat</option>
            <option value="trousers">Trousers / Jeans / Shorts</option>
            <option value="skirt">Skirt</option>
            <option value="dress">Dress / Gown / Jumpsuit</option>
            <option value="native">Native wear (kaftan, agbada, abaya)</option>
            <option value="shoes">Shoes</option>
            <option value="hat">Cap / Hat</option>
            <option value="jewellery">Jewellery / Watch</option>
            <option value="bag">Bag</option>
          </select>
          <p class="text-xs text-neutral-600 mt-1.5">This tells Virtual Try-On how to wear it, so choose carefully.</p>
        </div>
        <div>
          <label class="text-xs text-neutral-400 mb-1.5 block">Who is it for? <span class="text-citrine">*</span></label>
          <select id="add-prod-gender" required class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
            <option value="">Select</option>
            <option value="male">Men</option>
            <option value="female">Women</option>
            <option value="unisex">Unisex (men and women)</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-neutral-400 mb-1.5 block">Collection <span class="text-citrine">*</span></label>
          <select id="add-prod-cat" required class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
            <option value="">Select collection</option>
            <option>Streetwear</option>
            <option>African Wear</option>
            <option>Evening Wear</option>
            <option>Footwear</option>
            <option>Accessories</option>
            <option>Tops</option>
            <option>Bottoms</option>
            <option>Dresses</option>
            <option>Outerwear</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-neutral-400 mb-1.5 block">Description <span class="text-citrine">*</span></label>
          <textarea id="add-prod-desc" rows="4" required minlength="40" maxlength="1500" oninput="addProdDescCount()" placeholder="Tell buyers what they are getting: the fabric and how it feels, how it fits, what it goes with, and anything special about it." class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none resize-none transition-colors"></textarea>
          <p id="add-prod-desc-count" class="text-xs text-neutral-600 mt-1">At least 40 characters</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-neutral-400 mb-1.5 block">Material <span class="text-citrine">*</span></label>
            <input type="text" id="add-prod-material" required maxlength="80" placeholder="e.g. 100% cotton" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
          </div>
          <div>
            <label class="text-xs text-neutral-400 mb-1.5 block">Fit</label>
            <select id="add-prod-fit" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors"><option value="">Not applicable</option><option>Slim</option><option>Regular</option><option>Loose</option><option>Oversized</option></select>
          </div>
        </div>
        <div>
          <label class="text-xs text-neutral-400 mb-1.5 block">Care instructions</label>
          <input type="text" id="add-prod-care" maxlength="200" placeholder="e.g. Hand wash cold, do not bleach" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-neutral-400 mb-1.5 block">Sizes (comma-separated) <span class="text-citrine">*</span></label>
            <input type="text" id="add-prod-sizes" required placeholder="S, M, L, XL or 40, 41, 42" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
          </div>
          <div>
            <label class="text-xs text-neutral-400 mb-1.5 block">Colors (comma-separated)</label>
            <input type="text" id="add-prod-colors" placeholder="Black, White, Red" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
          </div>
        </div>
        <div>
          <label class="text-xs text-neutral-400 mb-1.5 block">Stock Quantity <span class="text-citrine">*</span></label>
          <input type="number" id="add-prod-stock" required min="0" placeholder="100" class="w-full px-4 py-3 bg-charcoal border border-charcoal-border rounded-xl text-sm focus:border-citrine outline-none transition-colors">
        </div>
        <button type="submit" class="w-full py-3.5 bg-citrine text-obsidian font-bold rounded-xl text-sm uppercase tracking-wider hover:brightness-110 transition-all">Post Product</button>
      </form>
    </div>
  `;
  document.body.appendChild(m);
  _addProdMain = ''; _addProdMore = []; _addProdUploading = 0;
}
function closeAddProductModal() {
  var m = document.getElementById('add-product-modal');
  if (m) m.remove();
}
function openEditPriceModal(productId) {
  var p = PRODUCTS.find(function(x) { return x.id === productId; });
  if (!p) return;
  var existing = document.getElementById('edit-price-modal');
  if (existing) existing.remove();
  _editPriceProductId = productId;
  var modal = document.createElement('div');
  modal.id = 'edit-price-modal';
  modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4';
  modal.innerHTML =
    '<div class="bg-charcoal rounded-2xl border border-charcoal-border w-full max-w-sm p-6">' +
    '<div class="flex items-center justify-between mb-5">' +
    '<h2 class="font-display text-xl font-bold">Edit Price</h2>' +
    '<button onclick="closeEditPriceModal()" class="w-8 h-8 flex items-center justify-center rounded-full bg-obsidian hover:bg-red-500/20 text-neutral-400 hover:text-red-400 text-lg transition-colors">&times;</button>' +
    '</div>' +
    '<p class="text-xs text-neutral-400 mb-1">Product</p>' +
    '<p class="font-semibold text-white mb-5">' + escHtml(p.name) + '</p>' +
    '<form onsubmit="submitEditPrice(event)" class="space-y-4">' +
    '<div><label class="text-xs text-neutral-400 mb-1.5 block">Selling Price (\u20a6) *</label>' +
    '<input type="number" id="edit-price-val" value="' + (p.price || '') + '" min="0" required' +
    ' class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine focus:outline-none"></div>' +
    '<div><label class="text-xs text-neutral-400 mb-1.5 block">Original Price (\u20a6) \u2014 shows as strikethrough if higher</label>' +
    '<input type="number" id="edit-compare-val" value="' + (p.compare > p.price ? p.compare : '') + '" min="0"' +
    ' placeholder="Leave blank if no discount" class="w-full px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine focus:outline-none"></div>' +
    '<div class="flex gap-3 pt-2">' +
    '<button type="button" onclick="closeEditPriceModal()" class="flex-1 py-3 rounded-xl border border-charcoal-border text-neutral-400 text-sm font-semibold hover:border-citrine/50 transition-colors">Cancel</button>' +
    '<button type="submit" id="edit-price-submit" class="flex-1 py-3 bg-citrine text-obsidian font-bold rounded-xl text-sm hover:opacity-90 transition-opacity">Save Price</button>' +
    '</div>' +
    '</form>' +
    '</div>';
  document.body.appendChild(modal);
}
function closeEditPriceModal() {
  var m = document.getElementById('edit-price-modal');
  if (m) m.remove();
}
function submitEditPrice(e) {
  e.preventDefault();
  var p = PRODUCTS.find(function(x) { return x.id === _editPriceProductId; });
  if (!p) return;
  var price = parseInt(document.getElementById('edit-price-val').value) || 0;
  var compare = parseInt(document.getElementById('edit-compare-val').value) || 0;
  if (!price) { showToast('Please enter a selling price', 'error'); return; }
  if (compare && compare <= price) compare = 0;
  var disc = compare > price ? Math.round((1 - price / compare) * 100) : 0;
  var btn = document.getElementById('edit-price-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  function _applyAndRefresh() {
    p.price = price; p.compare = compare || price; p.discount = disc;
    closeEditPriceModal();
    var navEl = Array.from(document.querySelectorAll('.dashboard-nav-item')).find(function(n) {
      return n.textContent.includes('My Products');
    });
    renderDashSection('products', navEl || null);
  }
  fetch('/api/update-price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId: p.id, brandName: p.brand, productBase: p.name.toLowerCase(),
      price: price, compare: compare || price
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (res.error) throw new Error(res.error);
    showToast('Price updated!');
    _applyAndRefresh();
  })
  .catch(function() {
    showToast('Price saved locally');
    _applyAndRefresh();
  })
  .finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Price'; }
  });
}
// ── Product pictures ──
// The main picture must be the item alone on a white background: it is what Virtual Try-On
// wears. It is checked here before it is uploaded.
var _addProdMain = '';   // uploaded main picture
var _addProdMore = [];   // uploaded extra pictures
var PRODUCT_IMG_MIN_SIDE = 400;

// Resolves '' if the picture is usable as a main picture, or the reason it is not
function checkMainProductImage(file) {
  return new Promise(function(resolve) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(url);
      if (Math.min(img.width, img.height) < PRODUCT_IMG_MIN_SIDE) {
        resolve('This picture is too small (' + img.width + ' × ' + img.height + '). Use one at least ' + PRODUCT_IMG_MIN_SIDE + ' pixels on its shorter side so it looks sharp.');
        return;
      }
      // Look at the outer edge of the picture: on a white-background product shot it is white
      var s = 160 / Math.max(img.width, img.height);
      var w = Math.max(8, Math.round(img.width * s)), h = Math.max(8, Math.round(img.height * s));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var d = ctx.getImageData(0, 0, w, h).data;
      var edge = Math.max(2, Math.round(Math.min(w, h) * 0.04)), total = 0, white = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (x >= edge && x < w - edge && y >= edge && y < h - edge) continue;
          var i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
          total++;
          if (a < 24 || (Math.min(r, g, b) >= 228 && Math.max(r, g, b) - Math.min(r, g, b) <= 20)) white++;
        }
      }
      resolve(white / total >= 0.9 ? '' : 'The background is not plain white. Photograph the item on its own against a white background, with nothing else in the picture.');
    };
    img.onerror = function() { URL.revokeObjectURL(url); resolve('That file is not a picture we can read. Use a JPG, PNG or WebP.'); };
    img.src = url;
  });
}

function _uploadProductImage(file) {
  var fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', 'trendmallz_products');
  return fetch('https://api.cloudinary.com/v1_1/vsowmkzo/image/upload', { method: 'POST', body: fd })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.secure_url) throw new Error((data.error && data.error.message) || 'Upload failed');
      return data.secure_url;
    });
}

function _addProdBusy(n) {
  _addProdUploading = Math.max(0, _addProdUploading + n);
  var btn = document.querySelector('#add-product-modal [type="submit"]');
  if (btn) { btn.disabled = _addProdUploading > 0; btn.textContent = _addProdUploading > 0 ? 'Uploading pictures\u2026' : 'Post Product'; }
}

function _addProdMainMsg(text, ok) {
  var el = document.getElementById('add-prod-main-msg');
  if (!el) return;
  el.textContent = text || '';
  el.style.display = text ? 'block' : 'none';
  el.style.color = ok ? '#4ade80' : '#f87171';
}

function _renderAddProdPreview() {
  var preview = document.getElementById('add-prod-img-preview');
  if (!preview) return;
  preview.innerHTML = '';
  (_addProdMain ? [_addProdMain] : []).concat(_addProdMore).forEach(function(url, i) {
    var wrap = document.createElement('div');
    wrap.className = 'relative';
    var img = document.createElement('img');
    img.src = url;
    img.className = 'w-16 h-20 rounded-lg object-cover border-2 ' + (_addProdMain && i === 0 ? 'border-citrine bg-white' : 'border-charcoal-border');
    var lbl = document.createElement('span');
    lbl.className = 'absolute bottom-0 left-0 right-0 text-center bg-black/60 rounded-b-lg text-white py-0.5';
    lbl.style.fontSize = '9px';
    lbl.textContent = _addProdMain && i === 0 ? 'Main' : 'View ' + (i + (_addProdMain ? 1 : 2));
    wrap.appendChild(img);
    wrap.appendChild(lbl);
    preview.appendChild(wrap);
  });
}

function addProdPickMain(evt) {
  var file = evt.target.files[0];
  evt.target.value = '';
  if (!file) return;
  _addProdMainMsg('Checking the picture\u2026', true);
  checkMainProductImage(file).then(function(problem) {
    if (problem) { _addProdMainMsg(problem, false); return; }
    _addProdMainMsg('Uploading\u2026', true);
    _addProdBusy(1);
    return _uploadProductImage(file)
      .then(function(url) { _addProdMain = url; _addProdMainMsg('Main picture added: clear, white background.', true); _renderAddProdPreview(); })
      .catch(function(err) { _addProdMainMsg('Upload failed: ' + err.message, false); })
      .finally(function() { _addProdBusy(-1); });
  });
}

function addProdPickMore(evt) {
  var files = Array.from(evt.target.files).slice(0, 5);
  evt.target.value = '';
  if (!files.length) return;
  _addProdBusy(files.length);
  var results = new Array(files.length), done = 0;
  files.forEach(function(f, idx) {
    _uploadProductImage(f)
      .then(function(url) { results[idx] = url; })
      .catch(function(err) { showToast('Picture ' + (idx + 1) + ' failed: ' + err.message, 'error'); })
      .finally(function() {
        _addProdBusy(-1);
        if (++done === files.length) { _addProdMore = results.filter(Boolean); _renderAddProdPreview(); }
      });
  });
}

function addProdDescCount() {
  var box = document.getElementById('add-prod-desc'), el = document.getElementById('add-prod-desc-count');
  if (!box || !el) return;
  var n = box.value.trim().length;
  el.textContent = n < 40 ? (40 - n) + ' more characters needed' : n + ' characters';
  el.style.color = n < 40 ? '' : '#4ade80';
}

function submitAddProduct(e) {
  e.preventDefault();
  var u = state.currentUser;
  if (!u || (u.role !== 'vendor' && u.role !== 'admin')) { showToast('Not logged in as a brand', 'error'); return; }
  if (_addProdUploading > 0) { showToast('Pictures still uploading, please wait', 'error'); return; }
  if (!_addProdMain) { _addProdMainMsg('Add the main picture of the item on a white background.', false); showToast('Add the main picture first', 'error'); return; }
  var val = function(id) { return document.getElementById(id).value.trim(); };
  var name = val('add-prod-name');
  var price = parseInt(val('add-prod-price')) || 0;
  var compare = parseInt(val('add-prod-compare')) || 0;
  var cat = val('add-prod-cat');
  var itemType = val('add-prod-type');
  var gender = val('add-prod-gender');
  var desc = val('add-prod-desc');
  var material = val('add-prod-material');
  var stock = parseInt(val('add-prod-stock')) || 0;
  var list = function(id) { return val(id).split(',').map(function(s){return s.trim();}).filter(Boolean); };
  var sizes = list('add-prod-sizes');
  var colors = list('add-prod-colors');
  if (!name || !price || !cat || !itemType || !gender) { showToast('Please fill all required fields', 'error'); return; }
  if (desc.length < 40) { showToast('Write a description of at least 40 characters', 'error'); return; }
  if (!material) { showToast('Say what the item is made of', 'error'); return; }
  if (!sizes.length) { showToast('Enter the sizes you have', 'error'); return; }
  var btn = e.target.querySelector('[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Posting...'; }
  fetch('/api/add-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandName: u.brandName, category: cat, itemType: itemType, gender: gender, name: name,
      price: price, compare: compare, description: desc,
      material: material, fit: val('add-prod-fit'), care: val('add-prod-care'),
      sizes: sizes, colors: colors.length ? colors : ['Default'], stock: stock,
      images: [_addProdMain].concat(_addProdMore)
    })
  })
  .then(function(r) { return r.json().catch(function() { return {}; }).then(function(d) { return { ok: r.ok, d: d }; }); })
  .then(function(res) {
    if (!res.ok || res.d.error) { showToast(res.d.error || 'Could not post the product. Please try again.', 'error'); return; }
    _addProdMain = ''; _addProdMore = [];
    showToast('Product posted!');
    closeAddProductModal();
    loadProductsFromAPI();
  })
  .catch(function() { showToast('Connection error. Please try again.', 'error'); })
  .finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Post Product'; }
  });
}


// ---------- ADMIN DASHBOARD ----------
function renderAdminSection(id, el, u) {
  const users = adminUsers;
  const allRevenue = orders.reduce((s,o)=>s+o.subtotal,0);
  const allCommission = Math.round(allRevenue*0.1);
  const sections = {
    overview: `
    <h2 class="font-display text-2xl font-bold mb-6">Admin Overview ⚡</h2>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="bg-gradient-to-br from-citrine/20 to-transparent rounded-2xl p-5 border border-citrine/20"><div class="text-2xl font-bold text-citrine">${fmt(allRevenue)}</div><div class="text-xs text-neutral-500 mt-1">Total GMV</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold text-green-400">${fmt(allCommission)}</div><div class="text-xs text-neutral-500 mt-1">Total Commission (10%)</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold">${orders.length}</div><div class="text-xs text-neutral-500 mt-1">Total Orders</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold">${users.length}</div><div class="text-xs text-neutral-500 mt-1">Total Users</div></div>
    </div>
    <div class="grid lg:grid-cols-3 gap-4 mb-8">
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-xl font-bold">${users.filter(u=>u.role==='vendor').length}</div><div class="text-xs text-neutral-500 mt-0.5">Active Vendors</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-xl font-bold">${users.filter(u=>u.role==='customer').length}</div><div class="text-xs text-neutral-500 mt-0.5">Customers</div></div>
      <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-xl font-bold">${PRODUCTS.length}</div><div class="text-xs text-neutral-500 mt-0.5">Total Products</div></div>
    </div>
    <div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border mb-6">
      <h3 class="font-semibold mb-5">Revenue Overview</h3>
      <div class="flex items-end gap-2 h-40">${[45,68,35,85,72,95,80,110,92,125,108,140].map((v,i)=>`<div class="flex-1 rounded-t-lg transition-all hover:opacity-80" style="height:${v}px;background:${i===new Date().getMonth()?'#FF6B00':'#333'}"></div>`).join('')}</div>
      <div class="flex justify-between text-xs text-neutral-600 mt-2">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m=>`<span>${m}</span>`).join('')}</div>
    </div>
    <h3 class="font-semibold mb-4">Recent Orders</h3>
    <div class="table-scroll bg-charcoal rounded-2xl border border-charcoal-border overflow-hidden">
      <table class="data-table w-full"><thead><tr><th>Order ID</th><th>Date</th><th>Revenue</th><th>Commission</th><th>Status</th></tr></thead>
      <tbody>${orders.slice(-5).reverse().map(o=>`<tr><td class="font-mono text-xs">${o.trackingId}</td><td>${o.date}</td><td>${fmt(o.subtotal)}</td><td class="text-green-400">${fmt(Math.round(o.subtotal*0.1))}</td><td><span class="badge ${o.status==='Delivered'?'badge-green':o.status==='In Transit'?'badge-blue':'badge-yellow'}">${o.status}</span></td></tr>`).join('')||`<tr><td colspan="5" class="text-center py-6 text-neutral-500">No orders yet</td></tr>`}</tbody></table>
    </div>`,
    orders: `<h2 class="font-display text-2xl font-bold mb-6">All Orders</h2><div class="table-scroll bg-charcoal rounded-2xl border border-charcoal-border overflow-hidden"><table class="data-table w-full"><thead><tr><th>Order ID</th><th>Customer</th><th>Items</th><th>Deliver To</th><th>Date</th><th>Total</th><th>Commission</th><th>Status</th><th>Action</th></tr></thead><tbody>${orders.map(o=>{const cu=users.find(u=>u.id===o.userId);return`<tr><td class="font-mono text-xs">${o.trackingId}</td><td class="text-xs">${escHtml(o.customerName||(cu?cu.fname+' '+cu.lname:'Guest'))}</td><td class="text-xs">${(o.items||[]).map(i=>escHtml(i.qty+'× '+i.name+(i.size?' ('+i.size+')':''))).join('<br>')}</td><td class="text-xs">${o.shipping?escHtml(o.shipping.phone)+'<br>'+escHtml(o.shipping.address+', '+o.shipping.city+', '+o.shipping.state):'-'}</td><td>${o.date}</td><td>${fmt(o.total)}</td><td class="text-green-400">${fmt(Math.round(o.subtotal*0.1))}</td><td><span class="badge ${o.status==='Delivered'?'badge-green':o.status==='In Transit'?'badge-blue':'badge-yellow'}">${o.status}</span></td><td><select onchange="updateOrderStatus('${o.id}',this.value)" class="bg-obsidian border border-charcoal-border rounded-lg px-2 py-1 text-xs"><option ${o.status==='Processing'?'selected':''}>Processing</option><option ${o.status==='In Transit'?'selected':''}>In Transit</option><option ${o.status==='Delivered'?'selected':''}>Delivered</option><option ${o.status==='Cancelled'?'selected':''}>Cancelled</option></select></td></tr>`;}).join('')||`<tr><td colspan="9" class="text-center py-8 text-neutral-500">No orders yet</td></tr>`}</tbody></table></div>`,
    vendors: `<h2 class="font-display text-2xl font-bold mb-6">Vendors</h2><div class="table-scroll bg-charcoal rounded-2xl border border-charcoal-border overflow-hidden"><table class="data-table w-full"><thead><tr><th>Vendor</th><th>Brand</th><th>Joined</th><th>Revenue</th><th>Commission</th><th>Status</th><th>Action</th></tr></thead><tbody>${users.filter(u=>u.role==='vendor').map(v=>{const vRev=v.storeRevenue||0;const vCom=Math.round(vRev*0.1);return`<tr><td><div><p class="font-medium">${v.fname} ${v.lname}</p><p class="text-xs text-neutral-500">${v.email}</p></div></td><td>${v.brandName||'-'}</td><td>${v.createdAt}</td><td>${fmt(vRev)}</td><td class="text-green-400">${fmt(vCom)}</td><td><span class="badge badge-green">Active</span></td><td><button onclick="showToast('Vendor management in PHP build','info')" class="text-xs text-citrine hover:underline">Manage</button></td></tr>`;}).join('')||`<tr><td colspan="7" class="text-center py-6 text-neutral-500">No vendors yet</td></tr>`}</tbody></table></div>`,
    customers: `<h2 class="font-display text-2xl font-bold mb-6">Customers</h2><div class="table-scroll bg-charcoal rounded-2xl border border-charcoal-border overflow-hidden"><table class="data-table w-full"><thead><tr><th>Customer</th><th>Joined</th><th>Orders</th><th>Referrals</th><th>Wallet</th><th>Status</th></tr></thead><tbody>${users.filter(u=>u.role==='customer').map(c=>`<tr><td><div><p class="font-medium">${c.fname} ${c.lname}</p><p class="text-xs text-neutral-500">${c.email}</p></div></td><td>${c.createdAt}</td><td>${(c.orders||[]).length}</td><td>${c.referralCount||0}</td><td>${fmt(c.wallet||0)}</td><td><span class="badge badge-green">Active</span></td></tr>`).join('')||`<tr><td colspan="6" class="text-center py-6 text-neutral-500">No customers yet</td></tr>`}</tbody></table></div>`,
    products: `<h2 class="font-display text-2xl font-bold mb-6">All Products</h2><div class="table-scroll bg-charcoal rounded-2xl border border-charcoal-border overflow-hidden"><table class="data-table w-full"><thead><tr><th>Product</th><th>Brand</th><th>Category</th><th>Price</th><th>Stock</th><th>Rating</th><th>Status</th></tr></thead><tbody>${PRODUCTS.map(p=>`<tr><td><div class="flex items-center gap-3"><img src="${p.img}" class="w-10 h-12 rounded-lg object-cover"><p class="font-medium text-sm">${p.name}</p></div></td><td class="text-sm">${p.brand}</td><td><span class="badge badge-gray">${p.category}</span></td><td>${fmt(p.price)}</td><td><span class="${p.stock<10?'text-red-400':''}">${p.stock}</span></td><td>${p.rating}</td><td><span class="badge badge-green">Active</span></td></tr>`).join('')}</tbody></table></div>`,
    commissions: `<h2 class="font-display text-2xl font-bold mb-6">Commissions</h2><div class="grid grid-cols-3 gap-4 mb-6"><div class="bg-gradient-to-br from-green-500/10 to-transparent rounded-2xl p-5 border border-green-500/20"><div class="text-2xl font-bold text-green-400">${fmt(allCommission)}</div><div class="text-xs text-neutral-500 mt-1">Total Earned (10%)</div></div><div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold">${fmt(allRevenue)}</div><div class="text-xs text-neutral-500 mt-1">Total GMV</div></div><div class="bg-charcoal rounded-2xl p-5 border border-charcoal-border"><div class="text-2xl font-bold">${orders.length}</div><div class="text-xs text-neutral-500 mt-1">Transactions</div></div></div><div class="table-scroll bg-charcoal rounded-2xl border border-charcoal-border overflow-hidden"><table class="data-table w-full"><thead><tr><th>Vendor/Brand</th><th>Orders</th><th>Revenue</th><th>Commission (10%)</th><th>Net to Vendor</th></tr></thead><tbody>${BRANDS.map(b=>{const bOrders=orders.filter(o=>o.items.some(i=>PRODUCTS.find(p=>p.id===i.productId)?.brand===b.name));const bRev=bOrders.reduce((s,o)=>s+o.subtotal,0);const bCom=Math.round(bRev*0.1);return`<tr><td><div class="flex items-center gap-2"><img src="${b.logo}" class="w-8 h-8 rounded-full object-cover"><span class="font-medium">${b.name}</span></div></td><td>${bOrders.length}</td><td>${fmt(bRev)}</td><td class="text-green-400 font-semibold">${fmt(bCom)}</td><td>${fmt(bRev-bCom)}</td></tr>`;}).join('')}</tbody></table></div>`,
    coupons: `<div class="flex justify-between items-center mb-6"><h2 class="font-display text-2xl font-bold">Coupon Codes</h2><button onclick="showToast('Create coupon feature ready!','info')" class="flex items-center gap-2 px-4 py-2.5 bg-citrine text-obsidian font-bold rounded-xl text-sm"><i data-lucide="plus" class="w-4 h-4"></i>New Coupon</button></div><div class="space-y-3">${[['WELCOME10','10% off for new users','10%',245,true],['FREESHIP','Free shipping on all orders','Free Delivery',89,true],['SAVE20','20% off entire cart','20%',32,false]].map(([c,d,v,u,a])=>`<div class="coupon-card"><div class="flex items-center justify-between"><div><p class="font-mono font-bold text-citrine text-lg">${c}</p><p class="text-xs text-neutral-400 mt-0.5">${d}</p></div><div class="text-right"><div class="text-2xl font-bold">${v}</div><div class="text-xs text-neutral-500">${u} uses</div></div><span class="badge ${a?'badge-green':'badge-gray'}">${a?'Active':'Inactive'}</span></div></div>`).join('')}</div>`,
    settings: `<h2 class="font-display text-2xl font-bold mb-6">Platform Settings</h2><div class="max-w-2xl space-y-6"><div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border"><h3 class="font-semibold mb-4">Commission Settings</h3><div class="flex items-center gap-4"><div class="flex-1"><label class="text-xs text-neutral-400 mb-1.5 block">Platform Commission Rate</label><div class="flex items-center gap-3"><input type="number" value="10" class="w-24 px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"><span class="text-neutral-400">% per sale</span></div></div></div><button onclick="showToast('Commission rate saved!')" class="mt-4 px-6 py-2.5 bg-citrine text-obsidian font-bold rounded-xl text-sm">Save</button></div><div class="bg-charcoal rounded-2xl p-6 border border-charcoal-border"><h3 class="font-semibold mb-4">Referral Settings</h3><div class="space-y-4"><div><label class="text-xs text-neutral-400 mb-1.5 block">Referral Bonus Amount</label><div class="flex items-center gap-3"><span class="text-neutral-400">₦</span><input type="number" value="2000" class="flex-1 px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"><span class="text-neutral-400">per referral</span></div></div><div><label class="text-xs text-neutral-400 mb-1.5 block">New User Welcome Bonus</label><div class="flex items-center gap-3"><span class="text-neutral-400">₦</span><input type="number" value="500" class="flex-1 px-4 py-3 bg-obsidian border border-charcoal-border rounded-xl text-sm focus:border-citrine"></div></div></div><button onclick="showToast('Referral settings saved!')" class="mt-4 px-6 py-2.5 bg-citrine text-obsidian font-bold rounded-xl text-sm">Save</button></div></div>`,
  };
  el.innerHTML = sections[id] || `<p class="text-neutral-500">Section: ${id}</p>`;
  lucide.createIcons();
}

function updateOrderStatus(orderId, status) {
  fetch('/api/orders/' + encodeURIComponent(orderId) + '/status', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
  })
    .then(r => r.json())
    .then(res => {
      if (res.error) { showToast(res.error, 'error'); return; }
      const order = orders.find(o => o.id === orderId);
      if (order) order.status = status;
      showToast('Order ' + res.order.trackingId + ' marked as ' + status);
    })
    .catch(() => showToast('Connection error. Please try again.', 'error'));
}

// =================== SEARCH ===================
function doNavSearch(query) {
  const results = document.getElementById('nav-search-results');
  if(!query.trim()) { results.classList.add('hidden'); return; }
  const matches = PRODUCTS.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.brand.toLowerCase().includes(query.toLowerCase()) || p.category.toLowerCase().includes(query.toLowerCase())).slice(0,5);
  if(matches.length===0) { results.innerHTML='<div class="p-4 text-sm text-neutral-500 text-center">No results found</div>'; results.classList.remove('hidden'); return; }
  results.innerHTML = matches.map(p=>`<button onclick="openProductModal(${p.id});closeNavSearch()" class="w-full flex items-center gap-3 px-4 py-3 hover:bg-obsidian transition-colors text-left"><img src="${p.img}" class="w-10 h-12 rounded-lg object-cover shrink-0"><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${p.name}</p><p class="text-xs text-neutral-500">${p.brand} · ${fmt(p.price)}</p></div></button>`).join('');
  results.classList.remove('hidden');
  lucide.createIcons();
}
function closeNavSearch() { document.getElementById('nav-search-results').classList.add('hidden'); }

// =================== MOBILE NAV ===================

// =================== MOBILE NAV ===================
function openMobileNav() {
  document.getElementById('mobile-nav').classList.add('open');
  document.getElementById('mobile-overlay').classList.remove('hidden');
}
function closeMobileNav() {
  document.getElementById('mobile-nav').classList.remove('open');
  document.getElementById('mobile-overlay').classList.add('hidden');
}

async function loadSnapConfig() {
  try {
    const res = await fetch('/api/snap-configured', { cache: 'no-store' });
    const data = await res.json();
    state.snapConfigured = !!data.configured;
  } catch (_) {
    state.snapConfigured = false;
  }
}

// =================== SCROLL EFFECTS ===================
window.addEventListener('scroll', () => {
  const nav = document.querySelector('nav');
  if(window.scrollY > 20) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
});

// ===================== FASHIONAI ENGINE =====================

let aiState = {
  photo: null, bodyData: null, avatarReady: false,
  outfit: { shirt:null, trouser:null, shoe:null, cap:null },
  canvas: null, rotY: 0, dragging: false, lastX: 0,
  processedPhoto: null, landmarks: [], _photoImg: null,
  skin: '#c68642', hair: '#1a1a1a'
};

function initFashionAIPage() {
  lucide.createIcons();
  if (aiState.avatarReady) {
    setTimeout(() => { setupAiCanvas(); buildAiClothingSelector(); }, 100);
    return;
  }
  // Show default avatar immediately — no photo needed
  aiState.bodyData = { height: 1.72, shoulder: 44, build: 'Athletic', skin: aiState.skin };
  aiState.avatarReady = true;
  document.getElementById('ai-step-upload').style.display = '';
  document.getElementById('ai-viewer-section').style.display = 'block';
  document.getElementById('ai-sidebar-ph').style.display = 'none';
  document.getElementById('ai-cloth-selector').style.display = 'block';
  buildAiClothingSelector();
  aiSetStep(2);
  setTimeout(() => { setupAiCanvas(); lucide.createIcons(); }, 80);
}

// Sets display on a studio element if it exists (some are replaced once clothes load)
function _aiShow(id, display) { const el = document.getElementById(id); if (el) el.style.display = display; }

function aiResetAll() {
  destroy3DScene();
  aiViewMode = '3d';
  const modeLabel = document.getElementById('ai-mode-label');
  const hint = document.getElementById('ai-viewer-hint-text');
  if(modeLabel) modeLabel.textContent = 'Photo Mode';
  if(hint) hint.textContent = '3D Avatar · Drag to rotate · Scroll to zoom';
  const prevSkin = aiState.skin || '#c68642';
  const prevHair = aiState.hair || '#1a1a1a';
  aiState = { photo:null, bodyData:null, avatarReady:false, outfit:{shirt:null,trouser:null,shoe:null,cap:null}, canvas:null, rotY:0, dragging:false, lastX:0, processedPhoto:null, landmarks:[], _photoImg:null, skin:prevSkin, hair:prevHair };
  _syncHairPanel();
  _aiShow('ai-step-upload', '');
  _aiShow('ai-viewer-section', 'none');
  _aiShow('ai-pipeline', 'none');
  _aiShow('ai-body-stats', 'none');
  _aiShow('ai-sidebar-ph', '');
  _aiShow('ai-cloth-selector', 'none');
  _aiShow('ai-export-wrap', 'none');
  _aiShow('ai-add-cart-wrap', 'none');
  document.getElementById('ai-upload-zone').innerHTML = `
    <input type="file" id="ai-file-input" accept="image/*" onchange="aiHandleFile(event)" style="display:none"/>
    <div style="width:64px;height:64px;border:1.5px solid rgba(255,107,0,.35);border-radius:16px;display:flex;align-items:center;justify-content:center;margin-bottom:1.2rem"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,107,0,.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
    <h3 class="font-display text-lg font-bold mb-2">Drop your full body photo</h3>
    <p class="text-neutral-500 text-sm text-center max-w-xs leading-relaxed">Stand straight, full body visible. Best results on plain backgrounds. JPG or PNG.</p>
    <div class="flex gap-3 mt-6 text-xs text-neutral-600">
      <span class="px-3 py-1.5 bg-charcoal rounded-lg">✓ Clear full body</span>
      <span class="px-3 py-1.5 bg-charcoal rounded-lg">✓ Good lighting</span>
      <span class="px-3 py-1.5 bg-charcoal rounded-lg">✓ Front facing</span>
    </div>`;
  aiSetStep(1);
}

function aiSetStep(n) {
  for(let i=1;i<=5;i++){
    const el=document.getElementById('asp-'+i);
    if(!el)continue;
    el.classList.remove('active','done');
    const num=el.querySelector('.asp-num');
    if(i<n){el.classList.add('done');if(num)num.textContent='';}
    else if(i===n){el.classList.add('active');if(num)num.textContent=i;}
    else{if(num)num.textContent=i;}
  }
}

function aiHandleDrag(e){e.preventDefault();document.getElementById('ai-upload-zone').classList.add('drag');}
function aiHandleDrop(e){e.preventDefault();document.getElementById('ai-upload-zone').classList.remove('drag');const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('image/'))aiProcessFile(f);}
function aiHandleFile(e){const f=e.target.files[0];if(f)aiProcessFile(f);}

function aiProcessFile(file){
  const r=new FileReader();
  r.onload=(ev)=>{
    aiState.photo=ev.target.result; aiShowPreview(ev.target.result,file.name); aiRunPipeline();
    // The studio photo also becomes the customer's AI try-on photo
    const src=ev.target.result;
    if(state.currentUser) _saveTryonPhoto(src).then(ok=>{ if(ok && aiState.photo===src){ aiState._savedAsTryon=true; showToast('Saved as your try-on photo'); } });
  };
  r.readAsDataURL(file);
}

function aiShowPreview(src,name){
  const z=document.getElementById('ai-upload-zone');
  z.style.cursor='default';
  z.innerHTML=`<img src="${src}" style="width:100%;height:100%;object-fit:contain;position:absolute;top:0;left:0;border-radius:18px"/>
    <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(10,10,10,.92));padding:1.2rem 1rem .9rem;display:flex;align-items:center;gap:.6rem">
      <span class="badge badge-yellow">Photo loaded</span>
      <span style="font-size:.74rem;color:rgba(229,229,229,.7)">${name}</span>
    </div>`;
}

function aiSetPStep(i, status, prog){
  const el=document.getElementById('ai-ps-'+i);
  const pb=document.getElementById('ai-pb-'+i);
  const pst=document.getElementById('ai-pst-'+i);
  if(!el)return;
  el.classList.remove('active','done');
  if(status==='active'){el.classList.add('active');pb.style.width=prog+'%';pst.textContent='Processing…';pst.style.color='#FF6B00';}
  else if(status==='done'){el.classList.add('done');pb.style.width='100%';pst.textContent='✓ Done';pst.style.color='#4ade80';}
  else{pb.style.width='0%';pst.textContent='Waiting';pst.style.color='';}
}

function aiAnimBar(id, from, to, ms){
  return new Promise(res=>{
    const el=document.getElementById(id);
    const steps=55,inc=(to-from)/steps,delay=ms/steps;
    let cur=from;
    const t=setInterval(()=>{
      cur+=inc+(Math.random()-.5)*inc*.5;
      cur=Math.min(to,Math.max(from,cur));
      el.style.width=cur+'%';
      if(cur>=to){clearInterval(t);el.style.width=to+'%';res();}
    },delay);
  });
}

function aiSleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function aiRunPipeline(){
  document.getElementById('ai-pipeline').style.display='block';
  aiSetStep(2);

  // Try real Python AI backend; fall back to simulation if unavailable
  let apiResult = null;

  aiSetPStep(0,'active',0);
  const apiCall = fetch('/api/process-photo',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({image: aiState.photo})
  }).then(r=>r.ok?r.json():null).catch(()=>null);

  await aiAnimBar('ai-pb-0',0,100,1100); aiSetPStep(0,'done');

  aiSetPStep(1,'active',0);
  await aiAnimBar('ai-pb-1',0,100,1200); aiSetPStep(1,'done');

  aiSetPStep(2,'active',0);
  apiResult = await apiCall;   // wait for API by the time progress finishes
  await aiAnimBar('ai-pb-2',0,100,800);  aiSetPStep(2,'done');

  // Use real data if backend responded
  if(apiResult && apiResult.success){
    aiState.bodyData       = apiResult.bodyStats;
    aiState.processedPhoto = apiResult.processedImage;
    aiState.landmarks      = apiResult.landmarks || [];
    // Pre-load processed image and switch to photo mode so user sees their real photo
    if(aiState.processedPhoto){
      const img = new Image();
      img.onload = ()=>{ aiState._photoImg = img; aiPrepareHair(); if(aiState.avatarReady){ destroy3DScene(); aiDrawAvatar(); } };
      img.src = aiState.processedPhoto;
      // Auto-switch viewer to photo mode
      aiViewMode = 'photo';
      const modeLabel = document.getElementById('ai-mode-label');
      const hint      = document.getElementById('ai-viewer-hint-text');
      if(modeLabel) modeLabel.textContent = '3D Mode';
      if(hint)      hint.textContent      = 'Your photo · Select clothing to try on';
    }
  } else {
    aiState.bodyData = aiExtractBody();
  }

  aiShowBodyStats(aiState.bodyData);

  aiSetPStep(3,'active',0); await aiAnimBar('ai-pb-3',0,100,1800); aiSetPStep(3,'done');
  aiSetStep(3);

  await aiSleep(300);
  aiShowViewer();
  buildAiClothingSelector();
  aiState.avatarReady=true;
}

function aiExtractBody(){
  const builds=['Athletic','Slim','Regular','Broad'];
  const tones=['#c68642','#8d5524','#f1c27d','#e0ac69','#ffdbac','#4a2912'];
  return {
    height:(1.68+Math.random()*.22).toFixed(2),
    shoulder:(42+Math.random()*12).toFixed(0),
    build:builds[Math.floor(Math.random()*builds.length)],
    skin:tones[Math.floor(Math.random()*tones.length)]
  };
}

function aiShowBodyStats(d){
  const s=document.getElementById('ai-body-stats');
  s.style.display='block';
  document.getElementById('ai-bs-height').textContent=d.height+'m';
  document.getElementById('ai-bs-shoulder').textContent=d.shoulder+'cm';
  document.getElementById('ai-bs-build').textContent=d.build;
}

function aiShowViewer(){
  document.getElementById('ai-step-upload').style.display='none';
  const vs=document.getElementById('ai-viewer-section');
  vs.style.display='block';
  setTimeout(()=>{ setupAiCanvas(); lucide.createIcons(); },80);
}

// ── Canvas Avatar Renderer ──
function setupAiCanvas(){
  const wrap=document.getElementById('ai-canvas-wrap');
  if(!wrap)return;
  const c=document.getElementById('ai-avatar-canvas');
  c.width=wrap.clientWidth||600; c.height=420;
  aiState.canvas=c;

  // Use Three.js 3D bitmoji when available
  if(window.THREE && aiViewMode==='3d'){
    const ok=init3DScene();
    if(ok) return;
  }

  // 2D fallback (no Three.js, or photo mode) — stop Three.js first if running
  if(avatar3D.active) destroy3DScene();
  aiDrawAvatar();
  c.addEventListener('mousedown',e=>{aiState.dragging=true;aiState.lastX=e.clientX;});
  c.addEventListener('mousemove',e=>{
    if(!aiState.dragging)return;
    aiState.rotY+=(e.clientX-aiState.lastX)*.5;
    aiState.lastX=e.clientX;
    aiDrawAvatar();
  });
  c.addEventListener('mouseup',()=>aiState.dragging=false);
  c.addEventListener('mouseleave',()=>aiState.dragging=false);
  c.addEventListener('touchstart',e=>{aiState.dragging=true;aiState.lastX=e.touches[0].clientX;},{passive:true});
  c.addEventListener('touchmove',e=>{
    if(!aiState.dragging)return;
    aiState.rotY+=(e.touches[0].clientX-aiState.lastX)*.5;
    aiState.lastX=e.touches[0].clientX;
    aiDrawAvatar(); e.preventDefault();
  },{passive:false});
  c.addEventListener('touchend',()=>aiState.dragging=false);
}

function aiDrawAvatar(){
  if(avatar3D.active)return; // Three.js renderer handles this
  let c=aiState.canvas; if(!c)return;
  let ctx=c.getContext('2d');
  if(!ctx){ c=_freshAvatarCanvas(); aiState.canvas=c; ctx=c&&c.getContext('2d'); if(!ctx)return; }
  const W=c.width,H=c.height;
  ctx.clearRect(0,0,W,H);

  // ── Photo-based: show real background-removed photo whenever available ──
  if(aiState._photoImg){
    aiDrawPhotoTryOn(ctx, W, H);
    return;
  }

  // BG glow (fallback stick-figure path)
  const bg=ctx.createRadialGradient(W/2,H*.4,10,W/2,H*.4,H*.6);
  bg.addColorStop(0,'rgba(255,107,0,0.07)');bg.addColorStop(1,'rgba(10,10,10,0)');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

  // Shadow
  ctx.save();ctx.beginPath();ctx.ellipse(W/2,H*.93,52,11,0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.45)';ctx.fill();ctx.restore();

  const sc=H/460, cx=W/2, bY=H*.9;
  const lean=Math.sin(aiState.rotY*Math.PI/180)*9;
  const bd=aiState.bodyData;
  const skin=bd?bd.skin:'#c68642';
  const o=aiState.outfit;

  // Shoes
  const sc_=o.shoe?o.shoe.color:'#111',sa=o.shoe?o.shoe.accent:'#FF6B00';
  aiDrawShoe(ctx,sc,cx-28*sc+lean*.2,bY,sc_,sa,false);
  aiDrawShoe(ctx,sc,cx+18*sc+lean*.2,bY,sc_,sa,true);

  // Trousers
  const tc=o.trouser?o.trouser.color:'#111';
  ctx.save();ctx.translate(lean*.3,0);
  aiRoundRect(ctx,cx-32*sc,bY-140*sc,28*sc,135*sc,5*sc,tc);
  aiRoundRect(ctx,cx+4*sc,bY-140*sc,28*sc,135*sc,5*sc,tc);
  aiRoundRect(ctx,cx-34*sc,bY-149*sc,68*sc,15*sc,4*sc,aiDarken(tc,20));
  ctx.restore();

  // Shirt / torso
  const shc=o.shirt?o.shirt.color:'#111',sha=o.shirt?o.shirt.accent:'#FF6B00';
  ctx.save();ctx.translate(lean*.5,0);
  aiRoundRect(ctx,cx-38*sc,bY-270*sc,76*sc,128*sc,8*sc,shc);
  ctx.beginPath();ctx.moveTo(cx-12*sc,bY-270*sc);ctx.lineTo(cx,bY-256*sc);ctx.lineTo(cx+12*sc,bY-270*sc);
  ctx.strokeStyle=sha;ctx.lineWidth=2;ctx.stroke();
  // Arms
  aiRoundRect(ctx,cx-62*sc,bY-260*sc,25*sc,78*sc,7*sc,shc);
  aiRoundRect(ctx,cx-64*sc,bY-186*sc,29*sc,29*sc,5*sc,skin);
  aiRoundRect(ctx,cx+37*sc,bY-260*sc,25*sc,78*sc,7*sc,shc);
  aiRoundRect(ctx,cx+35*sc,bY-186*sc,29*sc,29*sc,5*sc,skin);
  ctx.restore();

  // Neck
  aiRoundRect(ctx,cx-10*sc,bY-300*sc,20*sc,33*sc,4*sc,skin);

  // Head
  ctx.save();ctx.translate(cx+lean,bY-370*sc);
  // Hair
  ctx.beginPath();ctx.ellipse(0,0,37*sc,41*sc,0,0,Math.PI*2);ctx.fillStyle='#1a0f05';ctx.fill();
  // Face
  ctx.beginPath();ctx.ellipse(0,7*sc,33*sc,35*sc,0,0,Math.PI*2);ctx.fillStyle=skin;ctx.fill();
  // Eyes
  ctx.fillStyle='#100808';
  ctx.beginPath();ctx.ellipse(-11*sc,5*sc,5*sc,5.5*sc,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(11*sc,5*sc,5*sc,5.5*sc,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='white';
  ctx.beginPath();ctx.ellipse(-9*sc,3*sc,2*sc,2.5*sc,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(13*sc,3*sc,2*sc,2.5*sc,0,0,Math.PI*2);ctx.fill();
  // Eyebrows
  ctx.strokeStyle=aiDarken(skin,55);ctx.lineWidth=2.5*sc;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(-16*sc,-3*sc);ctx.quadraticCurveTo(-11*sc,-8*sc,-6*sc,-3*sc);ctx.stroke();
  ctx.beginPath();ctx.moveTo(6*sc,-3*sc);ctx.quadraticCurveTo(11*sc,-8*sc,16*sc,-3*sc);ctx.stroke();
  // Nose
  ctx.strokeStyle=aiDarken(skin,35);ctx.lineWidth=1.5*sc;
  ctx.beginPath();ctx.moveTo(-3*sc,11*sc);ctx.quadraticCurveTo(0,19*sc,3*sc,11*sc);ctx.stroke();
  // Smile
  ctx.strokeStyle=aiDarken(skin,45);ctx.lineWidth=2*sc;
  ctx.beginPath();ctx.arc(0,21*sc,9*sc,.1,Math.PI-.1);ctx.stroke();
  // Cap
  if(o.cap){
    const cc=o.cap.color,ca=o.cap.accent;
    ctx.beginPath();ctx.ellipse(8*sc,-24*sc,37*sc,8*sc,-.08,0,Math.PI*2);ctx.fillStyle=aiDarken(cc,15);ctx.fill();
    ctx.beginPath();ctx.moveTo(-31*sc,-24*sc);ctx.quadraticCurveTo(-35*sc,-60*sc,0,-66*sc);ctx.quadraticCurveTo(35*sc,-60*sc,31*sc,-24*sc);ctx.closePath();
    ctx.fillStyle=cc;ctx.fill();ctx.strokeStyle=ca;ctx.lineWidth=2;ctx.stroke();
  }
  ctx.restore();

  // TrendMallz watermark
  ctx.fillStyle='rgba(255,107,0,0.18)';
  ctx.font=`${10*sc}px Syne,sans-serif`;ctx.textAlign='right';
  ctx.fillText('TrendMallz AI',W-12,H-10);
}

// ── Photo-based virtual try-on renderer ──────────────────────────────────────
// Uses the background-removed photo from the Python backend as the avatar base,
// then draws clothing shapes on top aligned to the MediaPipe body keypoints.
//
// MediaPipe landmark indices used:
//   11 = LEFT_SHOULDER  12 = RIGHT_SHOULDER
//   23 = LEFT_HIP       24 = RIGHT_HIP
//   25 = LEFT_KNEE      26 = RIGHT_KNEE
//   27 = LEFT_ANKLE     28 = RIGHT_ANKLE
//   0  = NOSE
function aiDrawPhotoTryOn(ctx, W, H){
  const img = aiState._hairImg || aiState._photoImg; // recoloured copy when a hair colour is picked
  const lms = aiState.landmarks;
  const o   = aiState.outfit;
  const hasLandmarks = lms && lms.length >= 25;

  // -- Draw processed (background-removed) photo centred in the canvas --
  const scale  = Math.min(W / img.width, H / img.height) * 0.92;
  const drawW  = img.width  * scale;
  const drawH  = img.height * scale;
  const offX   = (W - drawW) / 2;
  const offY   = (H - drawH) / 2;

  // Subtle orange glow behind the figure
  const glow = ctx.createRadialGradient(W/2, H*0.4, 20, W/2, H*0.4, H*0.55);
  glow.addColorStop(0,'rgba(255,107,0,0.09)');
  glow.addColorStop(1,'rgba(10,10,10,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  ctx.drawImage(img, offX, offY, drawW, drawH);

  // Clothing overlays require landmark data; skip if pose wasn't detected
  if(!hasLandmarks){ aiDrawWatermark(ctx,W,H); return; }

  // Helper: convert normalised landmark coords → canvas pixel coords
  const lx = i => offX + lms[i].x * drawW;
  const ly = i => offY + lms[i].y * drawH;

  // ── Shirt overlay ──
  if(o.shirt){
    const ls = {x: lx(11), y: ly(11)};
    const rs = {x: lx(12), y: ly(12)};
    const lh = {x: lx(23), y: ly(23)};
    const rh = {x: lx(24), y: ly(24)};

    // Expand shoulder width slightly so shirt covers arms
    const pad = (rs.x - ls.x) * 0.18;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.moveTo(ls.x - pad, ls.y);
    ctx.lineTo(rs.x + pad, rs.y);
    ctx.lineTo(rh.x + pad * 0.6, rh.y);
    ctx.lineTo(lh.x - pad * 0.6, lh.y);
    ctx.closePath();
    ctx.fillStyle = o.shirt.color;
    ctx.fill();

    // Collar V-line detail
    const midX = (ls.x + rs.x) / 2;
    const midY = (ls.y + rs.y) / 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(ls.x + (rs.x-ls.x)*.35, midY - 4);
    ctx.lineTo(midX, midY + (lh.y - midY)*0.35);
    ctx.lineTo(rs.x - (rs.x-ls.x)*.35, midY - 4);
    ctx.strokeStyle = o.shirt.accent;
    ctx.lineWidth   = Math.max(1.5, (rs.x - ls.x) * 0.025);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  // ── Trouser overlay ──
  if(o.trouser){
    const lh = {x: lx(23), y: ly(23)};
    const rh = {x: lx(24), y: ly(24)};
    const lk = {x: lx(25), y: ly(25)};
    const rk = {x: lx(26), y: ly(26)};
    const la = {x: lx(27), y: ly(27)};
    const ra = {x: lx(28), y: ly(28)};

    const hipW = (rh.x - lh.x) * 0.55;

    ctx.globalAlpha = 0.70;
    // Left leg
    ctx.beginPath();
    ctx.moveTo(lh.x - hipW*0.1, lh.y);
    ctx.lineTo((lh.x+rh.x)/2,   lh.y + 4);
    ctx.lineTo((lk.x+rk.x)/2 + 4, (lk.y+rk.y)/2);
    ctx.lineTo(la.x + hipW*0.35, la.y);
    ctx.lineTo(la.x - hipW*0.35, la.y);
    ctx.lineTo(lk.x - hipW*0.4, lk.y);
    ctx.closePath();
    ctx.fillStyle = o.trouser.color; ctx.fill();

    // Right leg
    ctx.beginPath();
    ctx.moveTo(rh.x + hipW*0.1, rh.y);
    ctx.lineTo((lh.x+rh.x)/2,   lh.y + 4);
    ctx.lineTo((lk.x+rk.x)/2 - 4, (lk.y+rk.y)/2);
    ctx.lineTo(rk.x - hipW*0.35, rk.y);
    ctx.lineTo(ra.x + hipW*0.35, ra.y);
    ctx.lineTo(ra.x - hipW*0.35, ra.y);
    ctx.closePath();
    ctx.fillStyle = o.trouser.color; ctx.fill();

    // Waistband
    ctx.globalAlpha = 0.85;
    const waistPad = hipW * 0.55;
    ctx.fillStyle = aiDarken(o.trouser.color, 18);
    ctx.fillRect(lh.x - waistPad, lh.y - 6, (rh.x - lh.x) + waistPad*2, 10);

    ctx.globalAlpha = 1;
  }

  // ── Shoe overlays (simple rounded rectangles below ankles) ──
  if(o.shoe){
    [[27,28],[28,27]].forEach(([ank])=>{
      const ax = lx(ank), ay = ly(ank);
      const sw = Math.abs(lx(12)-lx(11)) * 0.22;
      const sh = sw * 0.42;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(ax - sw*0.9, ay, sw*1.8, sh, sh*0.35);
      ctx.fillStyle   = o.shoe.color;   ctx.fill();
      ctx.strokeStyle = o.shoe.accent;  ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  // ── Cap overlay (above nose/head) ──
  if(o.cap){
    const nx = lx(0), ny = ly(0);
    const headW = Math.abs(lx(12)-lx(11)) * 0.55;
    ctx.globalAlpha = 0.88;
    // Brim
    ctx.beginPath();
    ctx.ellipse(nx + headW*0.15, ny - headW*0.55, headW*1.1, headW*0.22, -0.05, 0, Math.PI*2);
    ctx.fillStyle = aiDarken(o.cap.color, 15); ctx.fill();
    // Crown
    ctx.beginPath();
    ctx.moveTo(nx - headW*0.9, ny - headW*0.55);
    ctx.quadraticCurveTo(nx - headW*0.95, ny - headW*2.1, nx, ny - headW*2.2);
    ctx.quadraticCurveTo(nx + headW*0.95, ny - headW*2.1, nx + headW*0.9, ny - headW*0.55);
    ctx.closePath();
    ctx.fillStyle = o.cap.color; ctx.fill();
    ctx.strokeStyle = o.cap.accent; ctx.lineWidth = 2; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  aiDrawWatermark(ctx,W,H);
}

function aiDrawWatermark(ctx,W,H){
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#FF6B00';
  ctx.font = `${Math.max(9, W*0.018)}px Syne,sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('TrendMallz AI', W - 12, H - 10);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function aiDrawShoe(ctx,sc,x,y,color,accent,flip){
  ctx.save();ctx.translate(x,y);if(flip)ctx.scale(-1,1);
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-25*sc,0);
  ctx.quadraticCurveTo(-31*sc,-2*sc,-29*sc,-9*sc);
  ctx.lineTo(-2*sc,-11*sc);ctx.quadraticCurveTo(4*sc,-7*sc,2*sc,0);ctx.closePath();
  ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=accent;ctx.lineWidth=1.5;ctx.stroke();
  ctx.restore();
}
function aiRoundRect(ctx,x,y,w,h,r,color){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();ctx.fillStyle=color;ctx.fill();
}
function aiDarken(hex,amt){
  try{let c=hex.replace('#','');if(c.length===3)c=c.split('').map(x=>x+x).join('');
  return`rgb(${Math.max(0,parseInt(c.substr(0,2),16)-amt)},${Math.max(0,parseInt(c.substr(2,2),16)-amt)},${Math.max(0,parseInt(c.substr(4,2),16)-amt)})`;}
  catch(e){return hex;}
}

// ── Clothing Selector ──
function buildAiClothingSelector(){
  document.getElementById('ai-sidebar-ph').style.display='none';
  const sel=document.getElementById('ai-cloth-selector');
  sel.style.display='block';

  if(!PRODUCTS.length){
    sel.innerHTML='<p class="text-xs text-neutral-500 text-center py-8">No products available yet.</p>';
    aiSetStep(4);
    return;
  }

  // Group products by their category folder
  const groups={};
  PRODUCTS.forEach(p=>{
    const cat=p.category||'Other';
    if(!groups[cat])groups[cat]=[];
    groups[cat].push(p);
  });

  const gridHtml=Object.entries(groups).map(([cat,prods])=>`
    <div style="margin-bottom:1.5rem">
      <div class="ai-cat-lbl">${cat}</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.55rem">
        ${prods.map(p=>`
          <div class="ai-cloth${state.outfitIds.includes(String(p.id))?' in-outfit':''}" id="aicard-${p.id}" onclick="aiToggleOutfit('${p.id}')" title="Add ${escHtml(p.name)} to your outfit">
            <img src="${p.img}" alt="${escHtml(p.name)}" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;display:block;background:#111"/>
            <div class="ai-cloth-name">${escHtml(p.name)}</div>
            <div class="ai-cloth-brand" style="color:#c9a96e">${escHtml(p.brand)} · ${OUTFIT_SLOT_NAMES[p.tryonSlot]||'Item'}</div>
          </div>`).join('')}
      </div>
    </div>`).join('');

  sel.innerHTML=`
    <div id="ai-outfit-tray"></div>
    <p class="text-[10px] font-semibold text-citrine uppercase tracking-widest mb-1">Brand Catalogue</p>
    <p class="text-xs text-neutral-500 mb-4">Tap items to build your outfit, then tap <b>Try On Outfit</b></p>
    ${gridHtml}
  `;
  renderOutfitTray();
  aiSetStep(4);
}

// ── Outfit builder: pick a top, bottom, shoes, jewellery… then try them on together ──
const OUTFIT_SLOT_NAMES = { 'one-piece': 'Dress / Jumpsuit', tops: 'Top', outerwear: 'Jacket / Outer layer', bottoms: 'Bottom', shoes: 'Shoes', hats: 'Hat', jewelry: 'Jewellery', bags: 'Bag' };
const OUTFIT_SLOT_ORDER = ['one-piece', 'bottoms', 'tops', 'outerwear', 'shoes', 'hats', 'jewelry', 'bags'];
state.outfitIds = [];

function _outfitProducts() {
  return state.outfitIds.map(id => PRODUCTS.find(p => String(p.id) === id)).filter(Boolean)
    .sort((a, b) => OUTFIT_SLOT_ORDER.indexOf(a.tryonSlot) - OUTFIT_SLOT_ORDER.indexOf(b.tryonSlot));
}

// Adds or removes an item; an item of the same type (or a clashing one) is swapped out
function aiToggleOutfit(id) {
  id = String(id);
  const p = PRODUCTS.find(x => String(x.id) === id);
  if (!p) return;
  if (state.outfitIds.includes(id)) {
    state.outfitIds = state.outfitIds.filter(x => x !== id);
  } else {
    const clashes = q => q.tryonSlot === p.tryonSlot ||
      (p.tryonSlot === 'one-piece' && (q.tryonSlot === 'tops' || q.tryonSlot === 'bottoms')) ||
      (q.tryonSlot === 'one-piece' && (p.tryonSlot === 'tops' || p.tryonSlot === 'bottoms'));
    const removed = _outfitProducts().filter(clashes);
    state.outfitIds = state.outfitIds.filter(x => !removed.some(r => String(r.id) === x));
    state.outfitIds.push(id);
    if (removed.length) showToast('Swapped ' + removed.map(r => r.name).join(', ') + ' for ' + p.name, 'info');
  }
  document.querySelectorAll('.ai-cloth').forEach(el => el.classList.toggle('in-outfit', state.outfitIds.includes(el.id.replace('aicard-', ''))));
  renderOutfitTray();
}

function aiClearOutfit() {
  state.outfitIds = [];
  document.querySelectorAll('.ai-cloth.in-outfit').forEach(el => el.classList.remove('in-outfit'));
  renderOutfitTray();
}

function renderOutfitTray() {
  const tray = document.getElementById('ai-outfit-tray');
  if (!tray) return;
  const items = _outfitProducts();
  if (!items.length) { tray.innerHTML = ''; return; }
  const total = items.reduce((s, p) => s + (p.price || 0), 0);
  tray.innerHTML = `
    <div style="margin-bottom:1.2rem;padding:.9rem;border:1px solid rgba(255,107,0,.35);border-radius:14px;background:rgba(255,107,0,.05)">
      <div class="flex items-center justify-between mb-2">
        <p class="text-[10px] font-semibold text-citrine uppercase tracking-widest">Your Outfit · ${items.length} item${items.length > 1 ? 's' : ''}</p>
        <button onclick="aiClearOutfit()" class="text-[11px] text-neutral-500 hover:text-white">Clear</button>
      </div>
      <div class="space-y-1.5 mb-3">
        ${items.map(p => `<div class="flex items-center gap-2">
          <img src="${p.img}" class="w-8 h-10 object-cover rounded-md bg-black" alt=""/>
          <div class="flex-1 min-w-0"><p class="text-xs font-semibold truncate">${escHtml(p.name)}</p><p class="text-[10px] text-neutral-500">${OUTFIT_SLOT_NAMES[p.tryonSlot] || 'Item'} · ${fmt(p.price || 0)}</p></div>
          <button onclick="aiToggleOutfit('${p.id}')" class="text-neutral-500 hover:text-red-400 text-sm px-1" title="Remove">✕</button>
        </div>`).join('')}
      </div>
      <button class="ai-btn-primary" style="margin:0" onclick="startOutfitTryOn(state.outfitIds.slice())">Try On Outfit · ${fmt(total)}</button>
      <p class="text-[10px] text-neutral-600 mt-1.5 text-center">Each new item takes a few seconds. Items you've already tried with this photo are reused.</p>
    </div>`;
}

function aiExportPNG(){
  if(!aiState.canvas){showToast('Generate your avatar first','info');return;}
  const a=document.createElement('a');
  a.download='trendmallz-avatar.png';
  a.href=aiState.canvas.toDataURL('image/png');
  a.click();
  showToast('✓ Avatar saved as PNG','success');
}
function aiCopyLink(){
  navigator.clipboard.writeText(window.location.href).then(()=>showToast('✓ Link copied!','success')).catch(()=>showToast('Copy the URL manually','info'));
}
function aiShowQR(){
  const modal=document.getElementById('ai-qr-modal');
  modal.style.display='flex';
  const qc=document.getElementById('ai-qr-canvas');
  qc.width=160;qc.height=160;
  const ctx=qc.getContext('2d');
  ctx.fillStyle='#f5f5f5';ctx.fillRect(0,0,160,160);
  ctx.fillStyle='#0A0A0A';
  const seed=window.location.href.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
  for(let i=0;i<16;i++)for(let j=0;j<16;j++){
    const isC=(i<4&&j<4)||(i>11&&j<4)||(i<4&&j>11);
    if(isC||(seed*i+j*37+i*j*3)%7<3)ctx.fillRect(i*10,j*10,9,9);
  }
  [[0,0],[110,0],[0,110]].forEach(([ox,oy])=>{
    ctx.strokeStyle='#0A0A0A';ctx.lineWidth=2;ctx.strokeRect(ox+2,oy+2,46,46);
    ctx.fillStyle='#0A0A0A';ctx.fillRect(ox+10,oy+10,28,28);
    ctx.fillStyle='#f5f5f5';ctx.fillRect(ox+16,oy+16,16,16);
  });
  ctx.fillStyle='#FF6B00';ctx.beginPath();ctx.arc(80,80,6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#0A0A0A';ctx.font='bold 8px Syne,sans-serif';ctx.textAlign='center';
  ctx.fillText('TrendMallz AI',80,155);
}

// ===================== 3D BITMOJI ENGINE =====================

let aiViewMode = '3d';   // '3d' | 'photo'

function aiSetHair(hex, el) {
  aiState.hair = hex;
  document.querySelectorAll('#hair-swatches .appear-swatch').forEach(s => s.classList.remove('sel'));
  if (el) el.classList.add('sel');
  if (avatar3D.active) build3DAvatar();
}

const avatar3D = {
  renderer: null, scene: null, camera: null,
  controls: null, avatarGroup: null,
  animId: null, active: false
};

// ── Three.js Scene ─────────────────────────────────────────────────────────
function init3DScene() {
  const T = window.THREE;
  if (!T) return false;
  const wrap = document.getElementById('ai-canvas-wrap');
  const canvas = document.getElementById('ai-avatar-canvas');
  if (!wrap || !canvas) return false;
  const W = wrap.clientWidth || 600, H = 420;

  if (avatar3D.animId) { cancelAnimationFrame(avatar3D.animId); avatar3D.animId = null; }
  if (avatar3D.renderer) { avatar3D.renderer.dispose(); avatar3D.renderer = null; }

  const scene = new T.Scene();
  scene.background = new T.Color(0x0a0a0a);
  avatar3D.scene = scene;

  const camera = new T.PerspectiveCamera(42, W / H, 0.1, 100);
  camera.position.set(0, 0.85, 3.3);
  camera.lookAt(0, 0.55, 0);
  avatar3D.camera = camera;

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding || 3001; // correct gamma for GLB textures
  avatar3D.renderer = renderer;

  // Lighting — bright enough to show RPM avatar textures well
  scene.add(new T.AmbientLight(0xffffff, 0.7));
  const key = new T.DirectionalLight(0xffffff, 0.9);
  key.position.set(2, 4, 3); key.castShadow = true;
  key.shadow.mapSize.width = key.shadow.mapSize.height = 1024;
  scene.add(key);
  const fill = new T.DirectionalLight(0xffeedd, 0.35);
  fill.position.set(-3, 2, 1); scene.add(fill);
  const rim = new T.DirectionalLight(0xaaccff, 0.2);
  rim.position.set(0, 3, -4); scene.add(rim);
  const front = new T.PointLight(0xff6b00, 0.12, 6);
  front.position.set(0, 0.8, 2.5); scene.add(front);

  // Ground shadow disc
  const groundGeo = new T.CircleGeometry(1.2, 32);
  const groundMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
  const ground = new T.Mesh(groundGeo, groundMat);
  ground.name = '_ground';
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1.08;
  scene.add(ground);

  // OrbitControls
  if (T.OrbitControls) {
    const controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableZoom = true;
    controls.minDistance = 1.5; controls.maxDistance = 6;
    controls.minPolarAngle = Math.PI * 0.1; controls.maxPolarAngle = Math.PI * 0.78;
    controls.target.set(0, 0.55, 0);
    controls.autoRotate = true; controls.autoRotateSpeed = 1.4;
    controls.update();
    avatar3D.controls = controls;
  }

  // Build geometric avatar immediately
  build3DAvatar();

  function animate() {
    avatar3D.animId = requestAnimationFrame(animate);
    if (avatar3D.controls) avatar3D.controls.update();
    renderer.render(scene, camera);
  }
  animate();

  avatar3D.active = true;
  aiState.canvas = canvas;
  return true;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function _hexNum(val) {
  if (typeof val === 'number') return val;
  return parseInt(String(val).replace('#', ''), 16);
}
function _darkenHex(val, factor) {
  const n = _hexNum(val);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - factor)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - factor)));
  const b = Math.max(0, Math.round((n & 255) * (1 - factor)));
  return (r << 16) | (g << 8) | b;
}

// ── Geometric avatar ───────────────────────────────────────────────────────
function build3DAvatar() {
  const T = window.THREE;
  if (!T || !avatar3D.scene) return;

  if (avatar3D.avatarGroup) {
    avatar3D.scene.remove(avatar3D.avatarGroup);
    avatar3D.avatarGroup.traverse(obj => {
      if (obj.isMesh) { obj.geometry.dispose(); if (obj.material) obj.material.dispose(); }
    });
    avatar3D.avatarGroup = null;
  }

  const bd = aiState.bodyData;
  const skin = _hexNum(aiState.skin || (bd && bd.skin) || '#c68642');
  const hair = _hexNum(aiState.hair || '#1a1a1a');
  const o = aiState.outfit;
  const shirtC  = o.shirt   ? _hexNum(o.shirt.color)   : 0x1a1a1a;
  const trousC  = o.trouser ? _hexNum(o.trouser.color) : 0x1a1a1a;
  const shoeC   = o.shoe    ? _hexNum(o.shoe.color)    : 0x111111;
  const shoeAcc = o.shoe    ? _hexNum(o.shoe.accent)   : 0xFF6B00;
  const capC    = o.cap     ? _hexNum(o.cap.color)     : null;
  const capAcc  = o.cap     ? _hexNum(o.cap.accent)    : null;

  const group = new T.Group();
  function toon(c) { return new T.MeshToonMaterial({ color: c }); }

  // Hair dome
  group.add(Object.assign(new T.Mesh(new T.SphereGeometry(0.233, 22, 12, 0, Math.PI*2, 0, Math.PI*0.58), toon(hair)), {position: new T.Vector3(0, 1.575, -0.008), castShadow: true}));
  // Head
  group.add(Object.assign(new T.Mesh(new T.SphereGeometry(0.212, 22, 18), toon(skin)), {position: new T.Vector3(0, 1.515, 0), castShadow: true}));
  // Eyes
  [-0.087, 0.087].forEach(x => {
    group.add(Object.assign(new T.Mesh(new T.SphereGeometry(0.035,10,10), toon(0xfafafa)), {position: new T.Vector3(x, 1.532, 0.183)}));
    group.add(Object.assign(new T.Mesh(new T.SphereGeometry(0.021,8,8),   toon(0x0a0505)), {position: new T.Vector3(x, 1.532, 0.198)}));
    group.add(Object.assign(new T.Mesh(new T.SphereGeometry(0.007,6,6),   toon(0xffffff)), {position: new T.Vector3(x+0.011, 1.543, 0.207)}));
    const brow = new T.Mesh(new T.BoxGeometry(0.068,0.011,0.009), new T.MeshToonMaterial({color:hair}));
    brow.position.set(x, 1.558, 0.185); brow.rotation.z = x < 0 ? 0.13 : -0.13;
    group.add(brow);
  });
  // Nose + smile
  group.add(Object.assign(new T.Mesh(new T.SphereGeometry(0.016,8,8), toon(_darkenHex(skin,0.16))), {position: new T.Vector3(0, 1.5, 0.21)}));
  const smile = new T.Mesh(new T.TorusGeometry(0.051,0.007,6,12,Math.PI*0.88), toon(_darkenHex(skin,0.32)));
  smile.rotation.z = Math.PI; smile.rotation.x = Math.PI*0.09; smile.position.set(0, 1.46, 0.198); group.add(smile);
  // Neck
  group.add(Object.assign(new T.Mesh(new T.CylinderGeometry(0.07,0.083,0.112,10), toon(skin)), {position: new T.Vector3(0, 1.252, 0)}));
  // Torso
  group.add(Object.assign(new T.Mesh(new T.BoxGeometry(0.525,0.515,0.258), toon(shirtC)), {position: new T.Vector3(0, 0.875, 0), castShadow: true}));
  // Arms
  [-1,1].forEach(s => {
    group.add(Object.assign(new T.Mesh(new T.CylinderGeometry(0.069,0.061,0.268,9), toon(shirtC)), {position: new T.Vector3(s*0.337,0.845,0), rotation: new T.Euler(0,0,s*(-Math.PI/16)), castShadow:true}));
    group.add(Object.assign(new T.Mesh(new T.CylinderGeometry(0.055,0.047,0.238,9), toon(skin)),   {position: new T.Vector3(s*0.381,0.592,0), rotation: new T.Euler(0,0,s*(-Math.PI/12)), castShadow:true}));
    group.add(Object.assign(new T.Mesh(new T.SphereGeometry(0.052,8,8), toon(skin)), {position: new T.Vector3(s*0.42,0.452,0)}));
  });
  // Waistband + legs
  group.add(Object.assign(new T.Mesh(new T.BoxGeometry(0.528,0.063,0.262), toon(_darkenHex(trousC,0.18))), {position: new T.Vector3(0, 0.582, 0)}));
  [-1,1].forEach(s => {
    group.add(Object.assign(new T.Mesh(new T.CylinderGeometry(0.096,0.085,0.515,9), toon(trousC)), {position: new T.Vector3(s*0.14,0.288,0), castShadow:true}));
    group.add(Object.assign(new T.Mesh(new T.CylinderGeometry(0.075,0.066,0.415,9), toon(trousC)), {position: new T.Vector3(s*0.14,-0.047,0), castShadow:true}));
    // Shoes
    group.add(Object.assign(new T.Mesh(new T.BoxGeometry(0.138,0.068,0.258), toon(shoeC)), {position: new T.Vector3(s*0.154,-0.302,0.038), castShadow:true}));
    group.add(Object.assign(new T.Mesh(new T.BoxGeometry(0.139,0.021,0.259), toon(shoeAcc)), {position: new T.Vector3(s*0.154,-0.337,0.038)}));
  });
  // Cap
  if (o.cap && capC !== null) {
    group.add(Object.assign(new T.Mesh(new T.CylinderGeometry(0.152,0.202,0.198,15), toon(capC)), {position: new T.Vector3(0,1.762,0)}));
    const ct = new T.Mesh(new T.CircleGeometry(0.152,15), toon(capC)); ct.rotation.x = -Math.PI/2; ct.position.set(0,1.861,0); group.add(ct);
    group.add(Object.assign(new T.Mesh(new T.CylinderGeometry(0.287,0.287,0.021,30), toon(_darkenHex(capC,0.18))), {position: new T.Vector3(0.058,1.663,0)}));
    if (capAcc !== null) group.add(Object.assign(new T.Mesh(new T.BoxGeometry(0.038,0.028,0.001), toon(capAcc)), {position: new T.Vector3(0,1.762,0.153)}));
  }

  group.position.set(0, -0.08, 0);
  avatar3D.scene.add(group);
  avatar3D.avatarGroup = group;
}

function update3DClothing() {
  if (!avatar3D.active) return;
  build3DAvatar();
}

function destroy3DScene() {
  if (avatar3D.animId) { cancelAnimationFrame(avatar3D.animId); avatar3D.animId = null; }
  if (avatar3D.controls) { avatar3D.controls.dispose(); avatar3D.controls = null; }
  if (avatar3D.avatarGroup) {
    if (avatar3D.scene) avatar3D.scene.remove(avatar3D.avatarGroup);
    avatar3D.avatarGroup.traverse(obj => {
      if (obj.isMesh) { obj.geometry.dispose(); if (obj.material) obj.material.dispose(); }
    });
    avatar3D.avatarGroup = null;
  }
  if (avatar3D.renderer) { avatar3D.renderer.dispose(); avatar3D.renderer = null; _freshAvatarCanvas(); }
  avatar3D.scene = null; avatar3D.camera = null; avatar3D.active = false;
}

// A canvas that has been used for WebGL (the 3D avatar) can never give a 2D
// context again, so photo mode needs a brand-new canvas element in its place.
function _freshAvatarCanvas() {
  const old = document.getElementById('ai-avatar-canvas');
  if (!old) return null;
  const c = old.cloneNode(false);
  c.width = old.width; c.height = old.height;
  old.replaceWith(c);
  if (aiState.canvas === old) aiState.canvas = c;
  return c;
}

function aiToggleViewMode() {
  if (!aiState.avatarReady) return;
  const goingToPhoto = aiViewMode === '3d';
  aiViewMode = goingToPhoto ? 'photo' : '3d';
  const label = document.getElementById('ai-mode-label');
  const hint  = document.getElementById('ai-viewer-hint-text');

  if (aiViewMode === '3d') {
    if (label) label.textContent = 'Photo Mode';
    if (hint)  hint.textContent  = '3D Avatar · Drag to rotate · Scroll to zoom';
    setupAiCanvas();
  } else {
    if (label) label.textContent = '3D Mode';
    if (hint)  hint.textContent  = 'Photo Try-On · Outfit layered on your photo';
    destroy3DScene();
    const wrap = document.getElementById('ai-canvas-wrap');
    let c = document.getElementById('ai-avatar-canvas');
    if (c && !c.getContext('2d')) c = _freshAvatarCanvas();
    if (wrap && c) {
      c.width = wrap.clientWidth || 600; c.height = 420;
      aiState.canvas = c;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      if (aiState._photoImg && aiState.landmarks && aiState.landmarks.length >= 25) {
        aiDrawPhotoTryOn(ctx, c.width, c.height);
      } else {
        aiDrawAvatar();
      }
    }
  }
  _syncHairPanel();
  lucide.createIcons();
}
// ===================== END 3D BITMOJI ENGINE =====================

// ===================== PHOTO HAIR COLOUR =====================
// Finds the hair in the uploaded photo with MediaPipe (runs in the browser, no
// server cost) and recolours it while keeping the original shading and texture.
const AI_HAIR_COLOURS = [
  ['', 'Original'], ['#1a1a1a', 'Black'], ['#3b2314', 'Dark brown'], ['#7c4b2a', 'Brown'],
  ['#b5874a', 'Caramel'], ['#d4af37', 'Blonde'], ['#e8dcc0', 'Platinum'], ['#f4f4f4', 'White'],['#c0392b', 'Auburn'],
  ['#7b1e3a', 'Burgundy'], ['#888888', 'Grey'], ['#e75480', 'Pink'], ['#2e5aac', 'Blue'],
];
const MP_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
// Multiclass model: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 other
const MP_HAIR_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite';
const HAIR_CLASS = 1;
const HAIR_WORK_MAX = 1400; // longest side (px) of the working copy; keeps recolouring fast on phones
let _hairSegmenterPromise = null;

function _getHairSegmenter() {
  if (!_hairSegmenterPromise) {
    _hairSegmenterPromise = (async () => {
      const vision = await import(MP_VISION_URL + '/vision_bundle.mjs');
      const fileset = await vision.FilesetResolver.forVisionTasks(MP_VISION_URL + '/wasm');
      const opts = delegate => ({
        baseOptions: { modelAssetPath: MP_HAIR_MODEL, delegate },
        runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
      });
      try { return await vision.ImageSegmenter.createFromOptions(fileset, opts('GPU')); }
      catch (_) { return await vision.ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
    })();
    _hairSegmenterPromise.catch(() => { _hairSegmenterPromise = null; }); // allow a retry
  }
  return _hairSegmenterPromise;
}

// Hair confidence (0..1) per pixel of the source, copied out while the mask is valid
function _segmentHair(seg, source) {
  return new Promise(resolve => {
    seg.segment(source, result => {
      const m = result.confidenceMasks && result.confidenceMasks[HAIR_CLASS];
      resolve(m ? { w: m.width, h: m.height, data: Float32Array.from(m.getAsFloat32Array()) } : null);
    });
  });
}

function _scaledCanvas(src, x, y, w, h, outW, outH) {
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, outW, outH);
  return c;
}

// Bilinear-resamples a mask into the rectangle (rx,ry,rw,rh) of a W-wide target array
function _pasteMask(mask, target, W, rx, ry, rw, rh) {
  const { w: mw, h: mh, data } = mask;
  for (let y = 0; y < rh; y++) {
    const v = Math.min(mh - 1, Math.max(0, (y + 0.5) / rh * mh - 0.5));
    const y0 = Math.floor(v), y1 = Math.min(mh - 1, y0 + 1), fy = v - y0;
    for (let x = 0; x < rw; x++) {
      const u = Math.min(mw - 1, Math.max(0, (x + 0.5) / rw * mw - 0.5));
      const x0 = Math.floor(u), x1 = Math.min(mw - 1, x0 + 1), fx = u - x0;
      const top = data[y0 * mw + x0] * (1 - fx) + data[y0 * mw + x1] * fx;
      const bot = data[y1 * mw + x0] * (1 - fx) + data[y1 * mw + x1] * fx;
      target[(ry + y) * W + rx + x] = top * (1 - fy) + bot * fy;
    }
  }
}

function _maskBounds(conf, W, H, threshold) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (conf[y * W + x] > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

async function _buildHairMask(seg, img) {
  const s = Math.min(1, HAIR_WORK_MAX / Math.max(img.width, img.height));
  const W = Math.round(img.width * s), H = Math.round(img.height * s);
  const base = _scaledCanvas(img, 0, 0, img.width, img.height, W, H);

  // Pass 1: whole photo, to find roughly where the hair is
  const first = await _segmentHair(seg, base);
  if (!first) return null;
  let conf = new Float32Array(W * H);
  _pasteMask(first, conf, W, 0, 0, W, H);
  const box = _maskBounds(conf, W, H, 0.5);
  if (!box) return null;

  // Pass 2: zoom in on the head. In full-body photos the hair is only a few
  // pixels of the model's 256px input, so a close-up gives much cleaner edges.
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const side = Math.max(bw, bh) * 1.8;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2 + bh * 0.2;
  const rx = Math.max(0, Math.round(cx - side / 2)), ry = Math.max(0, Math.round(cy - side / 2));
  const rw = Math.min(W - rx, Math.round(side)), rh = Math.min(H - ry, Math.round(side));
  if (rw < W * 0.9 || rh < H * 0.9) {
    const zoom = await _segmentHair(seg, _scaledCanvas(base, rx, ry, rw, rh, rw, rh));
    if (zoom) {
      const refined = new Float32Array(W * H);
      _pasteMask(zoom, refined, W, rx, ry, rw, rh);
      if (_maskBounds(refined, W, H, 0.5)) conf = refined;
    }
  }

  // Soften the edge and measure the hair's average brightness
  const px = base.getContext('2d').getImageData(0, 0, W, H).data;
  const alpha = new Float32Array(W * H);
  let sumL = 0, sumA = 0;
  for (let i = 0; i < alpha.length; i++) {
    const t = Math.min(1, Math.max(0, (conf[i] - 0.3) / 0.4));
    const a = t * t * (3 - 2 * t);
    alpha[i] = a;
    if (a > 0) { sumL += a * (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255; sumA += a; }
  }
  if (sumA < 50) return null; // too little hair to work with
  return { base, W, H, alpha, meanL: sumL / sumA, cache: {} };
}

function _hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue / 6, sat, l];
}

function _hslToRgb(h, s, l) {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// New hue and saturation, with each pixel's brightness shifted around the target
// so strands, highlights and shadows stay visible
function _recolourHair(hair, hex) {
  if (hair.cache[hex]) return hair.cache[hex];
  const out = hair.base.getContext('2d').getImageData(0, 0, hair.W, hair.H);
  const d = out.data, a = hair.alpha;
  const [th, ts, tl] = _hexToHsl(hex);
  const meanL = Math.max(0.04, hair.meanL);
  const sat = ts * 0.8; // real dyed hair is less saturated than a flat swatch
  // Light colours (platinum, white) need dark strands lifted harder and full coverage,
  // otherwise the original dark hair shows through as grey patches
  const texture = 0.3 + 0.4 * (1 - tl);
  const floor = 0.35 + 0.3 * tl;
  const cover = 0.9 + 0.5 * tl;
  for (let i = 0, p = 0; i < a.length; i++, p += 4) {
    const k = a[i];
    if (k < 0.01) continue;
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Brightness relative to the hair's average, so dark hair going light keeps its strands.
    // The ratio is capped: in short or thin hair, bits of scalp and shine are far brighter
    // than the hair itself and would otherwise turn white.
    const ratio = Math.min(1.6, Math.max(floor, L / meanL));
    const nl = Math.min(0.95, Math.max(0.03, tl * Math.pow(ratio, texture)));
    const [nr, ng, nb] = _hslToRgb(th, sat, nl);
    const m = Math.min(1, k * cover);
    d[p] = r + (nr - r) * m; d[p + 1] = g + (ng - g) * m; d[p + 2] = b + (nb - b) * m;
  }
  const c = document.createElement('canvas');
  c.width = hair.W; c.height = hair.H;
  c.getContext('2d').putImageData(out, 0, 0);
  hair.cache[hex] = c;
  return c;
}

// The customer's chosen hair colour ('' = their own). Remembered on this device and
// applied to the studio photo and to every try-on result.
function _getHairPref() {
  if (state.hairColour === undefined) {
    try { state.hairColour = localStorage.getItem('tm_hair') || ''; } catch (_) { state.hairColour = ''; }
  }
  return state.hairColour;
}
function _setHairPref(hex) {
  state.hairColour = hex || '';
  try { localStorage.setItem('tm_hair', state.hairColour); } catch (_) {}
}
function _validHairHex(hex) { return AI_HAIR_COLOURS.some(([h]) => h === hex) ? hex : ''; }

function _setStatus(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? '' : 'none';
}
function _hairStatus(msg) { _setStatus('ai-hair-status', msg); }

function _syncHairPanel() {
  const panel = document.getElementById('ai-photo-hair');
  if (panel) panel.style.display = (aiState._photoImg && aiViewMode === 'photo') ? '' : 'none';
}

function _renderSwatchRow(boxId, pick, onclickFn) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = AI_HAIR_COLOURS.map(([hex, name]) =>
    `<div class="appear-swatch${hex === pick ? ' sel' : ''}" data-hex="${hex}" title="${name}" onclick="${onclickFn}('${hex}')"
      style="background:${hex || 'conic-gradient(#1a1a1a 0 25%,#d4af37 0 50%,#c0392b 0 75%,#888 0)'}"></div>`).join('');
}
function _markSwatch(boxId, hex) {
  document.querySelectorAll('#' + boxId + ' .appear-swatch').forEach(s => s.classList.toggle('sel', s.dataset.hex === hex));
}

async function aiPrepareHair() {
  const img = aiState._photoImg;
  if (!img) return;
  aiState._hair = null; aiState._hairImg = null; aiState._hairPick = _getHairPref();
  _renderSwatchRow('photo-hair-swatches', aiState._hairPick, 'aiSetPhotoHair');
  _syncHairPanel();
  _hairStatus('Finding your hair…');
  try {
    const seg = await _getHairSegmenter();
    if (aiState._photoImg !== img) return; // a new photo was uploaded meanwhile
    const hair = await _buildHairMask(seg, img);
    if (aiState._photoImg !== img) return;
    if (!hair) { _hairStatus("Couldn't find hair in this photo. Try one where your head is clearly visible."); return; }
    aiState._hair = hair;
    _hairStatus('');
    if (aiState._hairPick) aiSetPhotoHair(aiState._hairPick); // apply a colour tapped while loading
  } catch (err) {
    console.error('Hair colour:', err);
    _hairStatus("Hair colour isn't available on this device or connection.");
  }
}

function aiSetPhotoHair(hex) {
  aiState._hairPick = hex;
  _setHairPref(hex); // later try-ons use this colour too
  _markSwatch('photo-hair-swatches', hex);
  if (!aiState._hair) return; // still loading; applied once the mask is ready
  aiState._hairImg = hex ? _recolourHair(aiState._hair, hex) : null;
  if (aiViewMode === 'photo' && !avatar3D.active) aiDrawAvatar();
}

// ── Hair colour on try-on results ──
let _tryonJob = null;      // the look shown in the try-on window
let _tryonHair = null;     // hair mask of that result image
let _tryonBaseImg = null;  // the result image as FASHN returned it

function _showTryOnResult(job) {
  _tryonJob = job;
  _tryonHair = null;
  document.getElementById('tryon-loading').style.display = 'none';
  document.getElementById('tryon-error').style.display = 'none';
  document.getElementById('tryon-result').style.display = 'block';
  document.getElementById('tryon-choose').style.display = 'none';
  const quality = job.mode === 'quality';
  document.getElementById('tryon-mode-tag').textContent = quality ? 'Quality try-on' + (job.notes ? ' · “' + job.notes + '”' : '') : 'Quick preview';
  document.getElementById('tryon-upgrade').style.display = quality ? 'none' : 'inline-block';
  const imgEl = document.getElementById('tryon-result-img');
  imgEl.src = job.image;
  window._tryonLastUrl = job.image;
  const pick = _validHairHex(job.hairColour || '');
  _renderSwatchRow('tryon-hair-swatches', pick, 'tryonSetHair');
  // Items in this look; tap one to shop it
  const itemsBox = document.getElementById('tryon-items');
  if (itemsBox) itemsBox.innerHTML = (job.items || []).filter(i => !i.missing).map(i =>
    `<button onclick="closeTryOnModal();openProductModal(${Number(i.id)})" class="text-[11px] px-2.5 py-1 rounded-full border border-charcoal-border hover:border-citrine hover:text-citrine">${escHtml(i.name)} · ${fmt(i.price || 0)}</button>`).join('');
  _setStatus('tryon-hair-status', pick ? 'Applying your hair colour…' : '');
  lucide.createIcons();

  const base = new Image();
  base.onload = async () => {
    _tryonBaseImg = base;
    try {
      const seg = await _getHairSegmenter();
      const hair = await _buildHairMask(seg, base);
      if (_tryonJob !== job) return; // another look was opened meanwhile
      if (!hair) { _setStatus('tryon-hair-status', "Couldn't find hair in this result."); return; }
      _tryonHair = hair;
      _setStatus('tryon-hair-status', '');
      _applyTryonHair(_validHairHex(job.hairColour || ''));
    } catch (err) {
      console.error('Hair colour:', err);
      _setStatus('tryon-hair-status', "Hair colour isn't available on this device or connection.");
    }
  };
  base.src = job.image;
}

function _applyTryonHair(hex) {
  const imgEl = document.getElementById('tryon-result-img');
  if (!_tryonHair || !hex) { imgEl.src = _tryonJob.image; window._tryonLastUrl = _tryonJob.image; return; }
  const url = _recolourHair(_tryonHair, hex).toDataURL('image/jpeg', 0.92);
  imgEl.src = url;
  window._tryonLastUrl = url;
}

function tryonSetHair(hex) {
  if (!_tryonJob) return;
  _markSwatch('tryon-hair-swatches', hex);
  _setHairPref(hex);
  _tryonJob.hairColour = hex;
  if (_tryonHair) _applyTryonHair(hex);
  else _setStatus('tryon-hair-status', 'Applying your hair colour…');
  // Remember the colour with this saved look
  fetch('/api/tryon/' + encodeURIComponent(_tryonJob.jobId), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hairColour: hex }),
  }).catch(() => {});
  const saved = (state.looks || []).find(l => l.jobId === _tryonJob.jobId);
  if (saved) saved.hairColour = hex;
}

// ── My Looks (saved try-on results) ──
function loadLooks() {
  const box = document.getElementById('dash-looks');
  if (!box) return;
  box.innerHTML = '<p class="text-sm text-neutral-500">Loading your looks…</p>';
  fetch('/api/tryon/looks').then(r => r.json()).then(res => {
    state.looks = res.looks || [];
    renderLooks();
  }).catch(() => { box.innerHTML = '<p class="text-sm text-red-400">Could not load your looks. Please refresh.</p>'; });
}

function renderLooks() {
  const box = document.getElementById('dash-looks');
  if (!box) return;
  const looks = state.looks || [];
  if (!looks.length) {
    box.innerHTML = `<div class="text-center py-16 text-neutral-500"><i data-lucide="sparkles" class="w-12 h-12 mx-auto mb-4 opacity-20"></i>
      <p>No saved looks yet</p><p class="text-xs mt-1">Tap <b>Try On</b> on any item and your looks are saved here.</p>
      <button onclick="showPage('shop')" class="mt-4 px-6 py-2.5 bg-citrine text-obsidian text-sm font-bold rounded-xl">Browse Products</button></div>`;
    lucide.createIcons();
    return;
  }
  box.innerHTML = '<div class="grid grid-cols-2 md:grid-cols-3 gap-4">' + looks.map(l => {
    const hair = AI_HAIR_COLOURS.find(([h]) => h && h === l.hairColour);
    return `<div class="rounded-2xl border border-charcoal-border bg-obsidian/60 overflow-hidden">
      <div class="relative cursor-pointer" onclick="openLook('${escHtml(l.jobId)}')">
        <img src="${escHtml(l.image)}" class="w-full aspect-[2/3] object-cover" alt="${escHtml(l.productName)}"/>
        ${hair ? `<span class="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-full bg-black/70 flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${hair[0]}"></span>${hair[1]} hair</span>` : ''}
      </div>
      <div class="p-3">
        <p class="text-[10px] text-neutral-500 uppercase tracking-wider">${escHtml(l.brand)}</p>
        <p class="text-sm font-semibold truncate">${escHtml(l.productName)}</p>
        <p class="text-xs text-citrine font-bold">${fmt(l.price)}</p>
        <div class="flex gap-2 mt-2">
          <button onclick="openLook('${escHtml(l.jobId)}')" class="flex-1 py-1.5 text-xs font-bold bg-citrine text-obsidian rounded-lg">View</button>
          <button onclick="removeLook('${escHtml(l.jobId)}')" class="px-2.5 py-1.5 text-xs border border-charcoal-border rounded-lg text-neutral-400 hover:text-red-400" title="Remove"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
      </div>
    </div>`;
  }).join('') + '</div>';
  lucide.createIcons();
}

function openLook(jobId) {
  const look = (state.looks || []).find(l => l.jobId === jobId);
  if (!look) return;
  _tryonCurrentIds = (look.items || []).map(i => i.id);
  _tryonCurrentProduct = PRODUCTS.find(p => String(p.id) === String(look.productId)) || null;
  _openTryOnModal(look.productName);
  _showTryOnResult(look);
}

function removeLook(jobId) {
  if (!confirm('Remove this look?')) return;
  fetch('/api/tryon/' + encodeURIComponent(jobId), { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (res.error) { showToast(res.error, 'error'); return; }
      state.looks = (state.looks || []).filter(l => l.jobId !== jobId);
      renderLooks();
      showToast('Look removed');
    })
    .catch(() => showToast('Connection error. Please try again.', 'error'));
}

window.addEventListener('resize',()=>{
  if(aiState.canvas&&aiState.avatarReady){
    const w=document.getElementById('ai-canvas-wrap');
    if(w){
      const newW=w.clientWidth||600;
      if(avatar3D.active&&avatar3D.renderer){
        avatar3D.renderer.setSize(newW,420);
        if(avatar3D.camera){avatar3D.camera.aspect=newW/420;avatar3D.camera.updateProjectionMatrix();}
      } else {
        aiState.canvas.width=newW;
        aiDrawAvatar();
      }
    }
  }
});
// ===================== END FASHIONAI =====================
// ── Virtual Try-On ────────────────────────────────────────────────────────
let _tryonPendingIds = null;    // items to try on once a photo is uploaded
let _tryonCurrentProduct = null; // first item of the outfit being shown
let _tryonCurrentIds = [];
let _tryonPollTimer      = null;

// Loads the signed-in customer's saved try-on photo (kept on the server)
function loadTryonPhoto() {
  if (!state.currentUser) { state.tryonPhoto = null; return Promise.resolve(); }
  return fetch('/api/tryon/photo').then(r => r.ok ? r.json() : {}).then(res => { state.tryonPhoto = res.photo || null; }).catch(() => {});
}

// Try on one item (product cards)
function startTryOn(productId) { return startOutfitTryOn([productId]); }

// Try on one or more items together; the server dresses them in order
async function startOutfitTryOn(productIds, opts) {
  if (!state.currentUser) {
    showToast('Sign in to use Virtual Try-On', 'info');
    openAuthModal('login');
    return;
  }
  const products = productIds.map(id => PRODUCTS.find(p => String(p.id) === String(id))).filter(Boolean);
  if (!products.length) return;
  const product = products[0];
  _tryonCurrentProduct = product;
  _tryonCurrentIds = products.map(p => p.id);
  // In the studio, always dress the photo on screen: save it first if it wasn't saved
  // (e.g. uploaded before signing in, or the save failed)
  const onStudio = document.getElementById('page-fashionai').classList.contains('active');
  if (onStudio && aiState.photo && !aiState._savedAsTryon) {
    const src = aiState.photo;
    showToast('Saving your photo…', 'info');
    if (!(await _saveTryonPhoto(src))) return;
    if (aiState.photo === src) aiState._savedAsTryon = true;
  }
  _openTryOnModal(products.map(p => p.name).join(' + '));
  _showTryOnChoose(opts && opts.mode);
}

// ── Quick preview or Quality ──
// Things customers often ask for. Tapping one adds it to the instruction box;
// the ones on the same row are opposites, so picking one drops the other.
const TRYON_NOTE_CHIPS = [
  ['Keep my exact pose'],
  ['Button it up', 'Leave it unbuttoned'],
  ['Zip it up', 'Leave it unzipped'],
  ['Tuck the top in', 'Leave the top untucked'],
  ['Roll up the sleeves'],
  ['Loose fit', 'Slim fit'],
  ['Keep my own shoes'],
];
let _tryonMode = 'quick';
let _tryonAllowance = null;

// First step of a try-on: pick the mode (and, for Quality, any instructions)
async function _showTryOnChoose(preferMode) {
  document.getElementById('tryon-loading').style.display = 'none';
  document.getElementById('tryon-choose').style.display = 'block';
  document.getElementById('tryon-note-chips').innerHTML = TRYON_NOTE_CHIPS.map(g => g.map(t =>
    '<button type="button" class="tryon-chip" data-chip="' + escHtml(t) + '" onclick="tryonToggleChip(this.dataset.chip)">' + escHtml(t) + '</button>').join('')).join('');
  _syncNoteChips();
  tryonPickMode(preferMode || _tryonMode);
  try {
    const r = await fetch('/api/tryon/allowance');
    if (r.status === 401) { closeTryOnModal(); openAuthModal('login'); return; }
    const a = await r.json();
    if (!r.ok) return;
    if (!a.hasPhoto) { tryonChangePhoto(); return; }
    _tryonAllowance = a;
    // Start on a mode that still has free try-ons
    let mode = preferMode || _tryonMode;
    if (!a[mode].left) { const other = mode === 'quality' ? 'quick' : 'quality'; if (a[other].left) mode = other; }
    tryonPickMode(mode);
  } catch (_) { /* the server still checks everything when the try-on starts */ }
}

function tryonPickMode(mode) {
  _tryonMode = mode === 'quality' ? 'quality' : 'quick';
  const a = _tryonAllowance;
  ['quick', 'quality'].forEach(m => {
    const btn = document.getElementById('tryon-mode-' + m);
    btn.classList.toggle('active', m === _tryonMode);
    btn.classList.toggle('empty', !!a && !a[m].left);
    if (a) document.getElementById('tryon-left-' + m).textContent = a[m].left ? a[m].left + ' of ' + a[m].free + ' free left' : 'No free ones left';
  });
  document.getElementById('tryon-notes-wrap').style.display = _tryonMode === 'quality' ? 'block' : 'none';
  const out = !!a && !a[_tryonMode].left;
  _setStatus('tryon-choose-msg', out ? "You've used your free " + (_tryonMode === 'quality' ? 'Quality try-ons' : 'quick previews') + '. Looks you already made can still be opened for free.' : '');
  document.getElementById('tryon-start-btn').textContent = _tryonMode === 'quality' ? 'Start Quality Try-On' : 'Start Quick Preview';
}

// The pieces of the instruction box, split where the customer put commas or full stops
function _noteParts() {
  return document.getElementById('tryon-notes').value.split(/[,.;\n]+/).map(s => s.trim()).filter(Boolean);
}

function tryonToggleChip(text) {
  const box = document.getElementById('tryon-notes');
  const same = s => s.toLowerCase() === text.toLowerCase();
  let parts = _noteParts();
  if (parts.some(same)) parts = parts.filter(s => !same(s));
  else {
    const rivals = (TRYON_NOTE_CHIPS.find(g => g.includes(text)) || []).map(s => s.toLowerCase());
    parts = parts.filter(s => !rivals.includes(s.toLowerCase()));
    parts.push(text);
  }
  box.value = parts.join(', ').slice(0, box.maxLength > 0 ? box.maxLength : 240);
  _syncNoteChips();
}

function _syncNoteChips() {
  const parts = _noteParts().map(s => s.toLowerCase());
  document.querySelectorAll('#tryon-note-chips .tryon-chip').forEach(b => b.classList.toggle('active', parts.includes(b.dataset.chip.toLowerCase())));
}

// Lays every item of an outfit on one white picture, top to bottom the way they sit on
// a body, so a quick preview of the whole outfit is one try-on call. Resolves null if a
// picture can't be used; the server then dresses the items one at a time instead.
const OUTFIT_SHEET_ORDER = ['hats', 'tops', 'one-piece', 'bottoms', 'shoes', 'jewelry', 'bags'];
const OUTFIT_SHEET_SHARE = { hats: 0.5, tops: 1, 'one-piece': 1.8, bottoms: 1.25, shoes: 0.55, jewelry: 0.5, bags: 0.6 };
async function _buildOutfitSheet(ids) {
  try {
    const items = ids.map(id => PRODUCTS.find(p => String(p.id) === String(id))).filter(Boolean)
      .filter(p => ['tops', 'bottoms', 'one-piece'].includes(p.tryonSlot)) // shoes and accessories are dressed on their own
      .sort((a, b) => OUTFIT_SHEET_ORDER.indexOf(a.tryonSlot) - OUTFIT_SHEET_ORDER.indexOf(b.tryonSlot));
    if (items.length < 2) return null;
    const imgs = await Promise.all(items.map(p => new Promise((resolve, reject) => {
      const src = p.tryonImg || p.img || (p.images || [])[0];
      if (!src) { reject(new Error('no picture')); return; }
      const im = new Image();
      if (/^https?:/.test(src)) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im); im.onerror = () => reject(new Error('picture failed'));
      im.src = src;
    })));
    const W = 864, H = 1296, pad = 14;
    const shares = items.map(p => OUTFIT_SHEET_SHARE[p.tryonSlot] || 1);
    const total = shares.reduce((a, b) => a + b, 0);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    let y = 0;
    imgs.forEach((im, k) => {
      const cellH = H * shares[k] / total;
      const s = Math.min((W - pad * 2) / im.width, (cellH - pad * 2) / im.height);
      const w = im.width * s, h = im.height * s;
      ctx.drawImage(im, (W - w) / 2, y + (cellH - h) / 2, w, h);
      y += cellH;
    });
    return c.toDataURL('image/jpeg', 0.9); // throws if a picture came from another site without permission
  } catch (_) { return null; }
}

// Second step: send the try-on
async function tryonStart() {
  const ids = _tryonCurrentIds.slice();
  if (!ids.length) return;
  const mode = _tryonMode;
  const notes = mode === 'quality' ? document.getElementById('tryon-notes').value.trim() : '';
  document.getElementById('tryon-choose').style.display = 'none';
  document.getElementById('tryon-error').style.display = 'none';
  document.getElementById('tryon-loading').style.display = 'block';
  document.getElementById('tryon-status-text').textContent = 'Starting AI model…';
  document.getElementById('tryon-time-text').textContent = mode === 'quality' ? 'Quality try-ons can take a minute or two' : 'Usually takes 15–40 seconds';
  try {
    const sheet = mode === 'quick' && ids.length > 1 ? await _buildOutfitSheet(ids) : null;
    const r = await fetch('/api/tryon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds: ids, hairColour: _validHairHex(_getHairPref()), mode, notes, ...(sheet ? { sheet } : {}) }),
    });
    const data = await r.json();
    if (data.allowance) _tryonAllowance = { ...(_tryonAllowance || {}), ...data.allowance };
    if (r.status === 401) { closeTryOnModal(); openAuthModal('login'); return; }
    if (data.needPhoto) {
      closeTryOnModal();
      _tryonPendingIds = ids;
      document.getElementById('tryon-setup-modal').style.display = 'flex';
      lucide.createIcons();
      return;
    }
    if (data.limitReached) { // out of free try-ons for this mode: back to the choice
      document.getElementById('tryon-loading').style.display = 'none';
      document.getElementById('tryon-choose').style.display = 'block';
      tryonPickMode(mode);
      _setStatus('tryon-choose-msg', data.error);
      return;
    }
    if (!r.ok) { _showTryOnError(data.error || 'Try-on failed. Please try again.'); return; }
    _handleTryOnJob(data);
  } catch (_) {
    _showTryOnError('Connection error. Please try again.');
  }
}

// From a quick preview: make the same look again in Quality
function tryonRedoQuality() {
  if (_tryonCurrentIds.length) startOutfitTryOn(_tryonCurrentIds.slice(), { mode: 'quality' });
}

// Shows a finished job, or keeps checking until FASHN is done
function _handleTryOnJob(job) {
  if (job.status === 'completed' && job.image) { _showTryOnResult(job); return; }
  if (job.status === 'failed') { _showTryOnError(job.error || 'Try-on failed. Please try again.'); return; }
  document.getElementById('tryon-status-text').textContent = job.total > 1
    ? 'Dressing you: step ' + Math.min(job.step + 1, job.total) + ' of ' + job.total + (job.stepLabel ? ' · ' + job.stepLabel : '') + '…'
    : (job.items || []).length > 1 ? 'AI is dressing you in these items…' : 'AI is dressing you in this item…';
  if (_tryonPollTimer) clearTimeout(_tryonPollTimer);
  _tryonPollTimer = setTimeout(async () => {
    _tryonPollTimer = null;
    if (document.getElementById('tryon-modal').style.display === 'none') return; // closed
    try {
      const r = await fetch('/api/tryon/' + encodeURIComponent(job.jobId));
      const next = await r.json();
      if (!r.ok) { _showTryOnError(next.error || 'Try-on failed. Please try again.'); return; }
      _handleTryOnJob(next);
    } catch (_) {
      _showTryOnError('Connection error. Please try again.');
    }
  }, 2500);
}

function _openTryOnModal(title) {
  document.getElementById('tryon-modal-title').textContent = title || 'Virtual Try-On';
  document.getElementById('tryon-choose').style.display   = 'none';
  document.getElementById('tryon-loading').style.display  = 'block';
  document.getElementById('tryon-result').style.display   = 'none';
  document.getElementById('tryon-error').style.display    = 'none';
  document.getElementById('tryon-status-text').textContent = 'Starting AI model…';
  document.getElementById('tryon-modal').style.display = 'flex';
  _showPhotoUsed();
  if (!state.tryonPhoto && state.currentUser) loadTryonPhoto().then(_showPhotoUsed);
  lucide.createIcons();
}

// Shows which saved photo the try-on is using
function _showPhotoUsed() {
  const box = document.getElementById('tryon-photo-used');
  if (!box) return;
  if (state.tryonPhoto) document.getElementById('tryon-photo-thumb').src = state.tryonPhoto;
  box.style.display = state.tryonPhoto ? 'inline-flex' : 'none';
}

function closeTryOnModal() {
  document.getElementById('tryon-modal').style.display = 'none';
  if (_tryonPollTimer) { clearTimeout(_tryonPollTimer); _tryonPollTimer = null; }
}

function _showTryOnError(msg) {
  document.getElementById('tryon-choose').style.display  = 'none';
  document.getElementById('tryon-loading').style.display = 'none';
  document.getElementById('tryon-error').style.display   = 'block';
  document.getElementById('tryon-error-text').textContent = msg;
  lucide.createIcons();
}

function tryonSaveImage() {
  const url = window._tryonLastUrl; if (!url) return;
  const a = document.createElement('a');
  const name = (_tryonCurrentProduct ? _tryonCurrentProduct.name : 'look').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  a.href = url; a.download = 'trendmallz-' + name + '.jpg';
  document.body.appendChild(a); a.click(); a.remove();
}

function tryonShopNow() {
  closeTryOnModal();
  if (_tryonCurrentProduct) openProductModal(_tryonCurrentProduct.id);
}

function handleTryOnPhotoUpload(evt) {
  const file = evt.target.files[0]; if (!file) return;
  evt.target.value = ''; // allow choosing the same file again
  if (!state.currentUser) { openAuthModal('login'); return; }
  document.getElementById('tryon-setup-modal').style.display = 'none';
  showToast('Saving photo…', 'info');

  const reader = new FileReader();
  reader.onload = (e) => {
    _saveTryonPhoto(e.target.result).then(ok => {
      if (!ok) return;
      showToast('Photo saved!', 'success');
      if (_tryonPendingIds) {
        const ids = _tryonPendingIds; _tryonPendingIds = null;
        setTimeout(() => startOutfitTryOn(ids), 300);
      }
    });
  };
  reader.readAsDataURL(file);
}

// SHA-256 of the original picture, so the same picture is recognised on any device.
// Resolves '' if the browser can't hash (the server then fingerprints the resized copy).
function _fingerprint(dataUrl) {
  try {
    if (!window.crypto || !crypto.subtle) return Promise.resolve('');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl))
      .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''))
      .catch(() => '');
  } catch (_) { return Promise.resolve(''); }
}

// Shrinks a photo to what the try-on model uses (it works at 864×1296) and saves it
// to the customer's account. Resolves true when saved.
function _saveTryonPhoto(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const max = 1400;
      let w = img.width, h = img.height;
      if (w > max || h > max) {
        if (w > h) { h = Math.round(h * max / w); w = max; }
        else       { w = Math.round(w * max / h); h = max; }
      }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // transparent PNGs would otherwise turn black as JPEG
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.85);

      _fingerprint(dataUrl).then(sourceHash => fetch('/api/tryon/photo', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: compressed, sourceHash }),
      }))
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) { showToast(data.error || 'Could not save your photo', 'error'); resolve(false); return; }
          state.tryonPhoto = compressed;
          if (document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
          resolve(true);
        })
        .catch(() => { showToast('Connection error. Please try again.', 'error'); resolve(false); });
    };
    img.onerror = () => { showToast('That file is not a photo we can read', 'error'); resolve(false); };
    img.src = dataUrl;
  });
}

// From a failed try-on: pick a new photo, then retry the same item
function tryonChangePhoto() {
  closeTryOnModal();
  _tryonPendingIds = _tryonCurrentIds.slice();
  document.getElementById('tryon-setup-modal').style.display = 'flex';
  lucide.createIcons();
}

// ── Hero Carousel ─────────────────────────────────────────────────────────
const HERO_IMAGES = [
  'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=1400&q=80', // fashion editorial
  'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1400&q=80', // runway
  'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=1400&q=80', // streetwear
  'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1400&q=80', // luxury fashion
  'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1400&q=80', // model editorial
];

function initHeroCarousel() {
  const wrap = document.getElementById('hero-carousel');
  if (!wrap) return;
  wrap.innerHTML = '';
  HERO_IMAGES.forEach((url, i) => {
    const slide = document.createElement('div');
    slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
    slide.style.backgroundImage = `url('${url}')`;
    wrap.appendChild(slide);
  });

  let current = 0;
  setInterval(() => {
    const slides = wrap.querySelectorAll('.hero-slide');
    slides[current].classList.remove('active');
    slides[current].classList.add('leaving');
    setTimeout(() => slides[current].classList.remove('leaving'), 1400);
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }, 5000);
}

document.addEventListener('DOMContentLoaded', async () => {
  initSignupCountryDefault();
  await loadSnapConfig();
  _handleSnapCallback();
  initHeroCarousel();
  loadProductsFromAPI();
  loadBrandsFromAPI();
  initBrandSpotlight();
  initCountUp();
  loadCategoryImages();
  lucide.createIcons();
  // Show demo-account shortcuts only when the server has them enabled
  fetch('/api/config').then(function(r){return r.json();}).then(function(cfg){
    if(cfg.demoAccounts) document.getElementById('demo-accounts').classList.remove('hidden');
  }).catch(function(){});
  // Restore server session on page load
  fetch('/api/auth/me').then(function(r){return r.json();}).then(function(res){
    if(res.user && !state.currentUser){ loginUser(res.user); }
  }).catch(function(){});
});

// ── Stats count-up animation ──────────────────────────────────────────────────
function initCountUp() {
  const els = document.querySelectorAll('.stat-num');
  if (!els.length) return;

  function runCountUp(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const target   = parseInt(el.dataset.target, 10);
    const prefix   = el.dataset.prefix || '';
    const divisor  = parseFloat(el.dataset.displayDivisor) || 1;
    const suffix   = el.dataset.displaySuffix || el.dataset.suffix || '';
    const duration = 1800;
    const start    = performance.now();
    const step = (now) => {
      const p    = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(ease * target / divisor) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) runCountUp(entry.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  els.forEach(el => observer.observe(el));
}

// ── Category images — load from local folders, crossfade if multiple ──────────
async function loadCategoryImages() {
  const categories = [
    { folder: 'streetwears',   imgId: 'cat-img-streetwear' },
    { folder: 'african-wear',  imgId: 'cat-img-african'    },
    { folder: 'evening-wear',  imgId: 'cat-img-evening'    },
    { folder: 'footwear',      imgId: 'cat-img-footwear'   },
  ];
  for (const cat of categories) {
    try {
      const res    = await fetch(`/api/category-images/${cat.folder}`);
      const images = await res.json();
      const imgEl  = document.getElementById(cat.imgId);
      if (!images.length || !imgEl) continue;
      imgEl.src = images[Math.floor(Math.random() * images.length)];
      if (images.length > 1) {
        let current = 0;
        setInterval(() => {
          imgEl.style.opacity = '0';
          setTimeout(() => {
            current = (current + 1) % images.length;
            imgEl.src = images[current];
            imgEl.style.opacity = '1';
          }, 600);
        }, 4000);
        imgEl.style.transition = 'opacity 0.6s ease';
      }
    } catch(e) { /* folder missing — keep picsum fallback */ }
  }
}

// ── Load products from /products/{Brand}/{Category}/ via API ─────────────────
async function loadProductsFromAPI() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.length) return;
    PRODUCTS = data;
    try { var _cp=JSON.parse(localStorage.getItem('tm_custom_products')||'[]'); _cp.forEach(function(c){if(!PRODUCTS.find(function(p){return p.id===c.id;})) PRODUCTS.push(c);}); } catch(_){}
    applyGenderOrder();
    renderHome();
    renderShopGrid();
  } catch(e) { console.error('Failed to load products:', e); }
}

// ── Load brands from /brands/ folder via API ─────────────────────────────────
async function loadBrandsFromAPI() {
  try {
    const res = await fetch('/api/brands');
    if (!res.ok) return;
    const urls = await res.json();
    if (!urls || !urls.length) return;

    BRANDS = urls.map(url => {
      const filename = url.split('/').pop();
      const name = filename
        .replace(/\.[^.]+$/, '')
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/\s+\d+\s*/g, ' ')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ').trim()
        .replace(/\b\w/g, c => c.toUpperCase());
      return { id: name.toLowerCase().replace(/\s+/g, '-'), name, img: url };
    });

    renderHomeBrands();
    renderBrandsPage();
  } catch(e) { console.error('Failed to load brands:', e); }
}

// ── Brand Spotlight — vendor section carousel ────────────────────────────────
const _vbs = { current: 0, imgTimer: null, twTimer: null };

async function initBrandSpotlight() {
  try {
    const res = await fetch('/api/brands');
    if (!res.ok) return;
    const brands = await res.json();
    if (!brands || brands.length === 0) return;

    // Derive readable names — strip extension, brackets like (2), lone numbers, then title-case
    const names = brands.map(url =>
      url.split('/').pop()
         .replace(/\.[^.]+$/, '')
         .replace(/\s*\([^)]*\)\s*/g, ' ')
         .replace(/\s+\d+\s*/g, ' ')
         .replace(/[-_]+/g, ' ')
         .replace(/\s+/g, ' ').trim()
         .replace(/\b\w/g, c => c.toUpperCase())
    );

    // ── Vendor section brand showcase ──────────────────────────────────────────
    const vImgs  = document.getElementById('vendor-brand-imgs');
    const vDots  = document.getElementById('vendor-brand-dots');
    const vRight = document.getElementById('vendor-brand-right');
    if (vImgs && vDots && vRight) {
      brands.forEach((url, i) => {
        const img = document.createElement('img');
        img.src = url; img.alt = names[i];
        img.className = 'brand-slide' + (i === 0 ? ' active' : '');
        vImgs.appendChild(img);

        const dot = document.createElement('div');
        dot.className = 'brand-dot' + (i === 0 ? ' active' : '');
        dot.addEventListener('click', () => _vbsSwitch(i, names));
        vDots.appendChild(dot);
      });

      vRight.style.display = 'flex';
      _vbsTypewriter(document.getElementById('vendor-brand-tw'), names, 0);
      if (brands.length > 1) {
        _vbs.imgTimer = setInterval(() => _vbsSwitch((_vbs.current + 1) % brands.length, names), 5300);
      }
    }
  } catch(_e) { console.error('Brand spotlight error:', _e); }
}

function _vbsSwitch(idx, names) {
  document.querySelectorAll('#vendor-brand-imgs .brand-slide').forEach((s, i) => s.classList.toggle('active', i === idx));
  document.querySelectorAll('#vendor-brand-dots .brand-dot').forEach((d, i)  => d.classList.toggle('active',  i === idx));
  _vbs.current = idx;
  clearTimeout(_vbs.twTimer);
  const el = document.getElementById('vendor-brand-tw');
  if (el) { el.textContent = ''; _vbsTypewriter(el, names, idx); }
}

function _vbsTypewriter(el, names, startIdx) {
  if (!el || !names.length) return;
  let ni = startIdx, ci = 0, deleting = false;
  function tick() {
    const name = names[ni];
    if (!deleting) {
      el.textContent = name.slice(0, ci + 1); ci++;
      if (ci >= name.length) { deleting = true; _vbs.twTimer = setTimeout(tick, 2400); return; }
    } else {
      el.textContent = name.slice(0, ci); ci--;
      if (ci < 0) {
        deleting = false; ni = (ni + 1) % names.length; ci = 0;
        _vbsSwitch(ni, names); _vbs.twTimer = setTimeout(tick, 380); return;
      }
    }
    _vbs.twTimer = setTimeout(tick, deleting ? 36 : 72);
  }
  tick();
}

function _handleSnapCallback() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('snap_connected');
  const snapErr   = params.get('snap_error');
  if (!connected && !snapErr) return;

  // Clean the address bar straight away
  window.history.replaceState({}, '', '/');

  if (snapErr) {
    const snapErrMessages = {
      config_missing:   'Snapchat connection is not set up on this site yet.',
      login_required:   'Sign in to TrendMallz first, then connect Snapchat.',
      access_denied:    'You cancelled the Snapchat connection.',
      invalid_state:    'That took too long. Please try connecting Snapchat again.',
      token_exchange:   'Snapchat sign-in failed. Please try again.',
      no_access_token:  'Snapchat sign-in failed. Please try again.',
      identity_fetch:   'Could not read your Snapchat profile. Please try again.',
      no_bitmoji:       "Snapchat didn't share a Bitmoji. Create one in Snapchat and allow access to it, then try again.",
      auth_failed:      'Could not connect Snapchat. Please try again.',
    };
    setTimeout(() => showToast(snapErrMessages[snapErr] || 'Could not connect Snapchat. Please try again.', snapErr === 'config_missing' || snapErr === 'access_denied' ? 'info' : 'error'), 400);
    return;
  }

  // The Bitmoji was saved on the account: reload the account to pick it up
  fetch('/api/auth/me').then(r => r.json()).then(res => {
    if (!res.user) return;
    state.currentUser = res.user;
    updateNavForUser(res.user);
    showToast(res.user.snapBitmoji ? 'Snapchat Bitmoji connected!' : 'Snapchat connected', 'success');
  }).catch(() => {});
}
