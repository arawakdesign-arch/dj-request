// Vérification STATIQUE des migrations RLS critiques : lit les fichiers SQL
// eux-mêmes (aucune connexion réseau, aucune base réelle) et s'assure que
// les correctifs de verrouillage déjà appliqués en production existent
// toujours avec le contenu attendu.
//
// LIMITE IMPORTANTE, assumée : ceci vérifie que CES fichiers n'ont pas été
// altérés ou supprimés, pas que Supabase applique réellement ces policies
// aujourd'hui (une migration ultérieure pourrait en théorie les annuler à
// nouveau). La vérification qui fait foi est le script SQL
// supabase/verify-rls.sql, à exécuter directement dans Supabase.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function readMigration(name) {
  return fs.readFileSync(path.join(__dirname, '../../supabase', name), 'utf8');
}

test('events.password/owner_id : la lecture publique de la table events est fermée', () => {
  const sql = readMigration('migration-lock-events-rls.sql');
  assert.match(sql, /CREATE POLICY "events_read" ON events FOR SELECT USING \(false\)/);
});

test('user_profiles : la lecture publique (y compris friend_code) est fermée', () => {
  const sql = readMigration('migration-lock-user-profiles-rls.sql');
  assert.match(sql, /CREATE POLICY "user_profiles_read" ON user_profiles FOR SELECT USING \(false\)/);
});

test('votes/locations/blindtest_scores : la lecture publique est fermée', () => {
  const sql = readMigration('migration-fix-votes-locations-scores-rls.sql');
  assert.match(sql, /CREATE POLICY "votes_read" ON votes FOR SELECT USING \(false\)/);
  assert.match(sql, /CREATE POLICY "loc_read" ON locations FOR SELECT USING \(false\)/);
  assert.match(sql, /CREATE POLICY "scores_read" ON blindtest_scores FOR SELECT USING \(false\)/);
});

test('reports : jamais lisible publiquement, et user_profiles limité aux colonnes non sensibles', () => {
  const sql = readMigration('migration-fix-public-data-exposure.sql');
  assert.match(sql, /CREATE POLICY "reports_read" ON reports FOR SELECT USING \(false\)/);
  assert.match(sql, /REVOKE SELECT ON user_profiles FROM anon, authenticated/);
  assert.doesNotMatch(sql, /GRANT SELECT[^;]*\b(email|phone)\b[^;]*ON user_profiles/, 'email/phone must never be granted to anon/authenticated');
});

test('messages/proposals : user_id et proposed_by retirés des privilèges anon/authenticated', () => {
  const sql = readMigration('migration-restrict-messages-proposals-columns.sql');
  assert.match(sql, /REVOKE SELECT ON messages FROM anon, authenticated/);
  assert.doesNotMatch(sql, /GRANT SELECT[^;]*\buser_id\b[^;]*ON messages/);
  assert.match(sql, /REVOKE SELECT ON proposals FROM anon, authenticated/);
  assert.doesNotMatch(sql, /GRANT SELECT[^;]*\bproposed_by\b[^;]*ON proposals/);
});

test('retention_runs (purge RGPD) : aucun accès direct anon/authenticated', () => {
  const sql = readMigration('migration-add-retention-runs.sql');
  assert.match(sql, /CREATE POLICY "retention_runs_no_access" ON retention_runs FOR ALL USING \(false\) WITH CHECK \(false\)/);
});

test('organizer_followers : aucun accès direct anon/authenticated', () => {
  const sql = readMigration('migration-add-organizer-followers.sql');
  assert.match(sql, /CREATE POLICY "organizer_followers_no_direct" ON organizer_followers FOR ALL USING \(false\) WITH CHECK \(false\)/);
});

test('friendships : RLS activée sans policy permissive nulle part (deny-by-default Postgres)', () => {
  const files = fs.readdirSync(path.join(__dirname, '../../supabase')).filter(f => f.endsWith('.sql'));
  for (const file of files) {
    const sql = readMigration(file);
    const permissive = /CREATE POLICY\s+"[^"]*"\s+ON\s+friendships\s+FOR\s+SELECT\s+USING\s*\(\s*true\s*\)/i;
    assert.doesNotMatch(sql, permissive, `${file} must not grant public read access to friendships`);
  }
});
