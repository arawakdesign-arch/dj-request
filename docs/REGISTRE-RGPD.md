# Registre des traitements — Pull Up (simplifié)

Responsable du traitement : HUSTLE & FLOW, SASU (SIREN 941 167 835). Dernière mise à jour : 24 septembre 2026, à la suite d'un audit du code du dépôt `dj-request`. Ce registre reflète ce que le code fait réellement au moment de l'audit — à mettre à jour à chaque évolution touchant des données personnelles.

---

## 1. Gestion des comptes utilisateurs

- **Finalité :** authentifier les utilisateurs, leur permettre d'utiliser le Service.
- **Personnes concernées :** toute personne créant un compte (Google ou téléphone).
- **Données :** email ou téléphone, nom de compte, id technique Supabase Auth.
- **Base légale :** exécution du contrat.
- **Destinataires :** aucun (traitement interne, serveur uniquement).
- **Sous-traitant :** Supabase (hébergement + authentification), Google (fournisseur OAuth si connexion Google choisie).
- **Durée :** jusqu'à suppression du compte ou 24 mois d'inactivité (purge automatique, `lib/retention.js`).
- **Sécurité :** RLS Postgres fermée sur `user_profiles` (`migration-lock-user-profiles-rls.sql`), accès uniquement via le backend (clé service_role).

## 2. Participation à un événement (votes, propositions, chat)

