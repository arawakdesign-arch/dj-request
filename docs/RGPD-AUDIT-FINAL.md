# AUDIT RGPD PULL UP — 24 septembre 2026

Audit du code du dépôt `dj-request` (aucun accès à la base Supabase de production, aucune migration exécutée). Sur chaque point non vérifiable depuis le code seul, la mention **À VÉRIFIER MANUELLEMENT** est utilisée volontairement plutôt que d'affirmer une conformité non constatée.

---

## 🔴 Critique

### 1. Galerie DJ non supprimée à la suppression de compte
- **Fichier :** `lib/account.js`
- **Ligne / fonction :** `deleteUserAccount()`, lecture `dj_profiles`
- **Problème :** seule `photo_url` était lue avant suppression du stockage ; les jusqu'à 6 photos de `dj_profiles.gallery` restaient orphelines dans le bucket `profile-photos`.
- **Risque :** photos personnelles conservées indéfiniment après suppression du compte, contrairement à la promesse de la politique de confidentialité.
- **Correction appliquée :** lecture de `gallery` ajoutée, chaque URL ajoutée à la liste des fichiers supprimés du stockage.
- **Test :** `tests/rgpd/account-deletion.test.js` — `deleteUserAccount removes DJ gallery photos from storage, not just the avatar` (PASS).

### 2. Purge 24 mois : comptes sautés par la pagination
- **Fichier :** `lib/retention.js`
- **Ligne / fonction :** `purgeInactiveAccounts()`, boucle `listUsers({page, perPage})`
- **Problème :** la pagination par offset avançait systématiquement à la page suivante, y compris quand des comptes venaient d'être supprimés sur la page courante — cela décale tous les comptes suivants d'un cran et en fait sauter certains, jamais traités.
- **Risque :** des comptes inactifs depuis plus de 24 mois n'étaient jamais purgés, rendant la promesse de la politique de confidentialité fausse dans les faits.
- **Correction appliquée :** on ne passe à la page suivante que si aucune suppression n'a eu lieu sur la page courante ; sinon on la relit (bornée à 5 relectures pour éviter une boucle infinie en cas d'échec persistant).
- **Test :** `tests/rgpd/retention.test.js` — `does not skip accounts when deletions shift pagination offsets` (210 comptes sur 2 pages, PASS).

### 3. Lecteurs SoundCloud/Mixcloud/Spotify/YouTube chargés sans consentement
- **Fichier :** `public/js/dj-profile-editor.js`
- **Ligne / fonction :** `renderDjProfileDetails()` → `playersSection()`
- **Problème :** un `<iframe>` pointant directement vers SoundCloud/Mixcloud/Spotify/YouTube-nocookie était créé et inséré automatiquement à l'affichage de **tout** profil DJ public — y compris pour un visiteur anonyme n'ayant jamais consenti à une connexion avec ces services tiers.
- **Risque :** transmission de l'adresse IP (et potentiellement de traceurs) à des tiers avant tout consentement — non conforme aux recommandations CNIL sur les contenus intégrés tiers.
- **Correction appliquée :** un placeholder (« Ce contenu est fourni par X. En l'affichant, vous acceptez qu'une connexion soit établie avec X. » + bouton « Afficher le lecteur ») s'affiche à la place ; l'iframe n'est créée qu'après un clic explicite. Le choix est mémorisé par plateforme pour la session (`sessionStorage`), réinitialisable depuis Paramètres → Confidentialité (`resetEmbedConsent()`).
- **Test :** `tests/dj-profile.browser.cjs` (Playwright réel, mis à jour) — vérifie l'absence d'iframe avant clic, la présence après clic, la persistance pour la session, et la réinitialisation (PASS).

---

## 🟠 Important

