// ══ AUTH STATE ═══════════════════════════════════════════════════════
let _loggedIn          = false;
let _pendingPhone      = null;
let _authToken         = null;   // JWT interne (backend propre)
let _pendingCreateName    = null; // nom de soirée en attente de confirmation création
let _cancelCreateListener = null; // référence pour supprimer l'écouteur de changement de nom

// ── Sauvegarde / restauration du token ───────────────────────────────
function saveToken(token) {
  _authToken = token;
  localStorage.setItem('djr_token', token);
}
function loadToken() {
  const t = localStorage.getItem('djr_token');
  if (t) _authToken = t;
  return t;
}
function clearToken() {
  _authToken = null;
  localStorage.removeItem('djr_token');
}

// ── Initialisation au chargement ─────────────────────────────────────
window.addEventListener('load', async () => {
  await _configReady; // attendre que le client Supabase soit initialisé depuis /api/config/public
  const urlEid = new URLSearchParams(window.location.search).get('event');
  if (urlEid) {
    eid = urlEid;
  } else {
    eid = localStorage.getItem('djr_eid') || null;
  }
  // ename n'est jamais restauré depuis localStorage :
  // loadEvent() le définit depuis la DB, pas depuis le cache.

  // 1. Token backend sauvegardé (guest, téléphone, OAuth, organizer) → vérifier s'il est encore valide
  const saved = loadToken();
  if (saved) {
    try {
      const res = await api('GET', '/auth/me', null, { token: saved });
      const u   = res.user;
      _sbSession = { access_token: saved };
      currentUser = {
        displayName: u.displayName || u.phoneNumber || 'Invité',
        uid:         u.id,
        phoneNumber: u.phoneNumber || null,
        role:        u.role || 'user',
      };
      console.log('[pullup] restore token : role=', u.role, 'event_id=', u.event_id);
      if (u.role === 'organizer' && isValidUuid(u.event_id)) {
        // Restaurer session DJ : le JWT est la source d'autorité (propriétaire de l'événement)
        eid   = u.event_id;
        ename = u.displayName || '';
        console.log('[pullup] restauration session organizer : eid=', eid);
        await _activateDJ(ename, null);
      } else {
        afterLogin();
        if (eid) { await loadEvent(eid).catch(() => {}); }
      }
      return;
    } catch(e) { clearToken(); }
  }

  // 2. Session Supabase (Google OAuth callback, etc.)
  if (_sb) {
    try {
      _sb.auth.onAuthStateChange(async (event, session) => {
        if (session && !_loggedIn) {
          // Restaurer l'event ID préservé avant la redirection OAuth
          const savedEid = sessionStorage.getItem('djr_pre_oauth_eid');
          if (savedEid) { eid = savedEid; sessionStorage.removeItem('djr_pre_oauth_eid'); }
          _sbSession = session;
          const u   = session.user;
          currentUser = {
            displayName: u.user_metadata?.display_name || u.phone || u.email || 'Invité',
            uid:         u.id,
            phoneNumber: u.phone  || null,
            email:       u.email  || null,
          };
          afterLogin();
          if (eid) await loadEvent(eid).catch(() => {});
          // Nettoyer le hash OAuth ; conserver ou rétablir le paramètre ?event=
          if (window.location.hash) {
            history.replaceState(null, '', eid ? buildEventUrl(eid) : (window.location.pathname + window.location.search));
          }
        } else if (event !== 'INITIAL_SESSION' && !_loggedIn) {
          showPage('auth');
        }
      });
      const { data: { session } } = await _sb.auth.getSession();
      if (session) return; // onAuthStateChange gère la suite
    } catch(e) {}
  }

  // 3. Pas de session → page d'auth
  showPage('auth');
});

// ── Après connexion réussie ───────────────────────────────────────────
function afterLogin() {
  _loggedIn = true;
  const subEl = document.getElementById('prof-sub'); if (subEl) subEl.textContent = currentUser?.phoneNumber || currentUser?.email || '';
  renderProfile();
  showPage('client');
  renderAll();
  applyProfileToUI(); // initiale / photo dès la connexion (localStorage si présent, sinon fallback sur le nom du compte)
  loadRemoteProfile(); // le serveur fait autorité — écrase le cache local si le profil a été modifié ailleurs
  loadDjProfile();
  loadFlyerFromStorage();
  setTimeout(loadProfileStats, 1000); // charge les vraies stats en arrière-plan
  setTimeout(() => {
    initChat();
    initReportsListener();
  }, 600);
}

