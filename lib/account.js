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
async function deleteUserAccount(uid) {
  const [{ data: profile }, { data: djProfile }, { data: orgaPage }, { data: ownMessages }] = await Promise.all([
    supabase.from('user_profiles').select('photo_url').eq('id', uid).maybeSingle(),
    supabase.from('dj_profiles').select('photo_url').eq('id', uid).maybeSingle(),
    supabase.from('organizer_pages').select('logo_url, banner_url').eq('owner_id', uid).maybeSingle(),
    supabase.from('messages').select('id, photo_url').eq('user_id', uid).not('photo_url', 'is', null),
  ]);

  await Promise.all([
    supabase.from('votes').delete().eq('user_id', uid),
    supabase.from('locations').delete().eq('user_id', uid),
    supabase.from('blindtest_scores').delete().eq('user_id', uid),
    supabase.from('friendships').delete().eq('user_id', uid),
    supabase.from('organizer_followers').delete().eq('follower_id', uid),
    supabase.from('message_reactions').delete().eq('user_id', uid),
    supabase.from('reports').delete().eq('reported_by', uid),
  ]);

  // Anonymise plutôt que supprime : la ligne proposals reste (les votes des
  // autres pointent dessus via une FK CASCADE — la supprimer effacerait leurs votes).
  await supabase.from('proposals').update({ proposed_by: null }).eq('proposed_by', uid);

  // Messages : contenu et identité entièrement effacés, la ligne reste pour
  // ne pas trouer le fil de discussion des autres participants.
  await supabase.from('messages').update({
    user_id: null, user_name: 'Compte supprimé', user_photo: null, text: null, photo_url: null,
  }).eq('user_id', uid);

  const filesToRemove = [
    ['profile-photos', profile?.photo_url],
    ['profile-photos', djProfile?.photo_url],
    ['orga-logos',     orgaPage?.logo_url],
    ['orga-logos',     orgaPage?.banner_url],
    ...(ownMessages || []).map(m => ['chat-photos', m.photo_url]),
  ];
  await Promise.all(filesToRemove.map(([bucket, url]) => {
    const filePath = storagePathFromUrl(bucket, url);
    return filePath ? supabase.storage.from(bucket).remove([filePath]).catch(() => {}) : null;
  }));

  await Promise.all([
    supabase.from('user_profiles').delete().eq('id', uid),
    supabase.from('dj_profiles').delete().eq('id', uid),
    supabase.from('organizer_pages').delete().eq('owner_id', uid),
  ]);

  // Comptes invités (guest_*) : pas d'utilisateur Supabase Auth associé.
  if (!uid.startsWith('guest_')) {
    try { await supabase.auth.admin.deleteUser(uid); } catch(e) {}
  }
}

module.exports = { deleteUserAccount, storagePathFromUrl };