### 4. Politique de confidentialité en contradiction avec le comportement réel
- **Fichier :** `public/confidentialite.html`
- **Problème :** promettait la suppression de « l'ensemble des données associées (…messages) », listait un mode « Connexion invité » qui n'existe plus dans le code actuel (`routes/auth.js` ne génère plus d'identifiant `guest_*`), omettait entièrement les données de profil DJ et de page organisateur, et attribuait la recherche de morceaux à un fournisseur non vérifié dans le code pour SoundCloud/API Adresse.
- **Risque :** information trompeuse pour les utilisateurs, non-conformité à l'obligation de transparence (RGPD art. 13).
- **Correction appliquée :** réécriture complète (voir `docs/REGISTRE-RGPD.md` pour le détail par traitement) : anonymisation expliquée précisément, mode invité retiré, données DJ/organisateur ajoutées, tous les tiers réels listés avec leur rôle exact, IP jamais stockées en base, `sessionStorage` mentionné, base légale détaillée par traitement.

### 5. Aucun droit à la portabilité (export des données)
- **Fichier :** `routes/profile.js`
- **Problème :** aucune route ne permettait à un utilisateur de récupérer ses propres données.
- **Risque :** droit RGPD non exerçable en libre-service.
- **Correction appliquée :** `GET /api/profile/export` — renvoie profil, profil DJ, page organisateur, votes, propositions, messages, amis, abonnements, signalements ; jamais de données d'un tiers ni de secret serveur. Bouton « Télécharger mes données » ajouté dans le profil (`public/index.html`, `downloadMyData()` dans `public/js/auth.js`).
- **Test :** `tests/rgpd/export.test.js` (PASS).

### 6. Google Fonts : IP transmise à chaque ouverture de page
- **Fichiers :** `public/index.html`, `public/landing.html`, `public/cgu.html`, `public/confidentialite.html`, `public/mentions-legales.html`
- **Problème :** les polices Anton/Inter/Outfit étaient chargées depuis `fonts.googleapis.com`/`fonts.gstatic.com`, transmettant l'adresse IP de chaque visiteur à Google avant tout consentement, dès l'ouverture de n'importe quelle page.
- **Risque :** transfert de données non nécessaire à un tiers, incohérent avec l'objectif de minimisation.
- **Correction appliquée :** polices téléchargées (licence SIL Open Font License) et servies localement depuis `public/fonts/` via `public/css/fonts.css` ; plus aucun appel à Google Fonts. Vérifié visuellement (Playwright, rendu identique) sur les 5 pages.

### 7. Fiabilité de la purge automatique dépendante d'une configuration pm2 non garantie
- **Fichier :** `lib/retention.js`, `ecosystem.config.js`
- **Problème (déjà traité lors d'un audit précédent dans cette même conversation) :** le minuteur de purge ne s'active que si `NODE_ENV=production`, or `pm2 restart pullup` (commande utilisée à chaque déploiement) ne garantit pas que cette variable soit active.
- **Correction appliquée :** table `retention_runs` (verrou + journal), script autonome `scripts/purge-inactive-accounts.js` utilisable via un vrai cron système indépendant de pm2. **Confirmé en production le 24/09/2026** : `NODE_ENV=production` vérifié via `pm2 env 0`, cron installé (`crontab -l | grep -c retention` → 1).

---

## 🟡 Recommandé

### 8. Historique des amis : nom mis en cache non nettoyé
- **Fichier :** `routes/friends.js`, table `friendships`
- **Problème :** `friendships.friend_name` est un instantané du nom saisi au moment de l'ajout, sans lien vérifié vers un compte réel (`friend_code` n'est même pas validé à l'insertion). À la suppression d'un compte, le nom que d'autres personnes ont enregistré dans leur propre liste d'amis n'est pas nettoyé.
- **Analyse :** assimilable à un carnet de contacts personnel plutôt qu'à une donnée que Pull Up « détient » sur la personne supprimée — le même raisonnement qu'un contact resté dans le téléphone d'un tiers après suppression du compte associé. Non corrigé par prudence (comportement d'une fonctionnalité stable, pas de certitude qu'une intervention soit attendue) — **à trancher si vous le souhaitez.**
- **Aucune correction appliquée.**

### 9. Rate limiting générique, pas de limite dédiée par action
- **Fichier :** `server.js`
- **Constat :** une limite globale (120 req/min, 500 req/15 min) protège déjà tout `/api/`, y compris chat/votes/propositions, en plus de la limite dédiée mot de passe organisateur (10/10 min, `middleware/auth.js`). Jugé suffisant et proportionné pour ne pas bloquer des utilisateurs légitimes ; pas de limite plus fine ajoutée pour éviter de casser un usage normal (plusieurs votes rapprochés en soirée).
- **Aucune correction appliquée** — périmètre jugé déjà raisonnable.

---

## 🟢 Conforme dans le code (vérifié, aucune correction nécessaire)

- **RLS Supabase** — un audit rigoureux antérieur (migrations `migration-lock-events-rls.sql`, `migration-lock-user-profiles-rls.sql`, `migration-fix-votes-locations-scores-rls.sql`, `migration-fix-public-data-exposure.sql`, `migration-restrict-messages-proposals-columns.sql`, toutes datées du 5 au 12 septembre 2026) a déjà fermé : la lecture publique de `events` (mot de passe organisateur haché, owner_id), `user_profiles` (email/téléphone/friend_code), `votes`, `locations`, `blindtest_scores`, `reports`, et retiré `user_id`/`proposed_by` des colonnes publiques de `messages`/`proposals`. `friendships` et `message_reactions` n'ont aucune policy et sont donc fermées par défaut (comportement Postgres). Re-vérifié ligne par ligne migration par migration (pas seulement leur existence) — voir `tests/rgpd/rls-policies.test.js` et `supabase/verify-rls.sql`. `dj_profiles`/`organizer_pages` restent volontairement publiques (fonctionnalité), sans colonne non consentie.
- **Suppression de compte — gestion des échecs partiels** (`lib/account.js`) : chaque étape est vérifiée individuellement, le compte Supabase Auth n'est supprimé qu'en dernier et seulement si tout le reste a réussi, l'API renvoie une erreur 500 explicite en cas d'échec partiel (jamais un faux succès).
- **Anonymisation** (`lib/account.js`) : messages et propositions perdent identité (`user_id`/`proposed_by` → `null`), nom, photo et texte ; les événements créés perdent `owner_id` et le nom d'organisateur — jamais une simple valeur NULL laissant un lien indirect, la ligne devient réellement non ré-identifiable.
- **Déconnexion après suppression** (`public/js/auth.js`, `confirmDeleteAccount()`/`logout()`) : `localStorage.clear()`, `sessionStorage.clear()`, et `_sb.auth.signOut()` invalident la session Supabase — un ancien token ne permet plus de se reconnecter (le compte Auth est de toute façon supprimé côté serveur).
- **Consentement de partage des coordonnées** (`public/index.html` modale, `public/js/app.js` `maybeAskContactConsent()`) : aucune case pré-cochée, deux boutons explicites (« Oui, j'accepte » / « Non merci »), affichée **après** que le vote/la proposition ait déjà été enregistré côté client — jamais bloquant. Texte explique quelles données, avec qui, pourquoi.
- **Mot de passe événement** (`middleware/auth.js`, `routes/events.js`) : haché avec bcrypt à la création, jamais sélectionné dans les requêtes qui répondent au client, comparaison en temps constant, migration automatique des anciens hachages SHA-256 legacy, rate limiting dédié (10 tentatives/10 min/IP).
- **Uploads** (`routes/profile.js`, `routes/dj.js`, `routes/orga.js`, `routes/events.js`) : taille limitée (5-10 Mo selon la route), ré-encodage systématique via `sharp` (rejette tout fichier qui n'est pas une image valide, quel que soit son extension/en-tête déclarés), noms de fichiers générés côté serveur (jamais depuis une entrée utilisateur), suppression du fichier à la suppression du compte.
- **Logs serveur** (`routes/*.js`, `lib/*.js`, `middleware/auth.js`) : aucun mot de passe, token, en-tête d'autorisation, email ou téléphone journalisé — vérifié par lecture exhaustive de tous les `console.log`/`console.error`/`console.warn` du dépôt.
- **Third-party server-side** (`routes/search.js`) : Deezer, Apple/iTunes, SoundCloud, API Adresse (gouv.fr) et Photon/OSM sont appelés **par le serveur**, jamais par le navigateur — l'IP du visiteur ne leur est jamais transmise, seul le terme recherché l'est.
- **Money Pull Up / paiements** : recherché dans tout le dépôt (`grep` sur "money", "payment", "stripe", "paiement") — **aucune fonctionnalité de paiement n'existe dans le code actuel.** Rien à documenter à ce sujet.

---

# ACTIONS MANUELLES RESTANTES

## CODE
- Rien de bloquant identifié. Point mineur non tranché : nettoyage éventuel de `friendships.friend_name` à la suppression de compte (voir 🟡 point 8) — à décider.

## SUPABASE
- Exécuter `supabase/verify-rls.sql` dans le SQL Editor et confirmer que chaque table renvoie 0 ligne pour le rôle `anon`.
- Vérifier le fournisseur SMS configuré pour l'authentification téléphone (Auth → Providers → Phone) et son propre DPA.
- Vérifier la région d'hébergement exacte du projet dans les réglages Supabase (la politique affirme eu-west-1/Irlande sur la base du nom de la région généralement affectée aux nouveaux projets europ éens, non re-confirmé projet par projet ici).

## IONOS / SERVEUR
- Confirmé le 24/09/2026 : `NODE_ENV=production` actif, cron de purge installé.
- Reste à vérifier : durée de conservation des sauvegardes serveur (non documentée dans ce dépôt), permissions du fichier `.env` de production.

## CONTRATS FOURNISSEURS
- DPA Supabase : à vérifier manuellement (compte Supabase du projet).
- DPA IONOS : à vérifier manuellement (contrat d'hébergement).
- Mécanisme de transfert international Google (authentification) : à vérifier manuellement (conditions Google Cloud/Workspace applicables au compte utilisé).

## JURIDIQUE
- Ce document et la politique de confidentialité mise à jour ne constituent pas une certification juridique — une relecture par un professionnel du droit reste recommandée avant toute communication officielle sur la conformité RGPD de Pull Up.
- Décider du sort de `friendships.friend_name` (🟡 point 8) si une position plus stricte est souhaitée que celle retenue par défaut.

## TESTS PRODUCTION
- `npm run retention:dry-run` à exécuter au moins une fois en production avant de faire confiance aux futures purges automatiques réelles.
- Test de suppression de compte de bout en bout sur un compte réel (hors production si possible) recommandé en complément des tests automatisés (mockés).
