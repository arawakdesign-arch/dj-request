// ══ AUTH STATE ═══════════════════════════════════════════════════════
let _loggedIn          = false;
let _pendingPhone      = null;
let _authToken         = null;   // JWT interne (backend propre)

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

  // Écran TV appairé par QR (?screen=1) — jamais de restauration de session,
  // un nouveau code de pairing est demandé à chaque chargement de page.
  if (new URLSearchParams(window.location.search).get('screen')) {
    await startScreenPairing();
    return;
  }

  // Lien de pairing scanné depuis l'écran d'une TV (?pair=CODE) — mémorisé tout de
  // suite car _activateDJ() réécrit l'URL (history.replaceState) une fois connecté.
  const pairCode = new URLSearchParams(window.location.search).get('pair');
  if (pairCode) sessionStorage.setItem('djr_pending_pair_code', pairCode);

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
          if (sessionStorage.getItem('djr_pending_create_intent')) {
            sessionStorage.removeItem('djr_pending_create_intent');
            showPage('dj-login');
            _djLoginShowCreate(); // le formulaire nom/mot de passe apparaît, currentUser.email est maintenant renseigné
          } else if (eid) {
            await loadEvent(eid).catch(() => {});
          }
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

// ── Écran TV — appairage par QR ─────────────────────────────────────────
// Demande un code éphémère au serveur, l'affiche en QR + en clair, puis
// s'abonne en Realtime sur ce code exact (même idiome que subscribeToEvent
// dans api.js) pour basculer sur l'affichage Écran Géant dès qu'un
// organisateur l'associe à sa soirée depuis son téléphone.
async function startScreenPairing() {
  showPage('screen-pairing');
  const codeEl = document.getElementById('pair-code');
  try {
    const res = await fetch('/api/screen/pairings', { method: 'POST' });
    if (!res.ok) throw new Error('Création du code impossible');
    const { code } = await res.json();
    codeEl.textContent = code;

    const qrEl = document.getElementById('pair-qr');
    qrEl.innerHTML = '';
    const pairUrl = window.location.origin + '/?pair=' + code;
    try { new QRCode(qrEl, { text: pairUrl, width: 220, height: 220, colorDark: '#000', colorLight: '#fff' }); } catch(e) {}

    if (!_sb) return;
    _sb.channel('pairing:' + code)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'screen_pairings', filter: 'code=eq.' + code },
        async (payload) => {
          if (!payload.new?.event_id) return;
          eid = payload.new.event_id;
          showPage('bigscreen');
          // showPage('bigscreen') a déjà appelé generateQR()/renderBS() avec l'état
          // précédent (eid pas encore chargé) — on les rappelle une fois les vraies
          // données en place, même séquence que _activateDJ() (auth.js).
          await loadEvent(eid).catch(() => {});
          generateQR(eid);
          renderBS();
          loadChatHistory(); // charge tout l'historique du chat, pas seulement les messages à venir
        })
      .subscribe();
  } catch(e) {
    codeEl.textContent = 'Erreur';
  }
}

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

  // Un code de pairing écran attend, mais cette session n'est pas organisateur.
  // Si le compte connecté est propriétaire d'une soirée (owner_id), on
  // s'authentifie directement dessus — pas besoin de retaper le mot de passe.
  // Sinon (invité, staff sans compte propriétaire...) on retombe sur l'écran
  // de connexion organisateur classique (nom + mot de passe).
  if (sessionStorage.getItem('djr_pending_pair_code') && !djLoggedIn) {
    _tryAutoClaimViaOwnership().then(claimed => {
      if (!claimed) { showPage('dj-login'); _djLoginShowChoice(); }
    });
  }
}

// ── Auto-association écran via la propriété du compte (sans mot de passe) ──
async function _tryAutoClaimViaOwnership() {
  try {
    const events = await api('GET', '/events/mine');
    if (events.length !== 1) return false; // 0 → pas propriétaire ; plusieurs → ambigu, on laisse choisir à la main
    const ev = events[0];
    const res = await api('POST', '/events/' + ev.id + '/admin-token');
    if (!res.token) return false;
    saveToken(res.token);
    eid = ev.id; ename = ev.name;
    localStorage.setItem('djr_eid', eid);
    localStorage.setItem('djr_ename', ename);
    await _activateDJ(ename, null); // déclenche _tryClaimPendingScreenPair() en sortie
    return true;
  } catch(e) { return false; }
}

// ── Association d'un écran en attente (?pair=CODE) ──────────────────────
function _confirmScreenPair() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:1.5rem';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:1.5rem;max-width:320px;width:100%;text-align:center;box-shadow:var(--shadow)">
        <div style="font-size:1.6rem;margin-bottom:.5rem">📺</div>
        <div style="font-weight:700;font-size:.95rem;color:var(--tx);margin-bottom:.3rem">Associer cet écran ?</div>
        <div style="font-size:.8rem;color:var(--tx3);margin-bottom:1.1rem">L'écran scanné affichera le classement en direct de « ${ename} ».</div>
        <button id="pair-confirm-yes" class="btn-g" style="margin-bottom:.5rem">Associer</button>
        <button id="pair-confirm-no" style="background:none;border:none;color:var(--tx4);font-size:.8rem;width:100%">Annuler</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#pair-confirm-yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#pair-confirm-no').onclick  = () => { overlay.remove(); resolve(false); };
  });
}

