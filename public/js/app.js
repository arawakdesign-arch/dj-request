// ══ STATE GLOBAL ═════════════════════════════════════════════════════
let currentUser  = null;
let confirmResult = null, otpPhase = false, resendTimer = null, resendCD = 30;
let eid   = null, ename = '';
let eventClosed = false; // soirée figée en lecture seule 24h après sa création
let proposals = {}, myVotes = new Set(), nowPlaying = {t:'En attente…', a:''};
let selModal = null, selModalMeta = null, selectedPlan = 'free', subscribed = false, subCount = 1284;
let djLoggedIn = false;
let _djPassword = null;
let locActive = false, selectedZone = '';

// ══ UTILS ════════════════════════════════════════════════════════════
function elt(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
// fetch() sur une data: URL est bloqué par notre CSP (connect-src) — on
// décode le base64 nous-mêmes pour obtenir un Blob à uploader.
function dataURLtoBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime   = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function getUid() {
  let u = localStorage.getItem('djr_uid');
  if (!u) { u = Math.random().toString(36).slice(2); localStorage.setItem('djr_uid', u); }
  return u;
}
function animCount(id, target) {
  const el = document.getElementById(id); if (!el) return;
  let c = 0;
  const step = Math.max(1, Math.floor(target / 20));
  const iv = setInterval(() => { c = Math.min(c + step, target); el.textContent = c; if (c >= target) clearInterval(iv); }, 40);
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2500);
}

// ══ NAVIGATION ═══════════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('pg-' + id);
  if (!pg) return;
  pg.classList.add('active', 'pe');
  setTimeout(() => pg.classList.remove('pe'), 400);
  if (id === 'dj' || id === 'bigscreen') generateQR();
  if (id === 'bigscreen') renderBS();
  if (id === 'profile')   renderProfile();
  if (id === 'dj')        renderAll();
  if (id === 'chat')      { chatMarkRead(); scrollChatBottom(); }
  if (id === 'presskit')  { if (_djProfileCache) applyDjProfileToPresskit(); else loadDjProfile(); }
}

function navTo(id) {
  if (id === 'dj' && !djLoggedIn) { showPage('dj-login'); closeTopMenu(); return; }
  showPage(id);
  ['vote','chat','profile','dj'].forEach(t => document.getElementById('nav-' + t)?.classList.remove('active'));
  const map = {client:'vote', chat:'chat', profile:'profile', presskit:'dj', dj:'dj'};
  const navId = map[id];
  if (navId) document.getElementById('nav-' + navId)?.classList.add('active');
  closeTopMenu();
}

// ── Menu déroulant (haut gauche) ────────────────────────────────────────
function toggleTopMenu() {
  document.getElementById('top-menu')?.classList.toggle('open');
  document.getElementById('top-menu-overlay')?.classList.toggle('open');
}
function closeTopMenu() {
  document.getElementById('top-menu')?.classList.remove('open');
  document.getElementById('top-menu-overlay')?.classList.remove('open');
}

// ══ MODALS ═══════════════════════════════════════════════════════════
function openModal(id) {
  if (id === 'modal-propose') {
    selModal = null; selModalMeta = null;
    document.getElementById('modal-q').value = '';
    document.getElementById('modal-ok').disabled = true;
    renderModalList();
  }
  document.getElementById(id).classList.add('open');
}
function closeModal(id)          { document.getElementById(id).classList.remove('open'); }
function closeModalOut(id, e)    { if (e.target === document.getElementById(id)) closeModal(id); }

// ══ VOTE & PROPOSE ═══════════════════════════════════════════════════
// Affiche le bandeau "Soirée terminée" et masque le CTA de proposition une
// fois la fenêtre de 24h dépassée (cf. isEventClosed() côté serveur).
function applyEventClosedState() {
  const banner = document.getElementById('event-closed-banner');
  const propose = document.getElementById('btn-fab-propose');
  if (banner)  banner.style.display  = eventClosed ? 'block' : 'none';
  if (propose) propose.style.display = eventClosed ? 'none'  : 'flex';
  renderAll();
}

function vote(id) {
  if (!proposals[id]) return;
  if (eventClosed) { toast('🔒 Cette soirée est terminée'); return; }
  if (myVotes.has(id)) {
    myVotes.delete(id);
    proposals[id].votes = Math.max(0, (proposals[id].votes || 0) - 1);
    renderAll(); toast('Vote retiré');
    if (eid && _sbSession) api('DELETE', '/votes/' + eid + '/' + id).catch(() => {});
  } else {
    myVotes.add(id);
    proposals[id].votes = (proposals[id].votes || 0) + 1;
    renderAll(); toast('Voté ! 🎵');
    if (eid && _sbSession) api('POST', '/votes', {proposal_id: id, event_id: eid}).catch(e => {
      if (e.message === 'Vous avez déjà voté pour ce morceau') {
        myVotes.delete(id);
        if (proposals[id]) proposals[id].votes = Math.max(0, (proposals[id].votes || 0) - 1);
        renderAll();
      } else {
        console.error('[pullup] Échec enregistrement vote :', e.message);
        toast('⚠️ Vote non enregistré côté serveur — ' + e.message);
      }
    });
  }
}

