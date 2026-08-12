const express  = require('express');
const crypto   = require('crypto');
const multer   = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth, requireOrganizer } = require('../middleware/auth');
const { signToken } = require('../lib/jwt');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router();

// ── Events ────────────────────────────────────────────────────────────

// Lookup par nom — doit être déclaré AVANT /events/:id pour éviter que
// Express ne l'intercepte avec id = 'by-name'
router.get('/events/by-name', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Nom manquant' });

  const { data } = await supabase
    .from('events')
    .select('id, name, club_name, is_active')
    .eq('name', name)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return res.status(404).json({ error: 'Soirée introuvable' });
  res.json(data);
});

router.get('/events/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, club_name, address, hours, lineup, flyer_url, is_active, created_at')
    .eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Événement introuvable' });
  res.json(data);
});

router.post('/events', async (req, res) => {
  const { name, club_name, address, hours, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Champs manquants' });

  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
  const { data, error } = await supabase.from('events').insert({
    name, club_name, address, hours, password: hashedPassword,
  }).select('id, name, club_name, address, hours, created_at').single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('now_playing').insert({ event_id: data.id, title: 'En attente…', artist: '' });
  res.status(201).json(data);
});

router.patch('/events/:id', requireOrganizer, async (req, res) => {
  const { name, club_name, address, hours } = req.body;
  const { data, error } = await supabase.from('events')
    .update({ name, club_name, address, hours })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/events/:id/auth', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe manquant' });

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const { data: event } = await supabase.from('events')
    .select('id, name, password').eq('id', req.params.id).single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  if (event.password !== hash) return res.status(403).json({ error: 'Mot de passe incorrect' });

  // Générer un JWT organizer persistable — permet la restauration de session après refresh
  const token = signToken({ id: event.id, displayName: event.name, role: 'organizer', event_id: event.id });
  res.json({ authorized: true, event_id: event.id, name: event.name, token });
});

// ── Proposals ─────────────────────────────────────────────────────────
router.get('/proposals/:eventId', async (req, res) => {
  const { data, error } = await supabase
    .from('proposals').select('*')
    .eq('event_id', req.params.eventId)
    .order('votes', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Attache la liste des votants par proposition : le frontend (totalVoters()
  // dans render.js) en a besoin pour le compteur "connectés" de la bannière,
  // qui restait bloqué à 0 faute de cette donnée.
  const { data: allVotes } = await supabase
    .from('votes').select('proposal_id, user_id').eq('event_id', req.params.eventId);
  const votersByProposal = {};
  (allVotes || []).forEach(v => {
    (votersByProposal[v.proposal_id] ??= {})[v.user_id] = true;
  });
  const enriched = (data || []).map(p => ({ ...p, voters: votersByProposal[p.id] || {} }));
  res.json(enriched);
});

// Noms des derniers votants (bannière de l'événement) ────────────────
router.get('/events/:id/recent-voters', async (req, res) => {
  const { data: votes } = await supabase
    .from('votes').select('user_id, created_at')
    .eq('event_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const uniqueIds = [...new Set((votes || []).map(v => v.user_id))].slice(0, 8);
  if (!uniqueIds.length) return res.json([]);

  const { data: profiles } = await supabase
    .from('user_profiles').select('id, display_name').in('id', uniqueIds);
  const nameById = Object.fromEntries((profiles || []).map(p => [p.id, p.display_name]));
  res.json(uniqueIds.map(id => nameById[id] || 'Invité'));
});

router.post('/proposals', requireAuth, async (req, res) => {
  const { song_id, event_id, title, artist, cover_url } = req.body;
  if (!song_id || !event_id) return res.status(400).json({ error: 'Champs manquants' });

  const { data: existing } = await supabase.from('proposals')
    .select('id').eq('id', song_id).eq('event_id', event_id).single();
  if (existing) return res.status(409).json({ error: 'Morceau déjà proposé' });

  const { data, error } = await supabase.from('proposals').insert({
    id: song_id, event_id, proposed_by: req.user.id,
    title:     title     || null,
    artist:    artist    || null,
    cover_url: cover_url || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Vote initial du proposeur — le trigger update_proposal_votes incrémente proposals.votes
  const { error: voteError } = await supabase.from('votes').insert({
    user_id: req.user.id, proposal_id: song_id, event_id,
  });
  if (voteError) console.error('[vote initial]', voteError.message);

  res.status(201).json(data);
});

router.delete('/proposals/:eventId/:songId', requireOrganizer, async (req, res) => {
  const { error } = await supabase.from('proposals')
    .delete().eq('id', req.params.songId).eq('event_id', req.params.eventId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.patch('/proposals/:eventId/:songId', requireOrganizer, async (req, res) => {
  const { approved } = req.body;
  const { data, error } = await supabase.from('proposals')
    .update({ approved }).eq('id', req.params.songId).eq('event_id', req.params.eventId)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Votes ──────────────────────────────────────────────────────────────
router.post('/votes', requireAuth, async (req, res) => {
  const { proposal_id, event_id } = req.body;
  if (!proposal_id || !event_id) return res.status(400).json({ error: 'Champs manquants' });

  const { error } = await supabase.from('votes').insert({
    user_id: req.user.id, proposal_id, event_id,
  });
  if (error?.code === '23505') return res.status(409).json({ error: 'Vous avez déjà voté pour ce morceau' });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ success: true });
});

// Votes de l'utilisateur courant pour un event — utilisé par le frontend pour restaurer myVotes au reload
router.get('/votes/:eventId', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('votes')
    .select('proposal_id')
    .eq('event_id', req.params.eventId)
    .eq('user_id', req.user.id);
  res.json((data || []).map(v => v.proposal_id));
});

router.delete('/votes/:eventId/:proposalId', requireAuth, async (req, res) => {
  const { error } = await supabase.from('votes')
    .delete()
    .eq('user_id', req.user.id)
    .eq('proposal_id', req.params.proposalId)
    .eq('event_id', req.params.eventId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});


// ── Upload flyer soirée ───────────────────────────────────────────────
router.post('/events/:id/flyer', requireOrganizer, upload.single('flyer'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

  let buffer = req.file.buffer;
  try {
    const sharp = require('sharp');
    buffer = await sharp(buffer)
      .resize(1200, 800, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch(e) {}

  const fileName = `${req.params.id}/flyer.jpg`;
  const { error } = await supabase.storage.from('flyers').upload(fileName, buffer, {
    contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('flyers').getPublicUrl(fileName);

  await supabase.from('events').update({ flyer_url: publicUrl }).eq('id', req.params.id);
  res.json({ url: publicUrl });
});

router.delete('/events/:id/flyer', requireOrganizer, async (req, res) => {
  await supabase.storage.from('flyers').remove([`${req.params.id}/flyer.jpg`]);
  await supabase.from('events').update({ flyer_url: null }).eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
