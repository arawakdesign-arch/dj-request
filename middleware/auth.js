const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const supabase = require('../lib/supabase');
const { verifyToken } = require('../lib/jwt');

// Limite légère anti-brute-force sur les tentatives de mot de passe
// organisateur, en plus de la limite globale de l'API — ne s'applique
// qu'au chemin "mot de passe" de requireOrganizer/isOrganizer (pas aux
// requêtes JWT normales, qui restent illimitées). Compteur en mémoire par
// IP, remis à zéro toutes les 10 minutes ; suffisant pour une seule
// instance pm2 sans dépendance supplémentaire.
const PASSWORD_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const PASSWORD_ATTEMPT_MAX       = 15;
const _passwordAttempts = new Map(); // ip -> { count, resetAt }
function passwordAttemptAllowed(ip) {
  const now = Date.now();
  const entry = _passwordAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    _passwordAttempts.set(ip, { count: 1, resetAt: now + PASSWORD_ATTEMPT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= PASSWORD_ATTEMPT_MAX;
}

// Tient user_profiles.email/phone à jour à partir de l'identité vue sur
// chaque requête authentifiée (Google → email, Phone OTP → numéro) — sans
// bloquer la requête ni la faire échouer si la synchro rate.
async function syncContactInfo(user) {
  if (!user?.id || (!user.email && !user.phone)) return;
  const updates = { id: user.id, updated_at: new Date().toISOString() };
  if (user.email) updates.email = user.email;
  if (user.phone) updates.phone = user.phone;
  supabase.from('user_profiles').upsert(updates).then(() => {}, () => {});

  // Amorce le nom/photo depuis Google au premier login — sinon le profil reste
  // vide (aucune connexion Google ne les importe automatiquement) et le chat
  // affiche "Invité" sans photo tant que l'utilisateur n'édite pas son profil
  // à la main. On ne touche jamais un profil déjà personnalisé.
  // Écriture conditionnelle atomique (WHERE ... IS NULL) plutôt qu'un lire-
  // puis-écrire : sinon une requête concurrente (ex. upload de photo par
  // l'utilisateur au même moment) peut lire "vide" juste avant que l'upload
  // n'écrive la vraie photo, puis l'écraser après coup avec celle de Google.
  if (user.googleName)  supabase.from('user_profiles').update({ display_name: user.googleName }).eq('id', user.id).is('display_name', null).then(() => {}, () => {});
  if (user.googlePhoto) supabase.from('user_profiles').update({ photo_url: user.googlePhoto }).eq('id', user.id).is('photo_url', null).then(() => {}, () => {});
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  // 1. JWT interne (session organisateur)
  try {
    const payload = verifyToken(token);
    req.user = {
      id: payload.id, email: payload.email || null, phone: payload.phoneNumber || null,
      role: payload.role || null, event_id: payload.event_id || null,
    };
    syncContactInfo(req.user);
    return next();
  } catch(e) { /* pas notre JWT, on essaie Supabase */ }

  // 2. JWT Supabase (Google OAuth, Phone OTP natif)
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Token invalide' });
    req.user = {
      id: user.id, email: user.email || null, phone: user.phone || null,
      googleName:  user.user_metadata?.full_name || user.user_metadata?.name || null,
      googlePhoto: user.user_metadata?.picture || user.user_metadata?.avatar_url || null,
    };
    syncContactInfo(req.user);
    return next();
  } catch(e) {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// Comparaison en temps constant pour éviter les attaques par timing sur le hash du mot de passe
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

// Vérifie un mot de passe contre le hash stocké. Supporte l'ancien format
// (SHA-256 non salé, hex 64 caractères) pour ne pas invalider les mots de
// passe existants, et migre silencieusement vers bcrypt (salé) dès qu'une
// vérification réussit avec l'ancien format.
async function verifyOrganizerPassword(eventId, storedHash, password) {
  const isLegacy = typeof storedHash === 'string' && /^[0-9a-f]{64}$/i.test(storedHash);
  if (isLegacy) {
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
    const ok = timingSafeEqualHex(storedHash, legacyHash);
    if (ok) {
      supabase.from('events').update({ password: hashPassword(password) }).eq('id', eventId).then(() => {}, () => {});
    }
    return ok;
  }
  try { return bcrypt.compareSync(password, storedHash); } catch(e) { return false; }
}

// Un DJ inscrit sur Pull up et présent dans le line-up (type 'app', id =
// user_profiles.id = dj_profiles.id) peut administrer la soirée avec son
// propre compte, en même temps que l'organisateur — sans connaître le mot
// de passe partagé.
function isLineupMember(lineup, userId) {
  return Array.isArray(lineup) && lineup.some(dj => dj.type === 'app' && dj.id === userId);
}

async function requireOrganizer(req, res, next) {
  const eventId = req.params.eventId || req.params.id;

  // 1. JWT organizer (restauration de session — pas de mot de passe disponible après refresh)
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (bearer) {
    try {
      const payload = verifyToken(bearer);
      if (payload.role === 'organizer' && payload.event_id === eventId) return next();
      console.error('[requireOrganizer] JWT valide mais rôle/event_id ne correspondent pas —', req.method, req.originalUrl, '| payload.role=', payload.role, 'payload.event_id=', payload.event_id, 'eventId attendu=', eventId);
    } catch(e) { /* JWT expiré ou invalide — continuer avec le mot de passe */ }

    // 1bis. Compte personnel Pull up (Google/email) — propriétaire de la
    // soirée ou DJ du line-up.
    try {
      const { data: { user } } = await supabase.auth.getUser(bearer);
      if (user) {
        const { data: event } = await supabase.from('events').select('owner_id, lineup').eq('id', eventId).single();
        if (event && (event.owner_id === user.id || isLineupMember(event.lineup, user.id))) return next();
      }
    } catch(e) { /* pas un token Supabase valide non plus — continuer avec le mot de passe */ }
  }

  // 2. Mot de passe direct (session active, _djPassword présent)
  const password = req.headers['x-organizer-password'];
  if (!password) { console.error('[requireOrganizer] Aucun mot de passe fourni —', req.method, req.originalUrl, '| eventId=', eventId); return res.status(403).json({ error: 'Mot de passe requis' }); }

  if (!passwordAttemptAllowed(req.ip)) {
    return res.status(429).json({ error: 'Trop de tentatives — réessaie dans quelques minutes.' });
  }

  const { data: event } = await supabase
    .from('events').select('password').eq('id', eventId).single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });

  if (!await verifyOrganizerPassword(eventId, event.password, password)) {
    console.error('[requireOrganizer] Mot de passe incorrect —', req.method, req.originalUrl, '| eventId=', eventId);
    return res.status(403).json({ error: 'Mot de passe incorrect' });
  }

  next();
}

// Variante booléenne de requireOrganizer, utilisable en dehors d'une chaîne de middlewares
// (ex : une route où l'eventId ne vient pas des params mais d'une ressource déjà chargée).
async function isOrganizer(req, eventId) {
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (bearer) {
    try {
      const payload = verifyToken(bearer);
      if (payload.role === 'organizer' && payload.event_id === eventId) return true;
    } catch(e) { /* on retente avec le mot de passe */ }

    try {
      const { data: { user } } = await supabase.auth.getUser(bearer);
      if (user) {
        const { data: event } = await supabase.from('events').select('owner_id, lineup').eq('id', eventId).single();
        if (event && (event.owner_id === user.id || isLineupMember(event.lineup, user.id))) return true;
      }
    } catch(e) { /* pas un token Supabase valide non plus — continuer avec le mot de passe */ }
  }

  const password = req.headers['x-organizer-password'];
  if (!password) return false;
  if (!passwordAttemptAllowed(req.ip)) return false;

  const { data: event } = await supabase
    .from('events').select('password').eq('id', eventId).single();
  if (!event) return false;

  return verifyOrganizerPassword(eventId, event.password, password);
}

module.exports = { requireAuth, requireOrganizer, isOrganizer, hashPassword, verifyOrganizerPassword };
