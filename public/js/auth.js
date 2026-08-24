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

  // Écran TV appairé par QR (/tv ou ?screen=1 pour compat) — jamais de
  // restauration de session, un nouveau code de pairing est demandé à
  // chaque chargement de page.
  const _screenPath = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (_screenPath === 'tv' || new URLSearchParams(window.location.search).get('screen')) {
    await startScreenPairing();
    return;
  }

  // Page publique organisateur (pull-up.live/mon-club) — un seul segment de
  // chemin, aucun des fichiers statiques connus. Si aucune page ne correspond
  // au slug, on laisse tomber sur le flux normal (auth/vote) plutôt que 404.
  const pathSlug = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const reserved = ['', 'tv', 'cgu.html', 'confidentialite.html'];
  if (pathSlug && !reserved.includes(pathSlug) && !/^(images|js|css|api)\//.test(pathSlug) && !pathSlug.includes('.')) {
    if (await tryShowOrgaPublicPage(pathSlug)) return;
  }

  const urlEid = new URLSearchParams(window.location.search).get('event');
  if (urlEid) {
    if (isValidUuid(urlEid)) {
      eid = urlEid;
    } else {
      // Lien court partagé avec le nom de la soirée plutôt que l'UUID technique
      try {
        const found = await api('GET', '/events/by-name?name=' + encodeURIComponent(urlEid));
        eid = found.id;
      } catch(e) { eid = null; } // soirée introuvable sous ce nom → flux normal (page d'accueil)
    }
  } else {
    eid = localStorage.getItem('djr_eid') || null;
  }
  // ename n'est jamais restauré depuis localStorage :
  // loadEvent() le définit depuis la DB, pas depuis le cache.

  // 1. Session organisateur (JWT interne lié à un event_id) — indépendante de
  // l'identité personnelle ci-dessous : un organisateur peut aussi voter/
  // discuter avec son propre compte Google/téléphone, ce sont deux choses
  // distinctes. Ne jamais faire de cette session la source de l'identité
  // générale (cf. api.js) sous peine de "perdre" son compte personnel.
  const savedOrgToken = loadToken();
  if (savedOrgToken) {
    try {
      const res = await api('GET', '/auth/me', null, { token: savedOrgToken });
      const u   = res.user;
      if (u.role === 'organizer' && isValidUuid(u.event_id)) {
        eid   = u.event_id;
        ename = u.displayName || '';
        await _activateDJ(ename, null);
      } else {
        clearToken(); // ancien format de token (invité, etc.) — plus utilisé
      }
    } catch(e) { clearToken(); }
  }

  // 2. Identité personnelle (Google OAuth, magic link, téléphone via Supabase)
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
            displayName: u.user_metadata?.full_name || u.user_metadata?.name || u.phone || u.email || 'Invité',
            uid:         u.id,
            phoneNumber: u.phone  || null,
            email:       u.email  || null,
          };
          afterLogin();
          if (sessionStorage.getItem('djr_pending_create_intent')) {
            sessionStorage.removeItem('djr_pending_create_intent');
            showPage('dj-login');
            _djLoginShowCreate(); // le formulaire nom/mot de passe apparaît, currentUser.email est maintenant renseigné
          } else if (eid && !djLoggedIn) {
            // DJ du line-up (accès admin avec son propre compte, cf. enterAsLineupDj)
            // — restaurer le mode DJ après un refresh, pas seulement la page vote.
            if (eid && localStorage.getItem('djr_lineup_event') === eid) {
              await enterAsLineupDj(eid, ename || '');
            } else {
              await loadEvent(eid).catch(() => {});
            }
          }
          // Nettoyer le hash OAuth ; conserver ou rétablir le paramètre ?event=
          if (window.location.hash) {
            history.replaceState(null, '', eid ? buildEventUrl(eid) : (window.location.pathname + window.location.search));
          }
        } else if (event !== 'INITIAL_SESSION' && !_loggedIn && !djLoggedIn) {
          showPage(eid ? 'auth' : 'home');
        }
      });
      const { data: { session } } = await _sb.auth.getSession();
      if (session) return; // onAuthStateChange gère la suite
    } catch(e) {}
  }

  // 3. Ni organisateur ni identité personnelle → accès direct à la connexion
  // si on arrive avec un événement en contexte (lien/QR partagé), sinon
  // l'accueil de découverte (sauf si le mode DJ a déjà choisi sa page à
  // l'étape 1 ci-dessus)
  if (!djLoggedIn) showPage(eid ? 'auth' : 'home');
});

