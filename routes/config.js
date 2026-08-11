const express = require('express');
const router  = express.Router();

// Expose uniquement les variables publiques nécessaires au frontend.
// Ne jamais inclure SERVICE_KEY, SECRET_KEY, JWT_SECRET ou tout autre secret serveur.
router.get('/public', (req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Config serveur incomplète — vérifier .env' });
  res.json({ supabaseUrl: url, supabaseAnonKey: key });
});

module.exports = router;
