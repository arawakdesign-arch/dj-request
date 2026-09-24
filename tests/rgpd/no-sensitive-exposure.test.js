// Vérifie qu'aucune donnée sensible (mot de passe de soirée haché,
// identifiant interne owner_id) ne peut jamais être obtenue via l'API
// publique GET /events/:id. Entièrement mocké.
const {test}=require('node:test');
const assert=require('node:assert/strict');

// routes/events.js requiert lib/jwt.js, qui refuse de démarrer sans
// JWT_SECRET — sans incidence ici, aucun token n'est réellement signé/vérifié
// dans ce test.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used';

function makeSupabaseMock(eventRow) {
  return {
    from: (table) => {
      if (table === 'events') {
        return {
          select(cols) {
            return {
              eq() {
                return {
                  async single() {
                    // Simule le comportement réel de Supabase : seules les
                    // colonnes listées dans .select(...) sont renvoyées. Si le
                    // code venait à demander "password" par erreur, ce mock le
                    // renverrait aussi — c'est justement ce que le test surveille.
                    const requested = cols.split(',').map(c => c.trim());
                    const projected = {};
                    requested.forEach(c => { if (c in eventRow) projected[c] = eventRow[c]; });
                    return { data: projected, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'organizer_pages') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      if (table === 'dj_profiles') return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      throw new Error('unexpected table ' + table);
    },
  };
}

function loadEventsRouter(mock) {
  for (const [path, exports] of [
    ['../../lib/supabase', mock],
    ['../../middleware/auth', { requireAuth: (req, res, next) => next(), requireOrganizer: (req, res, next) => next() }],
  ]) {
    require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports };
  }
  delete require.cache[require.resolve('../../routes/events')];
  return require('../../routes/events');
}

test('GET /events/:id never returns the event password hash or owner_id, even if present in the row', async () => {
  const eventRow = {
    id: 'evt-1', name: 'Ma soirée', club_name: 'Le Club', orga: 'Orga', address: '', hours: '',
    lineup: [], flyer_url: null, is_active: true, created_at: '2026-01-01', scheduled_at: null, ended_at: null, updated_at: '2026-01-01',
    owner_id: 'secret-owner-uuid', password: '$2b$10$reallyHashedPassword',
  };
  const router = loadEventsRouter(makeSupabaseMock(eventRow));
  const layer = router.stack.find(l => l.route?.path === '/events/:id' && l.route.methods.get);
  const handler = layer.route.stack.at(-1).handle;
  const body = await new Promise((resolve) => {
    const res = { status() { return this; }, json: resolve };
    handler({ params: { id: 'evt-1' } }, res);
  });
  assert.equal(body.password, undefined, 'the bcrypt hash must never reach the client');
  assert.equal(body.owner_id, undefined, 'the internal owner id must never reach the client');
  assert.equal(body.name, 'Ma soirée');
});

test('the SELECT statement itself never lists the password column (defense in depth)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../routes/events.js'), 'utf8');
  const match = src.match(/\.from\('events'\)\s*\n?\s*\.select\('([^']+)'\)\s*\n?\s*\.eq\('id', req\.params\.id\)\.single\(\)/);
  assert.ok(match, 'could not locate the GET /events/:id select() call to inspect');
  assert.ok(!match[1].split(',').map(c => c.trim()).includes('password'), 'password must not be in the select() column list for the public event endpoint');
});
