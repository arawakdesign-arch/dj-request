-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Ajoute email/téléphone aux profils utilisateurs, pour
-- affichage dans l'onglet Contact de l'organisateur (Google → email,
-- connexion téléphone → numéro). Synchronisé automatiquement par le
-- middleware requireAuth à chaque requête authentifiée (cf.
-- middleware/auth.js), pas seulement à l'inscription.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT NULL;
