const supabase = require('./supabase');
const { deleteUserAccount } = require('./account');

// La politique de confidentialité annonce une suppression des comptes après
// 24 mois d'inactivité — cette fonction est ce qui rend cette promesse vraie
// (avant, rien dans le dépôt ne l'appliquait réellement).
//
// Verrou anti-concurrence + journal (table retention_runs, cf.
// supabase/migration-add-retention-runs.sql) : sans ça, deux déclenchements
// qui se chevauchent (redémarrage pm2 pendant une purge lente, script manuel
// lancé en même temps que le minuteur en process...) pourraient traiter les
// mêmes comptes en double, et rien ne permettait de vérifier depuis Supabase
// que la purge tourne réellement en production.
const STALE_LOCK_MS = 60 * 60 * 1000; // une purge plus vieille que ça est considérée plantée, pas "en cours"

async function acquireLock() {
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const { data: running, error } = await supabase
    .from('retention_runs').select('id, started_at')
    .eq('status', 'running').gt('started_at', staleCutoff).limit(1);
  if (error) throw new Error('vérification du verrou impossible : ' + error.message);
  if (running?.length) return null; // une purge est déjà en cours

  const { data, error: insertError } = await supabase
    .from('retention_runs').insert({ status: 'running' }).select('id').single();
  if (insertError) throw new Error('pose du verrou impossible : ' + insertError.message);
  return data.id;
}

async function releaseLock(runId, status, purgedCount, errorMessage) {
  await supabase.from('retention_runs').update({
    status, purged_count: purgedCount, error: errorMessage || null, finished_at: new Date().toISOString(),
  }).eq('id', runId);
}

async function purgeInactiveAccounts() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  const cutoffIso = cutoff.toISOString();
  let purged = 0;

  let runId;
  try {
    runId = await acquireLock();
  } catch(e) {
    console.error('[retention] impossible de poser le verrou —', e.message);
    return 0;
  }
  if (runId === null) {
    console.log('[retention] une purge est déjà en cours, celle-ci est ignorée.');
    return 0;
  }

  try {
    // Comptes Google/téléphone (Supabase Auth) — la dernière connexion fait foi.
    // Pagination par offset (page/perPage) : supprimer un compte pendant le
    // parcours décale tous les suivants d'un cran, ce qui SAUTE des comptes
    // si on avance bêtement à la page suivante à chaque itération. On ne
    // passe à la page suivante que si aucune suppression n'a eu lieu sur la
    // page courante ; sinon on la relit (les comptes restants y ont glissé).
    // stuckOnPage borne les relectures d'une même page pour ne jamais boucler
    // indéfiniment si un compte échoue systématiquement à se supprimer.
    let page = 1;
    const perPage = 200;
    let stuckOnPage = 0;
    const MAX_RETRIES_SAME_PAGE = 5;
    while (true) {
      let result;
      try { result = await supabase.auth.admin.listUsers({ page, perPage }); }
      catch(e) { console.error('[retention] listUsers a échoué —', e.message); break; }
      const users = result?.data?.users || [];
      if (!users.length) break;

      let deletedOnThisPage = 0;
      for (const u of users) {
        const lastActive = u.last_sign_in_at || u.created_at;
        if (lastActive && lastActive < cutoffIso) {
          try { await deleteUserAccount(u.id); purged++; deletedOnThisPage++; }
          catch(e) { console.error('[retention] échec suppression', u.id, e.message); }
        }
      }
      if (users.length < perPage) break; // dernière page

      if (deletedOnThisPage === 0) {
        page++;
        stuckOnPage = 0;
      } else {
        stuckOnPage++;
        if (stuckOnPage >= MAX_RETRIES_SAME_PAGE) {
          console.error(`[retention] page ${page} relue ${MAX_RETRIES_SAME_PAGE} fois avec des suppressions persistantes — on avance pour éviter une boucle infinie.`);
          page++;
          stuckOnPage = 0;
        }
        // sinon : on relit la même page, les comptes suivants y ont glissé.
      }
    }

    // Comptes invités historiques (guest_*) : plus jamais créés par le code
    // actuel (routes/auth.js ne génère plus cet identifiant), mais on
    // continue de nettoyer d'éventuelles lignes anciennes encore en base.
    // Pas de session Supabase Auth pour ces comptes — user_profiles.updated_at fait foi.
    const { data: staleGuests, error: guestsError } = await supabase
      .from('user_profiles').select('id').like('id', 'guest_%').lt('updated_at', cutoffIso);
    if (guestsError) console.error('[retention] lecture des comptes invités échouée —', guestsError.message);
    for (const g of (staleGuests || [])) {
      try { await deleteUserAccount(g.id); purged++; }
      catch(e) { console.error('[retention] échec suppression invité', g.id, e.message); }
    }

    if (purged) console.log(`[retention] ${purged} compte(s) inactif(s) depuis 24 mois supprimé(s).`);
    await releaseLock(runId, 'success', purged, null);
    return purged;
  } catch(e) {
    await releaseLock(runId, 'failed', purged, e.message);
    throw e;
  }
}

