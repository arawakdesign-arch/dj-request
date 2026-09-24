-- Exécuter dans Supabase SQL Editor.
-- screen_pairings.event_id référence events(id) sans ON DELETE CASCADE —
-- une soirée avec un écran TV déjà apparié ne pouvait donc jamais être
-- supprimée (violation de contrainte de clé étrangère), et empêchait
-- "Effacer les événements passés" de fonctionner pour cette soirée-là.
-- Les autres tables liées à events (messages, votes, propositions,
-- now_playing...) ont déjà ON DELETE CASCADE — on aligne screen_pairings
-- sur le même comportement.
BEGIN;

ALTER TABLE screen_pairings DROP CONSTRAINT IF EXISTS screen_pairings_event_id_fkey;
ALTER TABLE screen_pairings
  ADD CONSTRAINT screen_pairings_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

COMMIT;
