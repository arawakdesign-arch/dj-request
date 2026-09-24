-- Ajoute le PDF chargé par le DJ dans son formulaire de profil.
ALTER TABLE public.dj_profiles
  ADD COLUMN IF NOT EXISTS presskit_pdf_url TEXT;
