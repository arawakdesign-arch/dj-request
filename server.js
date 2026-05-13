/**
 * DJ REQUEST — Serveur Node.js
 * Stack : Express + Supabase + Realtime
 */
require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const { createClient } = require('@supabase/supabase-js');

// ══ INIT ══════════════════════════════════════════════════════════
const app  = express();
const PORT = process.env.PORT || 3000;

// Client Supabase avec la service_role key (accès complet côté serveur)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ══ MIDDLEWARE ════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"],
      styleSrc:    ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:     ["'self'", "fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:", "*.supabase.co", "i.pravatar.cc", "*.itunes.apple.com"],
      connectSrc:  ["'self'", "*.supabase.co", "itunes.apple.com"],
      mediaSrc:    ["'self'", "*.itunes.apple.com", "*.supabase.co"],
    }
  }
}));

app.use(cors({ origin: process.env.APP_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: 'Trop de requêtes' } });
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 60, message: { error: 'Ralentissez !' } });
app.use('/api/', apiLimiter);
app.use(limiter);

// Static files — HTML jamais mis en cache, assets 1 jour
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// ══ MIDDLEWARE AUTH ════════════════════════════════════════════════
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token invalide' });
  req.user = user;
  next();
}

async function requireOrganizer(req, res, next) {
  const eventId = req.params.eventId || req.params.id;
  const password = req.headers['x-organizer-password'];
  if (!password) return res.status(403).json({ error: 'Mot de passe requis' });

  const { data: event } = await supabase
    .from('events').select('password').eq('id', eventId).single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });

  const bcrypt = require('crypto');
  const hash = bcrypt.createHash('sha256').update(password).digest('hex');
  if (event.password !== hash) return res.status(403).json({ error: 'Mot de passe incorrect' });
  next();
}

// ══ ROUTES API ════════════════════════════════════════════════════

// ── Santé ─────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── Events ────────────────────────────────────────────────────────
app.get('/api/events/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, club_name, address, hours, lineup, is_active, created_at')
    .eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Événement introuvable' });
  res.json(data);
});

