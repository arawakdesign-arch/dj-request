const express  = require('express');
const multer   = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { validateDisplayName } = require('../lib/moderation');
const DjProfileSchema = require('../public/js/dj-profile-schema');
const { randomUUID } = require('node:crypto');
const { isClosed, isUpcoming } = require('./events');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function isMissingUpcomingEventsColumn(error) {
  return error && (error.code === '42703' || /upcoming_events/i.test(error.message || ''));
}

// ── Soirées où je suis dans le line-up (DJ inscrit sur Pull up) ───────
// Permet d'entrer administrer la soirée avec son propre compte, sans
// connaître le mot de passe partagé (cf. isLineupMember côté middleware).
router.get('/dj/my-events', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('events').select('id, name, created_at, scheduled_at, ended_at, lineup')
    .eq('is_active', true);
  if (error) return res.status(500).json({ error: error.message });
  const mine = (data || [])
    .filter(ev => Array.isArray(ev.lineup) && ev.lineup.some(dj => dj.type === 'app' && dj.id === req.user.id))
    .map(ev => ({ id: ev.id, name: ev.name, closed: isClosed(ev.created_at, ev.scheduled_at, ev.ended_at), upcoming: isUpcoming(ev.scheduled_at) }))
    .filter(ev => !ev.closed);
  res.json(mine);
});

// ── Mon profil DJ (édition) ─────────────────────────────────────────
router.get('/dj/profile', requireAuth, async (req, res) => {
  const { data } = await supabase.from('dj_profiles').select('*').eq('id', req.user.id).single();
  res.json(data || {});
});

