const crypto   = require('crypto');
const supabase = require('../lib/supabase');

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token invalide' });

  req.user = user;
  next();
}

async function requireOrganizer(req, res, next) {
  const eventId  = req.params.eventId || req.params.id;
  const password = req.headers['x-organizer-password'];
  if (!password) return res.status(403).json({ error: 'Mot de passe requis' });

  const { data: event } = await supabase
    .from('events').select('password').eq('id', eventId).single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (event.password !== hash) return res.status(403).json({ error: 'Mot de passe incorrect' });

  next();
}

module.exports = { requireAuth, requireOrganizer };
