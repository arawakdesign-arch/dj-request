# 🎵 DJ Request — Node.js + Supabase

Application de votes musicaux en soirée. Les invités proposent des morceaux, votent, chattent, et l'organisateur gère la file d'attente en temps réel.

## Stack technique

| Composant     | Technologie                        |
|---------------|------------------------------------|
| Serveur       | Node.js 20 + Express               |
| Base de données | Supabase (PostgreSQL)            |
| Temps réel    | Supabase Realtime (WebSocket)      |
| Auth          | Supabase Auth (Google + SMS OTP)   |
| Photos chat   | Supabase Storage                   |
| Process       | PM2 (cluster mode)                 |
| Proxy         | Nginx + SSL Let's Encrypt          |

## Structure du projet

```
djrequest/
├── server.js              # Serveur Express principal
├── package.json
├── ecosystem.config.js    # Configuration PM2
├── .env.example           # Variables d'environnement (à copier en .env)
├── public/
│   └── index.html         # Frontend SPA
├── supabase/
│   └── schema.sql         # Schéma base de données complet
├── nginx/
│   └── djrequest.conf     # Configuration Nginx
└── scripts/
    └── deploy.sh          # Script déploiement automatique
```

## Installation locale (développement)

```bash
# 1. Cloner le projet
git clone votre-repo ou copier les fichiers

# 2. Installer les dépendances
npm install

# 3. Configurer l'environnement
cp .env.example .env
nano .env   # Remplir les clés Supabase

# 4. Lancer en dev
npm run dev   # avec nodemon (rechargement auto)
# ou
npm start     # sans rechargement auto

# App accessible sur http://localhost:3000
```

## Configuration Supabase

### 1. Créer un projet

