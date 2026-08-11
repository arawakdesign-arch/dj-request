#!/bin/bash
# ══════════════════════════════════════════════════════════════════
# PULL UP! — Script de déploiement VPS complet
# Usage : bash scripts/deploy.sh
# Système : Ubuntu 22.04 LTS
# ══════════════════════════════════════════════════════════════════

set -e  # Arrêt immédiat en cas d'erreur
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warning() { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   🎵 PULL UP! — Déploiement VPS      ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── 1. Mise à jour système ─────────────────────────────────────────
info "Mise à jour du système..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Dépendances système ─────────────────────────────────────────
info "Installation des dépendances système..."
apt-get install -y -qq \
  curl wget git unzip \
  nginx certbot python3-certbot-nginx \
  build-essential

# ── 3. Node.js 20 LTS ─────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installation de Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  info "Node.js déjà installé : $(node -v)"
fi

# ── 4. PM2 ────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  info "Installation de PM2..."
  npm install -g pm2
fi

# ── 5. Dossier de l'application ───────────────────────────────────
APP_DIR="/var/www/pullup"
LOG_DIR="/var/log/pullup"

info "Création des dossiers..."
mkdir -p $APP_DIR $LOG_DIR
chown -R www-data:www-data $LOG_DIR 2>/dev/null || true

# ── 6. Copier les fichiers ─────────────────────────────────────────
info "Copie des fichiers de l'application..."
cp -r . $APP_DIR/
cd $APP_DIR

# ── 7. Variables d'environnement ──────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  warning "Fichier .env manquant ! Création depuis .env.example..."
  cp .env.example .env
  warning "⚠️  IMPORTANT : Éditez /var/www/pullup/.env avec vos clés Supabase !"
  warning "   nano /var/www/pullup/.env"
fi

# ── 8. Installation des dépendances npm ───────────────────────────
info "Installation des dépendances npm..."
cd $APP_DIR
npm install --production --quiet

# ── 9. Nginx ──────────────────────────────────────────────────────
info "Configuration de Nginx..."
DOMAIN=$(grep APP_URL $APP_DIR/.env | cut -d'=' -f2 | sed 's/https:\/\///' | sed 's/http:\/\///')

if [ -z "$DOMAIN" ]; then
  warning "Domaine non trouvé dans .env, utilisation de localhost"
  DOMAIN="localhost"
fi

sed "s/votre-domaine.fr/$DOMAIN/g" $APP_DIR/nginx/pullup.conf \
  > /etc/nginx/sites-available/pullup

ln -sf /etc/nginx/sites-available/pullup /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
info "Nginx configuré pour : $DOMAIN"

# ── 10. Démarrage PM2 ─────────────────────────────────────────────
info "Démarrage de l'application avec PM2..."
pm2 stop pullup 2>/dev/null || true
pm2 delete pullup 2>/dev/null || true
pm2 start $APP_DIR/ecosystem.config.js --env production
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# ── 11. SSL Certbot ───────────────────────────────────────────────
if [ "$DOMAIN" != "localhost" ]; then
  info "Configuration SSL avec Certbot..."
  warning "Assurez-vous que votre domaine pointe vers ce serveur avant de continuer"
  read -p "Lancer Certbot maintenant ? (o/n) : " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Oo]$ ]]; then
    EMAIL=$(grep SMTP_USER $APP_DIR/.env | cut -d'=' -f2)
    if [ -z "$EMAIL" ]; then read -p "Votre email pour Let's Encrypt : " EMAIL; fi
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --email $EMAIL --agree-tos --no-eff-email
    info "SSL activé !"
  else
    warning "SSL ignoré. Lancez manuellement : certbot --nginx -d $DOMAIN"
  fi
fi

# ── 12. Firewall ──────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  info "Configuration du firewall..."
  ufw allow 22/tcp    # SSH
  ufw allow 80/tcp    # HTTP
  ufw allow 443/tcp   # HTTPS
  ufw --force enable
fi

# ── Résumé ────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Déploiement terminé !${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "  📍 Application    : https://$DOMAIN"
echo "  📁 Dossier        : $APP_DIR"
echo "  📋 Logs app       : $LOG_DIR"
echo "  📋 Logs nginx     : /var/log/nginx/pullup.*"
echo ""
echo "  Commandes utiles :"
echo "  ├── pm2 status              → état de l'app"
echo "  ├── pm2 logs pullup      → logs en direct"
echo "  ├── pm2 restart pullup   → redémarrer"
echo "  ├── nano $APP_DIR/.env      → modifier les variables"
echo "  └── nginx -t && nginx -s reload → recharger nginx"
echo ""
warning "N'oubliez pas d'éditer .env avec vos clés Supabase !"
