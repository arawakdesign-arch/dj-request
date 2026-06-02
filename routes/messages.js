const express  = require('express');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Messages (chat) ───────────────────────────────────────────────────
router.get('/messages/:eventId', async (req, res) => {
  const { data, error } = await supabase
    .from('messages').select('*')
    .eq('event_id', req.params.eventId)
    .eq('deleted', false)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/messages', requireAuth, async (req, res) => {
  const { event_id, text, photo_url } = req.body;
  if (!event_id || (!text && !photo_url)) return res.status(400).json({ error: 'Champs manquants' });

  const profile  = await supabase.from('profiles').select('display_name').eq('id', req.user.id).single();
  const userName = profile.data?.display_name || req.user.phone || 'Invité';

  const { data, error } = await supabase.from('messages').insert({
    event_id, user_id: req.user.id, user_name: userName, text, photo_url,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/messages/:id', requireAuth, async (req, res) => {
  const { data: msg } = await supabase.from('messages').select('user_id').eq('id', req.params.id).single();
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });

  if (msg.user_id !== req.user.id) {
    if (!req.headers['x-organizer-password']) return res.status(403).json({ error: 'Non autorisé' });
  }
  const { error } = await supabase.from('messages').update({ deleted: true }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Reports (signalements) ────────────────────────────────────────────
router.post('/reports', requireAuth, async (req, res) => {
  const { message_id, event_id } = req.body;
  const { error } = await supabase.from('reports').insert({
    message_id, event_id, reported_by: req.user.id,
  });
  if (error?.code === '23505') return res.status(409).json({ error: 'Déjà signalé' });
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('messages').update({ reported: true }).eq('id', message_id);
  res.status(201).json({ success: true });
});

router.get('/reports/:eventId', async (req, res) => {
  const { data, error } = await supabase
    .from('reports')
    .select('*, messages(id, text, photo_url, user_name, created_at)')
    .eq('event_id', req.params.eventId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.delete('/reports/:id', async (req, res) => {
  const { error } = await supabase.from('reports').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
