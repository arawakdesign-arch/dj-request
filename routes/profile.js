const express  = require('express');
const multer   = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Profil utilisateur ────────────────────────────────────────────────
router.get('/profile', requireAuth, async (req, res) => {
  const { data } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
  res.json(data || {});
});

router.patch('/profile', requireAuth, async (req, res) => {
  const { display_name } = req.body;
  const { data, error } = await supabase.from('profiles')
    .update({ display_name }).eq('id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Upload photo (chat) ───────────────────────────────────────────────
router.post('/upload', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

  let buffer = req.file.buffer;
  try {
    const sharp = require('sharp');
    buffer = await sharp(buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch(e) {}

  const fileName = `${req.user.id}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('chat-photos').upload(fileName, buffer, {
    contentType: 'image/jpeg', cacheControl: '3600',
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('chat-photos').getPublicUrl(fileName);
  res.json({ url: publicUrl });
});

module.exports = router;
