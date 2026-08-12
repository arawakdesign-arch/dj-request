-- ══════════════════════════════════════════════════════════════════
-- PULL UP! — Une seule réaction par utilisateur et par message
-- À exécuter dans : Supabase → SQL Editor → New Query
-- Remplace increment_reaction (compteur global sans suivi par utilisateur)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
-- Aucune policy : cette table n'est manipulée que par le backend (service role),
-- jamais lue directement par le client (il lit l'agrégat messages.reactions).

-- Maintient l'agrégat messages.reactions à jour à chaque changement de
-- message_reactions (insert, changement d'emoji, suppression/toggle off).
CREATE OR REPLACE FUNCTION sync_message_reactions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE messages SET reactions = jsonb_set(
      reactions, ARRAY[NEW.emoji], to_jsonb(COALESCE((reactions->>NEW.emoji)::int, 0) + 1)
    ) WHERE id = NEW.message_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.emoji IS DISTINCT FROM NEW.emoji THEN
      UPDATE messages SET reactions = jsonb_set(
        reactions, ARRAY[OLD.emoji], to_jsonb(GREATEST(0, COALESCE((reactions->>OLD.emoji)::int, 0) - 1))
      ) WHERE id = OLD.message_id;
      UPDATE messages SET reactions = jsonb_set(
        reactions, ARRAY[NEW.emoji], to_jsonb(COALESCE((reactions->>NEW.emoji)::int, 0) + 1)
      ) WHERE id = NEW.message_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE messages SET reactions = jsonb_set(
      reactions, ARRAY[OLD.emoji], to_jsonb(GREATEST(0, COALESCE((reactions->>OLD.emoji)::int, 0) - 1))
    ) WHERE id = OLD.message_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_message_reaction_change ON message_reactions;
CREATE TRIGGER on_message_reaction_change
  AFTER INSERT OR UPDATE OR DELETE ON message_reactions
  FOR EACH ROW EXECUTE FUNCTION sync_message_reactions();
