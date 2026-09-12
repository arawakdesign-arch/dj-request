-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Traçabilité du consentement de partage des coordonnées
-- share_contact_ok (booléen seul) ne suffit pas à prouver un consentement
-- RGPD valide — on ajoute la date d'acceptation, la version du texte
-- accepté, et la date d'un éventuel retrait.
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS share_contact_ok_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS share_contact_ok_version TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS share_contact_withdrawn_at TIMESTAMPTZ;
