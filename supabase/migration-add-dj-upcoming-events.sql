-- À exécuter dans Supabase SQL Editor avant de publier les cartes
-- "Soirées à venir" sur les profils DJ.
ALTER TABLE public.dj_profiles
  ADD COLUMN IF NOT EXISTS upcoming_events JSONB NOT NULL DEFAULT '[]'::jsonb;
