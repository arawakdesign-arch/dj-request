-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Réactions + message épinglé dans le chat
-- À exécuter dans : Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- Incrémente atomiquement le compteur d'une réaction (évite les races entre
-- deux invités qui réagissent au même message en même temps).
CREATE OR REPLACE FUNCTION increment_reaction(msg_id UUID, emoji TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  updated JSONB;
BEGIN
  UPDATE messages
  SET reactions = jsonb_set(
    reactions, ARRAY[emoji],
    to_jsonb(COALESCE((reactions->>emoji)::int, 0) + 1)
  )
  WHERE id = msg_id
  RETURNING reactions INTO updated;
  RETURN updated;
END;
$$;
