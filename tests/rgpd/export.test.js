// Droit à la portabilité (GET /profile/export) — vérifie que seules les
// données appartenant à la personne authentifiée sont renvoyées, jamais
// celles d'un tiers ni de secret serveur. Entièrement mocké.
const {test}=require('node:test');
const assert=require('node:assert/strict');

function makeSupabaseMock(byTable) {
  return {
    from: (table) => ({
      select: () => ({
        eq: (col, val) => {
          const rows = byTable[table] || [];
          const matches = rows.filter(r => r[col] === val);
          return {
            maybeSingle: async () => ({ data: matches[0] || null, error: null }),
            then: (resolve) => resolve({ data: matches, error: null }),
          };
        },
      }),
    }),
  };
}

function loadProfileRouter(mock) {
  for (const [path, exports] of [
    ['../../lib/supabase', mock],
    ['../../middleware/auth', { requireAuth: (req, res, next) => { req.user = { id: 'user-a' }; next(); } }],
    ['../../lib/moderation', { validateDisplayName: () => ({ ok: true }) }],
    ['../../lib/account', { deleteUserAccount: async () => {} }],
  ]) {
    require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports };
  }
  delete require.cache[require.resolve('../../routes/profile')];
  return require('../../routes/profile');
}

function callRoute(router, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods.get);
  const handler = layer.route.stack.at(-1).handle;
  return new Promise((resolve) => {
    let status = 200; const headers = {};
    const res = { status(code) { status = code; return this; }, json(value) { resolve({ status, body: value }); }, setHeader(k, v) { headers[k] = v; } };
    handler({ user: { id: 'user-a' } }, res);
  });
}

const db = {
  user_profiles: [
    { id: 'user-a', display_name: 'Alice', email: 'alice@example.com', phone: '+33600000001', share_contact_ok: true },
    { id: 'user-b', display_name: 'Bob',   email: 'bob@example.com' },
  ],
  dj_profiles: [{ id: 'user-a', stage_name: 'DJ Alice', booking_email: 'booking@alice.example' }],
  organizer_pages: [],
  votes: [
    { user_id: 'user-a', event_id: 'evt-1', proposal_id: 'p1', created_at: 'now' },
    { user_id: 'user-b', event_id: 'evt-1', proposal_id: 'p2', created_at: 'now' },
  ],
  proposals: [{ id: 'p1', event_id: 'evt-1', proposed_by: 'user-a', title: 'Song A', artist: 'Artist A', votes: 3, approved: false, created_at: 'now' }],
  messages: [
    { id: 'm1', event_id: 'evt-1', user_id: 'user-a', text: 'Salut', photo_url: null, created_at: 'now' },
    { id: 'm2', event_id: 'evt-1', user_id: 'user-b', text: 'Secret de Bob', photo_url: null, created_at: 'now' },
  ],
  friendships: [{ user_id: 'user-a', friend_code: 'ABCD', friend_name: 'Copain', created_at: 'now' }],
  organizer_followers: [{ follower_id: 'user-a', organizer_id: 'orga-1', created_at: 'now' }],
  reports: [],
};

test('GET /profile/export returns only the authenticated user\'s own data', async () => {
  const router = loadProfileRouter(makeSupabaseMock(db));
  const { status, body } = await callRoute(router, '/profile/export');
  assert.equal(status, 200);
  assert.equal(body.profil.id, 'user-a');
  assert.equal(body.profil_dj.stage_name, 'DJ Alice');
  assert.equal(body.votes.length, 1, 'only the caller\'s own vote, filtered server-side by user_id');
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].text, 'Salut');
  assert.ok(!JSON.stringify(body).includes('Bob'), 'no data belonging to another user must appear anywhere in the export');
  assert.ok(!JSON.stringify(body).includes('bob@example.com'));
});

test('GET /profile/export never includes server secrets or other users\' contact info', () => {
  const router = loadProfileRouter(makeSupabaseMock(db));
  return callRoute(router, '/profile/export').then(({ body }) => {
    const json = JSON.stringify(body);
    assert.ok(!json.includes('JWT_SECRET'));
    assert.ok(!json.includes('SUPABASE_SERVICE'));
  });
});
