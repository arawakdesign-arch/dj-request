require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const supabase  = require('./lib/supabase');

const configRouter   = require('./routes/config');
const authRouter     = require('./routes/auth');
const searchRouter   = require('./routes/search');
const friendsRouter  = require('./routes/friends');
const eventsRouter   = require('./routes/events');
const messagesRouter = require('./routes/messages');
const liveRouter     = require('./routes/live');
const profileRouter  = require('./routes/profile');
const djRouter       = require('./routes/dj');
const screenRouter   = require('./routes/screen');
const orgaRouter     = require('./routes/orga');

const app  = express();
const PORT = process.env.PORT || 3000;

// Nécessaire derrière nginx (reverse proxy) pour que le rate limiting et req.ip
// utilisent la vraie IP du client (X-Forwarded-For) au lieu de 127.0.0.1 pour tout le monde.
app.set('trust proxy', 1);

// ══ SÉCURITÉ ══════════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:       ["'self'", "fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:", "blob:", "*.supabase.co", "i.pravatar.cc", "*.itunes.apple.com", "*.mzstatic.com", "*.dzcdn.net", "*.deezer.com"],
      connectSrc:    ["'self'", "https://*.supabase.co", "wss://*.supabase.co", "itunes.apple.com", "api.deezer.com"],
      mediaSrc:      ["'self'", "*.itunes.apple.com", "*.supabase.co"],
    },
  },
}));
app.use(cors({ origin: process.env.APP_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ══ RATE LIMITING ═════════════════════════════════════════════════════
app.use('/api/', rateLimit({ windowMs: 60 * 1000,      max: 120, message: { error: 'Ralentissez !' } }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { error: 'Trop de requêtes' } }));

// ══ PARTAGE D'ÉVÉNEMENT — flyer en aperçu de lien (WhatsApp, etc.) ═════
// Les crawlers de réseaux sociaux ne lisent que le HTML brut (pas de JS) :
// on injecte donc le flyer de l'événement dans les balises og:/twitter:
// avant de servir la page, plutôt que de compter sur le rendu client.
const escapeHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get('/', async (req, res, next) => {
  const evParam = req.query.event;
  if (!evParam) return next();
  try {
    let query = supabase.from('events').select('id, name, club_name, flyer_url, is_active');
    query = UUID_RE.test(evParam) ? query.eq('id', evParam) : query.eq('name', evParam).eq('is_active', true);
    const { data: ev } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!ev || !ev.flyer_url) return next();

    let html  = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const title = escapeHtml(ev.name || 'Pull up');
    const desc  = escapeHtml(`Rejoins la soirée${ev.club_name ? ' à ' + ev.club_name : ''} et vote pour la prochaine chanson 🎵`);
    const image = escapeHtml(ev.flyer_url);

    html = html
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${desc}">`)
      .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${image}">`)
      .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${title}">`)
      .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${desc}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${image}">`);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
  } catch (e) {
    next();
  }
});

// ══ FICHIERS STATIQUES ════════════════════════════════════════════════
const isDev = process.env.NODE_ENV !== 'production';
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (isDev) {
      // En dev : rien n'est caché → toujours la dernière version
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));

// ══ ROUTES API ════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() }));
app.use('/api/config', configRouter);

app.use('/api/auth',    authRouter);
app.use('/api/search',  searchRouter);
app.use('/api/friends', friendsRouter);
app.use('/api', eventsRouter);
app.use('/api', messagesRouter);
app.use('/api', liveRouter);
app.use('/api', profileRouter);
app.use('/api', djRouter);
app.use('/api', screenRouter);
app.use('/api', orgaRouter);

// ══ SPA FALLBACK ══════════════════════════════════════════════════════
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══ DÉMARRAGE ═════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🎵 PULL UP! — Serveur actif        ║
  ║   Port : ${PORT}                         ║
  ║   Env  : ${process.env.NODE_ENV || 'development'}              ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;