// ── Page publique organisateur (pull-up.live/slug) ───────────────────
async function tryShowOrgaPublicPage(slug) {
  let page;
  try { page = await api('GET', '/orga/by-slug/' + encodeURIComponent(slug)); }
  catch(e) { return false; } // pas de page à cette adresse → flux normal

  showPage('orga-public');
  elt('op-name', page.name || slug);
  elt('op-bio', page.bio || '');
  const banner = document.getElementById('op-banner');
  // Pas de banner_url → le dégradé de marque (.op-banner en CSS) reste visible,
  // pas de bandeau vide/plat.
  if (banner) banner.style.backgroundImage = page.banner_url ? `url(${escapeHtml(page.banner_url)})` : '';
  const logo = document.getElementById('op-logo');
  if (logo) {
    if (page.logo_url) { logo.style.backgroundImage = `url(${escapeHtml(page.logo_url)})`; logo.textContent = ''; }
    else                { logo.style.backgroundImage = ''; logo.textContent = '🎪'; }
  }

  const emailBtn = document.getElementById('op-email-btn');
  if (emailBtn) {
    if (page.email) { emailBtn.href = 'mailto:' + page.email; emailBtn.style.display = 'inline-flex'; }
    else             { emailBtn.style.display = 'none'; }
  }

  const socials = document.getElementById('op-socials');
  if (socials) {
    const links = [
      ['🌐', 'Site web',    page.website_url], ['📷', 'Instagram', page.instagram_url],
      ['🎵', 'TikTok',      page.tiktok_url],   ['📘', 'Facebook',  page.facebook_url],
    ].filter(([,,url]) => url);
    socials.innerHTML = links.map(([ico,label,url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${ico} ${label}</a>`).join('');
  }

  const EV_KIND = {
    live:     { icon: '🔴', bg: 'rgba(255,59,87,.12)',  color: 'var(--red)' },
    upcoming: { icon: '📅', bg: 'rgba(111,34,255,.1)',  color: 'var(--vi)' },
    closed:   { icon: '✓',  bg: 'var(--ink5)',          color: 'var(--tx4)' },
  };
  const evCard = (ev, sub, kind) => {
    const k = EV_KIND[kind];
    return `
    <button onclick="window.location.href='/?event=${ev.id}'" class="op-event-card">
      <div class="op-ev-icon" style="background:${k.bg};color:${k.color}">${k.icon}</div>
      <div style="min-width:0;flex:1">
        <div style="font-size:.9rem;font-weight:700;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(ev.name)}</div>
        <div style="font-size:.72rem;color:var(--tx3);margin-top:2px">${escapeHtml(sub)}</div>
      </div>
      <div style="color:var(--vi);font-size:1rem;flex-shrink:0">→</div>
    </button>`;
  };
  const fmtDate = iso => new Date(iso).toLocaleString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });

  const events   = page.events || [];
  const live     = events.filter(e => !e.upcoming && !e.closed);
  const upcoming = events.filter(e => e.upcoming);
  const closed   = events.filter(e => e.closed);

  const sections = [
    ['op-sec-live',     'op-events-live',     live,     ev => ev.club_name || '',                                              'live'],
    ['op-sec-upcoming', 'op-events-upcoming', upcoming, ev => ev.scheduled_at ? fmtDate(ev.scheduled_at) : (ev.club_name || ''), 'upcoming'],
    ['op-sec-closed',   'op-events-closed',   closed,   ev => ev.club_name || '',                                              'closed'],
  ];
  sections.forEach(([secId, listId, list, subFn, kind]) => {
    const sec  = document.getElementById(secId);
    const list_ = document.getElementById(listId);
    if (!sec || !list_) return;
    if (!list.length) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    list_.innerHTML = list.map(ev => evCard(ev, subFn(ev), kind)).join('');
  });
  return true;
}

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
          // loadEvent() ne charge pas l'historique du chat (seulement les nouveaux
          // messages via Realtime) — sans ça, l'écran affiche un chat vide tant
          // qu'aucun nouveau message n'arrive après l'appairage.
          if (typeof loadChatHistory === 'function') loadChatHistory();
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
  // Ne pas voler l'écran si le mode DJ est déjà actif (session organisateur
  // restaurée en parallèle, cf. window.load) — on charge quand même tout le
  // reste (profil, chat...) pour que l'identité personnelle soit disponible.
  if (!djLoggedIn) showPage('client');
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

// ── Email — Supabase Magic Link natif (aucun fournisseur externe requis) ──
async function sendEmailLink() {
  if (!_sb) { setErr('Service d\'authentification non disponible.'); return; }
  const inp   = document.getElementById('email-inp');
  const email = inp.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('Adresse email invalide.'); return; }
  const btn = document.getElementById('btn-email-action');
  btn.disabled = true; btn.textContent = 'Envoi…';
  try {
    if (eid) sessionStorage.setItem('djr_pre_oauth_eid', eid);
    const redirectTo = window.location.origin + '/';
    const { error } = await _sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) throw error;
    inp.style.display = 'none';
    btn.style.display = 'none';
    document.getElementById('email-sent-addr').textContent = email;
    document.getElementById('email-sent-msg').style.display = 'block';
    setErr('');
  } catch(e) {
    setErr(e.message || 'Erreur d\'envoi du lien');
    btn.disabled = false; btn.textContent = 'Recevoir le lien de connexion';
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
  _lineup = [];
  if (typeof _renderLineup === 'function') _renderLineup();
  _djCreateSyncGoogleState();
}
// Le formulaire nom/mot de passe n'apparaît qu'une fois connecté en Google —
// et seulement si cet email n'a pas déjà une soirée active : sinon, autant
// proposer directement de la gérer plutôt que de faire remplir un nouveau
// formulaire pour tomber sur l'erreur "soirée déjà en cours" à la soumission.
async function _djCreateSyncGoogleState() {
  const authed = !!currentUser?.email;
  document.getElementById('dj-create-google').style.display   = authed ? 'none' : 'block';
  document.getElementById('dj-create-existing').style.display = 'none';
  document.getElementById('dj-create-form').style.display     = 'none';
  if (!authed) return;

  try {
    const mine = await api('GET', '/events/mine');
    const active = (mine || []).find(ev => !ev.closed && !ev.upcoming);
    if (active) {
      document.getElementById('dj-create-existing-name').textContent = active.name;
      document.getElementById('dj-create-existing-btn').onclick = () => adminEnterEvent(active.id, active.name);
      document.getElementById('dj-create-existing').style.display = 'block';
      return;
    }
  } catch(e) {}

  if (typeof _fillHoursSelects === 'function') _fillHoursSelects('create-');
  // Pré-remplit "Organisateur" avec le nom déjà enregistré sur "Ma page",
  // pour ne pas le refaire taper à chaque nouvelle soirée.
  try {
    if (!_orgaProfileCache) _orgaProfileCache = await api('GET', '/orga/profile', null, { dj: true });
    const orgaField = document.getElementById('create-orga');
    if (orgaField && !orgaField.value) orgaField.value = _orgaProfileCache?.name || '';
  } catch(e) {}
  document.getElementById('dj-create-form').style.display = 'block';
}
function _djLoginBack() {
  const onSubView = document.getElementById('dj-join-form').style.display   === 'block'
                 || document.getElementById('dj-create-flow').style.display === 'block';
  if (onSubView) { _djLoginShowChoice(); return; }
  showPage('home');
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
  const n     = document.getElementById('dj-create-name').value.trim();
  const p     = document.getElementById('dj-create-pwd').value;
  const orga  = document.getElementById('create-orga')?.value.trim();
  const club  = document.getElementById('create-club')?.value.trim();
  const addr  = document.getElementById('create-address')?.value.trim();
  const date  = document.getElementById('create-date')?.value;
  const hours = document.getElementById('create-hours')?.value;
  const err = document.getElementById('dj-create-err');
  if (!n) { err.textContent = '⚠️ Saisissez un nom de soirée.'; return; }
  if (!p) { err.textContent = '⚠️ Mot de passe requis.'; return; }
  err.textContent = '';
  try {
    const body = { name: n, password: p, orga, club_name: club, address: addr, hours };
    if (date) body.scheduled_at = new Date(date).toISOString();
    const ev = await api('POST', '/events', body);
    eid = ev.id;
    localStorage.setItem('djr_eid',   eid);
    localStorage.setItem('djr_ename', n);
    // Obtenir le token organizer immédiatement après création pour survivre au refresh
    const authRes = await api('POST', '/events/' + eid + '/auth', { password: p });
    if (authRes.token) saveToken(authRes.token);
    // Line-up et flyer remplis pendant la création (eid/token viennent d'être
    // obtenus ci-dessus, donc utilisables seulement maintenant) — ces deux
    // helpers gèrent eux-mêmes leur toast/erreur.
    if (_lineup.length) _saveLineup();
    if (_createFlyerDataUrl) { await _persistFlyer(_createFlyerDataUrl); _createFlyerDataUrl = null; }
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
    if (e.active_event_id) {
      err.innerHTML = '';
      const msg = document.createElement('div');
      msg.textContent = e.message;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '⚠️ Gérer cette soirée';
      btn.style.cssText = 'margin-top:.5rem;padding:.55rem .9rem;border-radius:.75rem;border:1px solid #FFB020;background:#FFF6E5;color:#8A5A00;font-size:.78rem;font-weight:700;font-family:Inter,sans-serif';
      btn.onclick = () => adminEnterEvent(e.active_event_id, e.active_event_name);
      err.appendChild(msg);
      err.appendChild(btn);
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
  showPage(eid ? 'auth' : 'home');
  closeTopMenu();
}

// ── Suppression du compte (droit à l'effacement) ───────────────────────
function confirmDeleteAccount() {
  if (!(_authToken || _sbSession)) { toast('⚠️ Connecte-toi d\'abord pour supprimer ton compte'); return; }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:1.5rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:1.5rem;max-width:340px;width:100%;text-align:center;box-shadow:var(--shadow)">
      <div style="font-size:1.6rem;margin-bottom:.5rem">⚠️</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--tx);margin-bottom:.3rem">Supprimer ton compte ?</div>
      <div style="font-size:.8rem;color:var(--tx3);margin-bottom:1.1rem">Ton profil, tes statistiques et tes accès seront définitivement supprimés. Cette action est irréversible.</div>
      <button id="del-acc-yes" style="width:100%;padding:.75rem;border-radius:1rem;border:none;background:var(--red);color:#fff;font-size:.85rem;font-weight:700;font-family:Inter,sans-serif;margin-bottom:.5rem">Oui, supprimer définitivement</button>
      <button id="del-acc-no" style="background:none;border:none;color:var(--tx4);font-size:.8rem;width:100%">Annuler</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#del-acc-no').onclick = () => overlay.remove();
  overlay.querySelector('#del-acc-yes').onclick = async () => {
    overlay.remove();
    try {
      await api('DELETE', '/profile/account', null, {});
      localStorage.clear();
      sessionStorage.clear();
      toast('✅ Compte supprimé');
      logout();
    } catch(e) { toast('⚠️ ' + (e.message || 'Suppression impossible')); }
  };
}
