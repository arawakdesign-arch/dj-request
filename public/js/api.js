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
function subscribeToEvent(evId) {
  console.log('[pullup] subscribeToEvent() evId=', evId);
  if (!_sb) { console.warn('[pullup] subscribeToEvent: Supabase non initialisé'); return; }
  _sb.channel('proposals:' + evId)
    .on('postgres_changes', {event:'*', schema:'public', table:'proposals', filter:'event_id=eq.'+evId},
      async (payload) => {
        console.log('[pullup] Realtime proposals:', payload.eventType, '— rechargement pour evId=', evId);
        const p = await api('GET', '/proposals/' + evId);
        console.log('[pullup] Realtime proposals rechargés :', p.length, 'items');
        // Merge : préserver les métadonnées locales (title, artist, coverUrl)
        // absentes du schéma DB actuel mais présentes en mémoire locale
        const fetched = Object.fromEntries(p.map(x => [x.id, { ...x, coverUrl: x.cover_url || null }]));
        Object.keys(fetched).forEach(id => {
          if (proposals[id]) {
            fetched[id].title    = proposals[id].title    || fetched[id].title;
            fetched[id].artist   = proposals[id].artist   || fetched[id].artist;
            fetched[id].coverUrl = proposals[id].coverUrl || fetched[id].coverUrl;
          }
        });
        proposals = fetched;
        renderAll();
        loadVoteRate(evId);
      })
    .subscribe(status => console.log('[pullup] Canal proposals:' + evId, '→', status));

  let _messagesEverSubscribed = false;
  _sb.channel('messages:' + evId)
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'messages', filter:'event_id=eq.'+evId},
      payload => { if (typeof handleRealtimeMessage === 'function') handleRealtimeMessage(payload.new); })
    .subscribe(status => {
      console.log('[pullup] Canal messages:' + evId, '→', status);
      // Rattrapage : si le canal se re-souscrit après une coupure (verrouillage
      // téléphone, changement réseau), on recharge l'historique pour récupérer
      // les messages manqués pendant la déconnexion.
      if (status === 'SUBSCRIBED') {
        if (_messagesEverSubscribed && typeof loadChatHistory === 'function') loadChatHistory();
        _messagesEverSubscribed = true;
      }
    });

  _sb.channel('np:' + evId)
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'now_playing', filter:'event_id=eq.'+evId},
      p => { nowPlaying = {t: p.new.title, a: p.new.artist, coverUrl: p.new.cover_url || null}; updateNP(); })
    .subscribe(status => console.log('[pullup] Canal np:' + evId, '→', status));
}

// ── Chargement d'un événement ─────────────────────────────────────────
async function loadEvent(evId) {
  console.log('[pullup] loadEvent() appelée avec evId=', evId);
  try {
    const ev = await api('GET', '/events/' + evId);
    eid = ev.id; ename = ev.name;
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
