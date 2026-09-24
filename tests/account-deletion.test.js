// Suppression de compte (lib/account.js) — entièrement mockée, aucun appel
// réseau ni base Supabase réelle. Suit le même style de mock que
// tests/dj-profile.test.js (injection via require.cache).
const {test}=require('node:test');
const assert=require('node:assert/strict');

// Construit un client Supabase factice : results[table] fournit la réponse
// {data,error} renvoyée par .maybeSingle()/.single()/l'attente directe de la
// chaîne (delete/update), quelle que soit la profondeur des .eq()/.not()
// intermédiaires — suffisant ici car chaque table n'est utilisée qu'une
// seule fois par appel à deleteUserAccount().
function makeSupabaseMock(results = {}) {
  const calls = [];
  function chain(table) {
    const resolved = () => Promise.resolve(results[table] ?? { data: null, error: null });
    const b = {
      select: () => b, eq: () => b, not: () => b, gt: () => b, lt: () => b, like: () => b,
      limit: () => b, order: () => b,
      maybeSingle: () => resolved(),
      single: () => resolved(),
      delete: () => { calls.push({ table, op: 'delete' }); return b; },
      update: (v) => { calls.push({ table, op: 'update', value: v }); return b; },
      insert: (v) => { calls.push({ table, op: 'insert', value: v }); return { select: () => ({ single: () => resolved() }) }; },
      upsert: (v) => { calls.push({ table, op: 'upsert', value: v }); return b; },
      then: (resolve, reject) => resolved().then(resolve, reject),
    };
    return b;
  }
  const removedFiles = [];
  const deletedAuthUsers = [];
  return {
    calls, removedFiles, deletedAuthUsers,
    from: (table) => chain(table),
    storage: { from: (bucket) => ({ remove: async (paths) => { removedFiles.push(...paths.map(p => `${bucket}/${p}`)); return results[`storage:${bucket}`] ?? { data: null, error: null }; } }) },
    auth: { admin: { deleteUser: async (id) => { deletedAuthUsers.push(id); return results.deleteUser ?? { error: null }; } } },
  };
}

function withMockSupabase(results, fn) {
  const path = require.resolve('../lib/supabase');
  const mock = makeSupabaseMock(results);
  const original = require.cache[path];
  require.cache[path] = { id: path, filename: path, loaded: true, exports: mock };
  delete require.cache[require.resolve('../lib/account')];
  const { deleteUserAccount } = require('../lib/account');
  return Promise.resolve(fn(deleteUserAccount, mock)).finally(() => {
    if (original) require.cache[path] = original; else delete require.cache[path];
    delete require.cache[require.resolve('../lib/account')];
  });
}

test('deleteUserAccount removes DJ gallery photos from storage, not just the avatar', () => withMockSupabase({
  dj_profiles: { data: { photo_url: 'https://x.supabase.co/storage/v1/object/public/profile-photos/dj/u1/avatar.jpg', gallery: [
    'https://x.supabase.co/storage/v1/object/public/profile-photos/dj/u1/gallery-a.jpg',
    'https://x.supabase.co/storage/v1/object/public/profile-photos/dj/u1/gallery-b.jpg',
  ] }, error: null },
}, async (deleteUserAccount, mock) => {
  await deleteUserAccount('u1');
  assert.ok(mock.removedFiles.includes('profile-photos/dj/u1/avatar.jpg'), 'avatar removed');
  assert.ok(mock.removedFiles.includes('profile-photos/dj/u1/gallery-a.jpg'), 'gallery photo a removed');
  assert.ok(mock.removedFiles.includes('profile-photos/dj/u1/gallery-b.jpg'), 'gallery photo b removed');
}));

test('deleteUserAccount anonymizes messages and proposals instead of deleting the rows', () => withMockSupabase({}, async (deleteUserAccount, mock) => {
  await deleteUserAccount('u1');
  const proposalsUpdate = mock.calls.find(c => c.table === 'proposals' && c.op === 'update');
  const messagesUpdate  = mock.calls.find(c => c.table === 'messages'  && c.op === 'update');
  assert.ok(proposalsUpdate, 'proposals is updated, not deleted');
  assert.equal(proposalsUpdate.value.proposed_by, null);
  assert.ok(messagesUpdate, 'messages is updated, not deleted');
  assert.equal(messagesUpdate.value.user_id, null);
  assert.equal(messagesUpdate.value.text, null);
  assert.equal(messagesUpdate.value.photo_url, null);
  assert.equal(mock.calls.some(c => c.table === 'proposals' && c.op === 'delete'), false);
  assert.equal(mock.calls.some(c => c.table === 'messages'  && c.op === 'delete'), false);
}));

test('deleteUserAccount deletes rows that belong only to this person', () => withMockSupabase({}, async (deleteUserAccount, mock) => {
  await deleteUserAccount('u1');
  for (const table of ['votes', 'locations', 'blindtest_scores', 'friendships', 'organizer_followers', 'message_reactions', 'reports', 'user_profiles', 'dj_profiles', 'organizer_pages']) {
    assert.ok(mock.calls.some(c => c.table === table && c.op === 'delete'), `${table} should be deleted`);
  }
}));

test('deleteUserAccount throws and never deletes the auth user when a step fails', () => withMockSupabase({
  votes: { data: null, error: { message: 'boom' } },
}, async (deleteUserAccount, mock) => {
  await assert.rejects(() => deleteUserAccount('u1'), /Suppression incomplète/);
  assert.equal(mock.deletedAuthUsers.length, 0, 'auth user must not be deleted after a partial failure');
}));

test('deleteUserAccount never calls auth.admin.deleteUser for guest_* ids', () => withMockSupabase({}, async (deleteUserAccount, mock) => {
  await deleteUserAccount('guest_abc123');
  assert.equal(mock.deletedAuthUsers.length, 0);
}));

test('deleteUserAccount deletes the auth user only once every step has succeeded', () => withMockSupabase({}, async (deleteUserAccount, mock) => {
  await deleteUserAccount('u1');
  assert.deepEqual(mock.deletedAuthUsers, ['u1']);
}));
