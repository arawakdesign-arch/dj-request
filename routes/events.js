const express  = require('express');
const multer   = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth, requireOrganizer, hashPassword, verifyOrganizerPassword } = require('../middleware/auth');
const { signToken } = require('../lib/jwt');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router();

// Une soirée se ferme aux votes/propositions 24h après son démarrage — calculé
// à la volée depuis scheduled_at (ou created_at si pas planifiée), pas de
// tâche planifiée ni de colonne dédiée. Les données (votes, propositions,
// chat) restent en base et consultables.
const EVENT_DURATION_MS = 24 * 60 * 60 * 1000;
function isUpcoming(scheduledAt) {
  return !!scheduledAt && new Date(scheduledAt).getTime() > Date.now();
}
function isClosed(createdAt, scheduledAt) {
  if (isUpcoming(scheduledAt)) return false; // pas encore démarrée → pas fermée
  const start = scheduledAt ? new Date(scheduledAt).getTime() : new Date(createdAt).getTime();
  return (Date.now() - start) > EVENT_DURATION_MS;
}
async function isEventClosed(eventId) {
  const { data } = await supabase.from('events').select('created_at, scheduled_at').eq('id', eventId).single();
  if (!data) return true; // événement introuvable → traité comme fermé
  return isClosed(data.created_at, data.scheduled_at);
}

// ── Events ────────────────────────────────────────────────────────────

// Lookup par nom — doit être déclaré AVANT /events/:id pour éviter que
// Express ne l'intercepte avec id = 'by-name'
router.get('/events/by-name', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Nom manquant' });

  const { data } = await supabase
    .from('events')
    .select('id, name, club_name, is_active')
    .eq('name', name)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return res.status(404).json({ error: 'Soirée introuvable' });
  res.json(data);
});

// Soirées dont l'utilisateur connecté est propriétaire (owner_id) — alimente
// le bouton "Administrer" dans le profil. Déclarée avant /events/:id pour
// éviter qu'Express n'intercepte "mine" comme un id.
router.get('/events/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, club_name, created_at, scheduled_at')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(ev => ({ ...ev, closed: isClosed(ev.created_at, ev.scheduled_at), upcoming: isUpcoming(ev.scheduled_at) })));
});

router.get('/events/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, club_name, orga, address, hours, lineup, flyer_url, is_active, created_at, scheduled_at, owner_id')
    .eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Événement introuvable' });
  // Slug de la page publique organisateur, si l'organisateur en a configuré une —
  // permet aux liens/QR de la soirée de rediriger vers sa page de marque plutôt
  // que directement dans le flux d'inscription.
  let orgaSlug = null;
  if (data.owner_id) {
    const { data: page } = await supabase
      .from('organizer_pages').select('slug').eq('owner_id', data.owner_id).maybeSingle();
    orgaSlug = page?.slug || null;
  }
  const { owner_id, ...pub } = data;
  res.json({ ...pub, orga_slug: orgaSlug, closed: isClosed(data.created_at, data.scheduled_at), upcoming: isUpcoming(data.scheduled_at) });
});

// Personnes ayant voté et/ou proposé un morceau sur cet événement — liste
// affichée à l'organisateur dans l'onglet Contact.
router.get('/events/:id/participants', requireOrganizer, async (req, res) => {
  const eventId = req.params.id;
  const [votesRes, proposalsRes] = await Promise.all([
    supabase.from('votes').select('user_id').eq('event_id', eventId),
    supabase.from('proposals').select('proposed_by').eq('event_id', eventId),
  ]);
  const ids = [...new Set([
    ...(votesRes.data || []).map(v => v.user_id),
    ...(proposalsRes.data || []).map(p => p.proposed_by).filter(Boolean),
  ])];
  if (!ids.length) return res.json([]);

  const { data: profiles } = await supabase
    .from('user_profiles').select('id, display_name, email, phone').in('id', ids);
  const byId = {};
  (profiles || []).forEach(p => { byId[p.id] = p; });
  res.json(ids.map(id => ({
    id,
    name:  byId[id]?.display_name || 'Invité',
    email: byId[id]?.email || null,
    phone: byId[id]?.phone || null,
  })));
});

