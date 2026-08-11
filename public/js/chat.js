// ══ CHAT ═════════════════════════════════════════════════════════════
let chatInitialized = false;
let chatUnread      = 0;

const REACTION_EMOJIS = ['🔥', '👍', '❤️', '💜'];
const AVATAR_COLORS   = ['#6F22FF', '#0071E3', '#16C96B', '#FF9500', '#C4127A'];

function initChat() {
  if (chatInitialized) return;
  chatInitialized = true;
  loadChatHistory(); // charger l'historique depuis le backend
}

// Rattrapage des messages manqués : le websocket Realtime se coupe quand le
// téléphone se verrouille ou change de réseau (fréquent en soirée) sans que
// l'app le détecte autrement — on recharge l'historique au retour au premier plan.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && chatInitialized && eid) loadChatHistory();
});

function isDjName(name) { return (name || '').toLowerCase().includes('nova'); }

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function appendChatMsg(msg, msgKey) {
  const uid       = getUid();
  const isMe      = msg.uid === uid;
  const isDJ      = isDjName(msg.name);
  const container = document.getElementById('chat-messages'); if (!container) return;
  const name      = isMe ? (currentUser?.displayName || 'Moi') : (msg.name || 'Invité');

  const wrapper = document.createElement('div');
  wrapper.className = 'chat-msg';
  if (msgKey) wrapper.id = 'msg-' + msgKey;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar' + (isDJ ? ' dj' : '');
  if (isDJ) {
    avatar.style.backgroundImage = "url('/images/dj-avatar.png')";
  } else {
    avatar.style.background = avatarColor(name);
    avatar.textContent = name[0]?.toUpperCase() || '?';
  }

  const col = document.createElement('div');
  col.className = 'chat-msg-col';

  const head = document.createElement('div');
  head.className = 'chat-msg-head';
  const nameEl = document.createElement('span');
  nameEl.className = 'chat-msg-name' + (isDJ ? ' dj' : '');
  nameEl.textContent = name;
  head.appendChild(nameEl);
  if (isDJ) {
    const badge = document.createElement('span');
    badge.className = 'chat-admin-badge';
    badge.textContent = 'Admin';
    head.appendChild(badge);
  }

  const bubbleRow = document.createElement('div');
  bubbleRow.className = 'chat-bubble-row';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble' + (isDJ ? ' dj' : '');
  if (msg.reported) bubble.style.opacity = '.5';

  if (msg.photo) {
    const img = document.createElement('img');
    img.src   = msg.photo;
    img.onclick = () => { const w = window.open(); w.document.write(`<img src="${msg.photo}" style="max-width:100%;max-height:100vh">`); };
    bubble.appendChild(img);
  }
  if (msg.text) {
    const txt = document.createElement('div');
    txt.textContent = msg.text;
    bubble.appendChild(txt);
  }
  const time = document.createElement('span');
  time.className = 'chat-msg-time';
  const d = new Date(msg.ts || Date.now());
  time.textContent = d.getHours() + ':' + (d.getMinutes()+'').padStart(2,'0');
  bubbleRow.appendChild(bubble);
  bubbleRow.appendChild(time);

  // Réactions
  const reactions = document.createElement('div');
  reactions.className = 'chat-reactions';
  renderReactionPills(reactions, msg.reactions || {}, msgKey);

  col.appendChild(head);
  col.appendChild(bubbleRow);
  col.appendChild(reactions);

  // Actions (DJ : supprimer + épingler / invité : signaler)
  const actions = document.createElement('div');
  actions.className = 'chat-msg-actions';
  if (djLoggedIn && !isMe) {
    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'background:rgba(255,59,87,.08);border:1px solid rgba(255,59,87,.2);border-radius:8px;padding:4px 7px;font-size:.7rem;color:var(--red);opacity:.7';
    delBtn.textContent = '🗑️'; delBtn.title = 'Supprimer';
    delBtn.onclick = () => { wrapper.remove(); if (msgKey) deleteChatMsg(msgKey); toast('🗑️ Message supprimé'); };
    actions.appendChild(delBtn);
    if (msgKey) {
      const pinBtn = document.createElement('button');
      pinBtn.style.cssText = 'background:rgba(141,44,255,.08);border:1px solid rgba(141,44,255,.2);border-radius:8px;padding:4px 7px;font-size:.7rem;color:#8D2CFF;opacity:.7';
      pinBtn.textContent = '📌'; pinBtn.title = 'Épingler';
      pinBtn.onclick = () => pinMessage(msgKey, msg);
      actions.appendChild(pinBtn);
    }
  } else if (!isMe) {
    const alreadyReported = msg.reported;
    const repBtn = document.createElement('button');
    repBtn.style.cssText = `background:var(--ink5);border:1px solid var(--bdr);border-radius:8px;padding:4px 7px;font-size:.7rem;color:${alreadyReported?'#FF9500':'var(--tx4)'};opacity:.7`;
    repBtn.textContent = alreadyReported ? '⚑' : '⚐'; repBtn.title = 'Signaler';
    repBtn.onclick = () => {
      if (alreadyReported) return;
      repBtn.textContent = '⚑'; repBtn.style.color = '#FF9500'; bubble.style.opacity = '.5';
      if (msgKey) reportChatMsg(msgKey);
      toast('🚩 Message signalé au DJ');
    };
    actions.appendChild(repBtn);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(col);
  if (actions.children.length) wrapper.appendChild(actions);
  container.appendChild(wrapper);
}

// ── Réactions ────────────────────────────────────────────────────────
function renderReactionPills(container, reactions, msgKey) {
  container.innerHTML = '';
  Object.entries(reactions).forEach(([emoji, count]) => {
    if (!count) return;
    const pill = document.createElement('button');
    pill.className = 'chat-reaction-pill';
    pill.textContent = `${emoji} ${count}`;
    pill.onclick = () => reactToMessage(msgKey, emoji, pill);
    container.appendChild(pill);
  });
  if (!msgKey || msgKey.startsWith('tmp_')) return; // message optimiste pas encore persisté → pas de réaction possible
  const addBtn = document.createElement('button');
  addBtn.className = 'chat-react-add';
  addBtn.textContent = '+';
  addBtn.onclick = () => document.getElementById('react-picker-' + msgKey)?.classList.toggle('open');
  container.appendChild(addBtn);

  const picker = document.createElement('div');
  picker.className = 'chat-react-picker';
  picker.id = 'react-picker-' + msgKey;
  REACTION_EMOJIS.forEach(emoji => {
    const b = document.createElement('button');
    b.textContent = emoji;
    b.onclick = () => { picker.classList.remove('open'); reactToMessage(msgKey, emoji); };
    picker.appendChild(b);
  });
  container.appendChild(picker);
}

async function reactToMessage(msgKey, emoji) {
  if (!msgKey) return;
  try {
    const { reactions } = await api('PATCH', `/messages/${msgKey}/react`, { emoji });
    const wrapper = document.getElementById('msg-' + msgKey);
    const container = wrapper?.querySelector('.chat-reactions');
    if (container) renderReactionPills(container, reactions || {}, msgKey);
  } catch (e) {
    toast('⚠️ Réaction non enregistrée — ' + e.message);
  }
}

// ── Épinglage (DJ) ──────────────────────────────────────────────────
async function pinMessage(msgKey, msg) {
  if (!eid) return;
  try {
    await api('PATCH', `/messages/${eid}/${msgKey}/pin`, null, { dj: true });
    renderPinnedMessage({ id: msgKey, user_name: msg.name, text: msg.text, created_at: new Date(msg.ts || Date.now()).toISOString() });
    toast('📌 Message épinglé');
  } catch (e) {
    toast('⚠️ Échec épinglage — ' + e.message);
  }
}
async function unpinMessage(msgKey) {
  if (!eid || !msgKey) return;
  try {
    await api('PATCH', `/messages/${eid}/${msgKey}/unpin`, null, { dj: true });
    document.getElementById('chat-pinned').style.display = 'none';
  } catch (e) {
    toast('⚠️ Échec — ' + e.message);
  }
}

function renderPinnedMessage(msg) {
  const box = document.getElementById('chat-pinned'); if (!box) return;
  if (!msg) { box.style.display = 'none'; return; }
  const isDJ = isDjName(msg.user_name);
  const d = new Date(msg.created_at);
  const time = d.getHours() + ':' + (d.getMinutes()+'').padStart(2,'0');
  const avatarHTML = isDJ
    ? `<img class="chat-pinned-av" src="/images/dj-avatar.png" alt="">`
    : `<div class="chat-pinned-av" style="background:${avatarColor(msg.user_name)};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800">${(msg.user_name||'?')[0].toUpperCase()}</div>`;
  box.innerHTML = `
    ${avatarHTML}
    <div class="chat-pinned-body">
      <div class="chat-pinned-lbl">📌 Message épinglé</div>
      <div class="chat-pinned-txt">${msg.text || ''}</div>
      <div class="chat-pinned-time">${time}</div>
    </div>
    <div class="chat-pinned-ico" ${djLoggedIn ? `onclick="unpinMessage('${msg.id}')" title="Retirer"` : ''}>📌</div>`;
  box.style.display = 'flex';
}

// ── Suppression / signalement (persistés côté serveur) ────────────────
async function deleteChatMsg(msgKey) {
  try { await api('DELETE', '/messages/' + msgKey); }
  catch (e) { toast('⚠️ Échec suppression — ' + e.message); }
}
async function reportChatMsg(msgKey) {
  if (!eid) return;
  try { await api('POST', '/reports', { message_id: msgKey, event_id: eid }); }
  catch (e) { /* déjà signalé ou échec réseau : le feedback visuel local reste affiché */ }
}

function renderDJReports(reports) {
  const section = document.getElementById('dj-reports-section');
  const list    = document.getElementById('dj-reports-list');
  if (!section || !list) return;
  if (!reports || Object.keys(reports).length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = '';
  Object.entries(reports).forEach(([key, msg]) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:flex-start;gap:.65rem;padding:.7rem .85rem;background:rgba(255,59,87,.05);border:1px solid rgba(255,59,87,.2);border-radius:1rem;margin-bottom:.4rem';
    div.innerHTML = `<div style="flex:1;min-width:0">
      <div style="font-size:.7rem;font-weight:700;color:var(--red);margin-bottom:2px">⚑ ${msg.name||'Invité'}</div>
      <div style="font-size:.82rem;color:var(--tx2)">${msg.text||'[photo]'}</div>
    </div>
    <div style="display:flex;gap:.3rem;flex-shrink:0">
      <button onclick="djIgnoreReport('${key}')" style="font-size:.7rem;padding:4px 8px;border-radius:7px;border:1px solid var(--bdr);background:#FFFFFF;color:var(--tx3)">Ignorer</button>
      <button onclick="djDeleteReport('${key}','${msg.msgKey||key}')" style="font-size:.7rem;padding:4px 8px;border-radius:7px;border:1px solid rgba(255,59,87,.25);background:rgba(255,59,87,.08);color:var(--red)">Supprimer</button>
    </div>`;
    list.appendChild(div);
  });
}
function djIgnoreReport(key) { toast('✓ Signalement ignoré'); }
function djDeleteReport(key, msgKey) {
  const el = document.getElementById('msg-' + msgKey); if (el) el.remove();
  toast('🗑️ Message supprimé');
}

function initReportsListener() {}

// ── Historique du chat ────────────────────────────────────────────────
async function loadChatHistory() {
  if (!eid) return;
  try {
    const messages = await api('GET', '/messages/' + eid);
    updateDjBubbleFromMessages(messages);
    const pinned = messages.find(m => m.pinned);
    renderPinnedMessage(pinned || null);
    const container = document.getElementById('chat-messages');
    if (!container || !messages.length) return;
    // Vider les messages de démo avant d'afficher l'historique réel
    container.innerHTML = '<div style="text-align:center;padding:1rem 0"><div style="font-size:.68rem;color:var(--tx4);background:var(--ink3);border:1px solid var(--bdr);border-radius:18px;padding:.3rem .85rem;display:inline-block">Bienvenue dans le chat de la soirée 🎵</div></div>';
    messages.forEach(m => appendChatMsg({
      uid:  m.user_id,
      name: m.user_name || 'Invité',
      text: m.text,
      photo: m.photo_url || null,
      ts:   new Date(m.created_at).getTime(),
      reported: m.reported,
      reactions: m.reactions || {},
    }, m.id));
    scrollChatBottom();
  } catch(e) {}
}

// ── Bulle "dernier message" du DJ dans le bandeau vote ────────────────
function updateDjBubbleFromMessages(messages) {
  const djMsgs = (messages || []).filter(m => (m.user_name || '').toLowerCase().includes('nova'));
  if (!djMsgs.length) return;
  const last = djMsgs[djMsgs.length - 1];
  updateDjBubble(last.text);
}
function updateDjBubble(text) {
  const el = document.getElementById('dj-bubble-text');
  if (el && text) el.textContent = text;
}

// ── Réception temps réel (autres participants) ─────────────────────────
function handleRealtimeMessage(m) {
  if (!m || m.deleted) return;
  if (document.getElementById('msg-' + m.id)) return; // déjà affiché

  if (m.user_id === currentUser?.uid) {
    // Notre propre message est déjà affiché en optimiste (id tmp_…) — on ne le
    // duplique pas. Le tmp reste tel quel, ce qui suffit visuellement.
    return;
  }

  appendChatMsg({
    uid:  m.user_id,
    name: m.user_name || 'Invité',
    text: m.text,
    photo: m.photo_url || null,
    ts:   new Date(m.created_at).getTime(),
    reported: m.reported,
    reactions: m.reactions || {},
  }, m.id);

  if (isDjName(m.user_name)) updateDjBubble(m.text);
  scrollChatBottom();

  const chatPage = document.getElementById('pg-chat');
  if (!chatPage || !chatPage.classList.contains('active')) {
    chatUnread++;
    const badge = document.getElementById('chat-badge');
    if (badge) { badge.textContent = chatUnread; badge.style.display = 'flex'; }
  }
}

// ── Envoi d'un message ────────────────────────────────────────────────
async function sendChatMsg() {
  const inp  = document.getElementById('chat-input');
  const text = inp?.value.trim(); if (!text) return;
  const uid  = getUid();
  const name = currentUser?.displayName || currentUser?.phoneNumber || 'Invité';

  // Affichage optimiste immédiat
  const tmpId = 'tmp_' + Date.now();
  appendChatMsg({uid, name, text, ts: Date.now()}, tmpId);
  if (djLoggedIn) updateDjBubble(text);
  if (inp) { inp.value = ''; inp.style.height = 'auto'; }
  document.getElementById('chat-send-btn').disabled = true;
  document.getElementById('chat-send-btn').style.opacity = '.4';
  scrollChatBottom();

  // Envoi au backend si connecté à un événement (invité, téléphone ou Google —
  // toute session authentifiée, pas seulement Supabase)
  if (eid && (_authToken || _sbSession)) {
    try {
      await api('POST', '/messages', { event_id: eid, text });
      // Le message persisté arrivera via l'abonnement Realtime (handleRealtimeMessage),
      // qui retire ce message optimiste et l'affiche avec son vrai id. On ne le retire
      // pas ici pour éviter qu'il disparaisse si le Realtime met du temps à arriver.
    } catch(e) { /* message local gardé */ }
  }
}

function chatInputChanged() {
  const inp = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send-btn');
  const hasText = inp?.value.trim().length > 0;
  if (btn) { btn.disabled = !hasText; btn.style.opacity = hasText ? '1' : '.4'; }
}

async function sendPhoto(input) {
  const file = input.files[0]; if (!file) return;
  toast('📷 Compression de la photo…');
  try {
    const dataUrl = await compressImage(file, 800, 0.65);
    const uid  = getUid();
    const name = currentUser?.displayName || currentUser?.phoneNumber || 'Invité';
    appendChatMsg({uid, name, photo: dataUrl, ts: Date.now()});
    scrollChatBottom();
    input.value = '';
  } catch(e) { toast('❌ Erreur photo'); }
}

function compressImage(file, maxW, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale  = Math.min(1, maxW / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = img.width  * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function scrollChatBottom() { const s = document.getElementById('chat-scroll'); if (s) setTimeout(() => s.scrollTop = s.scrollHeight, 100); }
function chatMarkRead()     { chatUnread = 0; const b = document.getElementById('chat-badge'); if (b) b.style.display = 'none'; }

function loadDemoChat() {
  const demos = [
    {uid:'u1', name:'Marie 🌹', text:"C'est trop bien ce soir 🔥",         ts: Date.now()-310000},
    {uid:'u2', name:'Thomas',   text:"Quelqu'un a vu le DJ warm-up ?",     ts: Date.now()-240000},
    {uid:'u1', name:'Marie 🌹', text:'Ouii il était incroyable !',         ts: Date.now()-180000},
    {uid:'u3', name:'Alex',     text:'Votez pour Blinding Lights svp 🎵',  ts: Date.now()-120000},
  ];
  demos.forEach(m => appendChatMsg(m));
}
