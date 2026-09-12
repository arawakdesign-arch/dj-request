-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Ferme la lecture publique de events (FUITE CRITIQUE)
-- events.password (le hash bcrypt du mot de passe organisateur de
-- CHAQUE soirée) était lisible en clair par n'importe qui via l'API
-- REST Supabase directe (clé anon), tout comme events.owner_id
-- (identifiant interne de l'organisateur). Contrairement au flux normal
-- de connexion (limité en tentatives par IP, cf. middleware/auth.js),
-- rien n'empêchait de récupérer ce hash et de le craquer hors-ligne,
-- sans aucune limite.
-- Le client (JS navigateur) ne lit jamais la table events directement
-- avec la clé anon — tout passe par notre backend (clé service_role,
-- qui contourne RLS). Fermer complètement la lecture ici ne casse donc
-- rien.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "events_read" ON events;
CREATE POLICY "events_read" ON events FOR SELECT USING (false);
