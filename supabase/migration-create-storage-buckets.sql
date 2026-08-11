-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Crée les buckets de stockage manquants
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════
-- Ces 3 buckets sont utilisés par le code (routes/profile.js, routes/messages.js,
-- routes/events.js) mais n'ont jamais été créés — chaque upload échoue en 500,
-- avalé silencieusement côté client.

INSERT INTO storage.buckets (id, name, public) VALUES ('profile-photos', 'profile-photos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-photos', 'chat-photos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('flyers', 'flyers', true) ON CONFLICT (id) DO NOTHING;

-- Policies : lecture publique, écriture par le serveur (clé service_role,
-- qui contourne RLS de toute façon — mais storage.objects a RLS activé par défaut
-- sur les nouveaux projets Supabase, donc on ouvre explicitement la lecture).
DROP POLICY IF EXISTS "profile_photos_read" ON storage.objects;
CREATE POLICY "profile_photos_read" ON storage.objects FOR SELECT USING (bucket_id = 'profile-photos');
DROP POLICY IF EXISTS "chat_photos_read" ON storage.objects;
CREATE POLICY "chat_photos_read" ON storage.objects FOR SELECT USING (bucket_id = 'chat-photos');
DROP POLICY IF EXISTS "flyers_read" ON storage.objects;
CREATE POLICY "flyers_read" ON storage.objects FOR SELECT USING (bucket_id = 'flyers');