async function submitProposal() {
  if (!selModal) return;
  if (eventClosed) { toast('🔒 Cette soirée est terminée'); return; }

  // MusicBrainz result ou catalogue local
  const meta = selModalMeta || (() => {
    const c = CAT.find(x => x.id === selModal);
    return c ? { id: c.id, title: c.n, artist: c.a } : null;
  })();
  if (!meta) return;

  proposals[meta.id] = { id: meta.id, title: meta.title, artist: meta.artist,
                         coverUrl: meta.coverUrl || null, votes: 1, approved: false };
  myVotes.add(meta.id);
  renderAll();
  closeModal('modal-propose');
  toast(`🎵 "${meta.title}" proposé !`);
  if (eid && _sbSession) {
    api('POST', '/proposals', { song_id: meta.id, event_id: eid,
      title: meta.title, artist: meta.artist, cover_url: meta.coverUrl || null }).catch(e => {
        console.error('[pullup] Échec enregistrement proposition :', e.message);
        toast('⚠️ Non enregistré côté serveur — ' + e.message);
      });
  }
}

// ══ DJ ACTIONS ═══════════════════════════════════════════════════════
async function djPlay(id) {
  const s        = CAT.find(x => x.id === id);
  const p        = proposals[id];
  const title    = s?.n  || p?.title  || id;
  const artist   = s?.a  || p?.artist || '';
  const coverUrl = p?.coverUrl || artCache[title + artist] || null;
  nowPlaying = {t: title, a: artist, coverUrl};
  delete proposals[id]; renderAll(); toast(`▶ ${title}`);
  if (eid) {
    api('PUT',    '/now-playing/' + eid, {title, artist, coverUrl}, {dj: true}).catch(() => {});
    api('DELETE', '/proposals/' + eid + '/' + id, null, {dj: true}).catch(() => {});
  }
}
function djApprove(id) {
  if (proposals[id]) proposals[id].approved = true; renderAll(); toast('✓ Approuvé');
  if (eid) api('PATCH', '/proposals/' + eid + '/' + id, {approved: true}, {dj: true}).catch(() => {});
}
function djReject(id) {
  delete proposals[id]; renderAll(); toast('✕ Retiré');
  if (eid) api('DELETE', '/proposals/' + eid + '/' + id, null, {dj: true}).catch(() => {});
}
function djLogout() {
  djLoggedIn = false;
  document.getElementById('nav-dj').onclick = () => navTo('presskit');
  document.querySelector('#nav-dj .nav-tab-ico').textContent = '🎧';
  document.querySelector('#nav-dj .nav-tab-lbl').textContent = "DJ's";
  showPage('client');
}
async function createNewEvent(n) {
  // Vider l'event courant pour repartir d'un login propre
  eid = null;
  djLoggedIn = false;
  _djPassword = null;
  localStorage.removeItem('djr_eid');
  localStorage.removeItem('djr_ename');
  const nameEl = document.getElementById('dj-ev-name');
  const pwdEl  = document.getElementById('dj-pwd');
  const errEl  = document.getElementById('dj-err');
  if (nameEl) nameEl.value = '';
  if (pwdEl)  pwdEl.value  = '';
  if (errEl)  errEl.textContent = '';
  showPage('dj-login');
}

// ══ DJ DASHBOARD TABS ════════════════════════════════════════════════
function switchOrgaTab(tab, btn) {
  ['live','modo','pk','settings'].forEach(t => {
    const el = document.getElementById('orga-' + t);
    if (el) el.style.display = 'none';
    const tb = document.getElementById('otab-' + t);
    if (tb) { tb.style.color = 'var(--tx3)'; tb.style.borderBottom = '2px solid transparent'; tb.style.fontWeight = '600'; }
  });
  const el = document.getElementById('orga-' + tab);
  if (el) el.style.display = 'block';
  if (btn) { btn.style.color = '#6F22FF'; btn.style.borderBottom = '2px solid #6F22FF'; btn.style.fontWeight = '700'; }
  if (tab === 'modo') loadOrgaChatList();
}
function loadOrgaChatList() {
  const list = document.getElementById('orga-chat-list'); if (!list) return;
  const msgs = [...document.querySelectorAll('#chat-messages > div')];
  list.innerHTML = '';
  msgs.slice(-20).reverse().forEach(wrapper => {
    const bubble = wrapper.querySelector('div[style*="border-radius"]');
    const txt  = bubble?.querySelector('div')?.textContent;
    const name = wrapper.querySelector('div:first-child')?.textContent;
    if (!txt) return;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.45rem .65rem;background:var(--ink5);border-radius:.75rem;border:1px solid var(--bdr)';
    div.innerHTML = `<div style="flex:1;min-width:0"><div style="font-size:.65rem;color:var(--tx4);margin-bottom:1px">${name||'Moi'}</div><div style="font-size:.8rem;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${txt}</div></div>`;
    list.appendChild(div);
  });
  if (!list.children.length) list.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.78rem;color:var(--tx4)">Aucun message</div>';
}
// ══ PROFIL ═══════════════════════════════════════════════════════════
function openProfileEdit() {
  const saved = JSON.parse(localStorage.getItem('djr_profile') || '{}');
  // Pré-remplir les champs
  const nameInput = document.getElementById('prof-edit-name');
  const bioInput  = document.getElementById('prof-edit-bio');
  const img       = document.getElementById('prof-edit-img');
  const initials  = document.getElementById('prof-edit-initials');
  if (nameInput) nameInput.value = saved.name || currentUser?.displayName || '';
  if (bioInput)  bioInput.value  = saved.bio  || '';
  // Photo preview dans la modal
  if (saved.photo) {
    if (img)     { img.src = saved.photo; img.style.display = 'block'; }
    if (initials) initials.style.display = 'none';
  } else {
    if (img)     img.style.display = 'none';
    if (initials) { initials.style.display = 'flex'; initials.textContent = (saved.name || currentUser?.displayName || '?')[0].toUpperCase(); }
  }
  openModal('modal-profile-edit');
}

