const supabase = require('./supabase');
const { deleteUserAccount } = require('./account');

// La politique de confidentialité annonce une suppression des comptes après
// 24 mois d'inactivité — cette fonction est ce qui rend cette promesse vraie
// (avant, rien dans le dépôt ne l'appliquait réellement).
async function purgeInactiveAccounts() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  const cutoffIso = cutoff.toISOString();
  let purged = 0;

  // Comptes Google/téléphone (Supabase Auth) — la dernière connexion fait foi.
  let page = 1;
  const perPage = 200;
  while (true) {
    let result;
    try { result = await supabase.auth.admin.listUsers({ page, perPage }); }
    catch(e) { console.error('[retention] listUsers a échoué —', e.message); break; }
    const users = result?.data?.users || [];
    if (!users.length) break;

    for (const u of users) {
      const lastActive = u.last_sign_in_at || u.created_at;
      if (lastActive && lastActive < cutoffIso) {
        try { await deleteUserAccount(u.id); purged++; }
        catch(e) { console.error('[retention] échec suppression', u.id, e.message); }
      }
    }
    if (users.length < perPage) break;
    page++;
  }

  // Comptes invités (guest_*) : pas de session Supabase Auth — user_profiles.updated_at fait foi.
  const { data: staleGuests } = await supabase
    .from('user_profiles').select('id').like('id', 'guest_%').lt('updated_at', cutoffIso);
  for (const g of (staleGuests || [])) {
    try { await deleteUserAccount(g.id); purged++; }
    catch(e) { console.error('[retention] échec suppression invité', g.id, e.message); }
  }

  if (purged) console.log(`[retention] ${purged} compte(s) inactif(s) depuis 24 mois supprimé(s).`);
  return purged;
}

// pm2 tourne en cluster (2 instances) — sans cette garde, les deux processus
// lanceraient la purge en double toutes les 24h. NODE_APP_INSTANCE est fourni
// par pm2 ('0', '1', ...) ; absent hors cluster (dev local).
// Ne tourne qu'en production : le .env local pointe vers la même base
// Supabase que la prod (aucune base de dev séparée) — activer ça en local
// programmerait une vraie purge de comptes réels 60s après chaque `npm start`.
function schedulePurge() {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') return;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => { purgeInactiveAccounts().catch(e => console.error('[retention] purge échouée —', e.message)); }, ONE_DAY_MS);
  // Une passe peu après le démarrage plutôt que d'attendre 24h la première fois.
  setTimeout(() => { purgeInactiveAccounts().catch(e => console.error('[retention] purge échouée —', e.message)); }, 60 * 1000);
}

module.exports = { purgeInactiveAccounts, schedulePurge };
