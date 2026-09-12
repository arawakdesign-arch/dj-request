const supabase = require('./supabase');

// Les URLs publiques Supabase Storage ont la forme
// https://xxx.supabase.co/storage/v1/object/public/<bucket>/<chemin>?v=... —
// on retrouve le chemin réel (sans le cache-busting ?v=) pour pouvoir
// supprimer le bon fichier, quel que soit le bucket concerné.
function storagePathFromUrl(bucket, url) {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length).split('?')[0];
}

// Effacement complet d'un compte (droit à l'effacement RGPD) — utilisé à la
// fois par la suppression manuelle (routes/profile.js) et par la purge
// automatique des comptes inactifs depuis 24 mois (lib/retention.js).
//
// Règle appliquée : les lignes qui n'appartiennent qu'à cette personne sont
// supprimées définitivement (votes, position en salle, score, amitiés,
// abonnements, réactions, signalements) ; les lignes partagées avec d'autres
// participants (messages du chat, propositions de morceaux — dont dépendent
// les votes des AUTRES personnes) sont anonymisées plutôt que supprimées,
// pour ne pas casser l'historique commun d'une soirée.
// Chaque étape est vérifiée individuellement — avant, une erreur Supabase au
// milieu du processus passait inaperçue (Promise.all sans lire .error) et
// l'appelant affichait "Compte supprimé" alors que certaines données
// restaient en base. On accumule les échecs et on ne considère la
// suppression réussie que si tout est passé.
async function deleteUserAccount(uid) {
  const failures = [];
  const run = async (label, promise) => {
    const { error } = await promise;
    if (error) failures.push(`${label}: ${error.message}`);
    return !error;
  };
  // Lit un résultat en signalant un échec plutôt qu'en l'ignorant silencieusement
  // (ex : si la lecture du profil échoue, la photo de profil ne sera jamais
  // supprimée du stockage sans qu'on le sache).
  const read = async (label, promise) => {
    const { data, error } = await promise;
    if (error) failures.push(`lecture ${label}: ${error.message}`);
    return data;
  };

  const [profile, djProfile, orgaPage, ownMessages] = await Promise.all([
    read('user_profiles',   supabase.from('user_profiles').select('photo_url').eq('id', uid).maybeSingle()),
    read('dj_profiles',     supabase.from('dj_profiles').select('photo_url').eq('id', uid).maybeSingle()),
    read('organizer_pages', supabase.from('organizer_pages').select('logo_url, banner_url').eq('owner_id', uid).maybeSingle()),
    read('messages (photos)', supabase.from('messages').select('id, photo_url').eq('user_id', uid).not('photo_url', 'is', null)),
  ]);

  await Promise.all([
    run('votes',              supabase.from('votes').delete().eq('user_id', uid)),
    run('locations',          supabase.from('locations').delete().eq('user_id', uid)),
    run('blindtest_scores',   supabase.from('blindtest_scores').delete().eq('user_id', uid)),
    run('friendships',        supabase.from('friendships').delete().eq('user_id', uid)),
    run('organizer_followers',supabase.from('organizer_followers').delete().eq('follower_id', uid)),
    run('message_reactions',  supabase.from('message_reactions').delete().eq('user_id', uid)),
    run('reports',            supabase.from('reports').delete().eq('reported_by', uid)),
  ]);

  // Anonymise plutôt que supprime : la ligne proposals reste (les votes des
  // autres pointent dessus via une FK CASCADE — la supprimer effacerait leurs votes).
  await run('proposals', supabase.from('proposals').update({ proposed_by: null }).eq('proposed_by', uid));

  // Messages : contenu et identité entièrement effacés, la ligne reste pour
  // ne pas trouer le fil de discussion des autres participants.
  await run('messages', supabase.from('messages').update({
    user_id: null, user_name: 'Compte supprimé', user_photo: null, text: null, photo_url: null,
  }).eq('user_id', uid));

  // Soirées créées par cette personne : anonymisées (owner_id + nom
  // d'organisateur retirés), jamais supprimées — supprimer la ligne events
  // effacerait en cascade les propositions/votes/messages de TOUS les autres
  // participants à cette soirée (ON DELETE CASCADE), pas seulement les
  // siens.
  await run('events', supabase.from('events').update({ owner_id: null, orga: null }).eq('owner_id', uid));

  const filesToRemove = [
    ['profile-photos', profile?.photo_url],
    ['profile-photos', djProfile?.photo_url],
    ['orga-logos',     orgaPage?.logo_url],
    ['orga-logos',     orgaPage?.banner_url],
    ...(ownMessages || []).map(m => ['chat-photos', m.photo_url]),
  ];
  await Promise.all(filesToRemove.map(async ([bucket, url]) => {
    const filePath = storagePathFromUrl(bucket, url);
    if (!filePath) return;
    const { error } = await supabase.storage.from(bucket).remove([filePath]);
    if (error) failures.push(`storage ${bucket}/${filePath}: ${error.message}`);
  }));

  await Promise.all([
    run('user_profiles',   supabase.from('user_profiles').delete().eq('id', uid)),
    run('dj_profiles',     supabase.from('dj_profiles').delete().eq('id', uid)),
    run('organizer_pages', supabase.from('organizer_pages').delete().eq('owner_id', uid)),
  ]);

  // Comptes invités (guest_*) : pas d'utilisateur Supabase Auth associé.
  // Volontairement en tout dernier, et seulement si tout le reste a réussi :
  // une fois ce compte Auth supprimé, la personne ne peut plus se reconnecter
  // pour réessayer — mieux vaut lui laisser un accès valide si une étape
  // précédente a échoué, plutôt que de la bloquer avec une suppression
  // signalée comme incomplète mais irréversible sur ce point précis.
  if (!uid.startsWith('guest_') && failures.length === 0) {
    // supabase-js ne lève pas d'exception sur échec ici : comme les autres
    // appels, la méthode renvoie { data, error } — une erreur ignorée en
    // silence donnait l'impression d'un compte bien supprimé alors que la
    // personne pouvait encore se reconnecter avec son compte Google/téléphone.
    const { error } = await supabase.auth.admin.deleteUser(uid);
    if (error) failures.push(`auth.admin.deleteUser: ${error.message}`);
  }

  if (failures.length) {
    throw new Error(`Suppression incomplète (${failures.length} échec(s)) : ${failures.join(' | ')}`);
  }
}

module.exports = { deleteUserAccount, storagePathFromUrl };
