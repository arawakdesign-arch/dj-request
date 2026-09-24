// DELETE /orga/events/past — vérifie que le flyer de chaque soirée passée
// est bien supprimé du stockage en plus de la ligne events elle-même
// (sinon les fichiers s'accumulent indéfiniment dans le bucket "flyers").
// Entièrement mocké.
const {test}=require('node:test');
const assert=require('node:assert/strict');

function makeSupabaseMock({ events }) {
  const removedFlyerPaths = [];
  const deletedEventIds = { value: null };
  return {
    removedFlyerPaths, deletedEventIds,
    from: (table) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: async () => ({ data: events, error: null }) }),
          delete: () => ({ in: async (col, ids) => { deletedEventIds.value = ids; return { data: null, error: null }; } }),
        };
      }
      throw new Error('unexpected table ' + table);
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => { if (bucket === 'flyers') removedFlyerPaths.push(...paths); return { data: null, error: null }; },
      }),
    },
  };
}

function loadOrgaRouter(mock) {
  for (const [path, exports] of [
    ['../../lib/supabase', mock],
    ['../../middleware/auth', { requireAuth: (req, res, next) => { req.user = { id: 'orga-1' }; next(); } }],
    ['../../routes/events', { isClosed: (createdAt) => createdAt < '2020-01-01', isUpcoming: () => false }],
  ]) {
    require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports };
  }
  delete require.cache[require.resolve('../../routes/orga')];
  return require('../../routes/orga');
}

function callRoute(router) {
  const layer = router.stack.find(l => l.route?.path === '/orga/events/past' && l.route.methods.delete);
  const handler = layer.route.stack.at(-1).handle;
  return new Promise((resolve) => {
    const res = { status() { return this; }, json: resolve };
    handler({ user: { id: 'orga-1' } }, res);
  });
}

test('clearing past events also deletes their flyer files from storage', async () => {
  const events = [
    { id: 'evt-old-1', created_at: '2019-01-01', scheduled_at: null, ended_at: null, flyer_url: 'https://x.supabase.co/storage/v1/object/public/flyers/evt-old-1/flyer.jpg' },
    { id: 'evt-old-2', created_at: '2019-06-01', scheduled_at: null, ended_at: null, flyer_url: null },
    { id: 'evt-recent', created_at: '2026-09-01', scheduled_at: null, ended_at: null, flyer_url: 'https://x.supabase.co/storage/v1/object/public/flyers/evt-recent/flyer.jpg' },
  ];
  const mock = makeSupabaseMock({ events });
  const router = loadOrgaRouter(mock);
  const body = await callRoute(router);

  assert.equal(body.deleted, 2, 'only the two past events are deleted, the recent one is left alone');
  assert.deepEqual(mock.removedFlyerPaths, ['evt-old-1/flyer.jpg'], 'only the past event that actually had a flyer gets its file removed');
  assert.deepEqual(mock.deletedEventIds.value, ['evt-old-1', 'evt-old-2']);
});

test('clearing past events with none eligible does not touch storage', async () => {
  const events = [{ id: 'evt-recent', created_at: '2026-09-01', scheduled_at: null, ended_at: null, flyer_url: 'https://x.supabase.co/storage/v1/object/public/flyers/evt-recent/flyer.jpg' }];
  const mock = makeSupabaseMock({ events });
  const router = loadOrgaRouter(mock);
  const body = await callRoute(router);
  assert.equal(body.deleted, 0);
  assert.deepEqual(mock.removedFlyerPaths, []);
});
