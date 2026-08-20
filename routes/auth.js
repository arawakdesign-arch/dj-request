const express      = require('express');
const { verifyToken } = require('../lib/jwt');

const router = express.Router();

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
