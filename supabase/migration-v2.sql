-- ══ Migration v2 — Profil, Flyer, Amis ══════════════════════════════

-- 1. Colonnes profil utilisateur
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio        TEXT    DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo_url  TEXT    DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS friend_code TEXT   DEFAULT NULL;

-- 2. Colonne flyer événement
ALTER TABLE events ADD COLUMN IF NOT EXISTS flyer_url TEXT DEFAULT NULL;

-- 3. Table amitiés
CREATE TABLE IF NOT EXISTS friendships (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  friend_code TEXT        NOT NULL,
  friend_name TEXT        NOT NULL DEFAULT 'Ami',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_code)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- Les politiques RLS sont gérées côté serveur avec service_role (bypass)
