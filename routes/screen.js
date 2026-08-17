const express  = require('express');
const crypto   = require('crypto');
const supabase = require('../lib/supabase');
const { verifyToken } = require('../lib/jwt');

const router = express.Router();

// Caractères sans ambiguïté visuelle (pas de 0/O, 1/I/L) — code lisible à l'oral/écran
const CODE_ALPHABET   = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH     = 6;
const PAIRING_TTL_MS  = 5 * 60 * 1000; // un code non réclamé expire après 5 min

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// ── Écran (TV) : crée un code de pairing éphémère ───────────────────────
router.post('/screen/pairings', async (req, res) => {
  // Quelques tentatives en cas de collision improbable sur le code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { error } = await supabase.from('screen_pairings').insert({ code });
    if (!error) return res.status(201).json({ code });
    if (error.code !== '23505') return res.status(500).json({ error: error.message }); // 23505 = clé dupliquée → on retente
  }
  res.status(500).json({ error: 'Impossible de générer un code de pairing.' });
});

// ── Téléphone organisateur : associe le code à sa soirée ────────────────
router.post('/screen/pairings/:code/claim', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  let payload;
  try { payload = verifyToken(token); } catch(e) {
    return res.status(401).json({ error: 'Token invalide' });
  }
  if (payload.role !== 'organizer') {
    return res.status(403).json({ error: 'Seul un organisateur peut associer un écran.' });
  }

  const { data: pairing } = await supabase
    .from('screen_pairings').select('code, event_id, created_at').eq('code', req.params.code).maybeSingle();
  if (!pairing) return res.status(404).json({ error: 'Code introuvable.' });
  if (Date.now() - new Date(pairing.created_at).getTime() > PAIRING_TTL_MS) {
    return res.status(410).json({ error: 'Ce code a expiré — régénère un QR sur l\'écran.' });
  }
  if (pairing.event_id) return res.status(409).json({ error: 'Cet écran est déjà associé.' });

  const { error } = await supabase.from('screen_pairings')
    .update({ event_id: payload.event_id }).eq('code', req.params.code);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

module.exports = router;
