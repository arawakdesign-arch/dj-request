# Profils DJ étendus

## Mise en ligne

1. Dans Supabase → SQL Editor, exécuter `supabase/migration-expand-dj-profiles.sql`. La migration ajoute les colonnes et conserve les profils existants. Le bucket public `profile-photos` doit déjà exister (utilisé par la photo de profil actuelle).
2. Puis mettre à jour le serveur : `cd /var/www/pullup && git pull && pm2 restart pullup`.
3. Recharger la page et ouvrir Mon profil DJ. Vérifier avec un compte de test : compléter tous les champs requis, envoyer un portrait, choisir une couverture, enregistrer puis rouvrir le formulaire.

Les anciens profils restent lisibles. À leur prochaine modification, leurs propriétaires doivent compléter les nouveaux champs obligatoires. L’enregistrement d’un profil complet vérifie le portrait déjà enregistré côté serveur ; une URL envoyée par le client ne remplace pas ce contrôle.

Les ajouts/suppressions de photos sont immédiats. Les autres champs sont enregistrés avec le bouton du formulaire. La galerie est limitée à six images, les styles à six choix. Les suggestions de villes sont une liste intégrée ; la saisie libre permet toutes les autres localités. La biographie accepte 5 000 caractères.

## Vérifications

- `node --test tests/dj-profile.test.js` : validations partagées client/serveur, liens autorisés, limites, contrôle de propriété des images.
- Tests Chrome avec API simulée : mobile et bureau, recherche des styles, limite de six, 20 couvertures, erreurs de photo, envoi/suppression de galerie, enregistrement et réouverture.
- Tests navigateur sans écriture de données en production. La migration et le parcours réel Supabase restent à vérifier après exécution du SQL.

## Couvertures

20 fichiers dans `public/images/dj-avatars/`, générés avec l’outil imagegen intégré. Les prompts exacts sont dans `public/images/dj-avatars/PROMPTS.md`.
