const express  = require('express');
const multer   = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Mon profil DJ (édition) ─────────────────────────────────────────
router.get('/dj/profile', requireAuth, async (req, res) => {
  const { data } = await supabase.from('dj_profiles').select('*').eq('id', req.user.id).single();
  res.json(data || {});
});

router.post('/dj/profile', requireAuth, async (req, res) => {
  const { stage_name, tagline, bio, city, genres, instagram, soundcloud, resident_advisor, booking_email, available } = req.body;
  if (!stage_name) return res.status(400).json({ error: 'Nom de scène requis' });

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

// ── Upload photo de profil DJ ────────────────────────────────────────
router.post('/dj/profile/photo', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

  let buffer = req.file.buffer;
  try {
    const sharp = require('sharp');
    buffer = await sharp(buffer).resize(500, 500, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
  } catch(e) {}

  const fileName = `dj/${req.user.id}/avatar.jpg`;
  const { error } = await supabase.storage.from('profile-photos').upload(fileName, buffer, {
    contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(fileName);
  await supabase.from('dj_profiles').upsert({ id: req.user.id, photo_url: publicUrl, updated_at: new Date().toISOString() });
  res.json({ url: publicUrl });
});

// ── Profil public (page press kit partageable) ──────────────────────
router.get('/dj/profile/:id', async (req, res) => {
  const { data, error } = await supabase.from('dj_profiles').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Profil DJ introuvable' });
  res.json(data);
});

module.exports = router;
