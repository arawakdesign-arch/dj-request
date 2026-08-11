-- ══════════════════════════════════════════════════════════════════
-- DJ REQUEST / PULL UP! — Migration v3 — Phase 1 MVP Core
-- Périmètre strict : user_profiles, events, proposals, votes, now_playing
-- Base Supabase confirmée vide le 2026-06-30.
-- À exécuter manuellement : Supabase → SQL Editor → New Query → Run
-- ══════════════════════════════════════════════════════════════════

-- ══ EXTENSION ═════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ══ EVENTS ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS events (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT 'Soirée',
  club_name    TEXT DEFAULT '',
  address      TEXT DEFAULT '',
  hours        TEXT DEFAULT '',
  lineup       JSONB DEFAULT '[]',
  password     TEXT NOT NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  flyer_url    TEXT DEFAULT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ USER_PROFILES ══════════════════════════════════════════════════
-- id en TEXT : accepte guest_*, phone_*, UUID Google OAuth en texte.
-- Pas de FK vers auth.users.
CREATE TABLE IF NOT EXISTS user_profiles (
  id           TEXT PRIMARY KEY,
  display_name TEXT,
  bio          TEXT DEFAULT '',
  photo_url    TEXT DEFAULT NULL,
  friend_code  TEXT DEFAULT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ PROPOSALS ═════════════════════════════════════════════════════
-- proposed_by en TEXT, nullable (le code actuel l'envoie à NULL).
-- votes à 0 : alimenté par le trigger depuis la table votes.
-- Visibles et votables immédiatement — aucune condition sur approved.
CREATE TABLE IF NOT EXISTS proposals (
  id           TEXT NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  votes        INTEGER DEFAULT 0,
  approved     BOOLEAN DEFAULT FALSE,
  proposed_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, event_id)
);

-- ══ VOTES ═════════════════════════════════════════════════════════
-- user_id en TEXT, sans FK vers auth.users.
-- PRIMARY KEY (event_id, proposal_id, user_id) = contrainte anti double-vote.
-- FK vers proposals pour intégrité référentielle.
CREATE TABLE IF NOT EXISTS votes (
  user_id      TEXT NOT NULL,
  proposal_id  TEXT NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, proposal_id, user_id),
  FOREIGN KEY (proposal_id, event_id) REFERENCES proposals(id, event_id) ON DELETE CASCADE
);

-- ══ NOW_PLAYING ════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS now_playing (
  event_id     UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  title        TEXT DEFAULT 'En attente…',
  artist       TEXT DEFAULT '',
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ══════════════════════════════════════════════════════════════════

-- updated_at automatique
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER now_playing_updated_at
  BEFORE UPDATE ON now_playing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Synchronisation proposals.votes depuis la table votes.
-- Ce trigger deviendra actif une fois que le code applicatif écrira
-- réellement dans votes (mission de code séparée, hors périmètre ici).
CREATE OR REPLACE FUNCTION update_proposal_votes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE proposals SET votes = votes + 1
    WHERE id = NEW.proposal_id AND event_id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE proposals SET votes = GREATEST(0, votes - 1)
    WHERE id = OLD.proposal_id AND event_id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_vote_change ON votes;
CREATE TRIGGER on_vote_change
  AFTER INSERT OR DELETE ON votes
  FOR EACH ROW EXECUTE FUNCTION update_proposal_votes();

-- Création automatique du profil lors d'une inscription Google OAuth.
-- Ne se déclenche pas pour guest_* ni phone_* (ils ne passent pas par auth.users).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (
    NEW.id::text,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.phone, 'Invité')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Lecture publique là où c'est nécessaire (Realtime, affichage).
-- Écriture fermée côté client — backend service_role uniquement.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE now_playing    ENABLE ROW LEVEL SECURITY;

-- Events
CREATE POLICY "events_read"   ON events FOR SELECT USING (true);
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (false);
CREATE POLICY "events_update" ON events FOR UPDATE USING (false);
CREATE POLICY "events_delete" ON events FOR DELETE USING (false);

-- User_profiles
CREATE POLICY "user_profiles_read"   ON user_profiles FOR SELECT USING (true);
CREATE POLICY "user_profiles_insert" ON user_profiles FOR INSERT WITH CHECK (false);
CREATE POLICY "user_profiles_update" ON user_profiles FOR UPDATE USING (false);

-- Proposals : lecture publique — visibles et votables immédiatement
CREATE POLICY "proposals_read"   ON proposals FOR SELECT USING (true);
CREATE POLICY "proposals_insert" ON proposals FOR INSERT WITH CHECK (false);
CREATE POLICY "proposals_update" ON proposals FOR UPDATE USING (false);
CREATE POLICY "proposals_delete" ON proposals FOR DELETE USING (false);

-- Votes
CREATE POLICY "votes_read"   ON votes FOR SELECT USING (true);
CREATE POLICY "votes_insert" ON votes FOR INSERT WITH CHECK (false);
CREATE POLICY "votes_delete" ON votes FOR DELETE USING (false);

-- Now playing
CREATE POLICY "np_read"   ON now_playing FOR SELECT USING (true);
CREATE POLICY "np_insert" ON now_playing FOR INSERT WITH CHECK (false);
CREATE POLICY "np_update" ON now_playing FOR UPDATE USING (false);

-- ══════════════════════════════════════════════════════════════════
-- REALTIME
-- ══════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE proposals;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE now_playing;
