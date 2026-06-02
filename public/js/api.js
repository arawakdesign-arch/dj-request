// ══ SUPABASE CLIENT ══════════════════════════════════════════════════
let _sb = null, _sbSession = null;
try {
  _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
} catch(e) { console.warn('Supabase init failed:', e.message); }

// ── Fetch helper vers le serveur Node.js ─────────────────────────────
async function api(method, path, body, { dj } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (_sbSession?.access_token) headers['Authorization'] = 'Bearer ' + _sbSession.access_token;
  if (dj && _djPassword)        headers['x-organizer-password'] = _djPassword;
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
  if (!_sb) return;
  _sb.channel('proposals:' + evId)
    .on('postgres_changes', {event:'*', schema:'public', table:'proposals', filter:'event_id=eq.'+evId},
      async () => {
        const p = await api('GET', '/proposals/' + evId);
        proposals = Object.fromEntries(p.map(x => [x.id, x]));
        renderAll();
      })
    .subscribe();

  _sb.channel('messages:' + evId)
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'messages', filter:'event_id=eq.'+evId},
      p => appendChatMsg(p.new, p.new.id))
    .subscribe();

  _sb.channel('np:' + evId)
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'now_playing', filter:'event_id=eq.'+evId},
      p => { nowPlaying = {t: p.new.title, a: p.new.artist}; updateNP(); })
    .subscribe();
}

// ── Chargement d'un événement ─────────────────────────────────────────
async function loadEvent(evId) {
  try {
    const ev = await api('GET', '/events/' + evId);
    eid = ev.id; ename = ev.name;
    localStorage.setItem('djr_eid', eid);
    localStorage.setItem('djr_ename', ename);
    const ps = await api('GET', '/proposals/' + eid);
    proposals = Object.fromEntries(ps.map(x => [x.id, x]));
    const np = await api('GET', '/now-playing/' + eid);
    if (np?.title) nowPlaying = {t: np.title, a: np.artist || ''};
    renderAll();
    subscribeToEvent(eid);
  } catch(e) {}
}