async function _tryClaimPendingScreenPair() {
  const code = sessionStorage.getItem('djr_pending_pair_code');
  if (!code || !djLoggedIn) return;
  sessionStorage.removeItem('djr_pending_pair_code');

  const ok = await _confirmScreenPair();
  if (!ok) return;
  try {
    const res  = await fetch('/api/screen/pairings/' + encodeURIComponent(code) + '/claim', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _authToken },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Association impossible');
    toast('📺 Écran associé !');
  } catch(e) {
    toast('⚠️ ' + (e.message || 'Association impossible'));
  }
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

// ── Espace Organisateur — navigation entre les 2 accès ─────────────────
function _djLoginShowChoice() {
  document.getElementById('dj-choice').style.display      = 'block';
  document.getElementById('dj-join-form').style.display   = 'none';
  document.getElementById('dj-create-flow').style.display = 'none';
}
function _djLoginShowJoin() {
  document.getElementById('dj-choice').style.display      = 'none';
  document.getElementById('dj-join-form').style.display   = 'block';
  document.getElementById('dj-create-flow').style.display = 'none';
  document.getElementById('dj-err').textContent = '';
}
function _djLoginShowCreate() {
  document.getElementById('dj-choice').style.display      = 'none';
  document.getElementById('dj-join-form').style.display   = 'none';
  document.getElementById('dj-create-flow').style.display = 'block';
  document.getElementById('dj-create-err').textContent = '';
  _djCreateSyncGoogleState();
}
// Le formulaire nom/mot de passe n'apparaît qu'une fois connecté en Google
function _djCreateSyncGoogleState() {
  const authed = !!currentUser?.email;
  document.getElementById('dj-create-google').style.display = authed ? 'none'  : 'block';
  document.getElementById('dj-create-form').style.display   = authed ? 'block' : 'none';
}
function _djLoginBack() {
  const onSubView = document.getElementById('dj-join-form').style.display   === 'block'
                 || document.getElementById('dj-create-flow').style.display === 'block';
  if (onSubView) { _djLoginShowChoice(); return; }
  showPage('auth');
}

function _djCreateSignInGoogle() {
  // Une session invité/téléphone déjà stockée empêcherait sinon la restauration de la
  // session Google au retour d'OAuth (window.addEventListener('load') la restaurerait
  // en priorité, cf. étape 1 plus haut).
  clearToken();
  // Revenir sur l'étape "créer" de l'Espace Organisateur au retour d'OAuth (cf. onAuthStateChange)
  sessionStorage.setItem('djr_pending_create_intent', '1');
  signInGoogle();
}

// ── Rejoindre une soirée existante — nom + mot de passe uniquement ─────
async function djJoin() {
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

    if (!found) {
      err.textContent = `Soirée « ${n} » introuvable — vérifiez le nom, ou créez-la via "Créer une nouvelle soirée".`;
      return;
    }

    // Soirée trouvée → tester le mot de passe (lève une erreur si incorrect)
    eid = found.id;
    const authRes2 = await api('POST', '/events/' + eid + '/auth', { password: p });
    if (authRes2.token) saveToken(authRes2.token);
    toastMsg = `✅ Soirée "${n}" retrouvée !`;

    localStorage.setItem('djr_eid',   eid);
    localStorage.setItem('djr_ename', n);
    // subscribeToEvent est appelé par loadEvent() dans _activateDJ() — pas de doublon ici
    await _activateDJ(n, p);
    toast(toastMsg);
  } catch(e) {
    err.textContent = e.message || 'Mot de passe incorrect.';
  }
}

// ── Créer une nouvelle soirée — connexion Google déjà acquise à ce stade ──
async function djCreateSubmit() {
  const n   = document.getElementById('dj-create-name').value.trim();
  const p   = document.getElementById('dj-create-pwd').value;
  const err = document.getElementById('dj-create-err');
  if (!n) { err.textContent = '⚠️ Saisissez un nom de soirée.'; return; }
  if (!p) { err.textContent = '⚠️ Mot de passe requis.'; return; }
  err.textContent = '';
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
    if (e.message === 'Non authentifié' || e.message === 'Connecte-toi avec un compte Google autorisé pour créer une soirée.') {
      // Session Google expirée entre l'ouverture du formulaire et l'envoi → revenir à l'étape connexion
      _djCreateSyncGoogleState();
      err.textContent = 'Ta session a expiré — reconnecte-toi avec Google.';
      return;
    }
    err.textContent = e.message || 'Erreur lors de la création.';
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
  _tryClaimPendingScreenPair();
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
