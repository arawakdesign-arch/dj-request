const express  = require('express');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Mes amis ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Ajouter un ami ────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { friend_code, friend_name } = req.body;
  if (!friend_code) return res.status(400).json({ error: 'Code requis' });

  const { data: myProfile } = await supabase
    .from('user_profiles').select('friend_code').eq('id', req.user.id).single();
  if (myProfile?.friend_code && friend_code.toUpperCase() === myProfile.friend_code.toUpperCase())
    return res.status(400).json({ error: 'Ton propre code !' });

  const { data, error } = await supabase.from('friendships').insert({
    user_id:     req.user.id,
    friend_code: friend_code.toUpperCase(),
    friend_name: friend_name || 'Ami',
  }).select().single();

  if (error?.code === '23505') return res.status(409).json({ error: 'Ami déjà ajouté' });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── Supprimer un ami ──────────────────────────────────────────────────
router.delete('/:code', requireAuth, async (req, res) => {
  const { error } = await supabase.from('friendships')
    .delete()
    .eq('user_id', req.user.id)
    .eq('friend_code', req.params.code.toUpperCase());
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
