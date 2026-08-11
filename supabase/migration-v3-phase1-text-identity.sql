-- ══════════════════════════════════════════════════════════════════
-- DJ REQUEST / PULL UP! — Migration v3 — Phase 1 — Identité TEXT unifiée
-- À exécuter manuellement dans : Supabase → SQL Editor → New Query
-- Prérequis : schéma public vide (confirmé le 2026-06-30)
-- Conception : voir AI-Project-OS/07-Project/05-Architecture/04-Migration-SQL-Plan.md
-- ══════════════════════════════════════════════════════════════════

-- ══ EXTENSIONS ════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ══ TABLE EVENTS (soirées) ════════════════════════════════════════
-- Inchangé sur le fond — events.id reste UUID, aucune table d'identité
-- utilisateur n'est référencée ici. flyer_url repris de migration-v2.sql.
CREATE TABLE IF NOT EXISTS events (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT 'Soirée DJ Request',
  club_name    TEXT DEFAULT 'Club',
  address      TEXT DEFAULT '',
  hours        TEXT DEFAULT '22h → 6h',
  lineup       JSONB DEFAULT '[]',
  password     TEXT NOT NULL,           -- hash du mot de passe organisateur
  is_active    BOOLEAN DEFAULT TRUE,
  flyer_url    TEXT DEFAULT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE USER_PROFILES (remplace `profiles`) ═════════════════════
-- id en TEXT, sans FK vers auth.users : accepte guest_*, phone_*,
-- ou un UUID Google OAuth stocké comme texte.
-- Colonnes limitées à ce que le code lit/écrit réellement
-- (routes/profile.js, routes/auth.js, routes/messages.js, routes/live.js).
-- avatar_url / xp / events_count / votes_count / proposals_count de l'ancien
-- schéma `profiles` ne sont jamais lus ni écrits par le code actuel — non repris.
CREATE TABLE IF NOT EXISTS user_profiles (
  id           TEXT PRIMARY KEY,
  display_name TEXT,
  bio          TEXT DEFAULT '',
  photo_url    TEXT DEFAULT NULL,
  friend_code  TEXT DEFAULT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE PROPOSALS (propositions de morceaux) ════════════════════
-- proposed_by en TEXT, nullable (le code actuel l'envoie toujours à NULL —
-- routes/events.js. Sera peuplé une fois le code de vote corrigé, hors périmètre ici).
-- votes : défaut à 0, destiné à être synchronisé par le trigger update_proposal_votes
-- une fois que l'API écrira réellement dans la table votes (mission de code séparée).
CREATE TABLE IF NOT EXISTS proposals (
  id           TEXT NOT NULL,           -- id du morceau dans le catalogue
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  votes        INTEGER DEFAULT 0,
  approved     BOOLEAN DEFAULT FALSE,
  proposed_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, event_id)
);

-- ══ TABLE VOTES ════════════════════════════════════════════════════
-- user_id en TEXT, sans FK vers auth.users.
-- La PRIMARY KEY composite (event_id, proposal_id, user_id) est la
-- contrainte anti double-vote demandée : un même user_id ne peut avoir
-- qu'une seule ligne de vote par proposition.
-- FK vers proposals ajoutée (absente du schéma original) pour garantir
-- l'intégrité référentielle maintenant que la table est réellement utilisée.
CREATE TABLE IF NOT EXISTS votes (
  user_id      TEXT NOT NULL,
  proposal_id  TEXT NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, proposal_id, user_id),
  FOREIGN KEY (proposal_id, event_id) REFERENCES proposals(id, event_id) ON DELETE CASCADE
);

-- ══ TABLE MESSAGES (chat) ══════════════════════════════════════════
-- user_id en TEXT, sans FK vers auth.users. Nullable conservé tel quel
-- (comportement identique au schéma original).
CREATE TABLE IF NOT EXISTS messages (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT,
  user_name    TEXT NOT NULL DEFAULT 'Invité',
  text         TEXT,
  photo_url    TEXT,
  reported     BOOLEAN DEFAULT FALSE,
  deleted      BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE REPORTS (signalements) ══════════════════════════════════
-- reported_by en TEXT, sans FK vers auth.users.
CREATE TABLE IF NOT EXISTS reports (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reported_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, reported_by)
);

