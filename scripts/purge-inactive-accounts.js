#!/usr/bin/env node
// Purge RGPD des comptes inactifs depuis 24 mois — appelé par un vrai cron
// système plutôt que par le minuteur interne à l'application (lib/retention.js
// schedulePurge()), qui dépend d'un process pm2 démarré avec NODE_ENV=production
// et redémarre à zéro à chaque déploiement. Le verrou retention_runs rend les
// deux mécanismes sûrs à utiliser en même temps si besoin.
//
// Installation sur le serveur (à faire une fois, manuellement) :
//   crontab -e
// puis ajouter la ligne :
//   0 4 * * * cd /var/www/pullup && /usr/bin/env node scripts/purge-inactive-accounts.js >> /var/log/pullup/retention.log 2>&1
//
// Vérifier ensuite que ça tourne réellement, depuis Supabase SQL Editor :
//   select * from retention_runs order by started_at desc limit 5;
//
// --dry-run (ou : npm run retention:dry-run) : n'efface rien, affiche
// uniquement le nombre de comptes concernés et leurs UUID techniques —
// jamais leur email ni leur téléphone.

require('dotenv').config();
const { purgeInactiveAccounts, countInactiveAccounts } = require('../lib/retention');

const dryRun = process.argv.includes('--dry-run');

if (dryRun) {
  countInactiveAccounts()
    .then(ids => {
      console.log(`[retention:dry-run] ${ids.length} compte(s) seraient purgés (aucune suppression effectuée).`);
      if (ids.length) console.log('[retention:dry-run] UUID concernés :', ids.join(', '));
      process.exit(0);
    })
    .catch(e => { console.error('[retention:dry-run] échec —', e.message); process.exit(1); });
} else {
  purgeInactiveAccounts()
    .then(count => { console.log(`[retention] OK — ${count} compte(s) purgé(s).`); process.exit(0); })
    .catch(e => { console.error('[retention] échec —', e.message); process.exit(1); });
}
