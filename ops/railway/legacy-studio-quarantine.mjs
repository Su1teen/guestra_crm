/**
 * Moves tables that belong to the AI Studio schema out of the CRM `public` schema into `legacy_ai_studio`.
 * ALTER TABLE ... SET SCHEMA keeps rows, indexes, constraints, sequences and foreign keys between moved tables.
 * Nothing is dropped, truncated or rewritten; the move is transactional and idempotent.
 */
export const LEGACY_SCHEMA = 'legacy_ai_studio';
export const STUDIO_ONLY_TABLES = ['workspaces', 'studio_users', 'memberships', 'auth_sessions', 'agent_configurations',
  'prompt_versions', 'test_scenarios', 'scenario_runs', 'virtual_clients', 'virtual_identities', 'conversation_refs',
  'preview_messages', 'message_attempts', 'agent_runs', 'call_sessions', 'simulation_sessions', 'tester_annotations',
  'transcript_snapshots', 'media_assets', 'integration_configuration', 'audit_logs', 'schema_migrations'];
// Same name exists in CRM Integration V2; only the historical Studio shape (workspace_id) is moved.
const SHAPE_CHECKED = { integration_mappings: 'workspace_id' };

export async function quarantineLegacyStudio(query, log = console.log) {
  const present = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
  const names = new Set(present.map(r => r.table_name));
  const candidates = STUDIO_ONLY_TABLES.filter(t => names.has(t));
  for (const [table, column] of Object.entries(SHAPE_CHECKED)) {
    if (!names.has(table)) continue;
    const [hit] = await query(`SELECT 1 AS x FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, column]);
    if (hit) candidates.push(table);
  }
  if (!candidates.length) return { moved: [] };
  const existing = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema=$1`, [LEGACY_SCHEMA]);
  const archived = new Set(existing.map(r => r.table_name));
  if (candidates.some(t => archived.has(t))) throw new Error('LEGACY_STUDIO_ARCHIVE_CONFLICT');
  const moving = new Set(candidates);
  const fks = await query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`);
  // A foreign key between a moved and a retained table would break CRM data integrity; stop for review.
  const bare = name => name.replace(/"/g, '');
  if (fks.some(fk => moving.has(bare(fk.child)) !== moving.has(bare(fk.parent)))) throw new Error('LEGACY_STUDIO_FK_BOUNDARY');
  await query('BEGIN');
  try {
    await query(`CREATE SCHEMA IF NOT EXISTS ${LEGACY_SCHEMA}`);
    const manifest = [];
    for (const table of candidates) {
      const [{ n }] = await query(`SELECT count(*)::int AS n FROM public."${table}"`);
      await query(`ALTER TABLE public."${table}" SET SCHEMA ${LEGACY_SCHEMA}`);
      manifest.push({ table, rows: n });
    }
    await query(`CREATE TABLE IF NOT EXISTS ${LEGACY_SCHEMA}.quarantine_manifest (table_name text PRIMARY KEY, row_count integer NOT NULL, moved_at timestamptz NOT NULL DEFAULT now())`);
    for (const m of manifest) await query(`INSERT INTO ${LEGACY_SCHEMA}.quarantine_manifest(table_name,row_count) VALUES($1,$2) ON CONFLICT DO NOTHING`, [m.table, m.rows]);
    await query('COMMIT');
    log(JSON.stringify({ event: 'legacy_studio_quarantined', tables: manifest.length }));
    return { moved: manifest };
  } catch (error) { await query('ROLLBACK'); throw error; }
}
