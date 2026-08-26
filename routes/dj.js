const express  = require('express');
const multer   = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { validateDisplayName } = require('../lib/moderation');
const { isClosed, isUpcoming } = require('./events');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Soirées où je suis dans le line-up (DJ inscrit sur Pull up) ───────
// Permet d'entrer administrer la soirée avec son propre compte, sans
// connaître le mot de passe partagé (cf. isLineupMember côté middleware).
router.get('/dj/my-events', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('events').select('id, name, created_at, scheduled_at, lineup')
    .eq('is_active', true);
  if (error) return res.status(500).json({ error: error.message });
  const mine = (data || [])
    .filter(ev => Array.isArray(ev.lineup) && ev.lineup.some(dj => dj.type === 'app' && dj.id === req.user.id))
    .map(ev => ({ id: ev.id, name: ev.name, closed: isClosed(ev.created_at, ev.scheduled_at), upcoming: isUpcoming(ev.scheduled_at) }))
    .filter(ev => !ev.closed);
  res.json(mine);
});

// ── Mon profil DJ (édition) ─────────────────────────────────────────
router.get('/dj/profile', requireAuth, async (req, res) => {
  const { data } = await supabase.from('dj_profiles').select('*').eq('id', req.user.id).single();
  res.json(data || {});
});

router.post('/dj/profile', requireAuth, async (req, res) => {
  const { stage_name, tagline, bio, city, genres, instagram, soundcloud, resident_advisor, booking_email, available } = req.body;
  if (!stage_name) return res.status(400).json({ error: 'Nom de scène requis' });
  const nameCheck = validateDisplayName(stage_name);
  if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.reason });

  const updates = { id: req.user.id, stage_name, updated_at: new Date().toISOString() };
  if (tagline           !== undefined) updates.tagline          = tagline;
  if (bio                !== undefined) updates.bio              = bio;
  if (city               !== undefined) updates.city             = city;
  if (genres             !== undefined) updates.genres           = genres;
  if (instagram          !== undefined) updates.instagram        = instagram;
  if (soundcloud         !== undefined) updates.soundcloud       = soundcloud;
  if (resident_advisor   !== undefined) updates.resident_advisor = resident_advisor;
  if (booking_email      !== undefined) updates.booking_email    = booking_email;
  if (available          !== undefined) updates.available        = available;

  const { data, error } = await supabase.from('dj_profiles').upsert(updates).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Recherche de DJ inscrits (line-up d'une soirée) — déclarée avant
// /dj/profile/:id pour éviter qu'Express n'intercepte "search" comme id.
router.get('/dj/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  const { data, error } = await supabase
    .from('dj_profiles')
    .select('id, stage_name, photo_url, city')
    .not('stage_name', 'is', null)
    .ilike('stage_name', `%${q}%`)
    .limit(10);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Upload photo de profil DJ ────────────────────────────────────────
router.post('/dj/profile/photo', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

  let buffer;
  try {
    const sharp = require('sharp');
    buffer = await sharp(req.file.buffer).resize(500, 500, { fit: 'cover' }).jpeg({ quality: 75, mozjpeg: true }).toBuffer();
  } catch(e) { return res.status(400).json({ error: 'Fichier image invalide' }); }

  const fileName = `dj/${req.user.id}/avatar.jpg`;
  const { error } = await supabase.storage.from('profile-photos').upload(fileName, buffer, {
    contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(fileName);
  const { error: dbError } = await supabase.from('dj_profiles').upsert({ id: req.user.id, photo_url: publicUrl, updated_at: new Date().toISOString() });
  if (dbError) { console.error('[dj profile photo] échec écriture DB —', req.user.id, dbError.message); return res.status(500).json({ error: dbError.message }); }
  res.json({ url: publicUrl });
});

// ── Profil public (page press kit partageable) ──────────────────────
router.get('/dj/profile/:id', async (req, res) => {
  const { data, error } = await supabase.from('dj_profiles').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Profil DJ introuvable' });
  res.json(data);
});

module.exports = router;