router.post('/dj/profile', requireAuth, async (req, res) => {
  const { data: existing, error: readError } = await supabase.from('dj_profiles').select('photo_url, gallery').eq('id', req.user.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'Impossible de charger le profil. Vérifie la migration des profils DJ.' });
  const { value, errors } = DjProfileSchema.validate(req.body, existing?.photo_url);
  const nameCheck = validateDisplayName(value.stage_name || '');
  if (!nameCheck.ok) errors.stage_name = nameCheck.reason;
  const eventFlyerPrefix = supabase.storage.from('profile-photos').getPublicUrl(`dj/${req.user.id}/event-flyer-`).data.publicUrl;
  if (value.upcoming_events?.some(event => !event.flyer_url?.startsWith(eventFlyerPrefix))) errors.upcoming_events = 'Charge le flyer depuis ton profil DJ.';
  if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
  // Only retain gallery images previously uploaded by this user.
  const gallery = req.body.gallery === undefined ? (existing?.gallery || []) : req.body.gallery;
  if (!Array.isArray(gallery) || gallery.length > 6 || new Set(gallery).size !== gallery.length || gallery.some(url => !(existing?.gallery || []).includes(url))) {
    return res.status(400).json({ error: 'Galerie invalide : 6 photos maximum, importées depuis ton compte.' });
  }
  const updates = { ...value, id: req.user.id, updated_at: new Date().toISOString() };
  if (typeof req.body.available === 'boolean') updates.available = req.body.available;

  // Une chaîne vide veut dire "champ pas encore rempli", pas "je veux une URL
  // vide" — sinon enregistrer le reste du profil avant d'avoir choisi une
  // adresse de page bloquerait toute la sauvegarde avec "URL invalide".
  if (req.body.slug !== undefined && req.body.slug !== '') {
    const clean = slugify(req.body.slug);
    if (!clean) return res.status(400).json({ error: 'URL invalide' });
    const [{ data: djTaken }, { data: orgaTaken }] = await Promise.all([
      supabase.from('dj_profiles').select('id').eq('slug', clean).maybeSingle(),
      supabase.from('organizer_pages').select('owner_id').eq('slug', clean).maybeSingle(),
    ]);
    if ((djTaken && djTaken.id !== req.user.id) || orgaTaken) return res.status(409).json({ error: 'Cette adresse est déjà prise.' });
    updates.slug = clean;
  }

  let { data, error } = await supabase.from('dj_profiles').upsert(updates).select().single();
  if (isMissingUpcomingEventsColumn(error)) {
    if (value.upcoming_events?.length) {
      return res.status(500).json({ error: 'Migration Supabase manquante : exécute supabase/migration-add-dj-upcoming-events.sql pour enregistrer les soirées à venir.' });
    }
    const fallbackUpdates = { ...updates };
    delete fallbackUpdates.upcoming_events;
    ({ data, error } = await supabase.from('dj_profiles').upsert(fallbackUpdates).select().single());
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Recherche de DJ inscrits (line-up d'une soirée) — déclarée avant
// /dj/profile/:id pour éviter qu'Express n'intercepte "search" comme id.
router.get('/dj/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  const { data, error } = await supabase
    .from('dj_profiles')
    .select('id, stage_name, photo_url, cover_avatar')
    .not('stage_name', 'is', null)
    .ilike('stage_name', `%${q}%`)
    .limit(10);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Upload photo de profil DJ ────────────────────────────────────────
router.post('/dj/profile/photo', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pas de fichier' });

  let buffer;
  try {
    const sharp = require('sharp');
    buffer = await sharp(req.file.buffer)
      .rotate()
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
  } catch(e) { return res.status(400).json({ error: 'Fichier image invalide' }); }

  const fileName = `dj/${req.user.id}/avatar.jpg`;
  const { error } = await supabase.storage.from('profile-photos').upload(fileName, buffer, {
    contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(fileName);
  const photoUrl = publicUrl + '?v=' + Date.now();
  const { error: dbError } = await supabase.from('dj_profiles').upsert({ id: req.user.id, photo_url: photoUrl, updated_at: new Date().toISOString() });
  if (dbError) { console.error('[dj profile photo] échec écriture DB —', req.user.id, dbError.message); return res.status(500).json({ error: dbError.message }); }
  res.json({ url: photoUrl });
});

router.post('/dj/profile/event-flyer', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choisis un flyer.' });
  let buffer;
  try {
    buffer = await require('sharp')(req.file.buffer)
      .rotate()
      .resize(1200, 1500, { fit: 'cover', withoutEnlargement: false })
      .jpeg({ quality: 86, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
  } catch { return res.status(400).json({ error: 'Flyer invalide.' }); }
  const path = `dj/${req.user.id}/event-flyer-${randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('profile-photos').upload(path, buffer, {
    contentType: 'image/jpeg', cacheControl: '31536000',
  });
  if (error) return res.status(500).json({ error: 'Échec de l’envoi du flyer.' });
  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(path);
  res.json({ url: publicUrl });
});

router.post('/dj/profile/presskit-pdf', requireAuth, pdfUpload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choisis un fichier PDF.' });
  const isPdf = req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');
  if (!isPdf || req.file.buffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
    return res.status(400).json({ error: 'Le fichier doit être un PDF valide.' });
  }
  const path = `dj/${req.user.id}/presskit.pdf`;
  const { error } = await supabase.storage.from('profile-photos').upload(path, req.file.buffer, {
    contentType: 'application/pdf', cacheControl: '3600', upsert: true,
  });
  if (error) return res.status(500).json({ error: 'Échec de l’envoi du PDF.' });
  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(path);
  const pdfUrl = publicUrl + '?v=' + Date.now();
  const { error: dbError } = await supabase.from('dj_profiles').upsert({ id: req.user.id, presskit_pdf_url: pdfUrl, updated_at: new Date().toISOString() });
  if (isMissingUpcomingEventsColumn(dbError) || /presskit_pdf_url/i.test(dbError?.message || '')) {
    return res.status(500).json({ error: 'Migration Supabase manquante : ajoute la colonne presskit_pdf_url sur dj_profiles.' });
  }
  if (dbError) return res.status(500).json({ error: dbError.message });
  res.json({ url: pdfUrl });
});

// Add gallery images one at a time; the client serializes uploads.
router.post('/dj/profile/gallery', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choisis une image.' });
  const { data: profile, error: readError } = await supabase.from('dj_profiles').select('gallery').eq('id', req.user.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'Galerie indisponible. Vérifie la migration des profils DJ.' });
  const gallery = profile?.gallery || [];
  if (gallery.length >= 6) return res.status(400).json({ error: 'La galerie est limitée à 6 photos.' });
  let buffer;
  try { buffer = await require('sharp')(req.file.buffer).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer(); }
  catch { return res.status(400).json({error:'Image invalide.'}); }
  const path = `dj/${req.user.id}/gallery-${randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('profile-photos').upload(path, buffer, {contentType:'image/jpeg'});
  if (error) return res.status(500).json({error:'Échec de l’envoi de la photo.'});
  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(path);
  // Compare-and-swap prevents concurrent uploads from losing a photo or exceeding six.
  let write;
  if (profile) write = await supabase.from('dj_profiles').update({gallery:[...gallery,publicUrl],updated_at:new Date().toISOString()}).eq('id',req.user.id).eq('gallery',JSON.stringify(gallery)).select('gallery').maybeSingle();
  else write = await supabase.from('dj_profiles').insert({id:req.user.id,gallery:[publicUrl]}).select('gallery').single();
  if (write.error || !write.data) {
    await supabase.storage.from('profile-photos').remove([path]);
    return res.status(409).json({error:'La galerie a changé. Rouvre ton profil puis réessaie.'});
  }
  res.json({url:publicUrl,gallery:write.data.gallery});
});

router.delete('/dj/profile/gallery', requireAuth, async (req, res) => {
  const { data: profile, error } = await supabase.from('dj_profiles').select('gallery').eq('id',req.user.id).maybeSingle();
  if (error) return res.status(500).json({error:'Impossible de charger la galerie.'});
  const gallery = profile?.gallery || [];
  if (!gallery.includes(req.body.url)) return res.status(404).json({error:'Photo introuvable.'});
  const nextGallery = gallery.filter(url=>url!==req.body.url);
  const write = await supabase.from('dj_profiles').update({gallery:nextGallery,updated_at:new Date().toISOString()}).eq('id',req.user.id).eq('gallery',JSON.stringify(gallery)).select('gallery').maybeSingle();
  if (write.error || !write.data) return res.status(409).json({error:'La galerie a changé. Rouvre ton profil puis réessaie.'});
  // Remove only an object under this account's gallery prefix.
  const prefix = supabase.storage.from('profile-photos').getPublicUrl(`dj/${req.user.id}/`).data.publicUrl;
  if (typeof req.body.url === 'string' && req.body.url.startsWith(prefix+'gallery-')) {
    const path = `dj/${req.user.id}/`+req.body.url.slice(prefix.length);
    await supabase.storage.from('profile-photos').remove([path]);
  }
  res.json({gallery:nextGallery});
});

router.delete('/dj/profile/presskit-pdf', requireAuth, async (req, res) => {
  const { data: profile, error } = await supabase.from('dj_profiles').select('presskit_pdf_url').eq('id', req.user.id).maybeSingle();
  if (isMissingUpcomingEventsColumn(error) || /presskit_pdf_url/i.test(error?.message || '')) {
    return res.status(500).json({ error: 'Migration Supabase manquante : ajoute la colonne presskit_pdf_url sur dj_profiles.' });
  }
  if (error) return res.status(500).json({ error: 'Impossible de charger le PDF.' });
  const { error: dbError } = await supabase.from('dj_profiles').update({ presskit_pdf_url: null, updated_at: new Date().toISOString() }).eq('id', req.user.id);
  if (dbError) return res.status(500).json({ error: dbError.message });
  const prefix = supabase.storage.from('profile-photos').getPublicUrl(`dj/${req.user.id}/`).data.publicUrl;
  if (profile?.presskit_pdf_url?.startsWith(prefix + 'presskit.pdf')) {
    await supabase.storage.from('profile-photos').remove([`dj/${req.user.id}/presskit.pdf`]);
  }
  res.json({ url: '' });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?(req.path.includes('presskit-pdf')?'Le PDF doit faire moins de 10 Mo.':'Chaque image doit faire moins de 5 Mo.'):'Envoi de fichier invalide.'});
  next(err);
});

// ── Profil public (page press kit partageable, pull-up.live/mon-nom) ──
router.get('/dj/by-slug/:slug', async (req, res) => {
  const { data, error } = await supabase.from('dj_profiles').select('*').eq('slug', req.params.slug).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Profil DJ introuvable' });
  res.json(data);
});

// ── Profil public (page press kit partageable) ──────────────────────
router.get('/dj/profile/:id', async (req, res) => {
  const { data, error } = await supabase.from('dj_profiles').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Profil DJ introuvable' });
  res.json(data);
});

module.exports = router;
