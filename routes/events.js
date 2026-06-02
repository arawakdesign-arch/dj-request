const express  = require('express');
const crypto   = require('crypto');
const supabase = require('../lib/supabase');
const { requireAuth, requireOrganizer } = require('../middleware/auth');

const router = express.Router();

// ── Events ────────────────────────────────────────────────────────────
router.get('/events/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, club_name, address, hours, lineup, is_active, created_at')
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

  res.json({ authorized: true, event_id: event.id, name: event.name });
});

// ── Proposals ─────────────────────────────────────────────────────────
router.get('/proposals/:eventId', async (req, res) => {
  const { data, error } = await supabase
    .from('proposals').select('*')
    .eq('event_id', req.params.eventId)
    .order('votes', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/proposals', requireAuth, async (req, res) => {
  const { song_id, event_id } = req.body;
  if (!song_id || !event_id) return res.status(400).json({ error: 'Champs manquants' });

  const { data: existing } = await supabase.from('proposals')
    .select('id').eq('id', song_id).eq('event_id', event_id).single();
  if (existing) return res.status(409).json({ error: 'Morceau déjà proposé' });

  const { data, error } = await supabase.from('proposals').insert({
    id: song_id, event_id, votes: 1, proposed_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('votes').insert({ user_id: req.user.id, proposal_id: song_id, event_id }).catch(() => {});
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
  const { error } = await supabase.from('votes').insert({
    user_id: req.user.id, proposal_id, event_id,
  });
  if (error?.code === '23505') return res.status(409).json({ error: 'Déjà voté' });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ success: true });
});

router.delete('/votes/:eventId/:proposalId', requireAuth, async (req, res) => {
  const { error } = await supabase.from('votes')
    .delete()
    .eq('user_id',     req.user.id)
    .eq('proposal_id', req.params.proposalId)
    .eq('event_id',    req.params.eventId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