async function saveProfile() {
  const name  = document.getElementById('prof-edit-name')?.value.trim() || currentUser?.displayName || 'Invité';
  const bio   = document.getElementById('prof-edit-bio')?.value.trim()  || '';
  const saved = JSON.parse(localStorage.getItem('djr_profile') || '{}');
  const profile = { ...saved, name, bio };
  localStorage.setItem('djr_profile', JSON.stringify(profile));
  if (currentUser) currentUser.displayName = name;
  applyProfileToUI(profile);
  closeModal('modal-profile-edit');
  toast('✅ Profil mis à jour !');
  // Sync backend
  if (_authToken || _sbSession) api('PATCH', '/profile', { display_name: name, bio, friend_code: getFriendCode() }).catch(() => {});
}

// Le profil (nom, bio, photo) est sauvegardé côté serveur via saveProfile()/
// uploadProfilePhoto(), mais uniquement lu depuis localStorage jusqu'ici —
// donc invisible sur un autre appareil/navigateur, ou après un vidage du
// cache. On le recharge depuis le serveur à la connexion, qui fait autorité.
async function loadRemoteProfile() {
  if (!(_authToken || _sbSession)) return;
  try {
    const p = await api('GET', '/profile');
    if (!p || !p.id) return; // rien enregistré côté serveur pour l'instant
    const saved  = JSON.parse(localStorage.getItem('djr_profile') || '{}');
    const merged = { ...saved, name: p.display_name || saved.name, photo: p.photo_url || saved.photo, bio: p.bio || saved.bio };
    localStorage.setItem('djr_profile', JSON.stringify(merged));
    if (currentUser && p.display_name) currentUser.displayName = p.display_name;
    applyProfileToUI(merged);
  } catch(e) { /* profil local conservé en repli */ }
}

async function uploadProfilePhoto(input) {
  const file = input.files[0]; if (!file) return;
  toast('📷 Compression de la photo…');

  // Compression côté client (comme pour les photos du chat) : sans ça, une
  // photo haute résolution (portrait IA, photo de téléphone récent…) dépasse
  // souvent la limite de taille du serveur et l'upload échoue silencieusement
  // — seul l'aperçu local restait visible, jamais partagé nulle part ailleurs.
  let dataUrl;
  try {
    dataUrl = await compressImage(file, 500, 0.8);
  } catch(e) { toast('❌ Erreur photo'); return; }

  // Preview immédiate
  const saved = JSON.parse(localStorage.getItem('djr_profile') || '{}');
  saved.photo = dataUrl;
  try { localStorage.setItem('djr_profile', JSON.stringify(saved)); } catch(err) {}
  const img      = document.getElementById('prof-edit-img');
  const initials = document.getElementById('prof-edit-initials');
  if (img)     { img.src = dataUrl; img.style.display = 'block'; }
  if (initials) initials.style.display = 'none';
  applyProfileToUI(saved);

  // Upload backend si connecté
  if (_authToken || _sbSession) {
    try {
      const blob = dataURLtoBlob(dataUrl);
      const form = new FormData();
      form.append('photo', blob, 'avatar.jpg');
      const r = await fetch('/api/profile/photo', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (_authToken || _sbSession.access_token) },
        body: form,
      });
      if (r.ok) {
        const { url } = await r.json();
        const saved2 = JSON.parse(localStorage.getItem('djr_profile') || '{}');
        saved2.photo = url;
        localStorage.setItem('djr_profile', JSON.stringify(saved2));
        applyProfileToUI(saved2);
        toast('✅ Photo sauvegardée !');
      } else {
        const err = await r.json().catch(() => ({}));
        console.error('[pullup] Échec upload photo serveur :', err.error || r.status);
        toast('⚠️ Photo gardée en local seulement — ' + (err.error || 'échec serveur'));
      }
    } catch(e) {
      console.error('[pullup] Échec upload photo serveur :', e.message);
      toast('⚠️ Photo gardée en local seulement — ' + e.message);
    }
  }
}

// ══ PROFIL DJ (inscription / press kit) ═════════════════════════════
let _djProfileCache = null; // {} tant que non chargé, {stage_name:...} une fois connu

async function loadDjProfile() {
  if (!(_authToken || _sbSession)) return null;
  try {
    _djProfileCache = await api('GET', '/dj/profile');
  } catch(e) { _djProfileCache = null; }
  refreshDjRegisterButton();
  if (document.getElementById('pg-presskit')?.classList.contains('active')) applyDjProfileToPresskit();
  return _djProfileCache;
}

