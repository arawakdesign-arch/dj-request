-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Consentement explicite avant de partager email/téléphone
-- avec les organisateurs (export CSV "Clients")
-- Avant ce correctif, voter ou proposer un morceau à une soirée suffisait
-- à rendre l'email/téléphone de la personne exportables par l'organisateur,
-- sans qu'elle ait jamais accepté d'être contactée.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS share_contact_ok BOOLEAN DEFAULT FALSE;
