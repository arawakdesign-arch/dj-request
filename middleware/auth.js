const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const supabase = require('../lib/supabase');
const { verifyToken } = require('../lib/jwt');

// Tient user_profiles.email/phone à jour à partir de l'identité vue sur
// chaque requête authentifiée (Google → email, Phone OTP → numéro) — sans
// bloquer la requête ni la faire échouer si la synchro rate.
function syncContactInfo(user) {
  if (!user?.id || (!user.email && !user.phone)) return;
  const updates = { id: user.id, updated_at: new Date().toISOString() };
  if (user.email) updates.email = user.email;
  if (user.phone) updates.phone = user.phone;
  supabase.from('user_profiles').upsert(updates).then(() => {}, () => {});
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  // 1. JWT interne (guest, phone OTP maison)
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
    req.user = { id: user.id, email: user.email || null, phone: user.phone || null };
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

async function requireOrganizer(req, res, next) {
  const eventId = req.params.eventId || req.params.id;

  // 1. JWT organizer (restauration de session — pas de mot de passe disponible après refresh)
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (bearer) {
    try {
      const payload = verifyToken(bearer);
      if (payload.role === 'organizer' && payload.event_id === eventId) return next();
    } catch(e) { /* JWT expiré ou invalide — continuer avec le mot de passe */ }
  }

  // 2. Mot de passe direct (session active, _djPassword présent)
  const password = req.headers['x-organizer-password'];
  if (!password) return res.status(403).json({ error: 'Mot de passe requis' });

  const { data: event } = await supabase
    .from('events').select('password').eq('id', eventId).single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });

  if (!await verifyOrganizerPassword(eventId, event.password, password)) {
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
  }

  const password = req.headers['x-organizer-password'];
  if (!password) return false;

  const { data: event } = await supabase
    .from('events').select('password').eq('id', eventId).single();
  if (!event) return false;

  return verifyOrganizerPassword(eventId, event.password, password);
}

module.exports = { requireAuth, requireOrganizer, isOrganizer, hashPassword, verifyOrganizerPassword };