// ── Google OAuth ──────────────────────────────────────────────────────
async function signInGoogle() {
  if (!_sb) { setErr('Service d\'authentification non disponible.'); return; }
  try {
    // Préserver l'event ID avant la redirection OAuth (page rechargée)
    if (eid) sessionStorage.setItem('djr_pre_oauth_eid', eid);
    const redirectTo = window.location.origin + '/';
    const { data, error } = await _sb.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo, skipBrowserRedirect: true },
    });
    if (error) { setErr('Connexion Google impossible : ' + (error.message || 'erreur inconnue')); return; }
    if (!data?.url) { setErr('Connexion Google impossible : URL de redirection manquante.'); return; }
    window.location.href = data.url;
  } catch(e) {
    setErr('Connexion Google impossible : ' + (e.message || 'erreur réseau'));
  }
}

// ── SMS / OTP — Supabase Phone OTP natif (Twilio) ────────────────────
function toE164(cc, raw) {
  const digits = raw.replace(/[\s\-\(\)\.]/g, '');
  if (!/^\d{7,15}$/.test(digits)) return null;
  return cc + (digits.startsWith('0') ? digits.slice(1) : digits);
}

async function sendSMS() {
  if (!_sb) { setErr('Service d\'authentification non disponible.'); return; }
  const cc  = document.getElementById('cc').value;
  const raw = document.getElementById('phone-inp').value;
  const full = toE164(cc, raw);
  if (!full) { setErr('Numéro invalide — vérifiez le format.'); return; }
  _pendingPhone = full;
  document.getElementById('otp-num').textContent = full;
  try {
    const { error } = await _sb.auth.signInWithOtp({ phone: full });
    if (error) { setErr(error.message || 'Erreur envoi SMS'); return; }
    showOTP();
    toast('📱 Code envoyé !');
  } catch(e) {
    setErr(e.message || 'Erreur envoi SMS');
  }
}

