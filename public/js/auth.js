// ══ AUTH STATE ═══════════════════════════════════════════════════════
let _loggedIn    = false;
let _pendingPhone = null;

// ── Initialisation au chargement ─────────────────────────────────────
window.addEventListener('load', async () => {
  if (!_sb) { showPage('auth'); return; }

  _sb.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      _sbSession = session;
      const u    = session.user;
      currentUser = {
        displayName: u.user_metadata?.display_name || u.phone || u.email || 'Invité',
        uid:         u.id,
        phoneNumber: u.phone  || null,
        email:       u.email  || null,
      };
      afterLogin();
      const urlEid     = new URLSearchParams(window.location.search).get('event');
      const storageEid = localStorage.getItem('djr_eid');
      const targetEid  = urlEid || storageEid;
      if (targetEid && targetEid !== eid) {
        ename = localStorage.getItem('djr_ename') || ename;
        await loadEvent(targetEid);
      }
    } else if (event !== 'INITIAL_SESSION' && !_loggedIn) {
      showPage('auth');
    }
  });

  try {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) {
      const urlEid = new URLSearchParams(window.location.search).get('event');
      if (urlEid) { eid = urlEid; ename = localStorage.getItem('djr_ename') || ename; }
      showPage('auth');
    }
  } catch(e) { showPage('auth'); }
});

// ── Après connexion réussie ───────────────────────────────────────────
function afterLogin() {
  _loggedIn = true;
  const name = currentUser?.displayName || currentUser?.phoneNumber || 'Invité';
  const init = name[0]?.toUpperCase() || '🎵';
  const avEl = document.getElementById('prof-av'); if (avEl) avEl.textContent = init;
  document.getElementById('prof-name').textContent = name;
  const subEl = document.getElementById('prof-sub'); if (subEl) subEl.textContent = currentUser?.phoneNumber || currentUser?.email || '';
  document.getElementById('bottom-nav').classList.add('show');
  renderProfile();
  showPage('client');
  renderAll();
  setTimeout(() => {
    initChat();
    loadDemoChat();
    initReportsListener();
    const miniQR = document.getElementById('club-qr-mini');
    if (miniQR) {
      miniQR.innerHTML = '';
      const base = window.location.href.split('?')[0];
      const url  = eid ? base + '?event=' + eid : base;
      try { new QRCode(miniQR, {text:url, width:56, height:56, colorDark:'#1D1D1F', colorLight:'#ffffff'}); } catch(e) {}
    }
  }, 600);
}

// ── Google OAuth ──────────────────────────────────────────────────────
async function signInGoogle() {
  if (!_sb) { demoLogin(); return; }
  try {
    const { data, error } = await _sb.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo: window.location.href, skipBrowserRedirect: true },
    });
    if (error || !data?.url) { demoLogin(); return; }
    window.location.href = data.url;
  } catch(e) { demoLogin(); }
}

// ── SMS / OTP ─────────────────────────────────────────────────────────
async function sendSMS() {
  const cc  = document.getElementById('cc').value;
  const num = document.getElementById('phone-inp').value.replace(/\s/g, '');
  if (num.length < 9) { setErr('Numéro invalide'); return; }
  const full = cc + (num.startsWith('0') ? num.slice(1) : num);
  _pendingPhone = full;
  document.getElementById('otp-num').textContent = cc + ' ' + document.getElementById('phone-inp').value;
  if (!_sb) { _pendingPhone = '__demo__'; toast('📱 SMS simulé — entrez 123456'); showOTP(); return; }
  try {
    const { error } = await _sb.auth.signInWithOtp({ phone: full });
    if (error) throw error;
    showOTP(); toast('📱 Code envoyé !');
  } catch(e) {
    _pendingPhone = '__demo__';
    toast('📱 SMS simulé — entrez 123456');
    showOTP();
  }
}

async function verifyOTP() {
  const code = [...document.querySelectorAll('.otp-b')].map(b => b.value).join('');
  if (code.length < 6) { setErr('Entrez les 6 chiffres'); return; }
  if (_pendingPhone === '__demo__') { demoVerify(code); return; }
  try {
    const { error } = await _sb.auth.verifyOtp({ phone: _pendingPhone, token: code, type: 'sms' });
    if (error) throw error;
  } catch(e) {
    setErr('Code incorrect');
    document.querySelectorAll('.otp-b').forEach(b => { b.value = ''; b.classList.remove('filled'); });
    document.querySelectorAll('.otp-b')[0].focus();
  }
}

function phoneAction() { if (!otpPhase) sendSMS(); else verifyOTP(); }

