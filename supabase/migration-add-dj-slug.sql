-- Exécuter dans Supabase SQL Editor AVANT de déployer cette version.
-- Migration additive : conserve tous les profils DJ existants.
BEGIN;
ALTER TABLE public.dj_profiles
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
COMMIT;
