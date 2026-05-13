-- ══════════════════════════════════════════════════════════════════
-- DJ REQUEST — Schéma Supabase (PostgreSQL)
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

-- Extension pour UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ══ TABLE EVENTS (soirées) ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS events (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT 'Soirée DJ Request',
  club_name    TEXT DEFAULT 'Club',
  address      TEXT DEFAULT '',
  hours        TEXT DEFAULT '22h → 6h',
  lineup       JSONB DEFAULT '[]',
  password     TEXT NOT NULL,           -- hash du mot de passe organisateur
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE PROPOSALS (propositions de morceaux) ════════════════════
CREATE TABLE IF NOT EXISTS proposals (
  id           TEXT NOT NULL,           -- id du morceau dans le catalogue
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  votes        INTEGER DEFAULT 1,
  approved     BOOLEAN DEFAULT FALSE,
  proposed_by  UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, event_id)
);

-- ══ TABLE VOTES ════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS votes (
  user_id      UUID NOT NULL REFERENCES auth.users(id),
  proposal_id  TEXT NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, proposal_id, event_id)
);

-- ══ TABLE MESSAGES (chat) ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id),
  user_name    TEXT NOT NULL DEFAULT 'Invité',
  text         TEXT,
  photo_url    TEXT,                    -- URL Supabase Storage
  reported     BOOLEAN DEFAULT FALSE,
  deleted      BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE REPORTS (signalements) ══════════════════════════════════
CREATE TABLE IF NOT EXISTS reports (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reported_by  UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, reported_by)
);

-- ══ TABLE NOW_PLAYING ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS now_playing (
  event_id     UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  title        TEXT DEFAULT 'En attente…',
  artist       TEXT DEFAULT '',
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE LOCATIONS (position des invités) ════════════════════════
CREATE TABLE IF NOT EXISTS locations (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id),
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  user_name    TEXT DEFAULT 'Invité',
  zone         TEXT DEFAULT '',
  is_active    BOOLEAN DEFAULT TRUE,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE SCORES (blind test) ════════════════════════════════════
CREATE TABLE IF NOT EXISTS blindtest_scores (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id),
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  user_name    TEXT DEFAULT 'Invité',
  score        INTEGER DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE PROFILES (profils utilisateurs) ════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url   TEXT,
  xp           INTEGER DEFAULT 0,
  events_count INTEGER DEFAULT 0,
  votes_count  INTEGER DEFAULT 0,
  proposals_count INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- TRIGGERS & FONCTIONS
-- ══════════════════════════════════════════════════════════════════

-- Auto-création du profil à l'inscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.phone, 'Invité'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update compteur de votes sur la table proposals
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

-- Update updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER now_playing_updated_at BEFORE UPDATE ON now_playing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE now_playing ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE blindtest_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Events : lecture publique, création via service_role uniquement
CREATE POLICY "events_read" ON events FOR SELECT USING (true);
CREATE POLICY "events_insert_service" ON events FOR INSERT WITH CHECK (false); -- Via API server
CREATE POLICY "events_update_service" ON events FOR UPDATE USING (false);      -- Via API server

-- Proposals : lecture publique, insert/delete authentifié
CREATE POLICY "proposals_read" ON proposals FOR SELECT USING (true);
CREATE POLICY "proposals_insert" ON proposals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "proposals_delete" ON proposals FOR DELETE TO authenticated USING (true);

-- Votes : lecture publique, insert/delete soi-même
CREATE POLICY "votes_read" ON votes FOR SELECT USING (true);
CREATE POLICY "votes_insert" ON votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "votes_delete" ON votes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Messages : lecture publique (non supprimés), insert authentifié
CREATE POLICY "messages_read" ON messages FOR SELECT USING (deleted = false);
CREATE POLICY "messages_insert" ON messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "messages_update" ON messages FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Reports : insert authentifié
CREATE POLICY "reports_insert" ON reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reported_by);
CREATE POLICY "reports_read" ON reports FOR SELECT USING (true);

-- Now playing : lecture publique
CREATE POLICY "np_read" ON now_playing FOR SELECT USING (true);

-- Locations : lecture publique, update soi-même
CREATE POLICY "loc_read" ON locations FOR SELECT USING (is_active = true);
CREATE POLICY "loc_upsert" ON locations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "loc_update" ON locations FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Profiles : lecture publique, update soi-même
CREATE POLICY "profiles_read" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Scores : lecture publique, upsert soi-même
CREATE POLICY "scores_read" ON blindtest_scores FOR SELECT USING (true);
CREATE POLICY "scores_upsert" ON blindtest_scores FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "scores_update" ON blindtest_scores FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════════
-- REALTIME (activer les publications)
-- ══════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE proposals;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE now_playing;
ALTER PUBLICATION supabase_realtime ADD TABLE locations;
ALTER PUBLICATION supabase_realtime ADD TABLE reports;
ALTER PUBLICATION supabase_realtime ADD TABLE blindtest_scores;

-- ══════════════════════════════════════════════════════════════════
-- STORAGE (photos du chat)
-- ══════════════════════════════════════════════════════════════════
-- À créer dans Supabase → Storage → New bucket → "chat-photos" (public)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('chat-photos', 'chat-photos', true);

-- Policy storage
-- CREATE POLICY "chat_photos_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-photos');
-- CREATE POLICY "chat_photos_read" ON storage.objects FOR SELECT USING (bucket_id = 'chat-photos');