function showOTP() {
  otpPhase = true;
  document.getElementById('otp-wrap').classList.add('show');
  document.getElementById('phone-inp').disabled = true;
  document.getElementById('phone-btn-txt').textContent = 'Confirmer le code';
  document.querySelectorAll('.otp-b')[0].focus();
  startResendTimer();
}
function backToPhone() {
  otpPhase = false; confirmResult = null;
  document.getElementById('otp-wrap').classList.remove('show');
  document.getElementById('phone-inp').disabled = false;
  document.getElementById('phone-btn-txt').textContent = 'Recevoir le code SMS';
  document.querySelectorAll('.otp-b').forEach(b => { b.value = ''; b.classList.remove('filled'); });
  clearInterval(resendTimer); setErr('');
}
function startResendTimer() {
  resendCD = 30;
  const b = document.getElementById('resend-btn');
  const t = document.getElementById('rtimer');
  b.disabled = true; clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    resendCD--; t.textContent = resendCD;
    if (resendCD <= 0) { clearInterval(resendTimer); b.disabled = false; b.textContent = 'Renvoyer le code'; }
  }, 1000);
}
function resendSMS() { backToPhone(); sendSMS(); }
function fmtPhone(inp) { let v = inp.value.replace(/\D/g,''); if (v.length>1) v=v.replace(/(\d{2})(?=\d)/g,'$1 ').trim(); inp.value=v; setErr(''); }
function otpIn(el, idx) {
  const v = el.value.replace(/\D/g,''); el.value=v; el.classList.toggle('filled', v.length>0);
  if (v && idx < 5) document.querySelectorAll('.otp-b')[idx+1].focus();
  if ([...document.querySelectorAll('.otp-b')].every(b => b.value)) verifyOTP();
}
function otpKey(e, idx) {
  if (e.key === 'Backspace' && !e.target.value && idx > 0) {
    const bs = document.querySelectorAll('.otp-b'); bs[idx-1].value=''; bs[idx-1].classList.remove('filled'); bs[idx-1].focus();
  }
}

// ── Invité / Démo ─────────────────────────────────────────────────────
async function guestLogin() { demoLogin(); }

async function demoLogin() {
  currentUser = {displayName:'Invité', uid:'demo'};
  afterLogin();
  const urlEid    = new URLSearchParams(window.location.search).get('event');
  const targetEid = urlEid || localStorage.getItem('djr_eid');
  if (targetEid) {
    try {
      const ev = await api('GET', '/events/' + targetEid);
      eid = ev.id; ename = ev.name;
      const ps = await api('GET', '/proposals/' + eid);
      proposals = Object.fromEntries(ps.map(x => [x.id, x]));
      const np = await api('GET', '/now-playing/' + eid);
      if (np?.title) nowPlaying = {t: np.title, a: np.artist || ''};
      renderAll();
      subscribeToEvent(eid);
    } catch(e) {}
  }
}

function demoVerify(code) {
  if (code === '123456' || code.length === 6) { currentUser = {displayName:'Invité', uid:'demo'}; afterLogin(); }
  else setErr('Code incorrect (démo: 123456)');
}

function setErr(msg) { const e = document.getElementById('auth-err'); if (e) e.textContent = msg; }

// ── DJ Login ──────────────────────────────────────────────────────────
async function djLogin() {
  const n   = document.getElementById('dj-ev-name').value.trim();
  const p   = document.getElementById('dj-pwd').value;
  const err = document.getElementById('dj-err');
  if (!n) { err.textContent = 'Saisissez un nom de soirée'; return; }
  if (!p) { err.textContent = 'Mot de passe requis'; return; }
  err.textContent = '';
  try {
    if (eid) {
      await api('POST', '/events/' + eid + '/auth', {password: p});
    } else {
      const ev = await api('POST', '/events', {name: n, password: p});
      eid = ev.id; localStorage.setItem('djr_eid', eid); localStorage.setItem('djr_ename', n);
      subscribeToEvent(eid);
    }
    _activateDJ(n, p);
  } catch(e) {
    if (p === DJ_PWD) { _activateDJ(n, p); toast('🎛️ Mode DJ démo'); }
    else              { err.textContent = e.message || 'Mot de passe incorrect'; }
  }
}

function _activateDJ(n, p) {
  ename = n; djLoggedIn = true; _djPassword = p;
  document.getElementById('nav-dj').onclick = () => navTo('dj');
  document.querySelector('#nav-dj .nav-tab-ico').textContent = '🎛️';
  document.querySelector('#nav-dj .nav-tab-lbl').textContent = 'DJ';
  showPage('dj'); renderAll(); generateQR();
}

// ── Mode démo (données fictives) ──────────────────────────────────────
function demoMode() {
  nowPlaying = {t:'Strobe', a:'Deadmau5'};
  proposals  = {
    bl:  {id:'bl',  votes:24, approved:true},
    omt: {id:'omt', votes:17, approved:true},
    ti:  {id:'ti',  votes:12, approved:true},
    lv:  {id:'lv',  votes:8,  approved:true},
    wu:  {id:'wu',  votes:5,  approved:true},
  };
  currentUser = {displayName:'Invité Démo', phoneNumber:null, uid:'demo', photoURL:null};
  afterLogin();
  toast('🎮 Mode démo — connexion requise pour voter');
}
