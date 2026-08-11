-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Fix : les invités ne peuvent pas envoyer de messages / signaler
-- À exécuter dans : Supabase → SQL Editor → New Query
-- Même cause que la migration-fix-guest-proposals.sql : messages.user_id et
-- reports.reported_by sont en UUID+FK vers auth.users, incompatibles avec
-- les id invités ("guest_xxxx"). Chaque envoi de message échoue en 500,
-- avalé silencieusement côté client.
-- ══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_update" ON messages;
DROP POLICY IF EXISTS "reports_insert" ON reports;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_user_id_fkey;
ALTER TABLE messages ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_by_fkey;
ALTER TABLE reports ALTER COLUMN reported_by TYPE TEXT USING reported_by::text;

-- Le serveur écrit avec la clé service_role (contourne RLS) : on referme
-- l'écriture directe côté client plutôt que de rouvrir une comparaison
-- auth.uid() qui ne concernait que les utilisateurs Supabase Auth.
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (false);
CREATE POLICY "messages_update" ON messages FOR UPDATE USING (false);
CREATE POLICY "reports_insert" ON reports FOR INSERT WITH CHECK (false);
