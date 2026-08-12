-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Fix : les invités ne peuvent ni partager leur position
-- ni enregistrer un score de Blind Test (même cause que
-- migration-fix-guest-proposals.sql, jamais appliquée à ces 2 tables)
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════
--
-- Cause : locations.user_id et blindtest_scores.user_id sont typés
-- `UUID REFERENCES auth.users(id)`. Les invités et les comptes
-- téléphone utilisent un id maison ("guest_xxxx", "phone_xxxx") qui
-- n'est ni un UUID valide, ni présent dans auth.users → chaque
-- écriture échoue en base (500), silencieusement ignorée côté client.

DROP POLICY IF EXISTS "loc_upsert"    ON locations;
DROP POLICY IF EXISTS "loc_update"    ON locations;
DROP POLICY IF EXISTS "scores_upsert" ON blindtest_scores;
DROP POLICY IF EXISTS "scores_update" ON blindtest_scores;

ALTER TABLE locations         DROP CONSTRAINT IF EXISTS locations_user_id_fkey;
ALTER TABLE locations         ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE blindtest_scores  DROP CONSTRAINT IF EXISTS blindtest_scores_user_id_fkey;
ALTER TABLE blindtest_scores  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

-- Policies fermées côté écriture (comme pour proposals/votes) : le serveur
-- écrit avec la clé service_role, qui contourne RLS de toute façon.
CREATE POLICY "loc_upsert"    ON locations        FOR INSERT WITH CHECK (false);
CREATE POLICY "loc_update"    ON locations        FOR UPDATE USING (false);
CREATE POLICY "scores_upsert" ON blindtest_scores  FOR INSERT WITH CHECK (false);
CREATE POLICY "scores_update" ON blindtest_scores  FOR UPDATE USING (false);
