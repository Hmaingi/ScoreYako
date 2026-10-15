import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationFiles = [
  '001_auth_intelligence.sql',
  '002_portfolios_and_import_jobs.sql',
  '003_importer_intelligence.sql',
  '004_sheet_org_mapping.sql',
  '005_entity_raw_data.sql',
  '006_kyc.sql',
  '007_entity_delete_cascade.sql',
  '008_entity_import_tracking.sql',
  '009_membership_tenant_constraints.sql',
  '010_import_preview_no_commit.sql',
  '011_preserve_signed_import_balances.sql',
  '012_preserve_unmapped_import_rows.sql',
  '013_business_entity_relationships.sql',
  '014_kyc_document_files.sql',
];

export async function runMigrations() {
  const databasePath = path.join(__dirname, '..', '..', 'database');
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock(740291845102)');
    lockAcquired = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const baseSchema = await client.query<{ exists: string | null }>(`SELECT to_regclass('public.organizations') AS exists`);
    const baseAlreadyExists = Boolean(baseSchema.rows[0]?.exists);
    const baseApplied = await client.query('SELECT version FROM schema_migrations WHERE version = 0');
    if (!baseApplied.rows[0]) {
      await client.query('BEGIN');
      try {
        if (!baseAlreadyExists) {
          await client.query(fs.readFileSync(path.join(databasePath, 'schema.sql'), 'utf8'));
        }
        await client.query('INSERT INTO schema_migrations (version, filename) VALUES (0, $1)', ['schema.sql']);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(baseAlreadyExists ? 'Recorded existing base schema.' : 'Applied base schema.');
    }

    const expectedFiles = ['schema.sql', ...migrationFiles];
    const ledger = await client.query<{ version: number; filename: string }>(
      'SELECT version, filename FROM schema_migrations ORDER BY version',
    );
    for (const [index, row] of ledger.rows.entries()) {
      if (row.version !== index || row.filename !== expectedFiles[index]) {
        throw new Error(`Migration ledger is out of order at version ${row.version}.`);
      }
    }

    const seedPath = path.join(databasePath, 'seed.sql');
    const organizations = await client.query<{ count: string }>('SELECT COUNT(*) AS count FROM organizations');
    if (Number(organizations.rows[0]?.count || 0) === 0 && fs.existsSync(seedPath)) {
      await client.query(fs.readFileSync(seedPath, 'utf8'));
    }

    for (const [index, filename] of migrationFiles.entries()) {
      const version = index + 1;
      const applied = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [version]);
      if (applied.rows[0]) continue;

      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(databasePath, filename), 'utf8'));
        await client.query('INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)', [version, filename]);
        await client.query('COMMIT');
        console.log(`Applied migration ${String(version).padStart(3, '0')}: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      if (lockAcquired) await client.query('SELECT pg_advisory_unlock(740291845102)');
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
