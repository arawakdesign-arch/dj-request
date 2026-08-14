-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Appairage d'écran par QR code ("Écran Géant" sans login).
-- La TV crée un code éphémère (POST /api/screen/pairings), l'affiche en
-- QR ; le téléphone de l'organisateur (déjà connecté) le scanne et associe
-- l'event_id (POST /api/screen/pairings/:code/claim). La TV, abonnée en
-- Realtime sur ce code, bascule alors sur l'affichage de la soirée.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS screen_pairings (
  code       TEXT PRIMARY KEY,
  event_id   UUID REFERENCES events(id) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE screen_pairings ENABLE ROW LEVEL SECURITY;

-- Lecture publique : la TV (client anonyme) doit pouvoir s'abonner en
-- Realtime à son propre code. Les écritures passent uniquement par le
-- backend (clé service_role, contourne RLS) — pas de policy INSERT/UPDATE.
CREATE POLICY "screen_pairings_read" ON screen_pairings FOR SELECT USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE screen_pairings;
