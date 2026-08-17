-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Page organisateur (profil public + logo + réseaux + stats)
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizer_pages (
  owner_id       TEXT PRIMARY KEY,
  name           TEXT,
  email          TEXT,
  slug           TEXT UNIQUE,
  logo_url       TEXT,
  website_url    TEXT,
  instagram_url  TEXT,
  tiktok_url     TEXT,
  facebook_url   TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE organizer_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizer_pages_read" ON organizer_pages;
CREATE POLICY "organizer_pages_read" ON organizer_pages FOR SELECT USING (true);
-- Écritures faites côté serveur avec la clé service_role (contourne RLS) —
-- ces policies bloquent simplement les écritures directes depuis le navigateur.
DROP POLICY IF EXISTS "organizer_pages_no_insert" ON organizer_pages;
CREATE POLICY "organizer_pages_no_insert" ON organizer_pages FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "organizer_pages_no_update" ON organizer_pages;
CREATE POLICY "organizer_pages_no_update" ON organizer_pages FOR UPDATE USING (false);

-- Bucket de stockage pour les logos
INSERT INTO storage.buckets (id, name, public) VALUES ('orga-logos', 'orga-logos', true) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "orga_logos_read" ON storage.objects;
CREATE POLICY "orga_logos_read" ON storage.objects FOR SELECT USING (bucket_id = 'orga-logos');
