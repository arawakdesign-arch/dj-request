// ══ SUPABASE CLIENT ══════════════════════════════════════════════════
// Chargé dynamiquement depuis /api/config/public pour ne pas hardcoder
// les clés publiques dans le code source.
let _sb = null, _sbSession = null;

async function _initSupabase() {
  try {
    const res = await fetch('/api/config/public');
    if (!res.ok) throw new Error('Réponse config invalide : ' + res.status);
    const { supabaseUrl, supabaseAnonKey } = await res.json();
    _sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  } catch(e) { console.warn('Supabase init failed:', e.message); }
}

const _configReady = _initSupabase();

// ── Fetch helper vers le serveur Node.js ─────────────────────────────
async function api(method, path, body, { dj, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  // Priorité : token explicite > token interne > session Supabase
  const bearer = token || _authToken || _sbSession?.access_token;
  if (bearer) headers['Authorization'] = 'Bearer ' + bearer;
  if (dj && _djPassword) headers['x-organizer-password'] = _djPassword;
  const r = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'Erreur');
  }
  return r.json();
}

// ── Souscriptions Realtime ────────────────────────────────────────────

// Recharge les propositions depuis le serveur en préservant les métadonnées
// locales (title/artist/coverUrl absentes du schéma DB actuel). Utilisé par
// le handler Realtime ET par le filet de sécurité périodique de l'écran TV.
async function refreshProposals(evId) {
  const p = await api('GET', '/proposals/' + evId);
  const fetched = Object.fromEntries(p.map(x => [x.id, { ...x, coverUrl: x.cover_url || null }]));
  Object.keys(fetched).forEach(id => {
    if (proposals[id]) {
      fetched[id].title    = proposals[id].title    || fetched[id].title;
      fetched[id].artist   = proposals[id].artist   || fetched[id].artist;
      fetched[id].coverUrl = proposals[id].coverUrl || fetched[id].coverUrl;
    }
  });
  proposals = fetched;
}

async function refreshNowPlaying(evId) {
  const np = await api('GET', '/now-playing/' + evId);
  if (np?.title) { nowPlaying = {t: np.title, a: np.artist || '', coverUrl: np.cover_url || null}; if (typeof updateNP === 'function') updateNP(); }
}

// Un canal Realtime peut mourir silencieusement (wifi de la TV qui redémarre,
// veille prolongée, changement de réseau sur le téléphone) sans jamais
// redevenir SUBSCRIBED tout seul. On surveille le statut de chaque canal et,
// s'il tombe en erreur/expire/se ferme, on reprogramme une resouscription
// complète après une courte pause (debounce : un seul canal en échec suffit
// à déclencher, pas la peine que les 3 le fassent en même temps).
let _resubscribeTimer = null;
function _watchChannelStatus(evId, label) {
  return (status) => {
    console.log('[pullup] Canal ' + label + ':' + evId, '→', status);
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      _scheduleResubscribe(evId);
    }
  };
}
function _scheduleResubscribe(evId) {
  if (_resubscribeTimer || eid !== evId) return; // soirée déjà changée entretemps, pas la peine
  _resubscribeTimer = setTimeout(async () => {
    _resubscribeTimer = null;
    if (eid !== evId) return;
    console.log('[pullup] Realtime: resouscription après coupure, evId=', evId);
    subscribeToEvent(evId);
    // La coupure a pu durer longtemps (TV en veille, wifi qui redémarre) :
    // on recharge l'état complet plutôt que de compter sur le seul rattrapage
    // du canal messages.
    await refreshProposals(evId).catch(() => {});
    await refreshNowPlaying(evId).catch(() => {});
    renderAll();
  }, 3000);
}

