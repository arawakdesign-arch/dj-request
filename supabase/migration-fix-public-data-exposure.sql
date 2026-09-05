-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Corrige deux fuites de données via la clé anon Supabase,
-- exposée côté navigateur (nécessaire pour Realtime). Le backend Node
-- utilise le service_role (contourne RLS) pour tout le reste — ces
-- correctifs ne changent rien à son fonctionnement.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

-- 1. user_profiles : email/phone étaient lisibles par n'importe qui via
--    l'API REST Supabase directe (clé anon), alors qu'ils ne servent qu'à
--    l'onglet Contact de l'organisateur (lu côté serveur avec service_role).
--    On retire l'accès en lecture à ces deux colonnes pour anon/authenticated,
--    sans toucher aux colonnes publiques (display_name, photo_url, etc.)
--    ni à la policy RLS existante.
REVOKE SELECT ON user_profiles FROM anon, authenticated;
GRANT SELECT (id, display_name, bio, photo_url, friend_code, created_at, updated_at)
  ON user_profiles TO anon, authenticated;

-- 2. reports (signalements du chat) : lisibles publiquement via anon, alors
--    que seul l'organisateur doit y avoir accès (déjà appliqué côté serveur
--    via requireAuth + isOrganizer sur GET /api/reports/:eventId).
DROP POLICY IF EXISTS "reports_read" ON reports;
CREATE POLICY "reports_read" ON reports FOR SELECT USING (false);
