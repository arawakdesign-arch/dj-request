-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Ferme la lecture publique de votes/locations/blindtest_scores
-- Ces 3 tables étaient lisibles par n'importe qui avec la clé anon
-- (USING (true)/(is_active = true)), en interrogeant directement l'API
-- Supabase — hors de notre backend, donc hors de tout contrôle d'accès.
-- Ça exposait qui a voté pour quoi (votes), la zone physique de chaque
-- invité dans la salle (locations) et les scores nominatifs (blindtest_scores),
-- pour TOUTES les soirées, pas seulement celle en cours.
-- Le code (client JS) ne lit jamais ces 3 tables directement — seul le
-- backend (clé service_role, qui contourne RLS) en a besoin. Fermer la
-- lecture ici ne casse donc rien.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "votes_read" ON votes;
CREATE POLICY "votes_read" ON votes FOR SELECT USING (false);

DROP POLICY IF EXISTS "loc_read" ON locations;
CREATE POLICY "loc_read" ON locations FOR SELECT USING (false);

DROP POLICY IF EXISTS "scores_read" ON blindtest_scores;
CREATE POLICY "scores_read" ON blindtest_scores FOR SELECT USING (false);
