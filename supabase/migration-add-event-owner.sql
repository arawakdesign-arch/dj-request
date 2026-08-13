-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Relie chaque événement au compte de son créateur.
-- id en TEXT, sans FK vers auth.users : accepte guest_*, phone_*,
-- UUID Google OAuth en texte (même convention que dj_profiles /
-- user_profiles). Nullable : les événements déjà créés n'ont pas de
-- propriétaire connu et restent gérables par mot de passe comme avant.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_id TEXT DEFAULT NULL;
