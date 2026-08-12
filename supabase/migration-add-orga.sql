-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Ajoute le champ "Orga" (organisateur/organisation de
-- l'événement) sur les soirées, éditable depuis Réglages → Soirée en
-- cours, à côté du nom de l'événement / du club.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS orga TEXT DEFAULT '';
