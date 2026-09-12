-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Retire user_id/proposed_by de ce que la clé anon peut lire
-- sur messages et proposals
-- Ces deux tables doivent rester lisibles publiquement (Realtime : le
-- classement des votes et le chat s'affichent sans connexion), mais
-- restreindre les colonnes au niveau de l'API Node (routes/messages.js,
-- routes/events.js) ne suffisait pas : n'importe qui peut interroger
-- l'API REST Supabase directement avec la clé anon (publique, embarquée
-- dans l'app) et lire TOUTES les colonnes, y compris messages.user_id et
-- proposals.proposed_by — les vrais identifiants internes des personnes.
-- Comme pour user_profiles (migration-fix-public-data-exposure.sql), on
-- retire ces deux colonnes des privilèges accordés à anon/authenticated ;
-- RLS continue de filtrer les lignes normalement (deleted=false), et le
-- backend (clé service_role) n'est jamais concerné par ces privilèges.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

REVOKE SELECT ON messages FROM anon, authenticated;
GRANT SELECT (id, event_id, user_name, user_photo, text, photo_url, reported, reactions, pinned, created_at)
  ON messages TO anon, authenticated;

REVOKE SELECT ON proposals FROM anon, authenticated;
GRANT SELECT (id, event_id, votes, approved, created_at, title, artist, cover_url)
  ON proposals TO anon, authenticated;
