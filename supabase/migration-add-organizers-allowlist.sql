-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Allowlist des organisateurs autorisés à créer une soirée.
-- Seuls les comptes Google dont l'email figure dans cette table peuvent
-- créer un événement (POST /api/events) — cf. routes/events.js.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizers (
  email        TEXT PRIMARY KEY,
  display_name TEXT DEFAULT '',
  added_at     TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO organizers (email) VALUES
  ('arawakdesign@gmail.com')
ON CONFLICT (email) DO NOTHING;
