import test from 'node:test';
import assert from 'node:assert/strict';
import { quarantineLegacyStudio } from './legacy-studio-quarantine.mjs';

function fakeDb({ tables, columns = {}, archived = [], fks = [] }) {
  const log = [];
  const query = async (text, args = []) => {
    log.push(text);
    if (text.includes("table_schema='public' AND table_type")) return tables.map(table_name => ({ table_name }));
    if (text.includes('column_name=$2')) return columns[args[0]]?.includes(args[1]) ? [{ x: 1 }] : [];
    if (text.includes('table_schema=$1')) return archived.map(table_name => ({ table_name }));
    if (text.includes('pg_constraint')) return fks;
    if (text.includes('count(*)')) return [{ n: 3 }];
    return [];
  };
  return { query, log };
}

test('moves Studio tables to the archive schema without dropping anything', async () => {
  const db = fakeDb({ tables: ['properties', 'agent_runs', 'workspaces', 'integration_mappings'], columns: { integration_mappings: ['workspace_id'] } });
  const { moved } = await quarantineLegacyStudio(db.query, () => {});
  assert.deepEqual(moved.map(m => m.table).sort(), ['agent_runs', 'integration_mappings', 'workspaces']);
  assert.ok(db.log.some(q => q.includes('SET SCHEMA legacy_ai_studio')));
  assert.ok(!db.log.some(q => /DROP|TRUNCATE|DELETE/i.test(q)));
  assert.ok(db.log.includes('COMMIT'));
});

test('leaves the CRM-shaped integration_mappings in public', async () => {
  const db = fakeDb({ tables: ['properties', 'integration_mappings'], columns: { integration_mappings: ['property_id'] } });
  assert.deepEqual((await quarantineLegacyStudio(db.query, () => {})).moved, []);
});

test('is a no-op on a clean CRM database', async () => {
  const db = fakeDb({ tables: ['properties', 'organizations', 'app_users'] });
  assert.deepEqual((await quarantineLegacyStudio(db.query, () => {})).moved, []);
  assert.ok(!db.log.includes('BEGIN'));
});

test('refuses to overwrite an existing archive table', async () => {
  const db = fakeDb({ tables: ['workspaces'], archived: ['workspaces'] });
  await assert.rejects(quarantineLegacyStudio(db.query, () => {}), /LEGACY_STUDIO_ARCHIVE_CONFLICT/);
});

test('refuses when a foreign key crosses the ownership boundary', async () => {
  const db = fakeDb({ tables: ['workspaces', 'guests'], fks: [{ child: 'guests', parent: 'workspaces' }] });
  await assert.rejects(quarantineLegacyStudio(db.query, () => {}), /LEGACY_STUDIO_FK_BOUNDARY/);
});
