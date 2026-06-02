// ══ CHAT ═════════════════════════════════════════════════════════════
let chatInitialized = false;
let chatUnread      = 0;

function initChat() {
  if (chatInitialized) return;
  chatInitialized = true;
  // Firebase n'est plus utilisé — le chat fonctionne en local + Supabase Realtime (subscribeToEvent)
}

function appendChatMsg(msg, msgKey) {
  const uid       = getUid();
  const isMe      = msg.uid === uid;
  const container = document.getElementById('chat-messages'); if (!container) return;

  const wrapper = document.createElement('div');
  if (msgKey) wrapper.id = 'msg-' + msgKey;
  wrapper.style.cssText = `display:flex;flex-direction:column;align-items:${isMe?'flex-end':'flex-start'};gap:2px`;

  const name = document.createElement('div');
  name.style.cssText = 'font-size:.6rem;color:rgba(255,255,255,.4);margin:0 .5rem;font-weight:600';
  name.textContent   = isMe ? '' : msg.name || 'Invité';

  const row = document.createElement('div');
  row.style.cssText = `display:flex;align-items:flex-end;gap:.4rem;flex-direction:${isMe?'row-reverse':'row'}`;

  const bubble = document.createElement('div');
  bubble.style.cssText = `max-width:78%;padding:.6rem .9rem;border-radius:${isMe?'18px 18px 4px 18px':'18px 18px 18px 4px'};background:${isMe?'#8B5CF6':'rgba(255,255,255,.1)'};border:${isMe?'none':'1px solid rgba(255,255,255,.12)'};backdrop-filter:blur(10px);position:relative;word-break:break-word`;
  if (msg.reported) bubble.style.opacity = '.5';

  if (msg.photo) {
    const img = document.createElement('img');
    img.src   = msg.photo;
    img.style.cssText = 'max-width:220px;max-height:200px;border-radius:10px;display:block;object-fit:cover';
    img.onclick = () => { const w = window.open(); w.document.write(`<img src="${msg.photo}" style="max-width:100%;max-height:100vh">`); };
    bubble.appendChild(img);
  }
  if (msg.text) {
    const txt = document.createElement('div');
    txt.style.cssText = 'font-size:.88rem;color:#ffffff;line-height:1.4';
    txt.textContent   = msg.text;
    bubble.appendChild(txt);
  }
  const time = document.createElement('div');
  const d    = new Date(msg.ts || Date.now());
  time.style.cssText = `font-size:.58rem;color:rgba(255,255,255,.4);margin-top:3px;text-align:${isMe?'right':'left'}`;
  time.textContent   = d.getHours() + ':' + (d.getMinutes()+'').padStart(2,'0');
  bubble.appendChild(time);

  // Bouton DJ (supprimer) ou invité (signaler)
  const actionBtn = document.createElement('button');
  if (djLoggedIn && !isMe) {
    actionBtn.style.cssText = 'background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.2);border-radius:8px;padding:4px 7px;font-size:.7rem;color:#F87171;flex-shrink:0;opacity:.7;transition:opacity .2s';
    actionBtn.textContent   = '🗑️';
    actionBtn.title         = 'Supprimer';
    actionBtn.onclick       = () => { wrapper.remove(); toast('🗑️ Message supprimé'); };
  } else if (!isMe) {
    const alreadyReported = msg.reported;
    actionBtn.style.cssText = `background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 7px;font-size:.7rem;color:${alreadyReported?'#F59E0B':'rgba(255,255,255,.35)'};flex-shrink:0;opacity:.7;transition:all .2s`;
    actionBtn.textContent   = alreadyReported ? '⚑' : '⚐';
    actionBtn.title         = 'Signaler';
    actionBtn.onclick       = () => {
      if (alreadyReported) return;
      actionBtn.textContent      = '⚑';
      actionBtn.style.color      = '#F59E0B';
      bubble.style.opacity       = '.5';
      toast('🚩 Message signalé au DJ');
    };
  }

  row.appendChild(bubble);
  if (!isMe)       row.appendChild(actionBtn);
  else if (djLoggedIn) row.appendChild(actionBtn);
  if (!isMe) wrapper.appendChild(name);
  wrapper.appendChild(row);
  container.appendChild(wrapper);
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
    div.style.cssText = 'display:flex;align-items:flex-start;gap:.65rem;padding:.7rem .85rem;background:rgba(248,113,113,.06);border:1px solid rgba(248,113,113,.2);border-radius:1rem;margin-bottom:.4rem';
    div.innerHTML = `<div style="flex:1;min-width:0">
      <div style="font-size:.7rem;font-weight:700;color:#F87171;margin-bottom:2px">⚑ ${msg.name||'Invité'}</div>
      <div style="font-size:.82rem;color:rgba(255,255,255,.7)">${msg.text||'[photo]'}</div>
    </div>
    <div style="display:flex;gap:.3rem;flex-shrink:0">
      <button onclick="djIgnoreReport('${key}')" style="font-size:.7rem;padding:4px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:rgba(255,255,255,.5)">Ignorer</button>
      <button onclick="djDeleteReport('${key}','${msg.msgKey||key}')" style="font-size:.7rem;padding:4px 8px;border-radius:7px;border:1px solid rgba(248,113,113,.25);background:rgba(248,113,113,.1);color:#F87171">Supprimer</button>
    </div>`;
    list.appendChild(div);
  });
}
function djIgnoreReport(key) { toast('✓ Signalement ignoré'); }
function djDeleteReport(key, msgKey) {
  const el = document.getElementById('msg-' + msgKey); if (el) el.remove();
  toast('🗑️ Message supprimé');
}

function initReportsListener() {
  // Supabase Realtime gère les rapports via subscribeToEvent
}

function sendChatMsg() {
  const inp  = document.getElementById('chat-input');
  const text = inp?.value.trim(); if (!text) return;
  const uid  = getUid();
  const name = currentUser?.displayName || currentUser?.phoneNumber || 'Invité';
  const msg  = {uid, name, text, ts: Date.now()};
  appendChatMsg(msg);
  if (inp) { inp.value = ''; inp.style.height = 'auto'; }
  document.getElementById('chat-send-btn').disabled = true;
  document.getElementById('chat-send-btn').style.opacity = '.4';
  scrollChatBottom();
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
    {uid:'u1', name:'Marie 🌹', text:"C'est trop bien ce soir 🔥",         ts: Date.now()-300000},
    {uid:'u2', name:'Thomas',   text:"Quelqu'un a vu le DJ warm-up ?",     ts: Date.now()-240000},
    {uid:'u1', name:'Marie 🌹', text:'Ouii il était incroyable !',         ts: Date.now()-180000},
    {uid:'u3', name:'Alex',     text:'Votez pour Blinding Lights svp 🎵',  ts: Date.now()-120000},
  ];
  demos.forEach(m => appendChatMsg(m));
}