function refreshDjRegisterButton() {
  const title = document.getElementById('btn-dj-register-title');
  const sub   = document.getElementById('btn-dj-register-sub');
  if (!title || !sub) return;
  if (_djProfileCache?.stage_name) {
    title.textContent = 'Mon profil DJ';
    sub.textContent    = _djProfileCache.stage_name;
  } else {
    title.textContent = "S'enregistrer comme DJ";
    sub.textContent    = "Crée ton profil et ton press kit";
  }
}

async function openDjRegister() {
  showPage('dj-register');
  if (!(_authToken || _sbSession)) return; // formulaire consultable ; connexion requise seulement à l'enregistrement
  if (!_djProfileCache) await loadDjProfile();
  const p = _djProfileCache || {};
  elt2val('dj-edit-stage-name',     p.stage_name);
  elt2val('dj-edit-tagline',        p.tagline);
  elt2val('dj-edit-bio',            p.bio);
  elt2val('dj-edit-city',           p.city);
  elt2val('dj-edit-genres',         p.genres);
  elt2val('dj-edit-instagram',      p.instagram);
  elt2val('dj-edit-soundcloud',     p.soundcloud);
  elt2val('dj-edit-ra',             p.resident_advisor);
  elt2val('dj-edit-booking-email',  p.booking_email);
  const img = document.getElementById('dj-edit-img');
  const ini = document.getElementById('dj-edit-initials');
  if (p.photo_url) { img.src = p.photo_url; img.style.display = 'block'; ini.style.display = 'none'; }
  else              { img.style.display = 'none'; ini.style.display = 'flex'; }
}
function elt2val(id, v) { const e = document.getElementById(id); if (e) e.value = v || ''; }

async function saveDjProfile() {
  if (!(_authToken || _sbSession)) { toast('⚠️ Connecte-toi (Google) pour enregistrer ton profil DJ'); return; }
  const stage_name = document.getElementById('dj-edit-stage-name')?.value.trim();
  if (!stage_name) { toast('⚠️ Le nom de scène est requis'); return; }
  const payload = {
    stage_name,
    tagline:          document.getElementById('dj-edit-tagline')?.value.trim(),
    bio:               document.getElementById('dj-edit-bio')?.value.trim(),
    city:              document.getElementById('dj-edit-city')?.value.trim(),
    genres:            document.getElementById('dj-edit-genres')?.value.trim(),
    instagram:         document.getElementById('dj-edit-instagram')?.value.trim(),
    soundcloud:        document.getElementById('dj-edit-soundcloud')?.value.trim(),
    resident_advisor:  document.getElementById('dj-edit-ra')?.value.trim(),
    booking_email:     document.getElementById('dj-edit-booking-email')?.value.trim(),
  };
  try {
    _djProfileCache = await api('POST', '/dj/profile', payload);
    refreshDjRegisterButton();
    applyDjProfileToPresskit();
    showPage(currentUser ? 'profile' : 'auth');
    toast('✅ Profil DJ enregistré !');
  } catch(e) {
    console.error('[pullup] Échec enregistrement profil DJ :', e.message);
    toast('⚠️ Erreur : ' + e.message);
  }
}

async function uploadDjPhoto(input) {
  const file = input.files[0]; if (!file) return;
  toast('📷 Compression de la photo…');
  let dataUrl;
  try { dataUrl = await compressImage(file, 500, 0.8); } catch(e) { toast('❌ Erreur photo'); return; }

  const img = document.getElementById('dj-edit-img');
  const ini = document.getElementById('dj-edit-initials');
  if (img) { img.src = dataUrl; img.style.display = 'block'; }
  if (ini) ini.style.display = 'none';

  try {
    const blob = dataURLtoBlob(dataUrl);
    const form = new FormData();
    form.append('photo', blob, 'avatar.jpg');
    const r = await fetch('/api/dj/profile/photo', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (_authToken || _sbSession.access_token) },
      body: form,
    });
    if (r.ok) {
      const { url } = await r.json();
      if (_djProfileCache) _djProfileCache.photo_url = url;
      applyDjProfileToPresskit();
      toast('✅ Photo sauvegardée !');
    } else {
      const err = await r.json().catch(() => ({}));
      toast('⚠️ Échec upload — ' + (err.error || 'erreur serveur'));
    }
  } catch(e) {
    toast('⚠️ Échec upload — ' + e.message);
  }
}

function copyBookingEmail() {
  const mail = _djProfileCache?.booking_email;
  if (mail) navigator.clipboard?.writeText(mail).then(() => toast('📧 ' + mail + ' copié'));
  else      toast('📧 booking@djnova.fr copié');
}