router.post('/events', requireAuth, async (req, res) => {
  const { name, club_name, orga, address, hours, password, scheduled_at } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Champs manquants' });
  // Date planifiée optionnelle — doit être dans le futur, sinon on l'ignore
  // (la soirée démarre alors immédiatement comme avant).
  const scheduledAt = scheduled_at && new Date(scheduled_at).getTime() > Date.now() ? scheduled_at : null;

  // Créer une soirée nécessite un compte identifiable par email (Google ou
  // email magic-link) — les invités et comptes téléphone n'en ont pas et
  // sont rejetés. Plus de liste blanche : n'importe quel compte email peut
  // créer une soirée (ouvert à tous les clients).
  // Exception : une session organisateur (JWT lié à un event_id, ex. planifier
  // une soirée à venir depuis le dashboard) n'a pas d'email dans son JWT —
  // on résout alors le vrai propriétaire via l'événement en cours.
  let ownerId = req.user.email ? req.user.id : null;
  if (!ownerId && req.user.role === 'organizer' && req.user.event_id) {
    const { data: currentEvent } = await supabase
      .from('events').select('owner_id').eq('id', req.user.event_id).single();
    ownerId = currentEvent?.owner_id || null;
  }
  if (!ownerId) {
    return res.status(403).json({ error: 'Connecte-toi avec Google ou par email pour créer une soirée.' });
  }

  // Un compte organisateur ne peut gérer qu'une seule soirée LIVE à la fois —
  // évite la confusion de plusieurs soirées ouvertes en parallèle sous le même
  // compte. Une fois la soirée fermée (24h, cf. isClosed()), il peut en
  // recréer une. Ne s'applique que si la nouvelle soirée démarre immédiatement :
  // planifier une soirée à venir (scheduledAt) reste toujours possible, même
  // si une soirée est déjà live ou d'autres soirées à venir existent déjà.
  if (!scheduledAt) {
    const { data: recent } = await supabase
      .from('events').select('id, name, created_at, scheduled_at')
      .eq('owner_id', ownerId).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(5);
    const ownActive = (recent || []).find(ev => !isUpcoming(ev.scheduled_at) && !isClosed(ev.created_at, ev.scheduled_at));
    if (ownActive) {
      return res.status(409).json({
        error: `Ta soirée "${ownActive.name}" est encore en cours — attends sa clôture (24h) avant d'en créer une nouvelle.`,
        active_event_id: ownActive.id,
        active_event_name: ownActive.name,
      });
    }
  }

  // Empêche 2 soirées actives en même temps sous le même nom : source de
  // confusion (recherche par nom, QR/liens partagés qui se marchent dessus).
  // Une fois la soirée existante fermée (24h, cf. isClosed()), le nom se
  // libère pour une nouvelle création.
  const { data: existingActive } = await supabase
    .from('events').select('created_at, scheduled_at')
    .eq('name', name).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existingActive && !isClosed(existingActive.created_at, existingActive.scheduled_at)) {
    return res.status(409).json({ error: `Une soirée "${name}" est déjà en cours — choisissez un autre nom.` });
  }

  const hashedPassword = hashPassword(password);
  const { data, error } = await supabase.from('events').insert({
    name, club_name, orga, address, hours, password: hashedPassword, owner_id: ownerId,
    scheduled_at: scheduledAt,
  }).select('id, name, club_name, orga, address, hours, created_at, scheduled_at').single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('now_playing').insert({ event_id: data.id, title: 'En attente…', artist: '' });
  res.status(201).json(data);
});

