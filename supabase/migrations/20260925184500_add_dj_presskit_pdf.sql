-- Enregistre le PDF du press kit chargé par chaque DJ.
-- Migration additive : aucune donnée existante n'est modifiée.
ALTER TABLE public.dj_profiles
  ADD COLUMN IF NOT EXISTS presskit_pdf_url TEXT;

COMMENT ON COLUMN public.dj_profiles.presskit_pdf_url IS
  'URL publique du press kit PDF chargé par le DJ';

-- Force PostgREST à reconnaître immédiatement la nouvelle colonne.
NOTIFY pgrst, 'reload schema';