// Applique le profil DJ connecté à la page Press Kit (si présent) — sinon
// la page garde son contenu de démonstration (DJ Nova) tel quel.
function applyDjProfileToPresskit() {
  const p = _djProfileCache;
  const editBtn = document.getElementById('pk-edit-btn');
  if (!p || !p.stage_name) { if (editBtn) editBtn.style.display = 'none'; return; }

  elt('pk-name', p.stage_name.toUpperCase());
  if (p.tagline) elt('pk-tagline', p.tagline);
  if (p.city)    { const el = document.getElementById('pk-location'); if (el) el.textContent = '📍 ' + p.city; }
  if (p.photo_url) { const img = document.getElementById('pk-photo'); if (img) img.src = p.photo_url; }
  if (p.booking_email) elt('pk-booking-email', p.booking_email);

  const socWrap = document.getElementById('pk-socials');
  if (socWrap) {
    const ig = document.getElementById('pk-soc-ig'), sc = document.getElementById('pk-soc-sc'), ra = document.getElementById('pk-soc-ra');
    if (ig) ig.style.display = p.instagram        ? '' : 'none';
    if (sc) sc.style.display = p.soundcloud       ? '' : 'none';
    if (ra) ra.style.display = p.resident_advisor ? '' : 'none';
  }

  if (editBtn) editBtn.style.display = 'block';
}

function applyProfileToUI(profile) {
  if (!profile) profile = JSON.parse(localStorage.getItem('djr_profile') || '{}');
  const name = profile.name || currentUser?.displayName || 'Invité';
  // Nom
  elt('prof-name', name);
  // Initiale avatar
  const avEl = document.getElementById('prof-av');
  if (avEl) avEl.textContent = name[0]?.toUpperCase() || '🎵';
  // Photo
  const photo    = profile.photo || null;
  const photoEl  = document.getElementById('prof-photo-display');
  if (photoEl) { photoEl.src = photo || ''; photoEl.style.display = photo ? 'block' : 'none'; }
  if (avEl) avEl.style.display = photo ? 'none' : 'flex';
  // Avatar du header (haut de page, mène au profil) — vraie photo, sinon initiale
  document.querySelectorAll('.tb-avatar').forEach(el => {
    if (photo) { el.style.backgroundImage = `url('${photo}')`; el.textContent = ''; }
    else       { el.style.backgroundImage = 'none'; el.textContent = name[0]?.toUpperCase() || '?'; }
  });
  // Bio
  const bioEl = document.getElementById('prof-bio-display');
  if (bioEl && profile.bio) bioEl.textContent = profile.bio;
}

// ══ FLYER ════════════════════════════════════════════════════════════
async function uploadFlyer(input) {
  const file = input.files[0]; if (!file) return;
  toast('🖼️ Compression du flyer…');

  let dataUrl;
  try {
    dataUrl = await compressImage(file, 1200, 0.8);
  } catch(e) { toast('❌ Erreur photo'); return; }

  // Preview locale immédiate
  localStorage.setItem('djr_flyer', dataUrl);
  applyFlyer(dataUrl);

  // Upload backend si organisateur connecté à un événement. _djPassword n'est
  // rempli qu'au moment de la saisie du mot de passe et ne survit pas à un
  // rechargement de page — on envoie donc aussi le JWT organisateur restauré
  // (_authToken), sans quoi l'upload échouait silencieusement après un refresh.
  if (eid && (_authToken || _djPassword)) {
    try {
      const blob = dataURLtoBlob(dataUrl);
      const form = new FormData();
      form.append('flyer', blob, 'flyer.jpg');
      const headers = {};
      if (_authToken)  headers['Authorization']        = 'Bearer ' + _authToken;
      if (_djPassword) headers['x-organizer-password'] = _djPassword;
      const r = await fetch(`/api/events/${eid}/flyer`, { method: 'POST', headers, body: form });
      if (r.ok) {
        const { url } = await r.json();
        localStorage.setItem('djr_flyer', url);
        applyFlyer(url);
        toast('✅ Flyer sauvegardé !');
      } else {
        const err = await r.json().catch(() => ({}));
        console.error('[pullup] Échec upload flyer :', err.error || r.status);
        toast('⚠️ Flyer gardé en local seulement — ' + (err.error || 'échec serveur'));
      }
    } catch(e) {
      console.error('[pullup] Échec upload flyer :', e.message);
      toast('⚠️ Flyer gardé en local seulement — ' + e.message);
    }
  }
}

function removeFlyer() {
  localStorage.removeItem('djr_flyer');
  applyFlyer(null);
  toast('🗑️ Flyer retiré');
  // Sans ça, flyer_url reste en base côté serveur : le flyer "retiré"
  // revenait dès le prochain chargement (pour tout le monde).
  if (eid && (_authToken || _djPassword)) {
    const headers = {};
    if (_authToken)  headers['Authorization']        = 'Bearer ' + _authToken;
    if (_djPassword) headers['x-organizer-password'] = _djPassword;
    fetch(`/api/events/${eid}/flyer`, { method: 'DELETE', headers }).catch(e => {
      console.error('[pullup] Échec suppression flyer serveur :', e.message);
    });
  }
}

