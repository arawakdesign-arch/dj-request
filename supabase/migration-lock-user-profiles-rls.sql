-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Ferme la lecture publique de user_profiles
-- Les colonnes email/téléphone étaient déjà exclues des privilèges
-- accordés à anon/authenticated (migration-add-profile-contact.sql),
-- mais id/display_name/bio/photo_url/friend_code restaient interrogeables
-- par n'importe qui avec la clé anon — notamment friend_code, pensé pour
-- n'être partagé qu'à qui la personne choisit.
-- Le code (client JS) ne lit jamais cette table directement — seul le
-- backend (clé service_role, qui contourne RLS) en a besoin.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "user_profiles_read" ON user_profiles;
CREATE POLICY "user_profiles_read" ON user_profiles FOR SELECT USING (false);
