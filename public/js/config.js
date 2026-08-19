// ══ CONFIG ══════════════════════════════════════════════════════════
// SUPABASE_URL et SUPABASE_ANON sont chargés dynamiquement au démarrage
// depuis GET /api/config/public — ne jamais hardcoder ces valeurs ici.

const CLUB_INFO = {
  name:      '',
  address:   '',
  logo:      '🎵',
  instagram: '',
};

const CAT = [
  {id:'bl',  n:'Blinding Lights',           a:'The Weeknd',              e:'🔴', c:'#E040FB'},
  {id:'omt', n:'One More Time',             a:'Daft Punk',               e:'🤖', c:'#3B82F6'},
  {id:'ti',  n:'Titanium',                  a:'David Guetta ft. Sia',    e:'💎', c:'#F59E0B'},
  {id:'lv',  n:'Levels',                    a:'Avicii',                  e:'✨', c:'#10B981'},
  {id:'wu',  n:'Wake Me Up',                a:'Avicii',                  e:'☀️', c:'#FBBF24'},
  {id:'an',  n:'Animals',                   a:'Martin Garrix',           e:'🐾', c:'#F43F5E'},
  {id:'atw', n:'Around The World',          a:'Daft Punk',               e:'🌍', c:'#06B6D4'},
  {id:'gs',  n:'Gangnam Style',             a:'PSY',                     e:'🕺', c:'#A855F7'},
  {id:'it',  n:'In The Air Tonight',        a:'Phil Collins',            e:'🥁', c:'#F97316'},
  {id:'sm',  n:'Smells Like Teen Spirit',   a:'Nirvana',                 e:'🎸', c:'#8B5CF6'},
  {id:'br',  n:'Bohemian Rhapsody',         a:'Queen',                   e:'👑', c:'#EC4899'},
  {id:'gl',  n:'Get Lucky',                 a:'Daft Punk ft. Pharrell',  e:'🍀', c:'#10B981'},
  {id:'st',  n:'Strobe',                    a:'Deadmau5',                e:'⚡', c:'#6366F1'},
  {id:'np',  n:'One Dance',                 a:'Drake',                   e:'🎭', c:'#F59E0B'},
  {id:'dc',  n:"Don't You Worry Child",     a:'Swedish House Mafia',     e:'🙏', c:'#22D3EE'},
  {id:'fc',  n:'Feel So Close',             a:'Calvin Harris',           e:'💙', c:'#3B82F6'},
  {id:'sg',  n:'Sunflower',                 a:'Post Malone',             e:'🌻', c:'#F59E0B'},
  {id:'sh',  n:'Shake It Off',              a:'Taylor Swift',            e:'🩷', c:'#EC4899'},
];

// Fallback utilisé uniquement si /profile/stats n'a pas encore répondu —
// vide pour ne pas afficher de fausses statistiques à un nouvel utilisateur.
const USER_EVENTS = [];

const LEVELS = [
  {name:'Découvreur', ico:'🌱', min:0},
  {name:'Fan',        ico:'🎵', color:'#3B82F6', min:50},
  {name:'Actif',      ico:'🔥', color:'#8B5CF6', min:150},
  {name:'VIP',        ico:'💎', color:'#EC4899', min:350},
  {name:'Légende',    ico:'👑', color:'#F59E0B', min:700},
];

const ACHIEVEMENTS = [
  {ico:'🗳️', n:'Premier vote',  d:'Voter pour la 1ère fois',   ok:true},
  {ico:'🎤', n:'Proposeur',     d:'Proposer 3 morceaux',        ok:true},
  {ico:'🏆', n:'MVP Soirée',    d:'Morceau proposé joué',       ok:true},
  {ico:'🔥', n:'En feu',        d:'5 votes en 1 soirée',        ok:true},
  {ico:'⭐', n:'Régulier',      d:'3 soirées minimum',          ok:true},
  {ico:'🎧', n:'Mélomane',      d:'5 soirées minimum',          ok:false},
  {ico:'👑', n:'Légende',       d:'Atteindre 700 pts',          ok:false},
  {ico:'🚀', n:'Premier',       d:"1er votant d'une soirée",    ok:true},
  {ico:'💎', n:'VIP',           d:'Atteindre niveau 4',         ok:false},
];
