-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Fix : les invités (guest_xxxx) ne peuvent pas proposer/voter
-- À exécuter dans : Supabase → SQL Editor → New Query
-- Sûr à lancer sur une base existante (ALTER, pas de perte de données).
-- ══════════════════════════════════════════════════════════════════
--
-- Cause : proposals.proposed_by et votes.user_id sont typés
-- `UUID REFERENCES auth.users(id)`. Les invités utilisent un id maison
-- du type "guest_a1b2c3d4..." (routes/auth.js), qui n'est pas un UUID
-- valide et n'existe pas dans auth.users. Résultat : chaque INSERT
-- échoue en base (500), mais l'app l'ignore silencieusement et affiche
-- quand même la proposition/le vote en local — jusqu'au prochain
-- rafraîchissement, où elle disparaît puisqu'elle n'a jamais été
-- enregistrée côté serveur.

-- Les policies RLS sur votes.user_id doivent être supprimées AVANT
-- l'ALTER COLUMN (Postgres refuse de changer le type d'une colonne
-- utilisée dans une définition de policy).
DROP POLICY IF EXISTS "votes_insert" ON votes;
DROP POLICY IF EXISTS "votes_delete" ON votes;

-- ── proposals.proposed_by : UUID+FK → TEXT ─────────────────────────
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_proposed_by_fkey;
ALTER TABLE proposals ALTER COLUMN proposed_by TYPE TEXT USING proposed_by::text;

-- ── votes.user_id : UUID+FK → TEXT ─────────────────────────────────
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_user_id_fkey;
ALTER TABLE votes ALTER COLUMN user_id TYPE TEXT USING user_id::text;

-- Recrée les policies fermées : le serveur écrit avec la clé service_role
-- (contourne RLS de toute façon), donc pas besoin de rouvrir l'écriture
-- directe côté client — la comparaison auth.uid() = user_id ne servait
-- qu'aux utilisateurs Supabase Auth, jamais utilisée par les invités.
CREATE POLICY "votes_insert" ON votes FOR INSERT WITH CHECK (false);
CREATE POLICY "votes_delete" ON votes FOR DELETE USING (false);