-- ══ TABLE NOW_PLAYING ══════════════════════════════════════════════
-- Inchangé — aucune colonne d'identité utilisateur.
CREATE TABLE IF NOT EXISTS now_playing (
  event_id     UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  title        TEXT DEFAULT 'En attente…',
  artist       TEXT DEFAULT '',
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE LOCATIONS (position des invités) ════════════════════════
-- user_id en TEXT (PK), sans FK vers auth.users.
-- Hors périmètre fonctionnel Phase 1 (géolocalisation exclue du MVP) —
-- table créée uniquement pour cohérence du schéma, routes/live.js la référence déjà.
CREATE TABLE IF NOT EXISTS locations (
  user_id      TEXT PRIMARY KEY,
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  user_name    TEXT DEFAULT 'Invité',
  zone         TEXT DEFAULT '',
  is_active    BOOLEAN DEFAULT TRUE,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE BLINDTEST_SCORES ════════════════════════════════════════
-- user_id en TEXT (PK), sans FK vers auth.users.
-- Hors périmètre fonctionnel Phase 1 (blind test exclu du MVP) —
-- table créée uniquement pour cohérence du schéma, routes/live.js la référence déjà.
CREATE TABLE IF NOT EXISTS blindtest_scores (
  user_id      TEXT PRIMARY KEY,
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  user_name    TEXT DEFAULT 'Invité',
  score        INTEGER DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ══ TABLE FRIENDSHIPS ══════════════════════════════════════════════
-- Déjà en TEXT dans migration-v2.sql — repris à l'identique, aucun changement.
-- Hors périmètre fonctionnel Phase 1 (système d'amis exclu du MVP) —
-- table créée uniquement pour cohérence du schéma, routes/friends.js la référence déjà.
CREATE TABLE IF NOT EXISTS friendships (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id     TEXT NOT NULL,
  friend_code TEXT NOT NULL,
  friend_name TEXT NOT NULL DEFAULT 'Ami',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_code)
);

-- ══════════════════════════════════════════════════════════════════
-- TRIGGERS & FONCTIONS
-- ══════════════════════════════════════════════════════════════════

-- Auto-création du profil à l'inscription Google OAuth uniquement
-- (guest_* et phone_* ne passent jamais par auth.users — leur profil est
-- créé/mis à jour par l'application via upsert, voir routes/auth.js et routes/profile.js).
-- NEW.id::text convertit l'UUID Supabase Auth en TEXT pour coller à user_profiles.id.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id::text, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.phone, 'Invité'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Synchronise proposals.votes depuis la table votes (inchangé dans sa logique —
-- redevient effectif une fois que l'API écrira réellement dans `votes`,
-- ce qui est une mission de code séparée, non traitée ici).
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

-- updated_at automatique
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER now_playing_updated_at BEFORE UPDATE ON now_playing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Décision Phase 1 : toutes les écritures passent par le backend
-- (clé service_role, qui contourne RLS). Aucune policy d'écriture
-- basée sur auth.uid() = user_id n'est ouverte côté client, puisque
-- user_id est désormais TEXT et que les invités/téléphone n'ont pas
-- de session Supabase Auth de toute façon.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE now_playing       ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE blindtest_scores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships       ENABLE ROW LEVEL SECURITY;

-- Events : lecture publique, écriture via service_role uniquement
CREATE POLICY "events_read"   ON events FOR SELECT USING (true);
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (false);
CREATE POLICY "events_update" ON events FOR UPDATE USING (false);

-- User_profiles : lecture publique (affichage display_name/photo), écriture fermée
CREATE POLICY "user_profiles_read"   ON user_profiles FOR SELECT USING (true);
CREATE POLICY "user_profiles_insert" ON user_profiles FOR INSERT WITH CHECK (false);
CREATE POLICY "user_profiles_update" ON user_profiles FOR UPDATE USING (false);

-- Proposals : lecture publique (visibilité immédiate), écriture fermée
CREATE POLICY "proposals_read"   ON proposals FOR SELECT USING (true);
CREATE POLICY "proposals_insert" ON proposals FOR INSERT WITH CHECK (false);
CREATE POLICY "proposals_update" ON proposals FOR UPDATE USING (false);
CREATE POLICY "proposals_delete" ON proposals FOR DELETE USING (false);

-- Votes : lecture publique, écriture fermée (passe uniquement par service_role)
CREATE POLICY "votes_read"   ON votes FOR SELECT USING (true);
CREATE POLICY "votes_insert" ON votes FOR INSERT WITH CHECK (false);
CREATE POLICY "votes_delete" ON votes FOR DELETE USING (false);

-- Messages : lecture publique (non supprimés), écriture fermée
CREATE POLICY "messages_read"   ON messages FOR SELECT USING (deleted = false);
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (false);
CREATE POLICY "messages_update" ON messages FOR UPDATE USING (false);

-- Reports : lecture publique conservée telle quelle (comportement hérité,
-- non modifié ici — hors périmètre identité, signalé comme risque ouvert),
-- écriture fermée côté client.
CREATE POLICY "reports_read"   ON reports FOR SELECT USING (true);
CREATE POLICY "reports_insert" ON reports FOR INSERT WITH CHECK (false);

-- Now playing : lecture publique, écriture fermée
CREATE POLICY "np_read" ON now_playing FOR SELECT USING (true);

-- Locations : lecture publique (actives), écriture fermée
CREATE POLICY "loc_read"   ON locations FOR SELECT USING (is_active = true);
CREATE POLICY "loc_insert" ON locations FOR INSERT WITH CHECK (false);
CREATE POLICY "loc_update" ON locations FOR UPDATE USING (false);

-- Blindtest scores : lecture publique, écriture fermée
CREATE POLICY "scores_read"   ON blindtest_scores FOR SELECT USING (true);
CREATE POLICY "scores_insert" ON blindtest_scores FOR INSERT WITH CHECK (false);
CREATE POLICY "scores_update" ON blindtest_scores FOR UPDATE USING (false);

-- Friendships : aucune policy publique — RLS activé sans aucune policy
-- = accès refusé pour anon/authenticated, seul service_role (bypass RLS) écrit/lit.
-- (identique à migration-v2.sql original)

-- ══════════════════════════════════════════════════════════════════
-- REALTIME (mêmes tables que le schéma original)
-- ══════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE proposals;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE now_playing;
ALTER PUBLICATION supabase_realtime ADD TABLE locations;
ALTER PUBLICATION supabase_realtime ADD TABLE reports;
ALTER PUBLICATION supabase_realtime ADD TABLE blindtest_scores;

-- ══════════════════════════════════════════════════════════════════
-- STORAGE — AJOUT AU-DELÀ DE LA DEMANDE STRICTE, NÉCESSAIRE AU FONCTIONNEMENT
-- Le schéma original ne créait que "chat-photos" (en commentaire, jamais exécuté).
-- Le code utilise en réalité 3 buckets : chat-photos (routes/messages.js),
-- profile-photos (routes/profile.js), flyers (routes/events.js).
-- Section optionnelle : à exécuter seulement si validée, sinon créer les buckets
-- manuellement via Supabase → Storage → New Bucket (public).
-- ══════════════════════════════════════════════════════════════════
-- INSERT INTO storage.buckets (id, name, public) VALUES ('chat-photos', 'chat-photos', true) ON CONFLICT (id) DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('profile-photos', 'profile-photos', true) ON CONFLICT (id) DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('flyers', 'flyers', true) ON CONFLICT (id) DO NOTHING;
