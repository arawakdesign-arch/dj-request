const express  = require('express');
const multer   = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Profil utilisateur ────────────────────────────────────────────────
router.get('/profile', requireAuth, async (req, res) => {
  const { data } = await supabase.from('user_profiles').select('*').eq('id', req.user.id).single();
  res.json(data || {});
});

router.patch('/profile', requireAuth, async (req, res) => {
  const { display_name, bio, friend_code } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (display_name !== undefined) updates.display_name = display_name;
  if (bio          !== undefined) updates.bio          = bio;
  if (friend_code  !== undefined) updates.friend_code  = friend_code;

  const { data, error } = await supabase.from('user_profiles')
    .upsert({ id: req.user.id, ...updates })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Stats réelles du profil ───────────────────────────────────────────
router.get('/profile/stats', requireAuth, async (req, res) => {
  const uid = req.user.id;

  const [votesRes, proposalsRes] = await Promise.all([
    supabase.from('votes').select('event_id').eq('user_id', uid),
    supabase.from('proposals').select('event_id, votes, approved').eq('proposed_by', uid),
  ]);

  const votes      = votesRes.data     || [];
  const proposals  = proposalsRes.data || [];

  // Dédupliquer les événements participés
  const eventIds = [...new Set([
    ...votes.map(v => v.event_id),
    ...proposals.map(p => p.event_id),
  ])];

  // Charger les infos de chaque événement
  let events = [];
  if (eventIds.length) {
    const { data } = await supabase
      .from('events')
      .select('id, name, club_name, created_at')
      .in('id', eventIds)
      .order('created_at', { ascending: false })
      .limit(20);
    events = data || [];
  }

  // Stats par événement
  const eventStats = events.map(ev => {
    const evVotes     = votes.filter(v => v.event_id === ev.id).length;
    const evProposals = proposals.filter(p => p.event_id === ev.id);
    const evApproved  = evProposals.filter(p => p.approved).length;
    return {
      id:        ev.id,
      name:      ev.name,
      venue:     ev.club_name || '',
      date:      new Date(ev.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' }),
      votes:     evVotes,
      proposals: evProposals.length,
      played:    evApproved,
    };
  });

  // Totaux
  const totals = {
    events:    eventStats.length,
    votes:     votes.length,
    proposals: proposals.length,
    played:    proposals.filter(p => p.approved).length,
    xp:        votes.length * 3 + proposals.length * 10 + proposals.filter(p => p.approved).length * 20,
  };

  res.json({ totals, events: eventStats });
});

// ── Upload photo de profil ────────────────────────────────────────────
router.post('/profile/photo', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

  let buffer = req.file.buffer;
  try {
    const sharp = require('sharp');
    buffer = await sharp(buffer)
      .resize(400, 400, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch(e) {}

  const fileName = `${req.user.id}/avatar.jpg`;
  const { error } = await supabase.storage.from('profile-photos').upload(fileName, buffer, {
    contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(fileName);

  // Sauvegarder l'URL dans le profil
  await supabase.from('user_profiles').upsert({ id: req.user.id, photo_url: publicUrl });
  res.json({ url: publicUrl });
});

// ── Upload photo chat ─────────────────────────────────────────────────
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
