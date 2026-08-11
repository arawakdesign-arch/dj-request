const express      = require('express');
const crypto       = require('crypto');
const { signToken, verifyToken } = require('../lib/jwt');

const router = express.Router();

// ── Invité : session sans compte ──────────────────────────────────────
router.post('/guest', (req, res) => {
  const uid  = 'guest_' + crypto.randomBytes(8).toString('hex');
  const user = { id: uid, displayName: 'Invité', role: 'guest' };
  const token = signToken(user);
  res.json({ token, user });
});

// ── Me : infos du token courant (JWT maison uniquement) ───────────────
router.get('/me', (req, res) => {
  const raw = req.headers.authorization?.replace('Bearer ', '');
  if (!raw) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const payload = verifyToken(raw);
    res.json({ user: payload });
  } catch(e) {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
});

module.exports = router;
