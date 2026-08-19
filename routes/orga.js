const express  = require('express');
const multer   = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Le logo est réécrit au même chemin de storage à chaque upload (upsert) —
// l'URL publique ne change donc jamais, ce qui fait que le navigateur (et le
// CDN Supabase) sert une version en cache après une mise à jour. On ajoute
// un paramètre de cache-busting basé sur updated_at pour forcer le refetch.
function bustLogoCache(url, updatedAt) {
  if (!url) return url;
  const v = updatedAt ? new Date(updatedAt).getTime() : Date.now();
  return url + (url.includes('?') ? '&' : '?') + 'v=' + v;
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── Ma page organisateur (édition) ───────────────────────────────────
router.get('/orga/profile', requireAuth, async (req, res) => {
  const { data } = await supabase.from('organizer_pages').select('*').eq('owner_id', req.user.id).maybeSingle();
  if (data?.logo_url) data.logo_url = bustLogoCache(data.logo_url, data.updated_at);
  res.json(data || { email: req.user.email || null });
});

router.put('/orga/profile', requireAuth, async (req, res) => {
  const { name, email, bio, slug, website_url, instagram_url, tiktok_url, facebook_url } = req.body;
  const updates = { owner_id: req.user.id, updated_at: new Date().toISOString() };
  if (name         !== undefined) updates.name         = name;
  if (email        !== undefined) updates.email        = email;
  if (bio          !== undefined) updates.bio          = bio;
  if (website_url  !== undefined) updates.website_url  = website_url;
  if (instagram_url!== undefined) updates.instagram_url= instagram_url;
  if (tiktok_url   !== undefined) updates.tiktok_url   = tiktok_url;
  if (facebook_url !== undefined) updates.facebook_url = facebook_url;

  if (slug !== undefined) {
    const clean = slugify(slug);
    if (!clean) return res.status(400).json({ error: 'URL invalide' });
    const { data: taken } = await supabase.from('organizer_pages').select('owner_id').eq('slug', clean).maybeSingle();
    if (taken && taken.owner_id !== req.user.id) return res.status(409).json({ error: 'Cette adresse est déjà prise.' });
    updates.slug = clean;
  }

  const { data, error } = await supabase.from('organizer_pages').upsert(updates).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Upload logo ────────────────────────────────────────────────────
router.post('/orga/profile/logo', requireAuth, upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

  let buffer = req.file.buffer;
  try {
    const sharp = require('sharp');
    buffer = await sharp(buffer).resize(500, 500, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
  } catch(e) {}

  const fileName = `${req.user.id}/logo.jpg`;
  const { error } = await supabase.storage.from('orga-logos').upload(fileName, buffer, {
    contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('orga-logos').getPublicUrl(fileName);
  const updatedAt = new Date().toISOString();
  await supabase.from('organizer_pages').upsert({ owner_id: req.user.id, logo_url: publicUrl, updated_at: updatedAt });
  res.json({ url: bustLogoCache(publicUrl, updatedAt) });
});

// ── Mes soirées + stats par événement ────────────────────────────────
router.get('/orga/events-stats', requireAuth, async (req, res) => {
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, club_name, created_at')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  if (!events?.length) return res.json([]);

  const ids = events.map(e => e.id);
  const [votesRes, proposalsRes] = await Promise.all([
    supabase.from('votes').select('event_id').in('event_id', ids),
    supabase.from('proposals').select('event_id').in('event_id', ids),
  ]);
  const votesByEv = {}, propsByEv = {};
  (votesRes.data || []).forEach(v => { votesByEv[v.event_id] = (votesByEv[v.event_id]||0)+1; });
  (proposalsRes.data || []).forEach(p => { propsByEv[p.event_id] = (propsByEv[p.event_id]||0)+1; });

  const EVENT_DURATION_MS = 24 * 60 * 60 * 1000;
  res.json(events.map(e => ({
    ...e,
    closed: (Date.now() - new Date(e.created_at).getTime()) > EVENT_DURATION_MS,
    votes: votesByEv[e.id] || 0,
    proposals: propsByEv[e.id] || 0,
  })));
});

// ── Liste agrégée des clients (toutes soirées possédées confondues) ───
async function collectClients(ownerId) {
  const { data: events } = await supabase.from('events').select('id').eq('owner_id', ownerId);
  const ids = (events || []).map(e => e.id);
  if (!ids.length) return [];

  const [votesRes, proposalsRes] = await Promise.all([
    supabase.from('votes').select('user_id').in('event_id', ids),
    supabase.from('proposals').select('proposed_by').in('event_id', ids),
  ]);
  const userIds = [...new Set([
    ...(votesRes.data || []).map(v => v.user_id),
    ...(proposalsRes.data || []).map(p => p.proposed_by).filter(Boolean),
  ])];
  if (!userIds.length) return [];

  const { data: profiles } = await supabase
    .from('user_profiles').select('id, display_name, email, phone').in('id', userIds);
  const byId = {};
  (profiles || []).forEach(p => { byId[p.id] = p; });
  return userIds.map(id => ({
    id,
    name:  byId[id]?.display_name || 'Invité',
    email: byId[id]?.email || '',
    phone: byId[id]?.phone || '',
  }));
}

router.get('/orga/clients', requireAuth, async (req, res) => {
  try {
    res.json(await collectClients(req.user.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/orga/clients/export.csv', requireAuth, async (req, res) => {
  try {
    const clients = await collectClients(req.user.id);
    const esc = s => `"${(s || '').toString().replace(/"/g, '""')}"`;
    const rows = [['Nom', 'Email', 'Téléphone'].map(esc).join(',')]
      .concat(clients.map(c => [c.name, c.email, c.phone].map(esc).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clients-pullup.csv"');
    res.send('﻿' + rows.join('\n')); // BOM pour un import Excel propre des accents
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Page publique organisateur (par slug) ────────────────────────────
router.get('/orga/by-slug/:slug', async (req, res) => {
  const { data: page } = await supabase.from('organizer_pages').select('*').eq('slug', req.params.slug).maybeSingle();
  if (!page) return res.status(404).json({ error: 'Page introuvable' });

  const { data: events } = await supabase
    .from('events').select('id, name, club_name, created_at, is_active')
    .eq('owner_id', page.owner_id).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(10);

  const EVENT_DURATION_MS = 24 * 60 * 60 * 1000;
  res.json({
    name: page.name, bio: page.bio, logo_url: bustLogoCache(page.logo_url, page.updated_at), website_url: page.website_url,
    instagram_url: page.instagram_url, tiktok_url: page.tiktok_url, facebook_url: page.facebook_url,
    events: (events || []).map(e => ({ ...e, closed: (Date.now() - new Date(e.created_at).getTime()) > EVENT_DURATION_MS })),
  });
});

module.exports = router;
