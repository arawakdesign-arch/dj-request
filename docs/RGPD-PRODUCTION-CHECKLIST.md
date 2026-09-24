# Checklist production — RGPD Pull Up

À vérifier manuellement à chaque déploiement majeur touchant ces domaines, et au minimum une fois maintenant. Cette checklist ne certifie rien juridiquement — elle liste ce qui doit être vérifié pour que le code et les textes juridiques restent vrais.

## Code (déployé automatiquement au prochain `git pull` + redémarrage pm2)

- [x] Suppression de compte : galerie DJ effacée du stockage (`lib/account.js`)
- [x] Purge 24 mois : bug de pagination corrigé, verrou anti-concurrence ajouté (`lib/retention.js`)
- [x] Export de mes données : `GET /api/profile/export` créé
- [x] Consentement partage coordonnées : vérifié conforme (aucune case pré-cochée, vote/proposition non bloqués)
- [x] Lecteurs SoundCloud/Mixcloud/Spotify/YouTube : consentement au clic avant chargement de l'iframe
- [x] Polices Google Fonts auto-hébergées (`public/fonts/`, `public/css/fonts.css`)
- [x] Logs serveur : aucun mot de passe/token/téléphone/email journalisé (vérifié par lecture, pas de correctif nécessaire)
- [x] Uploads : taille limitée, ré-encodage via `sharp` (rejette les fichiers non-image), noms de fichiers générés côté serveur
- [x] Mot de passe événement : haché (bcrypt), jamais sélectionné dans les requêtes publiques

## Supabase — **À VÉRIFIER MANUELLEMENT, non exécutable depuis ce dépôt**

- [ ] Exécuter `supabase/migration-add-retention-runs.sql` (déjà fait au 24/09/2026 d'après la conversation — reconfirmer si un nouveau projet Supabase est utilisé)
- [ ] Lancer `supabase/verify-rls.sql` dans le SQL Editor et confirmer que chaque `lignes_visibles` = 0 et chaque bloc affiche `OK :`
- [ ] Confirmer qu'aucune migration future ne rouvre `events`, `user_profiles`, `votes`, `locations`, `blindtest_scores`, `reports` en lecture publique (`USING (true)`)
- [ ] Vérifier le fournisseur SMS configuré pour l'authentification téléphone (Réglages Supabase → Auth → Phone) et son propre DPA
- [ ] Vérifier la région d'hébergement du projet Supabase (Réglages → Général) — la politique affirme eu-west-1 (Irlande)
- [ ] Vérifier qu'aucune clé `service_role` n'est présente dans les réglages "Anon key" exposés au frontend (`SUPABASE_ANON_KEY` doit être distincte de `SUPABASE_SERVICE_KEY`)

## IONOS / Serveur

- [ ] `pm2 env 0` doit afficher `NODE_ENV: 'production'` (sinon `pm2 delete pullup && pm2 start ecosystem.config.js --env production && pm2 save`)
- [ ] Cron `scripts/purge-inactive-accounts.js` installé (`crontab -l | grep retention`)
- [ ] HTTPS actif sur pull-up.live (certificat valide, pas de contenu mixte)
- [ ] Sauvegardes serveur/Supabase : vérifier leur existence et leur propre durée de rétention (non documentée dans ce dépôt)
- [ ] `.env` de production présent, non versionné, permissions restreintes (`chmod 600`)

## Contrats fournisseurs — **À VÉRIFIER MANUELLEMENT, hors de portée du code**

- [ ] DPA (Data Processing Agreement) Supabase signé/accepté
- [ ] DPA IONOS (hébergeur du serveur applicatif) vérifié
- [ ] Conditions Google (Supabase Auth OAuth) — mécanisme de transfert international à jour

## Tests

- [ ] `npm test` passe (38 tests au 24/09/2026, mocks uniquement, aucune base réelle)
- [ ] `npm run retention:dry-run` exécuté au moins une fois en production pour confirmer le nombre de comptes concernés avant la première purge réelle automatique
- [ ] Suppression de compte testée manuellement sur un compte de test réel (pas un mock) dans un environnement non-production si possible

## Juridique — **À VÉRIFIER MANUELLEMENT, hors de portée du code**

- [ ] Politique de confidentialité et CGU publiées et accessibles (déjà en ligne : `/confidentialite.html`, `/cgu.html`)
- [ ] Relecture par un professionnel du droit recommandée avant toute décision fondée sur ce document (cet audit n'est pas une certification juridique)
- [ ] Registre des traitements (`docs/REGISTRE-RGPD.md`) tenu à jour à chaque nouvelle fonctionnalité traitant des données personnelles
