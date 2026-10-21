import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deploy, identityFromEnv, attestIntegration } from './deploy-engine.mjs';
if (process.env.GUESTRA_DEPLOY_AUTOMATION_ENABLED !== 'true') {
  console.log('Deployment automation disabled; apply the reviewed Railway bootstrap configuration to enable it.');
} else {
  const identity = identityFromEnv('guestra_crm');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const query = async (text, args = []) => (await client.query(text, args)).rows ?? [];
  try {
    const [legacy] = await query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
    const installed = legacy.name ? await query('SELECT hash,created_at FROM drizzle.__drizzle_migrations') : [];
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
    if(installed.some(row=>!journal.entries.some(e=>e.when===Number(row.created_at))))throw new Error('MIGRATION_SOURCE_MISSING');
    const migrations = journal.entries.map(entry => {
      const old = installed.find(row => Number(row.created_at) === entry.when);
      return { name: 'core/' + entry.tag + '.sql', file: resolve('drizzle', entry.tag + '.sql'), installed: Boolean(old),
        legacyDigest: old?.hash, category: old ? 'safe' : 'manual' };
    });
    // Historical business backfills need review when unexpectedly absent on an existing deployment.
    // New reviewed additive releases belong in this versioned directory.
    for (const file of (await readdir('ops/railway/migrations')).filter(f => f.endsWith('.sql')).sort())
      migrations.push({ name: 'bootstrap/' + file, file: resolve('ops/railway/migrations', file), category: 'safe' });
    const [optionalLedger] = await query("SELECT to_regclass('public.guestra_integration_migrations') AS name");
    const optional = optionalLedger.name ? await query('SELECT name,digest FROM guestra_integration_migrations') : [];
    for (const file of (await readdir('integration-migrations')).filter(f => f.endsWith('.sql')).sort()) {
      const old = optional.find(row => row.name === file);
      migrations.push({ name: 'integration/' + file, file: resolve('integration-migrations', file), installed: Boolean(old), legacyDigest: old?.digest,
        category: 'integration', record: async (query, checksum) => {
          await query('CREATE TABLE IF NOT EXISTS guestra_integration_migrations(name text PRIMARY KEY,digest text NOT NULL,installed_at timestamptz NOT NULL DEFAULT now())');
          await query('INSERT INTO guestra_integration_migrations(name,digest) VALUES($1,$2)', [file, checksum]);
        } });
    }
    await deploy(query, { identity, migrations, foreignTables: ['room_types', 'agent_runs', 'workflow_entity'],
      requiredTables: ['properties', 'organizations', 'app_users'],
      baselineApproved: process.env.GUESTRA_MIGRATION_BASELINE_APPROVED === 'true',
      integrationApproved: process.env.GUESTRA_INTEGRATION_MIGRATIONS_APPROVED === 'true',
      afterMigrations: async query => {
        const [table] = await query("SELECT to_regclass('public.guestra_integration_deployment') AS name");
        if (table.name) await attestIntegration(query, 'guestra_integration_deployment', identity);
        if ((process.env.GUESTRA_REGISTRY_ENABLED === 'true'||process.env.CRM_PMS_INTEGRATION_ENABLED==='true') && !table.name) throw new Error('MIGRATION_REQUIRED:integration');
        const bootstrap = spawnSync(process.execPath, ['dist-server/server/integration/bootstrap-registry.js'], { stdio: 'inherit', env: process.env });
        if (bootstrap.error || bootstrap.status !== 0) throw new Error('REGISTRY_BOOTSTRAP_FAILED');
      } });
    console.log('DATABASE_READY');
  } catch (error) {
    console.error('Pre-deploy refused:', /^[A-Z_]+(?::[a-zA-Z0-9_./-]+)?$/.test(error.message) ? error.message : 'DATABASE_PREFLIGHT_FAILED', error.code ?? '');
    process.exitCode = 1;
  } finally { await client.end(); }
}
