-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Abonnés d'une page organisateur (vrai compteur, pas un
-- chiffre décoratif)
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizer_followers (
  organizer_id TEXT NOT NULL REFERENCES organizer_pages(owner_id) ON DELETE CASCADE,
  follower_id  TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (organizer_id, follower_id)
);

ALTER TABLE organizer_followers ENABLE ROW LEVEL SECURITY;

-- Écritures/lectures faites côté serveur avec la clé service_role (contourne
-- RLS) — cette policy bloque simplement tout accès direct depuis le navigateur.
DROP POLICY IF EXISTS "organizer_followers_no_direct" ON organizer_followers;
CREATE POLICY "organizer_followers_no_direct" ON organizer_followers FOR ALL USING (false) WITH CHECK (false);
