const express  = require('express');
const supabase = require('../lib/supabase');
const { requireAuth, requireOrganizer } = require('../middleware/auth');

const router = express.Router();

// ── Now Playing ───────────────────────────────────────────────────────
router.get('/now-playing/:eventId', async (req, res) => {
  const { data } = await supabase.from('now_playing').select('*')
    .eq('event_id', req.params.eventId).single();
  res.json(data || { title: 'En attente…', artist: '' });
});

router.put('/now-playing/:eventId', requireOrganizer, async (req, res) => {
  const { title, artist, coverUrl, proposer_name } = req.body;
  const { data, error } = await supabase.from('now_playing')
    .upsert({ event_id: req.params.eventId, title, artist, cover_url: coverUrl || null, proposer_name: proposer_name || null })
    .select().single();
  if (error) { console.error('[now-playing PUT] échec —', req.params.eventId, error.message); return res.status(500).json({ error: error.message }); }
  res.json(data);
});

// ── Locations ─────────────────────────────────────────────────────────
router.get('/locations/:eventId', async (req, res) => {
  const { data } = await supabase.from('locations').select('*')
    .eq('event_id', req.params.eventId).eq('is_active', true);
  res.json(data || []);
});

router.put('/locations/:eventId', requireAuth, async (req, res) => {
  const { zone, is_active } = req.body;
  const profile = await supabase.from('user_profiles').select('display_name').eq('id', req.user.id).single();
  const { error } = await supabase.from('locations').upsert({
    user_id:    req.user.id,
    event_id:   req.params.eventId,
    user_name:  profile.data?.display_name || 'Invité',
    zone,
    is_active,
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Blind test scores ─────────────────────────────────────────────────
router.get('/scores/:eventId', async (req, res) => {
  const { data } = await supabase.from('blindtest_scores').select('*')
    .eq('event_id', req.params.eventId).order('score', { ascending: false }).limit(20);
  res.json(data || []);
});

router.put('/scores/:eventId', requireAuth, async (req, res) => {
  const { score } = req.body;
  if (!Number.isInteger(score) || score < 0 || score > 10000) {
    return res.status(400).json({ error: 'Score invalide' });
  }
  const profile = await supabase.from('user_profiles').select('display_name').eq('id', req.user.id).single();
  const { error } = await supabase.from('blindtest_scores').upsert({
    user_id:   req.user.id,
    event_id:  req.params.eventId,
    user_name: profile.data?.display_name || 'Invité',
    score,
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