async function verifyOTP() {
  const code = [...document.querySelectorAll('.otp-b')].map(b => b.value).join('');
  if (code.length < 6) { setErr('Entrez les 6 chiffres'); return; }
  try {
    const { error } = await _sb.auth.verifyOtp({
      phone: _pendingPhone,
      token: code,
      type:  'sms',
    });
    if (error) throw error;
    // Succès → onAuthStateChange (SIGNED_IN) finalise la connexion
  } catch(e) {
    setErr(e.message || 'Code incorrect');
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
  otpPhase = false;
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
function resendSMS()   { backToPhone(); sendSMS(); }
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

// ── Invité — via backend ──────────────────────────────────────────────
async function guestLogin() {
  try {
    const res = await api('POST', '/auth/guest');
    saveToken(res.token); // persisté en localStorage — survivre au refresh
    _authToken  = res.token;
    _sbSession  = { access_token: res.token };
    currentUser = { displayName: 'Invité', uid: res.user.id, role: 'guest' };
    afterLogin();
    if (eid) loadEvent(eid).catch(() => {});
  } catch(e) {
    currentUser = { displayName: 'Invité', uid: 'local_' + Date.now() };
    afterLogin();
  }
}

function setErr(msg) { const e = document.getElementById('auth-err'); if (e) e.textContent = msg; }

// ── Confirmation création soirée ──────────────────────────────────────
function _showCreateConfirm(n, err) {
  // Supprimer l'écouteur précédent si djLogin() est rappelé avant confirmation
  const nameEl = document.getElementById('dj-ev-name');
  if (_cancelCreateListener) {
    nameEl.removeEventListener('input', _cancelCreateListener);
    _cancelCreateListener = null;
  }
  _pendingCreateName = n;

  const span = document.createElement('span');
  span.textContent = `La soirée « ${n} » n'existe pas.`;

  const btn = document.createElement('button');
  btn.textContent = '🎉 Créer cette soirée';
  btn.style.cssText = 'margin-top:.5rem;display:block;width:100%;padding:.5rem;background:#7C3AED;color:#fff;border:none;border-radius:.65rem;font-size:.85rem;font-weight:600;cursor:pointer';
  btn.onclick = confirmCreateEvent;

  err.innerHTML = '';
  err.appendChild(span);
  err.appendChild(btn);

  // Annuler automatiquement si l'utilisateur modifie le nom
  const cancel = () => {
    _pendingCreateName    = null;
    _cancelCreateListener = null;
    err.innerHTML = '';
    nameEl.removeEventListener('input', cancel);
  };
  _cancelCreateListener = cancel;
  nameEl.addEventListener('input', cancel);
}

async function confirmCreateEvent() {
  const n   = _pendingCreateName;
  const p   = document.getElementById('dj-pwd')?.value;
  const err = document.getElementById('dj-err');
  if (!n || !p) return;
  _pendingCreateName    = null;
  _cancelCreateListener = null;
  if (err) err.innerHTML = '';
  try {
    const ev = await api('POST', '/events', { name: n, password: p });
    eid = ev.id;
    localStorage.setItem('djr_eid',   eid);
    localStorage.setItem('djr_ename', n);
    // Obtenir le token organizer immédiatement après création pour survivre au refresh
    const authRes = await api('POST', '/events/' + eid + '/auth', { password: p });
    if (authRes.token) saveToken(authRes.token);
    // subscribeToEvent est appelé par loadEvent() dans _activateDJ() — pas de doublon ici
    await _activateDJ(n, p);
    toast(`🎉 Soirée "${n}" créée !`);
  } catch(e) {
    if (err) err.textContent = e.message === 'Non authentifié'
      ? '⚠️ Connecte-toi (Google) avant de créer une soirée.'
      : (e.message || 'Erreur lors de la création.');
  }
}

// ── DJ Login ──────────────────────────────────────────────────────────
async function djLogin() {
  const n   = document.getElementById('dj-ev-name').value.trim();
  const p   = document.getElementById('dj-pwd').value;
  const err = document.getElementById('dj-err');
  if (!n) { err.textContent = '⚠️ Saisissez un nom de soirée.'; return; }
  if (!p) { err.textContent = '⚠️ Mot de passe requis.'; return; }
  err.textContent = '';
  try {
    const storedName = localStorage.getItem('djr_ename') || '';
    let toastMsg;

    // 1. eid connu + même nom → tenter auth par ID.
    //    Si l'eid est obsolète (event supprimé, autre projet) → basculer sur lookup.
    if (eid && n === storedName) {
      try {
        const authRes = await api('POST', '/events/' + eid + '/auth', { password: p });
        if (authRes.token) saveToken(authRes.token);
        toastMsg = `✅ Accès accordé — "${n}"`;
        await _activateDJ(n, p);
        toast(toastMsg);
        return;
      } catch(e) {
        // Mauvais mot de passe → remonter l'erreur directement, pas de lookup
        if (e.message !== 'Événement introuvable') throw e;
        // eid obsolète → on continue avec le lookup par nom
        eid = null;
        localStorage.removeItem('djr_eid');
      }
    }

    // 2. Lookup par nom (eid absent, nom différent, ou eid obsolète)
    eid = null;
    let found = null;
    try { found = await api('GET', '/events/by-name?name=' + encodeURIComponent(n)); } catch(_) {}

    if (found) {
      // Soirée trouvée → tester le mot de passe (lève une erreur si incorrect)
      eid = found.id;
      const authRes2 = await api('POST', '/events/' + eid + '/auth', { password: p });
      if (authRes2.token) saveToken(authRes2.token);
      toastMsg = `✅ Soirée "${n}" retrouvée !`;
    } else {
      // Soirée inexistante → afficher le bloc de confirmation explicite
      _showCreateConfirm(n, err);
      return;
    }

    localStorage.setItem('djr_eid',   eid);
    localStorage.setItem('djr_ename', n);
    // subscribeToEvent est appelé par loadEvent() dans _activateDJ() — pas de doublon ici
    await _activateDJ(n, p);
    toast(toastMsg);
  } catch(e) {
    err.textContent = e.message || 'Mot de passe incorrect.';
  }
}

async function _activateDJ(n, p) {
  console.log('[pullup] _activateDJ() entrée : eid=', eid, 'n=', n);
  ename = n; djLoggedIn = true; _djPassword = p;
  document.getElementById('nav-dj').onclick = () => navTo('dj');
  document.querySelector('#nav-dj .nav-tab-ico').textContent = '🎛️';
  document.querySelector('#nav-dj .nav-tab-lbl').textContent = 'DJ';
  showPage('dj'); renderAll();
  // showPage('dj') déclenche generateQR() via app.js:37 — QR immédiat avec l'eid courant
  if (eid) {
    const preEid = eid;
    console.log('[pullup] _activateDJ() snapshot preEid=', preEid, '— appel loadEvent()');
    // loadEvent() gère ses propres erreurs : elle résout toujours, même en cas d'échec.
    // Si son catch interne a mis eid à null, le .catch() externe ne se déclenche JAMAIS.
    // → Vérifier eid après l'await avec isValidUuid(), pas seulement dans .catch().
    await loadEvent(eid);
    console.log('[pullup] _activateDJ() après loadEvent : eid=', eid, '| preEid=', preEid);
    if (!isValidUuid(eid) && isValidUuid(preEid)) {
      console.warn('[pullup] _activateDJ() : eid effacé par loadEvent — restauration depuis preEid=', preEid);
      eid = preEid;
    }
    const activeEid = eid;
    const publicUrl = buildEventUrl(activeEid);
    console.log('[pullup] _activateDJ() activeEid final=', activeEid, '| URL=', publicUrl);
    history.replaceState(null, '', publicUrl);
    generateQR(activeEid);
  }
}

// ── Déconnexion ───────────────────────────────────────────────────────
function logout() {
  clearToken();
  _loggedIn   = false;
  djLoggedIn  = false;
  _djPassword = null;
  currentUser = null;
  _sbSession  = null;
  if (_sb) _sb.auth.signOut().catch(() => {});
  showPage('auth');
  closeTopMenu();
}
