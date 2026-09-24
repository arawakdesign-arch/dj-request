-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Vérification RLS en conditions réelles
-- À exécuter dans : Supabase → SQL Editor → New Query
-- Lecture seule : ne modifie aucune donnée. Peut être relancé à tout
-- moment (ex. après chaque nouvelle migration touchant à RLS) pour
-- confirmer que ce que le code suppose est bien ce que Postgres applique.
--
-- Principe : on se fait passer pour la clé publique "anon" (celle
-- embarquée dans le navigateur) et on tente de lire des tables qui ne
-- doivent JAMAIS être accessibles directement de cette façon — seul le
-- backend Node (clé service_role, qui contourne RLS) doit pouvoir les lire.
-- Chaque requête doit renvoyer 0 ligne. Une seule ligne renvoyée = fuite.
-- ══════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL ROLE anon;

-- Toutes ces requêtes doivent renvoyer 0 ligne.
SELECT 'events (mot de passe organisateur)'      AS table_verifiee, count(*) AS lignes_visibles FROM events;
SELECT 'user_profiles (email/téléphone/friend_code)' AS table_verifiee, count(*) AS lignes_visibles FROM user_profiles;
SELECT 'votes'                                   AS table_verifiee, count(*) AS lignes_visibles FROM votes;
SELECT 'locations (zone déclarée)'               AS table_verifiee, count(*) AS lignes_visibles FROM locations;
SELECT 'blindtest_scores'                        AS table_verifiee, count(*) AS lignes_visibles FROM blindtest_scores;
SELECT 'reports (signalements)'                  AS table_verifiee, count(*) AS lignes_visibles FROM reports;
SELECT 'organizer_followers'                     AS table_verifiee, count(*) AS lignes_visibles FROM organizer_followers;
SELECT 'retention_runs'                          AS table_verifiee, count(*) AS lignes_visibles FROM retention_runs;
SELECT 'friendships'                             AS table_verifiee, count(*) AS lignes_visibles FROM friendships;

-- Ces deux colonnes ne doivent jamais apparaître, même sur les tables dont
-- la lecture est en partie publique (messages/proposals) : la requête doit
-- échouer avec "permission denied for column" — c'est le résultat attendu.
DO $$
BEGIN
  PERFORM user_id FROM messages LIMIT 1;
  RAISE EXCEPTION 'FUITE : messages.user_id est lisible par la clé anon';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK : messages.user_id correctement protégé';
END $$;

DO $$
BEGIN
  PERFORM proposed_by FROM proposals LIMIT 1;
  RAISE EXCEPTION 'FUITE : proposals.proposed_by est lisible par la clé anon';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK : proposals.proposed_by correctement protégé';
END $$;

DO $$
BEGIN
  PERFORM email FROM user_profiles LIMIT 1;
  RAISE EXCEPTION 'FUITE : user_profiles.email est lisible par la clé anon';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK : user_profiles.email correctement protégé';
END $$;

RESET ROLE;
ROLLBACK; -- SET LOCAL ROLE n'a d'effet que pour cette transaction ; ROLLBACK ferme proprement.

-- Lecture attendue : chaque "lignes_visibles" ci-dessus = 0, et chaque
-- bloc DO $$ affiche "OK : ...". Si une ligne apparaît ou qu'un bloc
-- lève "FUITE", corriger la migration correspondante avant de continuer.