router.patch('/events/:id', requireOrganizer, async (req, res) => {
  const { name, club_name, orga, address, hours, scheduled_at, lineup } = req.body;
  const updates = { name, club_name, orga, address, hours };
  if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at;
  if (lineup !== undefined) updates.lineup = lineup;
  const { data, error } = await supabase.from('events')
    .update(updates)
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, closed: isClosed(data.created_at, data.scheduled_at), upcoming: isUpcoming(data.scheduled_at) });
});

router.post('/events/:id/auth', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe manquant' });

  const { data: event } = await supabase.from('events')
    .select('id, name, password').eq('id', req.params.id).single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  if (!await verifyOrganizerPassword(event.id, event.password, password)) {
    return res.status(403).json({ error: 'Mot de passe incorrect' });
  }

  // Générer un JWT organizer persistable — permet la restauration de session après refresh
  const token = signToken({ id: event.id, displayName: event.name, role: 'organizer', event_id: event.id });
  res.json({ authorized: true, event_id: event.id, name: event.name, token });
});

// Émet un JWT organizer pour le propriétaire de la soirée sans repasser par
// le mot de passe : owner_id === req.user.id suffit à prouver l'identité.
router.post('/events/:id/admin-token', requireAuth, async (req, res) => {
  const { data: event } = await supabase
    .from('events').select('id, name, owner_id').eq('id', req.params.id).single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  if (event.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Vous n\'êtes pas propriétaire de cette soirée.' });
  }

  const token = signToken({ id: event.id, displayName: event.name, role: 'organizer', event_id: event.id });
  res.json({ token, event_id: event.id, name: event.name });
});

