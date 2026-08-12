-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Profils DJ : permet à un DJ de créer un profil (nom de
-- scène, bio, réseaux, booking) affiché sur une page Press Kit qui
-- lui est propre, indépendamment de tout événement.
-- id en TEXT, sans FK vers auth.users : accepte guest_*, phone_*,
-- UUID Google OAuth en texte (même convention que user_profiles).
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dj_profiles (
  id                TEXT PRIMARY KEY,
  stage_name        TEXT DEFAULT '',
  tagline           TEXT DEFAULT '',
  bio               TEXT DEFAULT '',
  city              TEXT DEFAULT '',
  genres            TEXT DEFAULT '',
  photo_url         TEXT DEFAULT NULL,
  instagram         TEXT DEFAULT '',
  soundcloud        TEXT DEFAULT '',
  resident_advisor  TEXT DEFAULT '',
  booking_email     TEXT DEFAULT '',
  available         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dj_profiles ENABLE ROW LEVEL SECURITY;

-- Lecture publique (page press kit partageable), écriture réservée au
-- serveur (clé service_role, qui contourne RLS de toute façon).
DROP POLICY IF EXISTS "dj_profiles_read"   ON dj_profiles;
DROP POLICY IF EXISTS "dj_profiles_insert" ON dj_profiles;
DROP POLICY IF EXISTS "dj_profiles_update" ON dj_profiles;
CREATE POLICY "dj_profiles_read"   ON dj_profiles FOR SELECT USING (true);
CREATE POLICY "dj_profiles_insert" ON dj_profiles FOR INSERT WITH CHECK (false);
CREATE POLICY "dj_profiles_update" ON dj_profiles FOR UPDATE USING (false);