function subscribeToEvent(evId) {
  console.log('[pullup] subscribeToEvent() evId=', evId);
  if (!_sb) { console.warn('[pullup] subscribeToEvent: Supabase non initialisé'); return; }
  // Repartir d'une base propre à chaque (re)souscription : sinon les canaux
  // d'un appel précédent (loadEvent() rappelé, resouscription après coupure)
  // restent ouverts en double et certains finissent par ne plus jamais
  // recevoir d'évènements — symptôme typique d'un écran qui "ne réagit plus".
  _sb.removeAllChannels();

  _sb.channel('proposals:' + evId)
    .on('postgres_changes', {event:'*', schema:'public', table:'proposals', filter:'event_id=eq.'+evId},
      async (payload) => {
        console.log('[pullup] Realtime proposals:', payload.eventType, '— rechargement pour evId=', evId);
        await refreshProposals(evId);
        renderAll();
        loadVoteRate(evId);
      })
    .subscribe(_watchChannelStatus(evId, 'proposals'));

  let _messagesEverSubscribed = false;
  _sb.channel('messages:' + evId)
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'messages', filter:'event_id=eq.'+evId},
      payload => { if (typeof handleRealtimeMessage === 'function') handleRealtimeMessage(payload.new); })
    .subscribe(status => {
      _watchChannelStatus(evId, 'messages')(status);
      // Rattrapage : si le canal se re-souscrit après une coupure (verrouillage
      // téléphone, changement réseau), on recharge l'historique pour récupérer
      // les messages manqués pendant la déconnexion.
      if (status === 'SUBSCRIBED') {
        if (_messagesEverSubscribed) {
          if (typeof loadChatHistory === 'function') loadChatHistory();
          if (typeof loadBsChatHistory === 'function') loadBsChatHistory(evId);
        }
        _messagesEverSubscribed = true;
      }
    });

  _sb.channel('np:' + evId)
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'now_playing', filter:'event_id=eq.'+evId},
      p => { nowPlaying = {t: p.new.title, a: p.new.artist, coverUrl: p.new.cover_url || null}; updateNP(); })
    .subscribe(_watchChannelStatus(evId, 'np'));
}

// Le réseau peut disparaître un instant (coupure box/4G) sans que les canaux
// Realtime déclenchent CHANNEL_ERROR — le navigateur les laisse "en attente".
// Dès que la connexion revient, on force une resouscription + un rattrapage.
window.addEventListener('online', () => {
  if (!eid) return;
  console.log('[pullup] réseau revenu — resynchronisation Realtime, evId=', eid);
  subscribeToEvent(eid);
  refreshProposals(eid).then(renderAll).catch(() => {});
  refreshNowPlaying(eid).catch(() => {});
});

// ── Filet de sécurité pour l'écran TV (Écran Géant) ─────────────────────
// Contrairement à un téléphone qu'on rallume, la TV reste TOUJOURS visible :
// le rattrapage basé sur `visibilitychange` (cf. chat.js) ne se déclenche
// donc jamais pour elle. Si le websocket Realtime meurt sans jamais générer
// d'évènement de statut détectable (cas vu sur certains wifi de box TV), rien
// ne le repère. Tant que l'Écran Géant est affiché, on force donc un
// rafraîchissement complet à intervalle régulier, indépendamment de l'état
// du Realtime — l'écran finit toujours par se remettre à jour.
let _bsWatchdog = null;
function startBigscreenWatchdog(evId) {
  stopBigscreenWatchdog();
  if (!evId) return;
  _bsWatchdog = setInterval(async () => {
    try {
      await refreshProposals(evId);
      await refreshNowPlaying(evId);
      if (typeof renderBS === 'function') renderBS();
      if (typeof loadBsChatHistory === 'function') loadBsChatHistory(evId);
    } catch(e) {}
  }, 20000);
}
function stopBigscreenWatchdog() {
  clearInterval(_bsWatchdog);
  _bsWatchdog = null;
}