function applyFlyer(dataUrl) {
  const container = document.getElementById('flyer-container');
  const overlay   = document.getElementById('flyer-overlay');
  const grid      = document.getElementById('flyer-grid');
  const preview   = document.getElementById('flyer-preview-dj');
  const hint      = document.getElementById('flyer-preview-hint');
  const venuePhoto = document.getElementById('venue-photo-img');
  if (venuePhoto) venuePhoto.src = dataUrl || '/images/venue-photo.jpg';

  if (dataUrl) {
    // Fond client : image en background
    if (container) {
      container.style.backgroundImage = `url(${dataUrl})`;
      container.style.backgroundSize  = 'cover';
      container.style.backgroundPosition = 'center';
    }
    // Masquer les éléments décoratifs
    if (overlay) overlay.style.display = 'none';
    if (grid)    grid.style.display    = 'none';
    // Preview DJ
    if (preview) { preview.style.backgroundImage = `url(${dataUrl})`; preview.style.backgroundSize = 'cover'; preview.style.backgroundPosition = 'center'; }
    if (hint)    hint.style.display = 'none';
  } else {
    if (container) { container.style.backgroundImage = ''; container.style.background = 'linear-gradient(135deg,#1a0030,#3b0764,#0c0028)'; }
    if (overlay) overlay.style.display = '';
    if (grid)    grid.style.display    = '';
    if (preview) { preview.style.backgroundImage = ''; preview.style.background = 'linear-gradient(135deg,#1a0030,#3b0764)'; }
    if (hint)    hint.style.display = '';
  }
}

function loadFlyerFromStorage() {
  const saved = localStorage.getItem('djr_flyer');
  if (saved) applyFlyer(saved);
}

function saveSettings() {
  const evName   = document.getElementById('settings-ev-name')?.value.trim();
  const clubName = document.getElementById('settings-club')?.value.trim();
  const orga     = document.getElementById('settings-orga')?.value.trim();
  const address  = document.getElementById('settings-address')?.value.trim();
  const hours    = document.getElementById('settings-hours')?.value.trim();
  if (evName)   { ename = evName; const fn = document.getElementById('flyer-ev-name'); if(fn) fn.textContent = evName;
                  const en = document.getElementById('venue-event-name'); if(en) en.textContent = evName; }
  if (clubName) { const cn = document.getElementById('club-name-strip'); if(cn) cn.textContent = clubName; }
  if (orga)     { const og = document.getElementById('venue-orga'); if(og) og.textContent = orga; }
  if (address)  { const ad = document.getElementById('venue-addr-txt'); if(ad) ad.textContent = address; }
  if (hours)    { const hs = document.getElementById('venue-hours-txt'); if(hs) hs.textContent = hours; }
  if (eid) {
    const updates = {};
    if (evName)   updates.name      = evName;
    if (clubName) updates.club_name = clubName;
    if (orga)     updates.orga      = orga;
    if (address)  updates.address   = address;
    if (hours)    updates.hours     = hours;
    if (Object.keys(updates).length) {
      api('PATCH', '/events/' + eid, updates, {dj: true}).catch(e => {
        console.error('[pullup] Échec enregistrement réglages :', e.message);
        toast('⚠️ Réglages non enregistrés côté serveur — ' + e.message);
        return;
      });
    }
  }
  toast('✅ Réglages enregistrés');
}

// ══ LOCALISATION ═════════════════════════════════════════════════════
function toggleLocation() {
  locActive = !locActive;
  const toggle      = document.getElementById('loc-toggle');
  const knob        = document.getElementById('loc-knob');
  const status      = document.getElementById('loc-status');
  const zoneSelector = document.getElementById('loc-zone-selector');
  if (locActive) {
    toggle.style.background  = '#6F22FF';
    toggle.style.borderColor = '#6F22FF';
    knob.style.left           = '23px';
    knob.style.background     = '#fff';
    status.textContent        = 'Position partagée avec vos amis ✓';
    status.style.color        = '#16C96B';
    zoneSelector.style.display = 'block';
    toast('📍 Position partagée !');
  } else {
    toggle.style.background  = 'var(--bdr)';
    toggle.style.borderColor = 'var(--bdr)';
    knob.style.left           = '3px';
    knob.style.background     = '#fff';
    status.textContent        = 'Dites à vos amis où vous êtes dans la salle';
    status.style.color        = 'var(--tx3)';
    zoneSelector.style.display = 'none';
    toast('📍 Position masquée');
  }
}
function selectZone(btn, zone) {
  selectedZone = zone;
  document.querySelectorAll('.zone-btn').forEach(b => {
    b.style.background  = '#FFFFFF';
    b.style.borderColor = 'var(--bdr)';
    b.style.color       = 'var(--tx2)';
  });
  btn.style.background  = 'rgba(111,34,255,.12)';
  btn.style.borderColor = 'rgba(111,34,255,.35)';
  btn.style.color       = '#6F22FF';
  toast('📍 Zone : ' + zone);
}