// ── Proposals ─────────────────────────────────────────────────────────
router.get('/proposals/:eventId', async (req, res) => {
  const { data, error } = await supabase
    .from('proposals').select('*')
    .eq('event_id', req.params.eventId)
    .order('votes', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Attache la liste des votants par proposition : le frontend (totalVoters()
  // dans render.js) en a besoin pour le compteur "connectés" de la bannière,
  // qui restait bloqué à 0 faute de cette donnée.
  const { data: allVotes } = await supabase
    .from('votes').select('proposal_id, user_id').eq('event_id', req.params.eventId);
  const votersByProposal = {};
  (allVotes || []).forEach(v => {
    (votersByProposal[v.proposal_id] ??= {})[v.user_id] = true;
  });

  // Nom de la personne qui a proposé chaque morceau — affiché sur la carte
  // dans la liste des propositions côté vote.
  const proposerIds = [...new Set((data || []).map(p => p.proposed_by).filter(Boolean))];
  let proposerNames = {};
  if (proposerIds.length) {
    const { data: profiles } = await supabase
      .from('user_profiles').select('id, display_name').in('id', proposerIds);
    (profiles || []).forEach(u => { proposerNames[u.id] = u.display_name; });
  }

  const enriched = (data || []).map(p => ({
    ...p,
    voters: votersByProposal[p.id] || {},
    proposer_name: proposerNames[p.proposed_by] || null,
  }));
  res.json(enriched);
});

// Votes/minute réel (bannière de l'événement) — compte les votes des 60
// dernières secondes, plutôt que le delta de rendu client précédemment
// utilisé (pas un vrai taux temporel).
router.get('/events/:id/vote-rate', async (req, res) => {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from('votes').select('*', { count: 'exact', head: true })
    .eq('event_id', req.params.id)
    .gte('created_at', since);
  res.json({ perMinute: count || 0 });
});

// song_id vient toujours d'un id de catalogue (Deezer/iTunes numérique, ou code
// local court) — jamais de texte libre. On le restreint à ce format : il est
// réinjecté tel quel dans des attributs onclick (`vote('${p.id}')`) côté client,
// un id contenant un guillemet permettrait d'y injecter du JS arbitraire.
const SONG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

router.post('/proposals', requireAuth, async (req, res) => {
  const { song_id, event_id, title, artist, cover_url } = req.body;
  if (!song_id || !event_id) return res.status(400).json({ error: 'Champs manquants' });
  if (!SONG_ID_RE.test(song_id)) return res.status(400).json({ error: 'Identifiant de morceau invalide' });
  if (await isEventClosed(event_id)) return res.status(403).json({ error: 'Cette soirée est terminée.' });

  const { data: existing } = await supabase.from('proposals')
    .select('id').eq('id', song_id).eq('event_id', event_id).single();
  if (existing) return res.status(409).json({ error: 'Morceau déjà proposé' });

  const { data, error } = await supabase.from('proposals').insert({
    id: song_id, event_id, proposed_by: req.user.id,
    title:     title     ? String(title).slice(0, 200)     : null,
    artist:    artist    ? String(artist).slice(0, 200)    : null,
    cover_url: cover_url ? String(cover_url).slice(0, 1000) : null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Vote initial du proposeur — le trigger update_proposal_votes incrémente proposals.votes
  const { error: voteError } = await supabase.from('votes').insert({
    user_id: req.user.id, proposal_id: song_id, event_id,
  });
  if (voteError) console.error('[vote initial]', voteError.message);

  res.status(201).json(data);
});

router.delete('/proposals/:eventId/:songId', requireOrganizer, async (req, res) => {
  const { error } = await supabase.from('proposals')
    .delete().eq('id', req.params.songId).eq('event_id', req.params.eventId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.patch('/proposals/:eventId/:songId', requireOrganizer, async (req, res) => {
  const { approved } = req.body;
  const { data, error } = await supabase.from('proposals')
    .update({ approved }).eq('id', req.params.songId).eq('event_id', req.params.eventId)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Votes ──────────────────────────────────────────────────────────────
router.post('/votes', requireAuth, async (req, res) => {
  const { proposal_id, event_id } = req.body;
  if (!proposal_id || !event_id) return res.status(400).json({ error: 'Champs manquants' });
  if (await isEventClosed(event_id)) return res.status(403).json({ error: 'Cette soirée est terminée.' });

  const { error } = await supabase.from('votes').insert({
    user_id: req.user.id, proposal_id, event_id,
  });
  if (error?.code === '23505') return res.status(409).json({ error: 'Vous avez déjà voté pour ce morceau' });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ success: true });
});

// Votes de l'utilisateur courant pour un event — utilisé par le frontend pour restaurer myVotes au reload
router.get('/votes/:eventId', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('votes')
    .select('proposal_id')
    .eq('event_id', req.params.eventId)
    .eq('user_id', req.user.id);
  res.json((data || []).map(v => v.proposal_id));
});

router.delete('/votes/:eventId/:proposalId', requireAuth, async (req, res) => {
  const { error } = await supabase.from('votes')
    .delete()
    .eq('user_id', req.user.id)
    .eq('proposal_id', req.params.proposalId)
    .eq('event_id', req.params.eventId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});


// ── Upload flyer soirée ───────────────────────────────────────────────
router.post('/events/:id/flyer', requireOrganizer, upload.single('flyer'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

  let buffer = req.file.buffer;
  try {
    const sharp = require('sharp');
    buffer = await sharp(buffer)
      .resize(1200, 800, { fit: 'cover' })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
  } catch(e) {}

  const fileName = `${req.params.id}/flyer.jpg`;
  const { error } = await supabase.storage.from('flyers').upload(fileName, buffer, {
    contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('flyers').getPublicUrl(fileName);

  await supabase.from('events').update({ flyer_url: publicUrl }).eq('id', req.params.id);
  res.json({ url: publicUrl });
});

router.delete('/events/:id/flyer', requireOrganizer, async (req, res) => {
  await supabase.storage.from('flyers').remove([`${req.params.id}/flyer.jpg`]);
  await supabase.from('events').update({ flyer_url: null }).eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
module.exports.isClosed = isClosed;
module.exports.isUpcoming = isUpcoming;