// Dry-run (npm run retention:dry-run) : compte les comptes qui SERAIENT
// purgés sans rien supprimer — lecture seule, aucun verrou nécessaire (rien
// n'est modifié, la pagination ne peut donc pas être faussée par des
// suppressions concurrentes). Ne renvoie jamais que des UUID techniques :
// jamais l'email ni le téléphone, même dans les logs.
async function countInactiveAccounts() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  const cutoffIso = cutoff.toISOString();
  const ids = [];

  let page = 1;
  const perPage = 200;
  while (true) {
    let result;
    try { result = await supabase.auth.admin.listUsers({ page, perPage }); }
    catch(e) { console.error('[retention:dry-run] listUsers a échoué —', e.message); break; }
    const users = result?.data?.users || [];
    if (!users.length) break;
    for (const u of users) {
      const lastActive = u.last_sign_in_at || u.created_at;
      if (lastActive && lastActive < cutoffIso) ids.push(u.id);
    }
    if (users.length < perPage) break;
    page++;
  }

  const { data: staleGuests, error: guestsError } = await supabase
    .from('user_profiles').select('id').like('id', 'guest_%').lt('updated_at', cutoffIso);
  if (guestsError) console.error('[retention:dry-run] lecture des comptes invités échouée —', guestsError.message);
  (staleGuests || []).forEach(g => ids.push(g.id));

  return ids;
}

// pm2 tourne en cluster (2 instances) — sans cette garde, les deux processus
// lanceraient la purge en double toutes les 24h. NODE_APP_INSTANCE est fourni
// par pm2 ('0', '1', ...) ; absent hors cluster (dev local). Le verrou
// retention_runs ci-dessus reste la protection principale contre toute
// exécution concurrente ; celle-ci n'est qu'une optimisation pour éviter
// qu'une seconde instance interroge inutilement Supabase pour rien.
// Ne tourne qu'en production : le .env local pointe vers la même base
// Supabase que la prod (aucune base de dev séparée) — activer ça en local
// programmerait une vraie purge de comptes réels 60s après chaque `npm start`.
//
// ATTENTION déploiement : ce minuteur ne se déclenche que si le process pm2
// tourne bien avec NODE_ENV=production. `pm2 restart pullup` seul NE
// GARANTIT PAS cela — pm2 ne réapplique env_production de ecosystem.config.js
// que si on le précise explicitement. Vérifier avec :
//   pm2 env 0        # doit afficher NODE_ENV: 'production'
// Si ce n'est pas le cas :
//   pm2 delete pullup && pm2 start ecosystem.config.js --env production && pm2 save
// Pour une garantie indépendante de cette configuration pm2, préférer un vrai
// cron système appelant scripts/purge-inactive-accounts.js (voir ce fichier) —
// le verrou retention_runs rend les deux mécanismes sûrs à combiner.
function schedulePurge() {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') return;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => { purgeInactiveAccounts().catch(e => console.error('[retention] purge échouée —', e.message)); }, ONE_DAY_MS);
  // Une passe peu après le démarrage plutôt que d'attendre 24h la première fois.
  setTimeout(() => { purgeInactiveAccounts().catch(e => console.error('[retention] purge échouée —', e.message)); }, 60 * 1000);
}

module.exports = { purgeInactiveAccounts, schedulePurge, countInactiveAccounts };
