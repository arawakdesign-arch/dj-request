-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Ajoute la pochette au morceau en cours de lecture
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE now_playing ADD COLUMN IF NOT EXISTS cover_url TEXT;
