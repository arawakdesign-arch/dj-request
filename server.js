require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

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

const app  = express();
const PORT = process.env.PORT || 3000;

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
      // Désactivé de nouveau temporairement : le DNS de pull-up.live n'est pas
      // encore propagé et aucun certificat SSL n'est posé sur le VPS (IP nue).
      // À retirer dès que certbot aura tourné — voir conversation "nom de domaine".
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(cors({ origin: process.env.APP_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ══ RATE LIMITING ═════════════════════════════════════════════════════
app.use('/api/', rateLimit({ windowMs: 60 * 1000,      max: 120, message: { error: 'Ralentissez !' } }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { error: 'Trop de requêtes' } }));

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