// ══ PARTAGE POSITION VENUE ═══════════════════════════════════════════
function shareVenuePosition() {
  const btn       = document.getElementById('share-pos-btn');
  const venueName = document.getElementById('club-name-strip')?.textContent || CLUB_INFO.name;
  const mapsUrl   = `https://maps.google.com/?q=${encodeURIComponent(CLUB_INFO.address)}`;
  const shareText = `Je suis à ${venueName} ce soir ! 🎵\n📍 ${CLUB_INFO.address}\n${mapsUrl}`;
  if (navigator.share) {
    navigator.share({title:`Je suis à ${venueName} 🎵`, text: shareText, url: mapsUrl})
      .then(() => {
        toast('📍 Position partagée !');
        if (btn) { btn.style.background='rgba(22,201,107,.12)'; btn.style.borderColor='rgba(22,201,107,.35)'; btn.style.color='#16C96B'; btn.innerHTML='<span>✓</span> Partagé'; }
      }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(shareText).then(() => toast('📋 Lien copié !'));
    if (btn) { btn.style.background='rgba(22,201,107,.12)'; btn.style.borderColor='rgba(22,201,107,.35)'; btn.style.color='#16C96B'; btn.innerHTML='<span>✓</span> Copié'; }
  }
}

// ══ QR & PARTAGE ════════════════════════════════════════════════════
function _copyFallback(url) {
  const ta = document.createElement('textarea');
  ta.value = url;
  ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  toast(ok ? '📋 URL copiée !' : '🔗 ' + url);
}

function copyUrl() {
  console.log('[pullup] copyUrl() eid=', eid, '| isValidUuid=', isValidUuid(eid));
  const url = buildEventUrl(eid);
  console.log('[pullup] copyUrl() url=', url);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => toast('📋 URL copiée !'))
      .catch(() => _copyFallback(url));
  } else {
    _copyFallback(url);
  }
}
// ══ AMIS ══════════════════════════════════════════════════════════════

function getFriendCode() {
  // Code ami = 8 premiers chars de l'UID en majuscules
  const uid = getUid();
  return uid.slice(0, 8).toUpperCase();
}

function getFriends() {
  return JSON.parse(localStorage.getItem('djr_friends') || '[]');
}

function saveFriends(friends) {
  localStorage.setItem('djr_friends', JSON.stringify(friends));
}

function openAddFriend() {
  // Afficher mon code
  const code = getFriendCode();
  elt('my-friend-code', code);
  document.getElementById('friend-code-input').value = '';
  elt('friend-add-err', '');
  renderFriendsList();
  openModal('modal-friend');
}

function renderFriendsList() {
  const friends = getFriends();
  const list    = document.getElementById('friends-list');
  elt('friends-count', friends.length);
  if (!list) return;

  if (!friends.length) {
    list.innerHTML = '<div style="text-align:center;padding:.75rem;font-size:.78rem;color:var(--tx4)">Aucun ami ajouté pour l\'instant</div>';
    return;
  }

  list.innerHTML = '';
  friends.forEach((f, i) => {
    const colors = ['linear-gradient(135deg,#6F22FF,#FF1C8E)','linear-gradient(135deg,#0071E3,#16C96B)','linear-gradient(135deg,#FF1C8E,#FF9500)'];
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:.65rem;padding:.6rem .8rem;background:#FFFFFF;border:1px solid var(--bdr);border-radius:1rem';
    div.innerHTML = `
      <div style="width:36px;height:36px;border-radius:50%;background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-size:.9rem;color:#fff;flex-shrink:0">${(f.name||'?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.88rem;font-weight:600;color:var(--tx)">${f.name}</div>
        <div style="font-size:.65rem;color:var(--tx4);font-family:'Inter',sans-serif">${f.code}</div>
      </div>
      <button onclick="removeFriend('${f.code}')" style="font-size:.7rem;padding:3px 8px;border-radius:7px;border:1px solid rgba(255,59,87,.2);background:rgba(255,59,87,.06);color:var(--red)">✕</button>`;
    list.appendChild(div);
  });
}

async function addFriendByCode() {
  const input = document.getElementById('friend-code-input');
  const code  = input?.value.trim().toUpperCase();

  if (!code || code.length < 4) { elt('friend-add-err', 'Code trop court (min 4 caractères)'); return; }
  if (code === getFriendCode())  { elt('friend-add-err', "C'est ton propre code !"); return; }

  const friends = getFriends();
  if (friends.find(f => f.code === code)) { elt('friend-add-err', 'Ami déjà ajouté'); return; }

  const name = prompt('Prénom ou surnom de cet ami :') || 'Ami ' + (friends.length + 1);

  // Sync backend
  if (_sbSession) api('POST', '/friends', { friend_code: code, friend_name: name }).catch(() => {});

  friends.push({ code, name, addedAt: Date.now() });
  saveFriends(friends);
  input.value = '';
  elt('friend-add-err', '');
  toast('✅ ' + name + ' ajouté !');
  renderFriendsList();
  renderFriendsOnProfile();
}

function removeFriend(code) {
  if (_sbSession) api('DELETE', '/friends/' + code).catch(() => {});
  const friends = getFriends().filter(f => f.code !== code);
  saveFriends(friends);
  renderFriendsList();
  renderFriendsOnProfile();
  toast('Ami retiré');
}

