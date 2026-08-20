// ══ MODÉRATION ═══════════════════════════════════════════════════════
// Filtre de pseudos (usurpation d'identité admin/staff + grossièretés) et
// de messages de chat (insultes). Résistant aux contournements courants :
// espacement des lettres, séparateurs, leetspeak, lettres répétées.
//
// Les mots courts (≤ 4 caractères, ex. "con", "cul", "tg") sont détectés en
// mot entier seulement — en sous-chaîne ils bloqueraient des mots innocents
// ("reculer", "calcul", "consultant"...). Les mots plus longs ("connard",
// "salope"...) sont eux détectés même séparés par des espaces/points/tirets
// ("c o n n a r d"), le risque de faux positif étant quasi nul à cette longueur.

const LEET_MAP = { '0':'o', '1':'i', '3':'e', '4':'a', '5':'s', '7':'t' };
const ACCENTS_RE = /[̀-ͯ]/g;

// Normalisation "légère" : accents/leet/répétitions neutralisés, mais les
// séparateurs (espaces, ponctuation) sont conservés comme frontières de mot.
function lightNormalize(s) {
  let t = String(s ?? '').toLowerCase().normalize('NFD').replace(ACCENTS_RE, '');
  t = t.replace(/[013457]/g, c => LEET_MAP[c] || c);
  t = t.replace(/(.)\1+/g, '$1');
  return t;
}

// Normalisation "agressive" : en plus, tous les séparateurs sont retirés —
// détecte "c.o.n.n.a.r.d" ou "p_u_t_e", mais ne doit servir qu'aux mots
// assez longs pour ne pas matcher un fragment de mot innocent.
function hardNormalize(s) {
  return lightNormalize(s).replace(/[\s.\-_]+/g, '');
}

const RESERVED_NAMES = [
  'admin', 'administrator', 'administrateur',
  'mod', 'modo', 'moderator', 'moderateur',
  'support', 'support officiel', 'equipe', 'staff',
  'officiel', 'official',
  'police', 'securite', 'security',
  'organisateur', 'organizer', 'dj officiel',
  'pull up', 'pullup', 'pull up admin', 'pullup admin', 'pull up support', 'pullup support',
];

const BANNED_WORDS = [
  'connard', 'connasse', 'con', 'conne', 'batard',
  'salope', 'pute', 'petasse', 'enfoire', 'enfoiree',
  'trou du cul', 'fils de pute', 'fdp', 'ntm', 'nique ta mere',
  'va te faire foutre', 'ferme ta gueule', 'tg',
  'debile', 'abruti', 'abrutie', 'bouffon', 'bouffonne', 'merde',
  'bite', 'chatte', 'couille', 'couilles', 'cul',
  'baise', 'baiser', 'niquer', 'suce', 'sucer',
  'branle', 'branleur', 'branleuse', 'porno', 'porn', 'sex', 'sexe',
];

function buildMatchers(words) {
  return words.map(w => {
    const canon = hardNormalize(w);
    const short = canon.length <= 4;
    return {
      short,
      // Mots courts : uniquement en mot entier (limites \b), sur le texte
      // légèrement normalisé (espaces conservés).
      wordRe: short ? new RegExp('(^|[^a-z0-9])' + canon.split('').join('[^a-z0-9]*') + '($|[^a-z0-9])') : null,
      canon, // mots longs : sous-chaîne sur le texte totalement normalisé
    };
  });
}

const RESERVED_MATCHERS = buildMatchers(RESERVED_NAMES);
const BANNED_MATCHERS   = buildMatchers(BANNED_WORDS);

function findMatch(text, matchers) {
  const light = lightNormalize(text);
  const hard  = hardNormalize(text);
  return matchers.find(m => m.short ? m.wordRe.test(light) : hard.includes(m.canon)) || null;
}

// Pseudo/nom de scène : ni usurpation, ni grossièreté.
function validateDisplayName(name) {
  if (!name) return { ok: true };
  if (findMatch(name, RESERVED_MATCHERS)) return { ok: false, reason: 'Ce nom est réservé — choisis-en un autre.' };
  if (findMatch(name, BANNED_MATCHERS))   return { ok: false, reason: "Ce nom n'est pas autorisé — choisis-en un autre." };
  return { ok: true };
}

// Message de chat : grossièretés seulement (pas la liste "réservés").
function containsProfanity(text) {
  return !!findMatch(text, BANNED_MATCHERS);
}

module.exports = { validateDisplayName, containsProfanity };