app.post('/api/events', async (req, res) => {
  const { name, club_name, address, hours, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Champs manquants' });

  const crypto = require('crypto');
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

  const { data, error } = await supabase.from('events').insert({
    name, club_name, address, hours, password: hashedPassword
  }).select('id, name, club_name, address, hours, created_at').single();

  if (error) return res.status(500).json({ error: error.message });

  // Initialiser now_playing
  await supabase.from('now_playing').insert({ event_id: data.id, title: 'En attente…', artist: '' });

  res.status(201).json(data);
});

app.patch('/api/events/:id', requireOrganizer, async (req, res) => {
  const { name, club_name, address, hours } = req.body;
  const { data, error } = await supabase.from('events')
    .update({ name, club_name, address, hours })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Vérifier le mot de passe organisateur
app.post('/api/events/:id/auth', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe manquant' });
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const { data: event } = await supabase.from('events')
    .select('id, name, password').eq('id', req.params.id).single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  if (event.password !== hash) return res.status(403).json({ error: 'Mot de passe incorrect' });
  res.json({ authorized: true, event_id: event.id, name: event.name });
});

// ── Proposals ─────────────────────────────────────────────────────
app.get('/api/proposals/:eventId', async (req, res) => {
  const { data, error } = await supabase
    .from('proposals')
    .select('*')
    .eq('event_id', req.params.eventId)
    .order('votes', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/proposals', requireAuth, async (req, res) => {
  const { song_id, event_id } = req.body;
  if (!song_id || !event_id) return res.status(400).json({ error: 'Champs manquants' });

  // Vérifier si déjà proposé
  const { data: existing } = await supabase.from('proposals')
    .select('id').eq('id', song_id).eq('event_id', event_id).single();
  if (existing) return res.status(409).json({ error: 'Morceau déjà proposé' });

  const { data, error } = await supabase.from('proposals').insert({
    id: song_id, event_id, votes: 1, proposed_by: req.user.id
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Vote initial automatique du proposeur
  await supabase.from('votes').insert({ user_id: req.user.id, proposal_id: song_id, event_id }).catch(() => {});

  res.status(201).json(data);
});

app.delete('/api/proposals/:eventId/:songId', requireOrganizer, async (req, res) => {
  const { error } = await supabase.from('proposals')
    .delete().eq('id', req.params.songId).eq('event_id', req.params.eventId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.patch('/api/proposals/:eventId/:songId', requireOrganizer, async (req, res) => {
  const { approved } = req.body;
  const { data, error } = await supabase.from('proposals')
    .update({ approved }).eq('id', req.params.songId).eq('event_id', req.params.eventId)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Votes ─────────────────────────────────────────────────────────
app.post('/api/votes', requireAuth, async (req, res) => {
  const { proposal_id, event_id } = req.body;
  const { error } = await supabase.from('votes').insert({
    user_id: req.user.id, proposal_id, event_id
  });
  if (error?.code === '23505') return res.status(409).json({ error: 'Déjà voté' });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ success: true });
});

app.delete('/api/votes/:eventId/:proposalId', requireAuth, async (req, res) => {
  const { error } = await supabase.from('votes')
    .delete()
    .eq('user_id', req.user.id)
    .eq('proposal_id', req.params.proposalId)
    .eq('event_id', req.params.eventId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Messages (chat) ───────────────────────────────────────────────
app.get('/api/messages/:eventId', async (req, res) => {
  const { data, error } = await supabase
    .from('messages').select('*')
    .eq('event_id', req.params.eventId)
    .eq('deleted', false)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/messages', requireAuth, async (req, res) => {
  const { event_id, text, photo_url } = req.body;
  if (!event_id || (!text && !photo_url)) return res.status(400).json({ error: 'Champs manquants' });

  const profile = await supabase.from('profiles').select('display_name').eq('id', req.user.id).single();
  const userName = profile.data?.display_name || req.user.phone || 'Invité';

  const { data, error } = await supabase.from('messages').insert({
    event_id, user_id: req.user.id, user_name: userName, text, photo_url
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.delete('/api/messages/:id', requireAuth, async (req, res) => {
  const { data: msg } = await supabase.from('messages').select('user_id').eq('id', req.params.id).single();
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  // Seul l'auteur ou un organisateur peut supprimer
  if (msg.user_id !== req.user.id) {
    const isOrganizer = req.headers['x-organizer-password'];
    if (!isOrganizer) return res.status(403).json({ error: 'Non autorisé' });
  }
  const { error } = await supabase.from('messages').update({ deleted: true }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Reports (signalements) ────────────────────────────────────────
app.post('/api/reports', requireAuth, async (req, res) => {
  const { message_id, event_id } = req.body;
  const { error } = await supabase.from('reports').insert({
    message_id, event_id, reported_by: req.user.id
  });
  if (error?.code === '23505') return res.status(409).json({ error: 'Déjà signalé' });
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('messages').update({ reported: true }).eq('id', message_id);
  res.status(201).json({ success: true });
});

app.get('/api/reports/:eventId', async (req, res) => {
  const { data, error } = await supabase
    .from('reports')
    .select('*, messages(id, text, photo_url, user_name, created_at)')
    .eq('event_id', req.params.eventId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.delete('/api/reports/:id', async (req, res) => {
  const { error } = await supabase.from('reports').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Now Playing ────────────────────────────────────────────────────
app.get('/api/now-playing/:eventId', async (req, res) => {
  const { data } = await supabase.from('now_playing').select('*').eq('event_id', req.params.eventId).single();
  res.json(data || { title: 'En attente…', artist: '' });
});

app.put('/api/now-playing/:eventId', requireOrganizer, async (req, res) => {
  const { title, artist } = req.body;
  const { data, error } = await supabase.from('now_playing')
    .upsert({ event_id: req.params.eventId, title, artist })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Upload photo (chat) ────────────────────────────────────────────
app.post('/api/upload', requireAuth, async (req, res) => {
  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Fichier trop lourd (max 5Mo)' });
    if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

    // Compression avec sharp
    let buffer = req.file.buffer;
    try {
      const sharp = require('sharp');
      buffer = await sharp(buffer).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    } catch(e) {}

    const fileName = `${req.user.id}/${Date.now()}.jpg`;
    const { data, error } = await supabase.storage.from('chat-photos').upload(fileName, buffer, {
      contentType: 'image/jpeg', cacheControl: '3600'
    });
    if (error) return res.status(500).json({ error: error.message });

    const { data: { publicUrl } } = supabase.storage.from('chat-photos').getPublicUrl(fileName);
    res.json({ url: publicUrl });
  });
});

// ── Locations ─────────────────────────────────────────────────────
app.get('/api/locations/:eventId', async (req, res) => {
  const { data } = await supabase.from('locations').select('*')
    .eq('event_id', req.params.eventId).eq('is_active', true);
  res.json(data || []);
});

app.put('/api/locations/:eventId', requireAuth, async (req, res) => {
  const { zone, is_active } = req.body;
  const profile = await supabase.from('profiles').select('display_name').eq('id', req.user.id).single();
  const { error } = await supabase.from('locations').upsert({
    user_id: req.user.id, event_id: req.params.eventId,
    user_name: profile.data?.display_name || 'Invité',
    zone, is_active
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Blind test scores ─────────────────────────────────────────────
app.get('/api/scores/:eventId', async (req, res) => {
  const { data } = await supabase.from('blindtest_scores').select('*')
    .eq('event_id', req.params.eventId).order('score', { ascending: false }).limit(20);
  res.json(data || []);
});

app.put('/api/scores/:eventId', requireAuth, async (req, res) => {
  const { score } = req.body;
  const profile = await supabase.from('profiles').select('display_name').eq('id', req.user.id).single();
  const { error } = await supabase.from('blindtest_scores').upsert({
    user_id: req.user.id, event_id: req.params.eventId,
    user_name: profile.data?.display_name || 'Invité', score
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Profil ────────────────────────────────────────────────────────
app.get('/api/profile', requireAuth, async (req, res) => {
  const { data } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
  res.json(data || {});
});

app.patch('/api/profile', requireAuth, async (req, res) => {
  const { display_name } = req.body;
  const { data, error } = await supabase.from('profiles')
    .update({ display_name }).eq('id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── SPA fallback ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══ DÉMARRAGE ════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🎵 DJ REQUEST — Serveur actif      ║
  ║   Port : ${PORT}                         ║
  ║   Env  : ${process.env.NODE_ENV || 'development'}              ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;