function renderFriendsOnProfile() {
  const friends = getFriends();
  const list    = document.getElementById('profile-friends-list');
  if (!list) return;

  // Le 1er enfant est la tuile statique "+ Ajouter" (cf. index.html) — on ne
  // touche qu'aux avatars ajoutés dynamiquement après elle.
  Array.from(list.children).slice(1).forEach(el => el.remove());

  const colors = ['linear-gradient(135deg,#6F22FF,#FF1C8E)','linear-gradient(135deg,#0071E3,#16C96B)','linear-gradient(135deg,#FF1C8E,#FF9500)','linear-gradient(135deg,#FF9500,#FF3B30)'];
  friends.forEach((f, i) => {
    const div = document.createElement('div');
    div.onclick = () => navTo('chat');
    div.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:.35rem;cursor:pointer';
    div.innerHTML = `
      <div style="position:relative">
        <div style="width:52px;height:52px;border-radius:50%;background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-size:1.15rem;font-weight:700;color:#fff">${(f.name||'?')[0].toUpperCase()}</div>
        <div style="position:absolute;bottom:1px;right:1px;width:12px;height:12px;border-radius:50%;background:var(--green);border:2px solid #fff"></div>
      </div>
      <div style="font-size:.66rem;color:var(--tx2);font-weight:600;max-width:56px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</div>`;
    list.appendChild(div);
  });
}

// ══ SUBSCRIBE ════════════════════════════════════════════════════════
function selPlan(el) {
  document.querySelectorAll('.plan').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
  selectedPlan = el.dataset.plan;
}
function doSubscribe() {
  subscribed = true; subCount++;
  const names = {free:'Gratuit', fan:'Fan ⭐', vip:'VIP 💎'};
  closeModal('modal-sub');
  const btn = document.getElementById('pk-sub-btn');
  if (btn) { btn.classList.add('done'); document.getElementById('pk-sub-ico').textContent='✓'; document.getElementById('pk-sub-txt').textContent='Abonné'; }
  elt('pk-subs-n', subCount.toLocaleString('fr-FR'));
  toast(`🎉 Abonnement ${names[selectedPlan]} activé !`);
}

// ══ LISTENERS CENTRALISÉS ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener('click', fn); };

  // Bannière DJ : se réduit dès qu'on scrolle dans la liste de propositions,
  // pour laisser plus de place à l'écran — revient dès qu'on remonte en haut.
  const cliScroll = document.getElementById('cli-scroll');
  const djBanner  = document.getElementById('dj-banner');
  if (cliScroll && djBanner) {
    cliScroll.addEventListener('scroll', () => {
      if (cliScroll.scrollTop > 24)      djBanner.classList.add('collapsed');
      else if (cliScroll.scrollTop < 8)  djBanner.classList.remove('collapsed');
    }, { passive: true });
  }

  // Bannière "Ajouter à l'écran d'accueil" : seule façon d'éliminer les barres
  // Safari sur iOS (impossible à masquer autrement depuis un onglet du navigateur).
  const isIOS       = /iPhone|iPod|iPad/.test(navigator.userAgent) ||
                       (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari    = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true ||
                        window.matchMedia('(display-mode: standalone)').matches;
  const a2hsBanner  = document.getElementById('a2hs-banner');
  if (a2hsBanner && isIOS && isSafari && !isStandalone && !localStorage.getItem('djr_a2hs_dismissed')) {
    setTimeout(() => a2hsBanner.classList.add('show'), 3000);
  }
  on('a2hs-close', () => {
    a2hsBanner.classList.remove('show');
    localStorage.setItem('djr_a2hs_dismissed', '1');
  });

  // Auth
  on('btn-google',       signInGoogle);
  on('btn-phone-action', phoneAction);
  on('btn-orga',         () => showPage('dj-login'));

  // Nav
  on('nav-vote',    () => navTo('client'));
  on('nav-chat',    () => navTo('chat'));
  on('nav-profile', () => navTo('profile'));
  on('nav-dj',      () => navTo('presskit'));

  // DJ login
  on('btn-dj-login', djLogin);
  on('btn-dj-back',  () => showPage('auth'));

  // Modal Proposer
  on('btn-fab-propose', () => {
    if (eventClosed) { toast('🔒 Cette soirée est terminée'); return; }
    const card = document.getElementById('btn-fab-propose');
    card.classList.remove('shake');
    void card.offsetWidth; // force le reflow pour pouvoir rejouer l'animation
    card.classList.add('shake');
    setTimeout(() => openModal('modal-propose'), 400);
  });
  on('modal-ok',        submitProposal);
  on('btn-modal-cancel', () => closeModal('modal-propose'));
  const mq = document.getElementById('modal-q');
  if (mq) mq.addEventListener('input', renderModalList);

  // Modal Subscribe
  on('btn-modal-sub-cancel', () => closeModal('modal-sub'));
  on('btn-modal-sub-ok',     doSubscribe);

  // Modal QR
  on('btn-modal-qr-copy',  () => { copyUrl(); closeModal('modal-qr'); });
  on('btn-modal-qr-close', () => closeModal('modal-qr'));

  // Profil
  on('btn-edit-profile',    openProfileEdit);
  on('btn-save-profile',    saveProfile);
  on('btn-save-dj-profile', saveDjProfile);
  on('btn-user-logout',     logout);

  // Amis
  on('btn-add-friend',        addFriendByCode);
  on('btn-copy-friend-code',  () => {
    const code = getFriendCode();
    navigator.clipboard?.writeText(code).then(() => toast('📋 Code copié : ' + code));
  });
  const fi = document.getElementById('friend-code-input');
  if (fi) fi.addEventListener('keydown', e => { if (e.key === 'Enter') addFriendByCode(); });
});
