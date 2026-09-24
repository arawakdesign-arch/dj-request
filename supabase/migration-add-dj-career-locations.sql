-- Résidences, collaborations et coordonnées affichées sur le profil DJ.
-- Migration additive : les profils existants conservent toutes leurs données.
BEGIN;
ALTER TABLE public.dj_profiles
  ADD COLUMN IF NOT EXISTS career_locations JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
