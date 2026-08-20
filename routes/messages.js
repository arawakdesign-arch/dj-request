const express  = require('express');
const supabase = require('../lib/supabase');
const { requireAuth, isOrganizer } = require('../middleware/auth');
const { containsProfanity } = require('../lib/moderation');

const ALLOWED_REACTIONS = ['🔥', '👍', '❤️', '💜'];

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
  if (text && containsProfanity(text)) return res.status(400).json({ error: 'Message non autorisé — merci de rester respectueux.' });

  const profile   = await supabase.from('user_profiles').select('display_name, photo_url').eq('id', req.user.id).single();
  const userName  = profile.data?.display_name || req.user.phone || 'Invité';
  const userPhoto = profile.data?.photo_url || null;

  const { data, error } = await supabase.from('messages').insert({
    event_id, user_id: req.user.id, user_name: userName, user_photo: userPhoto, text, photo_url,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/messages/:id', requireAuth, async (req, res) => {
  const { data: msg } = await supabase.from('messages').select('user_id, event_id').eq('id', req.params.id).single();
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });

  if (msg.user_id !== req.user.id) {
    const authorized = await isOrganizer(req, msg.event_id);
    if (!authorized) return res.status(403).json({ error: 'Non autorisé' });
  }
  const { error } = await supabase.from('messages').update({ deleted: true }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Réactions (une seule par utilisateur et par message) ───────────────
router.patch('/messages/:id/react', requireAuth, async (req, res) => {
  const { emoji } = req.body;
  if (!ALLOWED_REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Réaction invalide' });

  const { data: existing } = await supabase.from('message_reactions')
    .select('emoji').eq('message_id', req.params.id).eq('user_id', req.user.id).single();

  if (existing?.emoji === emoji) {
    // Même emoji re-cliqué → on retire la réaction (bascule off)
    const { error } = await supabase.from('message_reactions')
      .delete().eq('message_id', req.params.id).eq('user_id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    // Premier choix ou changement d'emoji → remplace l'éventuelle réaction précédente
    const { error } = await supabase.from('message_reactions')
      .upsert({ message_id: req.params.id, user_id: req.user.id, emoji });
    if (error) return res.status(500).json({ error: error.message });
  }

  const { data: msg, error: msgError } = await supabase.from('messages')
    .select('reactions').eq('id', req.params.id).single();
  if (msgError) return res.status(500).json({ error: msgError.message });
  res.json({ reactions: msg.reactions });
});

// ── Message épinglé ──────────────────────────────────────────────────
router.patch('/messages/:eventId/:id/pin', requireAuth, async (req, res) => {
  const authorized = await isOrganizer(req, req.params.eventId);
  if (!authorized) return res.status(403).json({ error: 'Non autorisé' });

  await supabase.from('messages').update({ pinned: false })
    .eq('event_id', req.params.eventId).eq('pinned', true);
  const { data, error } = await supabase.from('messages')
    .update({ pinned: true }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/messages/:eventId/:id/unpin', requireAuth, async (req, res) => {
  const authorized = await isOrganizer(req, req.params.eventId);
  if (!authorized) return res.status(403).json({ error: 'Non autorisé' });

  const { error } = await supabase.from('messages').update({ pinned: false }).eq('id', req.params.id);
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

router.get('/reports/:eventId', requireAuth, async (req, res) => {
  const authorized = await isOrganizer(req, req.params.eventId);
  if (!authorized) return res.status(403).json({ error: 'Non autorisé' });

  const { data, error } = await supabase
    .from('reports')
    .select('*, messages(id, text, photo_url, user_name, created_at)')
    .eq('event_id', req.params.eventId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.delete('/reports/:id', requireAuth, async (req, res) => {
  const { data: report } = await supabase.from('reports').select('event_id').eq('id', req.params.id).single();
  if (!report) return res.status(404).json({ error: 'Signalement introuvable' });

  const authorized = await isOrganizer(req, report.event_id);
  if (!authorized) return res.status(403).json({ error: 'Non autorisé' });

  const { error } = await supabase.from('reports').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
