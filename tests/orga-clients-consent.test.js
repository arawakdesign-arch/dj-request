// Export clients organisateur (routes/orga.js) — vérifie que l'email et le
// téléphone ne sortent jamais sans le consentement explicite (share_contact_ok),
// y compris dans le CSV, alors que le nom affiché sort toujours (comportement
// voulu, documenté dans la politique de confidentialité). Entièrement mocké.
const {test}=require('node:test');
const assert=require('node:assert/strict');

function makeSupabaseMock({ events, votes, proposals, profiles }) {
  return {
    from: (table) => {
      if (table === 'events')      return { select: () => ({ eq: async () => ({ data: events, error: null }) }) };
      if (table === 'votes')       return { select: () => ({ in: async () => ({ data: votes, error: null }) }) };
      if (table === 'proposals')   return { select: () => ({ in: async () => ({ data: proposals, error: null }) }) };
      if (table === 'user_profiles') return { select: () => ({ in: async () => ({ data: profiles, error: null }) }) };
      throw new Error('unexpected table ' + table);
    },
  };
}

function loadOrgaRouter(mock) {
  for (const [path, exports] of [
    ['../lib/supabase', mock],
    ['../middleware/auth', { requireAuth: (req, res, next) => { req.user = { id: 'orga-1' }; next(); }, requireOrganizer: (req, res, next) => next() }],
    ['../routes/events', { isClosed: () => false, isUpcoming: () => false }],
  ]) {
    require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports };
  }
  delete require.cache[require.resolve('../routes/orga')];
  return require('../routes/orga');
}

function callRoute(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  const handler = layer.route.stack.at(-1).handle;
  return new Promise((resolveTest) => {
    let status = 200; const headers = {};
    const res = {
      status(code) { status = code; return this; },
      json(value) { resolveTest({ status, body: value }); },
      setHeader(k, v) { headers[k] = v; },
      send(body) { resolveTest({ status, body, headers }); },
    };
    handler({ user: { id: 'orga-1' } }, res);
  });
}

const scenario = {
  events: [{ id: 'evt-1' }],
  votes: [{ user_id: 'voter-consented' }, { user_id: 'voter-refused' }],
  proposals: [],
  profiles: [
    { id: 'voter-consented', display_name: 'Alice', email: 'alice@example.com', phone: '+33600000001', share_contact_ok: true },
    { id: 'voter-refused',   display_name: 'Bob',   email: 'bob@example.com',   phone: '+33600000002', share_contact_ok: false },
  ],
};

test('GET /orga/clients exposes email/phone only when share_contact_ok is true, but always exposes the display name', async () => {
  const router = loadOrgaRouter(makeSupabaseMock(scenario));
  const { status, body } = await callRoute(router, 'get', '/orga/clients');
  assert.equal(status, 200);
  const alice = body.find(c => c.id === 'voter-consented');
  const bob   = body.find(c => c.id === 'voter-refused');
  assert.equal(alice.name, 'Alice'); assert.equal(alice.email, 'alice@example.com'); assert.equal(alice.phone, '+33600000001');
  assert.equal(bob.name, 'Bob', 'display name is shown even without contact-sharing consent');
  assert.equal(bob.email, '', 'email must be withheld without explicit consent');
  assert.equal(bob.phone, '', 'phone must be withheld without explicit consent');
});

test('GET /orga/clients/export.csv applies the same consent gating as the JSON endpoint', async () => {
  const router = loadOrgaRouter(makeSupabaseMock(scenario));
  const { status, body } = await callRoute(router, 'get', '/orga/clients/export.csv');
  assert.equal(status, 200);
  assert.ok(body.includes('Alice'));
  assert.ok(body.includes('alice@example.com'));
  assert.ok(body.includes('+33600000001'));
  assert.ok(body.includes('Bob'));
  assert.ok(!body.includes('bob@example.com'), 'CSV must not leak the email of a voter who did not consent');
  assert.ok(!body.includes('+33600000002'), 'CSV must not leak the phone of a voter who did not consent');
});

test('collectClients returns an empty list when the organizer owns no event', async () => {
  const router = loadOrgaRouter(makeSupabaseMock({ ...scenario, events: [] }));
  const { status, body } = await callRoute(router, 'get', '/orga/clients');
  assert.equal(status, 200);
  assert.deepEqual(body, []);
});
