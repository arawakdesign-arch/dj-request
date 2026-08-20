// SoundCloud n'émet plus de clé d'API publique aux nouvelles apps depuis
// plusieurs années. Leur propre site web utilise en interne un client_id
// public (pas secret — visible dans le JS livré à n'importe quel visiteur)
// pour ses propres appels de recherche. On le récupère depuis leurs bundles
// JS publics, comme le font des outils largement utilisés (ex: yt-dlp) pour
// interagir avec l'API publique de recherche. Aucune donnée privée, aucune
// authentification contournée — uniquement la recherche d'utilisateurs,
// déjà accessible publiquement à quiconque visite soundcloud.com.
let _clientId = null;
let _clientIdFetchedAt = 0;
const CLIENT_ID_TTL_MS = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (compatible; PullUpBot/1.0)';

async function discoverClientId() {
  const homeRes = await fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA } });
  if (!homeRes.ok) throw new Error('SoundCloud home ' + homeRes.status);
  const html = await homeRes.text();
  const scriptUrls = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  for (const url of scriptUrls.reverse()) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      const js = await r.text();
      const m = js.match(/client_id\s*:\s*"([a-zA-Z0-9]+)"/) || js.match(/client_id=([a-zA-Z0-9]+)/);
      if (m) return m[1];
    } catch(e) {}
  }
  throw new Error('client_id SoundCloud introuvable');
}

async function getClientId(forceRefresh = false) {
  if (!forceRefresh && _clientId && (Date.now() - _clientIdFetchedAt) < CLIENT_ID_TTL_MS) return _clientId;
  _clientId = await discoverClientId();
  _clientIdFetchedAt = Date.now();
  return _clientId;
}

async function searchDJs(q, limit = 6) {
  let clientId = await getClientId();
  const build = id => `https://api-v2.soundcloud.com/search/users?q=${encodeURIComponent(q)}&limit=${limit}&client_id=${id}`;
  let r = await fetch(build(clientId), { headers: { 'User-Agent': UA } });
  if (r.status === 401) {
    clientId = await getClientId(true);
    r = await fetch(build(clientId), { headers: { 'User-Agent': UA } });
  }
  if (!r.ok) throw new Error('SoundCloud search ' + r.status);
  const data = await r.json();
  return (data.collection || []).map(u => ({
    name:       u.username,
    avatar_url: u.avatar_url && !u.avatar_url.includes('default_avatar') ? u.avatar_url : null,
    permalink:  u.permalink_url,
    city:       u.city || null,
    followers:  u.followers_count || 0,
  }));
}

module.exports = { searchDJs };
