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

-- La policy RLS "user_profiles_read" existante (USING (true)) reste valable
-- pour les colonnes publiques (display_name, photo_url...) — mais email/phone
-- ne doivent jamais être lisibles via la clé anon/authenticated, seulement
-- côté serveur (service_role, contourne RLS) pour l'onglet Contact organisateur.
-- RLS ne filtre pas par colonne : on restreint donc au niveau des privilèges.
REVOKE SELECT ON user_profiles FROM anon, authenticated;
GRANT SELECT (id, display_name, bio, photo_url, friend_code, created_at, updated_at)
  ON user_profiles TO anon, authenticated;
