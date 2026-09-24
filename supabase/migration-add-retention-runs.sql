-- Exécuter dans Supabase SQL Editor AVANT de déployer cette version.
-- Journal des exécutions de la purge RGPD (comptes inactifs depuis 24 mois) —
-- aucune donnée personnelle : sert uniquement à vérifier que la purge tourne
-- réellement, à empêcher deux exécutions concurrentes, et à diagnostiquer un
-- échec depuis Supabase sans avoir besoin des logs serveur.
BEGIN;

CREATE TABLE IF NOT EXISTS retention_runs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'running', -- running | success | failed
  purged_count INTEGER,
  error        TEXT
);

ALTER TABLE retention_runs ENABLE ROW LEVEL SECURITY;

-- Écritures/lectures faites côté serveur avec la clé service_role (contourne
-- RLS) — ces policies bloquent simplement tout accès direct depuis le
-- navigateur avec la clé publique.
DROP POLICY IF EXISTS "retention_runs_no_access" ON retention_runs;
CREATE POLICY "retention_runs_no_access" ON retention_runs FOR ALL USING (false) WITH CHECK (false);

COMMIT;

-- Vérification manuelle depuis Supabase SQL Editor, à tout moment :
--   select * from retention_runs order by started_at desc limit 20;
-- Une purge saine produit une ligne 'success' par jour. L'absence de
-- nouvelle ligne depuis plus de 48h, ou une ligne 'running' plus vieille que
-- quelques minutes, indique que la purge ne tourne pas ou plus.
