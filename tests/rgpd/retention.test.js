// Purge des comptes inactifs (lib/retention.js) — entièrement mockée, aucun
// appel réseau ni base Supabase réelle.
const {test}=require('node:test');
const assert=require('node:assert/strict');

// auth.users factice avec pagination par offset qui reflète vraiment les
// suppressions (comme Supabase) — c'est ce qui permet de reproduire le bug
// de comptes sautés si le correctif de pagination régresse.
function makeAuthMock(initialUsers) {
  let users = [...initialUsers];
  const deleted = [];
  return {
    listUsers: async ({ page, perPage }) => {
      const start = (page - 1) * perPage;
      return { data: { users: users.slice(start, start + perPage) }, error: null };
    },
    deleteUser: async (id) => { users = users.filter(u => u.id !== id); deleted.push(id); return { error: null }; },
    deletedIds: deleted,
  };
}

// Table retention_runs factice : verrou + journal réels (pas juste des
// stubs) pour pouvoir tester la concurrence.
function makeRetentionRunsTable() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    chain(action) {
      let filters = {};
      const b = {
        select: () => b,
        eq: (col, val) => { filters[col] = val; return b; },
        gt: (col, val) => { filters[`${col}>`] = val; return b; },
        limit: (n) => ({ then: (resolve) => resolve({
          data: rows.filter(r => Object.entries(filters).every(([k, v]) => k.endsWith('>') ? r[k.slice(0, -1)] > v : r[k] === v)).slice(0, n),
          error: null,
        }) }),
        insert: (value) => {
          const row = { id: nextId++, started_at: new Date().toISOString(), status: 'running', ...value };
          rows.push(row);
          return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) };
        },
        update: (value) => ({ eq: async (col, val) => { const row = rows.find(r => r[col] === val); if (row) Object.assign(row, value); return { data: null, error: null }; } }),
      };
      return b;
    },
  };
}

function makeSupabaseMock({ authUsers = [], guestProfiles = [] } = {}) {
  const auth = makeAuthMock(authUsers);
  const retentionRuns = makeRetentionRunsTable();
  const deletedGuestIds = [];
  return {
    auth: { admin: auth },
    _retentionRuns: retentionRuns,
    _deletedGuestIds: deletedGuestIds,
    from: (table) => {
      if (table === 'retention_runs') return retentionRuns.chain();
      // Générique pour tout le reste (appelé en interne par deleteUserAccount
      // pour chaque compte : votes, messages, dj_profiles, user_profiles...) —
      // no-op réussi par défaut. user_profiles sert aussi à la requête de
      // purge des invités historiques (.like('id','guest_%').lt('updated_at')),
      // câblée séparément ici pour renvoyer guestProfiles.
      const b = {
        select: () => b, eq: () => b, not: () => b, like: () => b, delete: () => b, update: () => b, upsert: () => b,
        lt: () => table === 'user_profiles'
          ? { then: (resolve) => resolve({ data: guestProfiles, error: null }) }
          : { then: (resolve) => resolve({ data: null, error: null }) },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (resolve) => resolve({ data: null, error: null }),
      };
      return b;
    },
    storage: { from: () => ({ remove: async () => ({ data: null, error: null }) }) },
  };
}

function withMockRetention(mockOptions, fn) {
  const supabasePath = require.resolve('../../lib/supabase');
  const mock = makeSupabaseMock(mockOptions);
  const originalSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: mock };
  delete require.cache[require.resolve('../../lib/account')];
  delete require.cache[require.resolve('../../lib/retention')];
  const { purgeInactiveAccounts } = require('../../lib/retention');
  return Promise.resolve(fn(purgeInactiveAccounts, mock)).finally(() => {
    if (originalSupabase) require.cache[supabasePath] = originalSupabase; else delete require.cache[supabasePath];
    delete require.cache[require.resolve('../../lib/account')];
    delete require.cache[require.resolve('../../lib/retention')];
  });
}

const OLD = '2000-01-01T00:00:00.000Z'; // toujours avant le cutoff de 24 mois

test('purgeInactiveAccounts does not skip accounts when deletions shift pagination offsets', () => {
  // 210 comptes éligibles avec perPage=200 codé en dur : sans le correctif,
  // la 2e page (offset 200) serait mal alignée après les suppressions de la
  // 1re page et sauterait des comptes.
  const users = Array.from({ length: 210 }, (_, i) => ({ id: `u${i}`, last_sign_in_at: OLD, created_at: OLD }));
  return withMockRetention({ authUsers: users }, async (purgeInactiveAccounts, mock) => {
    const purged = await purgeInactiveAccounts();
    assert.equal(purged, 210, 'every eligible account must be purged, none skipped by the pagination shift');
    assert.equal(mock.auth.admin.deletedIds.length, 210);
  });
});

test('purgeInactiveAccounts leaves active accounts untouched', () => {
  const users = [
    { id: 'old1', last_sign_in_at: OLD, created_at: OLD },
    { id: 'recent1', last_sign_in_at: new Date().toISOString(), created_at: OLD },
  ];
  return withMockRetention({ authUsers: users }, async (purgeInactiveAccounts, mock) => {
    await purgeInactiveAccounts();
    assert.deepEqual(mock.auth.admin.deletedIds, ['old1']);
  });
});

test('purgeInactiveAccounts records a success run in retention_runs with the purged count', () => {
  const users = [{ id: 'old1', last_sign_in_at: OLD, created_at: OLD }];
  return withMockRetention({ authUsers: users }, async (purgeInactiveAccounts, mock) => {
    await purgeInactiveAccounts();
    assert.equal(mock._retentionRuns.rows.length, 1);
    assert.equal(mock._retentionRuns.rows[0].status, 'success');
    assert.equal(mock._retentionRuns.rows[0].purged_count, 1);
  });
});

test('purgeInactiveAccounts refuses to run concurrently while a run is already in progress', () => {
  return withMockRetention({ authUsers: [] }, async (purgeInactiveAccounts, mock) => {
    // Simule une purge déjà en cours (verrou posé, jamais relâché).
    mock._retentionRuns.rows.push({ id: 999, started_at: new Date().toISOString(), status: 'running' });
    const purged = await purgeInactiveAccounts();
    assert.equal(purged, 0, 'a concurrent run must be skipped, not executed');
    assert.equal(mock._retentionRuns.rows.length, 1, 'no second run row should have been created');
  });
});

test('purgeInactiveAccounts proceeds when the only running row is stale (older than the lock timeout)', () => {
  return withMockRetention({ authUsers: [] }, async (purgeInactiveAccounts, mock) => {
    const staleDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h — au-delà du verrou d'1h
    mock._retentionRuns.rows.push({ id: 998, started_at: staleDate, status: 'running' });
    await purgeInactiveAccounts();
    const newRun = mock._retentionRuns.rows.find(r => r.id !== 998);
    assert.ok(newRun, 'a stale lock must not block a new run');
    assert.equal(newRun.status, 'success');
  });
});

test('purgeInactiveAccounts also purges stale guest_* rows without a Supabase Auth session', () => {
  return withMockRetention({ authUsers: [], guestProfiles: [{ id: 'guest_abc' }] }, async (purgeInactiveAccounts) => {
    const purged = await purgeInactiveAccounts();
    assert.equal(purged, 1);
  });
});
