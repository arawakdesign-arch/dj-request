-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Ajoute la bio (À propos) à la page organisateur
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE organizer_pages ADD COLUMN IF NOT EXISTS bio TEXT;