- **Finalité :** permettre de voter, proposer des morceaux, discuter pendant une soirée.
- **Personnes concernées :** participants aux événements.
- **Données :** votes, propositions musicales, messages de chat, photos de chat, nom/photo affichés.
- **Base légale :** exécution du contrat.
- **Destinataires :** les autres participants du même événement (contenu public de l'événement) ; l'organisateur (modération).
- **Sous-traitant :** Supabase (stockage), Deezer/Apple-iTunes (recherche de morceaux, requête serveur uniquement, terme recherché seul transmis).
- **Durée :** tant que le compte reste actif ; en cas de suppression de compte, contenu anonymisé (voir traitement n°8) plutôt que supprimé, pour préserver l'historique des autres participants.
- **Sécurité :** RLS fermée sur `votes` (`migration-fix-votes-locations-scores-rls.sql`) ; colonnes `user_id`/`proposed_by` retirées des privilèges publics sur `messages`/`proposals` (`migration-restrict-messages-proposals-columns.sql`).

## 3. Partage des coordonnées avec un organisateur

- **Finalité :** permettre à un organisateur de recontacter un participant qui y consent.
- **Personnes concernées :** participants ayant explicitement accepté.
- **Données :** email, téléphone, preuve du consentement (date, version du texte).
- **Base légale :** consentement (art. 6.1.a RGPD).
- **Destinataires :** l'organisateur de l'événement concerné, uniquement si consentement actif.
- **Sous-traitant :** Supabase.
- **Durée :** jusqu'à retrait du consentement ou suppression du compte.
- **Sécurité :** email/téléphone jamais lisibles via la clé anon (`migration-fix-public-data-exposure.sql`) ; gating applicatif dans `routes/orga.js` (`collectClients()`).

## 4. Profil DJ public (press kit)

- **Finalité :** permettre à un DJ de présenter son travail publiquement et d'être contacté pour des bookings.
- **Personnes concernées :** utilisateurs créant un profil DJ.
- **Données :** nom de scène, bio, genres, types de prestation, réseaux, liens de mixes, photo/avatar, galerie (6 photos max), soirées à venir, et — si le DJ les renseigne — email et téléphone de booking rendus **volontairement publics**.
- **Base légale :** consentement (création et publication volontaires).
- **Destinataires :** tout visiteur du lien public (`/dj/profile/:id`, `/dj/by-slug/:slug`).
- **Sous-traitant :** Supabase (stockage photos) ; SoundCloud/Mixcloud/Spotify/YouTube si le visiteur choisit d'afficher un lecteur intégré (consentement au clic, cf. `public/js/dj-profile-editor.js`).
- **Durée :** jusqu'à suppression du profil ou du compte (photos de galerie incluses, `lib/account.js`).
- **Sécurité :** RLS volontairement ouverte en lecture (`dj_profiles_read USING (true)`) — c'est la fonctionnalité elle-même ; aucune colonne sensible non consentie n'existe sur cette table.

## 5. Page publique organisateur

- **Finalité :** permettre à un organisateur de présenter son club/collectif et ses soirées.
- **Personnes concernées :** utilisateurs créant une page organisateur.
- **Données :** nom, bio, email de contact, logo, bannière, réseaux sociaux, nombre d'abonnés.
- **Base légale :** consentement (création et publication volontaires).
- **Destinataires :** tout visiteur du lien public (`/orga/by-slug/:slug`).
- **Sous-traitant :** Supabase.
- **Durée :** jusqu'à suppression de la page ou du compte.
- **Sécurité :** RLS volontairement ouverte en lecture ; écritures bloquées côté client (`organizer_pages_no_update`).

## 6. Sécurité et lutte anti-abus

- **Finalité :** limiter le spam, les tentatives de connexion répétées.
- **Personnes concernées :** tout visiteur de l'API.
- **Données :** adresse IP.
- **Base légale :** intérêt légitime.
- **Destinataires :** aucun.
- **Sous-traitant :** aucun — traitement en mémoire uniquement, jamais persisté en base (`express-rate-limit`, `middleware/auth.js`).
- **Durée :** quelques minutes (fenêtres glissantes 10 min / 15 min / 1 min selon le point d'entrée), puis oubliée.

## 7. Purge des comptes inactifs (24 mois)

- **Finalité :** respecter la durée de conservation annoncée, minimiser les données conservées.
- **Personnes concernées :** comptes sans connexion depuis 24 mois.
- **Données :** UUID technique uniquement (jamais email/téléphone dans les logs, `scripts/purge-inactive-accounts.js`).
- **Base légale :** obligation issue du principe de minimisation (RGPD art. 5.1.e).
- **Destinataires :** aucun.
- **Sous-traitant :** Supabase.
- **Durée :** exécution quotidienne (cron + minuteur interne, verrouillage anti-concurrence via `retention_runs`).
- **Sécurité :** journal des exécutions (`retention_runs`, RLS fermée), verrou empêchant deux purges simultanées.

## 8. Suppression / anonymisation de compte

- **Finalité :** exercice du droit à l'effacement.
- **Personnes concernées :** toute personne demandant la suppression de son compte.
- **Données supprimées :** profil, photos (avatar, galerie DJ, logo/bannière organisateur), votes, positions, scores, amis, abonnements, compte Supabase Auth.
- **Données anonymisées (conservées sans identité) :** messages de chat, propositions musicales, événements créés — pour ne pas casser l'historique partagé d'autres participants.
- **Base légale :** obligation légale (droit à l'effacement) pour les données supprimées ; intérêt légitime des autres participants (intégrité de l'historique partagé) pour les données anonymisées.
- **Destinataires :** aucun après suppression.
- **Durée :** traitement immédiat (bouton in-app) ou sous 30 jours (demande par e-mail).

## 9. Export des données personnelles

- **Finalité :** exercice du droit à la portabilité.
- **Personnes concernées :** toute personne demandant l'export de ses données.
- **Données exportées :** profil, profil DJ, page organisateur, votes, propositions, messages, amis ajoutés, organisateurs suivis, signalements effectués — jamais les données d'un tiers ni de secret serveur (`GET /api/profile/export`).
- **Base légale :** obligation légale (droit à la portabilité).
- **Destinataires :** la personne elle-même uniquement (fichier téléchargé localement).
- **Durée :** génération à la demande, aucune conservation du fichier généré côté serveur.
