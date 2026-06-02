// ══ STATE GLOBAL ═════════════════════════════════════════════════════
let currentUser  = null;
let confirmResult = null, otpPhase = false, resendTimer = null, resendCD = 30;
let eid   = null, ename = 'Soirée DJ Request';
let proposals = {}, myVotes = new Set(), nowPlaying = {t:'Strobe', a:'Deadmau5'};
let prog  = 0, selModal = null, selectedPlan = 'free', subscribed = false, subCount = 1284;
let djLoggedIn = false;
let _djPassword = null;
let locActive = false, selectedZone = '';

// ══ UTILS ════════════════════════════════════════════════════════════
function elt(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
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
}

function navTo(id) {
  if (id === 'dj' && !djLoggedIn) { showPage('dj-login'); return; }
  showPage(id);
  ['vote','chat','profile','dj'].forEach(t => document.getElementById('nav-' + t)?.classList.remove('active'));
  const map = {client:'vote', chat:'chat', profile:'profile', presskit:'dj', dj:'dj'};
  const navId = map[id];
  if (navId) document.getElementById('nav-' + navId)?.classList.add('active');
}

// ══ MODALS ═══════════════════════════════════════════════════════════
function openModal(id) {
  if (id === 'modal-propose') {
    selModal = null;
    document.getElementById('modal-q').value = '';
    document.getElementById('modal-ok').disabled = true;
    renderModalList();
  }
  document.getElementById(id).classList.add('open');
}
function closeModal(id)          { document.getElementById(id).classList.remove('open'); }
function closeModalOut(id, e)    { if (e.target === document.getElementById(id)) closeModal(id); }

// ══ VOTE & PROPOSE ═══════════════════════════════════════════════════
function vote(id) {
  if (!proposals[id]) return;
  if (myVotes.has(id)) {
    myVotes.delete(id);
    proposals[id].votes = Math.max(0, (proposals[id].votes || 0) - 1);
    renderAll(); toast('Vote retiré');
    if (eid && _sbSession) api('DELETE', '/votes/' + eid + '/' + id).catch(() => {});
  } else {
    myVotes.add(id);
    proposals[id].votes = (proposals[id].votes || 0) + 1;
    renderAll(); toast('Voté ! 🎵');
    if (eid && _sbSession) api('POST', '/votes', {proposal_id: id, event_id: eid}).catch(() => {});
  }
}

async function submitProposal() {
  if (!selModal) return;
  const s = CAT.find(x => x.id === selModal); if (!s) return;
  proposals[s.id] = {id: s.id, votes: 1, approved: false};
  myVotes.add(s.id); renderAll();
  closeModal('modal-propose'); toast(`🎵 "${s.n}" proposé !`);
  if (eid && _sbSession) api('POST', '/proposals', {song_id: s.id, event_id: eid}).catch(() => {});
}

