const express = require('express');
const router  = express.Router();

const artCache = new Map(); // url → Buffer

// Domaines autorisés pour le proxy de pochettes — empêche le SSRF via une URL arbitraire
const ALLOWED_COVER_HOSTS = ['dzcdn.net', 'deezer.com', 'mzstatic.com', 'apple.com', 'supabase.co'];

function isAllowedCoverUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch(e) { return false; }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_COVER_HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
}

// ── Recherche morceaux : Deezer (90M titres) + iTunes fallback ────────
router.get('/songs', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);

  // 1. Deezer — catalogue le plus complet (~90M titres, gratuit, sans clé)
  try {
    const url  = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=20&output=json`;
    const r    = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('Deezer ' + r.status);

    const data    = await r.json();
    if (data.error) throw new Error(data.error.message || 'Deezer error');

    const results = (data.data || []).map(t => ({
      id:       String(t.id),
      title:    t.title,
      artist:   t.artist?.name  || '',
      album:    t.album?.title  || '',
      coverUrl: t.album?.cover_big || t.album?.cover_medium || t.album?.cover || null,
      preview:  t.preview       || null,
      duration: t.duration      || null,
      source:   'deezer',
    }));

    return res.json(results);
  } catch(eDeezer) {
    console.warn('[search] Deezer indisponible :', eDeezer.message, '— fallback iTunes');
  }

  // 2. Fallback iTunes si Deezer est indisponible
  try {
    const url  = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=20&country=fr`;
    const r    = await fetch(url);
    if (!r.ok) throw new Error('iTunes ' + r.status);

    const data    = await r.json();
    const results = (data.results || []).map(t => ({
      id:       String(t.trackId),
      title:    t.trackName,
      artist:   t.artistName,
      album:    t.collectionName || '',
      coverUrl: t.artworkUrl100 ? t.artworkUrl100.replace('100x100', '300x300') : null,
      preview:  t.previewUrl    || null,
      duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
      source:   'itunes',
    }));

    return res.json(results);
  } catch(eItunes) {
    console.error('[search] Les deux sources sont indisponibles');
    return res.status(502).json({ error: 'Recherche indisponible' });
  }
});

// ── Proxy pochette (cache 24h) ────────────────────────────────────────
router.get('/cover', async (req, res) => {
  const { url } = req.query;
  if (!url || !isAllowedCoverUrl(url)) return res.status(400).end();

  if (artCache.has(url)) {
    const cached = artCache.get(url);
    if (!cached) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached);
  }

  try {
    const r   = await fetch(url);
    if (!r.ok) { artCache.set(url, null); return res.status(404).end(); }
    const buf = Buffer.from(await r.arrayBuffer());
    artCache.set(url, buf);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch(e) {
    artCache.set(url, null);
    res.status(404).end();
  }
});

module.exports = router;