// ── Chargement d'un événement ─────────────────────────────────────────
async function loadEvent(evId) {
  console.log('[pullup] loadEvent() appelée avec evId=', evId);
  try {
    const ev = await api('GET', '/events/' + evId);
    eid = ev.id; ename = ev.name;
    eventClosed = !!ev.closed;
    if (typeof applyEventClosedState === 'function') applyEventClosedState();
    // Figer l'ID dans une variable locale : eid global peut être muté
    // entre deux await par du code concurrent (onAuthStateChange, etc.)
    const localEid = eid;
    console.log('[pullup] loadEvent() succès : localEid=', localEid, 'ename=', ename);
    localStorage.setItem('djr_eid', localEid);
    localStorage.setItem('djr_ename', ename);
    // Bannière venue-card : les vraies infos de l'événement (enregistrées par
    // l'organisateur via saveSettings()) priment sur les valeurs de démo figées
    // dans le HTML — sinon tout le monde voit toujours "Warehouse 42".
    const en = document.getElementById('venue-event-name');  if (en && ev.name)      en.textContent = ev.name;
    const og = document.getElementById('venue-orga');        if (og && ev.orga)      og.textContent = ev.orga;
    const cn = document.getElementById('club-name-strip');   if (cn && ev.club_name) cn.textContent = ev.club_name;
    const ad = document.getElementById('venue-addr-txt');    if (ad && ev.address)   ad.textContent = ev.address;
    const hr = document.getElementById('venue-hours-txt');   if (hr && ev.hours)     hr.textContent = ev.hours;
    // Flyer : le serveur fait autorité (pas seulement le cache local du
    // téléphone qui l'a uploadé) — sinon les autres invités ne le voient jamais.
    // Alimente aussi la vignette venue-photo de la venue-card (cf. applyFlyer).
    if (typeof applyFlyer === 'function') applyFlyer(ev.flyer_url || null);
    loadVoteRate(localEid);
    const ps = await api('GET', '/proposals/' + localEid);
    console.log('[pullup] loadEvent() proposals reçus :', ps.length, 'items pour localEid=', localEid);
    // Normalise cover_url (DB snake_case) → coverUrl (camelCase utilisé par render.js)
    proposals = Object.fromEntries(ps.map(x => [x.id, { ...x, coverUrl: x.cover_url || null }]));
    const np = await api('GET', '/now-playing/' + localEid);
    if (np?.title) nowPlaying = {t: np.title, a: np.artist || '', coverUrl: np.cover_url || null};
    // Restaurer les votes de l'utilisateur courant après reload
    if (currentUser?.uid) {
      try {
        const ids = await api('GET', '/votes/' + localEid);
        myVotes = new Set(ids);
      } catch(_) {}
    }
    renderAll();
    subscribeToEvent(localEid);
    if (typeof generateQR === 'function') generateQR(localEid);
    const miniQR = document.getElementById('club-qr-mini');
    if (miniQR) {
      miniQR.innerHTML = '';
      const sz = window.innerWidth <= 430 ? 96 : 120;
      try { new QRCode(miniQR, {text: buildEventUrl(localEid), width:sz, height:sz, colorDark:'#000', colorLight:'#fff'}); } catch(_) {}
    }
  } catch(e) {
    // Soirée introuvable ou supprimée → nettoyer tout l'état lié à cet event
    // NOTE : loadEvent() gère sa propre erreur et résout toujours (ne rejette jamais).
    // Le caller ne peut pas détecter l'échec via .catch() — utiliser isValidUuid(eid) après l'await.
    console.error('[pullup] loadEvent() échec : evId=', evId, 'erreur=', e.message);
    eid       = null;
    ename     = '';
    proposals = {};
    nowPlaying = {t: 'En attente…', a: ''};
    myVotes   = new Set();
    localStorage.removeItem('djr_eid');
    localStorage.removeItem('djr_ename');
    toast('Soirée introuvable ou supprimée.');
    renderAll();
  }
}

// ── Votes/minute (bannière de l'événement) ──────────────────────────────
// Remplace l'ancien calcul client (delta entre deux rendus, pas un vrai
// taux temporel) par un vrai compte des votes de la dernière minute.
async function loadVoteRate(evId) {
  try {
    const { perMinute } = await api('GET', '/events/' + evId + '/vote-rate');
    elt('venue-recent-votes', perMinute ?? 0);
  } catch(e) {}
}