// ══ DJ ACTIONS ═══════════════════════════════════════════════════════
async function djPlay(id) {
  const s = CAT.find(x => x.id === id); if (!s) return;
  nowPlaying = {t: s.n, a: s.a}; prog = 0;
  delete proposals[id]; renderAll(); toast(`▶ ${s.n}`);
  if (eid) {
    api('PUT',    '/now-playing/' + eid, {title: s.n, artist: s.a}, {dj: true}).catch(() => {});
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
  document.querySelector('#nav-dj .nav-tab-lbl').textContent = 'DJ Nova';
  showPage('client');
}
async function createNewEvent(n) {
  const name = n || ename;
  const pwd  = _djPassword || prompt('Mot de passe pour cette soirée :');
  if (!pwd) return;
  try {
    const ev = await api('POST', '/events', {name, password: pwd});
    eid = ev.id; ename = ev.name; _djPassword = pwd;
    localStorage.setItem('djr_eid', eid); localStorage.setItem('djr_ename', ename);
    subscribeToEvent(eid); generateQR(); toast(`✅ "${name}" créée !`);
  } catch(e) { toast('Erreur: ' + e.message); }
}

// ══ DJ DASHBOARD TABS ════════════════════════════════════════════════
function switchOrgaTab(tab, btn) {
  ['live','modo','pk','settings'].forEach(t => {
    const el = document.getElementById('orga-' + t);
    if (el) el.style.display = 'none';
    const tb = document.getElementById('otab-' + t);
    if (tb) { tb.style.color = 'rgba(255,255,255,.4)'; tb.style.borderBottom = '2px solid transparent'; tb.style.fontWeight = '600'; }
  });
  const el = document.getElementById('orga-' + tab);
  if (el) el.style.display = 'flex';
  if (btn) { btn.style.color = '#8B5CF6'; btn.style.borderBottom = '2px solid #8B5CF6'; btn.style.fontWeight = '700'; }
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
    div.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.45rem .65rem;background:rgba(255,255,255,.03);border-radius:.75rem;border:1px solid rgba(255,255,255,.06)';
    div.innerHTML = `<div style="flex:1;min-width:0"><div style="font-size:.65rem;color:rgba(255,255,255,.35);margin-bottom:1px">${name||'Moi'}</div><div style="font-size:.8rem;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${txt}</div></div>`;
    list.appendChild(div);
  });
  if (!list.children.length) list.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.78rem;color:rgba(255,255,255,.25)">Aucun message</div>';
}
function saveSettings() {
  const evName   = document.getElementById('settings-ev-name')?.value.trim();
  const clubName = document.getElementById('settings-club')?.value.trim();
  if (evName)   { ename = evName; const fn = document.getElementById('flyer-ev-name'); if(fn) fn.textContent = evName; }
  if (clubName) { const cn = document.getElementById('club-name-strip'); if(cn) cn.textContent = clubName; }
  if (eid && evName) api('PATCH', '/events/' + eid, {name: evName}, {dj: true}).catch(() => {});
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
    toggle.style.background  = '#8B5CF6';
    toggle.style.borderColor = '#8B5CF6';
    knob.style.left           = '23px';
    knob.style.background     = '#fff';
    status.textContent        = 'Position partagée avec vos amis ✓';
    status.style.color        = '#34C759';
    zoneSelector.style.display = 'block';
    toast('📍 Position partagée !');
  } else {
    toggle.style.background  = 'rgba(255,255,255,.1)';
    toggle.style.borderColor = 'rgba(255,255,255,.15)';
    knob.style.left           = '3px';
    knob.style.background     = 'rgba(255,255,255,.5)';
    status.textContent        = 'Dites à vos amis où vous êtes dans la salle';
    status.style.color        = 'rgba(255,255,255,.45)';
    zoneSelector.style.display = 'none';
    toast('📍 Position masquée');
  }
}
function selectZone(btn, zone) {
  selectedZone = zone;
  document.querySelectorAll('.zone-btn').forEach(b => {
    b.style.background  = 'rgba(255,255,255,.05)';
    b.style.borderColor = 'rgba(255,255,255,.1)';
    b.style.color       = 'rgba(255,255,255,.7)';
  });
  btn.style.background  = 'rgba(139,92,246,.2)';
  btn.style.borderColor = 'rgba(139,92,246,.4)';
  btn.style.color       = '#fff';
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
        if (btn) { btn.style.background='rgba(52,199,89,.2)'; btn.style.borderColor='rgba(52,199,89,.4)'; btn.style.color='#34C759'; btn.innerHTML='<span>✓</span> Partagé'; }
      }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(shareText).then(() => toast('📋 Lien copié !'));
    if (btn) { btn.style.background='rgba(52,199,89,.2)'; btn.style.borderColor='rgba(52,199,89,.4)'; btn.style.color='#34C759'; btn.innerHTML='<span>✓</span> Copié'; }
  }
}

// ══ QR & PARTAGE ════════════════════════════════════════════════════
function copyUrl() {
  const url = eid ? `${window.location.href.split('?')[0]}?event=${eid}` : window.location.href;
  navigator.clipboard?.writeText(url).then(() => toast('📋 URL copiée !')).catch(() => toast(url));
}
function openAddFriend() { openModal('modal-friend'); }

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

// ══ PROGRESS BAR (tick) ══════════════════════════════════════════════
setInterval(() => {
  prog = (prog + 0.1) % 100;
  const p = prog.toFixed(1) + '%';
  ['dj-prog','bs-prog-f'].forEach(id => { const e = document.getElementById(id); if (e) e.style.width = p; });
}, 200);

// ══ LISTENERS CENTRALISÉS ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener('click', fn); };

  // Auth
  on('btn-google',       signInGoogle);
  on('btn-phone-action', phoneAction);
  on('btn-orga',         () => showPage('dj-login'));
  on('btn-guest',        guestLogin);

  // Nav
  on('nav-vote',    () => navTo('client'));
  on('nav-chat',    () => navTo('chat'));
  on('nav-profile', () => navTo('profile'));
  on('nav-dj',      () => navTo('presskit'));

  // DJ login
  on('btn-dj-login', djLogin);
  on('btn-dj-back',  () => showPage('auth'));

  // Modal Proposer
  on('btn-fab-propose', () => openModal('modal-propose'));
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
});