1. Aller sur [supabase.com](https://supabase.com) → New Project
2. Nommer le projet (ex: `djrequest-prod`)
3. Choisir la région : **West EU (Ireland)** pour la France
4. Attendre l'initialisation (~2 min)

### 2. Initialiser le schéma

1. Supabase → **SQL Editor** → New Query
2. Coller tout le contenu de `supabase/schema.sql`
3. Cliquer **Run**

### 3. Activer l'authentification

**Google :**
1. Supabase → Authentication → Providers → Google → Enable
2. Créer une app OAuth sur [console.cloud.google.com](https://console.cloud.google.com)
3. Copier Client ID et Secret dans Supabase

**Téléphone (SMS OTP) :**
1. Supabase → Authentication → Providers → Phone → Enable
2. Configurer Twilio (compte gratuit suffisant pour les tests)
   - Account SID, Auth Token, Phone Number

### 4. Créer le bucket Storage

1. Supabase → Storage → New Bucket
2. Nom : `chat-photos`
3. Cocher **Public bucket**
4. Créer

### 5. Récupérer les clés API

Supabase → Settings → API :
- `SUPABASE_URL` → Project URL
- `SUPABASE_ANON_KEY` → anon/public key
- `SUPABASE_SERVICE_KEY` → service_role key (**privée, jamais en front !**)

## Déploiement VPS (production)

### Prérequis

- VPS Ubuntu 22.04 LTS (1 vCPU, 1 Go RAM minimum)
- Accès SSH root
- Domaine pointant vers l'IP du VPS (A record)

### Déploiement automatique

```bash
# 1. Copier les fichiers sur le VPS
scp -r djrequest-node/ root@IP_VPS:/tmp/djrequest

# 2. Se connecter en SSH
ssh root@IP_VPS

# 3. Rendre le script exécutable et lancer
cd /tmp/djrequest
chmod +x scripts/deploy.sh
bash scripts/deploy.sh
```

Le script installe automatiquement :
- Node.js 20 LTS
- PM2
- Nginx
- Certbot (SSL gratuit)
- Configure le firewall

### Déploiement manuel étape par étape

```bash
# Sur le VPS (Ubuntu 22.04)

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PM2
npm install -g pm2

# Copier le projet
cp -r /tmp/djrequest /var/www/djrequest
cd /var/www/djrequest

# Variables d'environnement
cp .env.example .env
nano .env   # ← Remplir vos clés Supabase

# Dépendances
npm install --production

# Créer dossier logs
mkdir -p /var/log/djrequest

# Démarrer avec PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup

# Nginx
cp nginx/djrequest.conf /etc/nginx/sites-available/djrequest
ln -s /etc/nginx/sites-available/djrequest /etc/nginx/sites-enabled/
nano /etc/nginx/sites-available/djrequest  # ← changer votre-domaine.fr
nginx -t && systemctl reload nginx

# SSL
certbot --nginx -d votre-domaine.fr -d www.votre-domaine.fr
```

## Commandes utiles (production)

```bash
# État de l'application
pm2 status

# Logs en temps réel
pm2 logs djrequest

# Redémarrer l'app
pm2 restart djrequest

# Recharger sans downtime
pm2 reload djrequest

# Stopper l'app
pm2 stop djrequest

# Mise à jour des fichiers
cd /var/www/djrequest
# (copiez vos nouveaux fichiers)
pm2 reload djrequest   # rechargement à chaud

# Recharger Nginx
nginx -t && systemctl reload nginx

# Renouveler SSL (automatique via cron, mais manuel si besoin)
certbot renew
```

## Variables d'environnement (.env)

| Variable | Description | Exemple |
|----------|-------------|---------|
| `SUPABASE_URL` | URL de votre projet Supabase | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Clé publique (front) | `eyJhbGci...` |
| `SUPABASE_SERVICE_KEY` | Clé privée (serveur) | `eyJhbGci...` |
| `PORT` | Port du serveur Node | `3000` |
| `NODE_ENV` | Environnement | `production` |
| `ORGANIZER_PASSWORD` | Mot de passe Espace Orga | `djrequest2026!` |
| `APP_URL` | URL publique | `https://www.mon-domaine.fr` |

## API Endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Santé du serveur |
| GET | `/api/events/:id` | Détails d'un événement |
| POST | `/api/events` | Créer un événement |
| POST | `/api/events/:id/auth` | Vérifier mot de passe orga |
| GET | `/api/proposals/:eventId` | Liste des propositions |
| POST | `/api/proposals` | Proposer un morceau |
| DELETE | `/api/proposals/:eid/:sid` | Supprimer (orga) |
| POST | `/api/votes` | Voter |
| DELETE | `/api/votes/:eid/:pid` | Retirer son vote |
| GET | `/api/messages/:eventId` | Messages du chat |
| POST | `/api/messages` | Envoyer un message |
| DELETE | `/api/messages/:id` | Supprimer un message |
| POST | `/api/reports` | Signaler un message |
| GET | `/api/now-playing/:eventId` | Morceau en cours |
| PUT | `/api/now-playing/:eventId` | Mettre à jour (orga) |
| POST | `/api/upload` | Upload photo chat |

## Sécurité

- ✅ Helmet.js (headers HTTP sécurisés)
- ✅ Rate limiting (200 req/15min global, 60 req/min API)
- ✅ CORS configuré
- ✅ Supabase RLS (Row Level Security) sur toutes les tables
- ✅ Mots de passe hashés SHA-256
- ✅ JWT validation côté serveur pour les routes protégées
- ✅ SSL/TLS Let's Encrypt
- ✅ Nginx comme reverse proxy (Node.js non exposé directement)

## Mise à jour de l'app

```bash
# Copier les nouveaux fichiers sur le VPS
scp public/index.html root@IP_VPS:/var/www/djrequest/public/
scp server.js root@IP_VPS:/var/www/djrequest/

# Redémarrer sans downtime
ssh root@IP_VPS "pm2 reload djrequest"
```

---

Made with ❤️ — DJ Request v1.0.0
# dj-request
