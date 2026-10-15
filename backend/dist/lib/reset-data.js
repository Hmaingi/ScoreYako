import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { query } from './db.js';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
// Clears imported/transactional data for a clean local slate while keeping
// organizations, users, and memberships so existing logins keep working.
// Guarded to non-production; requires RESET_CONFIRM=yes to avoid accidental runs.
async function resetData() {
    if (process.env.NODE_ENV === 'production') {
        console.error('Refusing to reset data when NODE_ENV=production.');
        process.exit(1);
    }
    if (process.env.RESET_CONFIRM !== 'yes') {
        console.error('Set RESET_CONFIRM=yes to confirm this destructive local reset.');
        process.exit(1);
    }
    const resettableTables = [
        'kyc_verifications', 'kyc_checks', 'kyc_documents', 'kyc_addresses',
        'kyc_individuals', 'kyc_businesses', 'kyc_entity_relationships', 'kyc_profiles',
        'entity_raw_data', 'communications', 'promises_to_pay', 'collection_cases',
        'payments', 'financial_relationships', 'entities', 'import_job_sheet_mappings',
        'import_jobs', 'portfolios', 'risk_snapshots', 'audit_events',
    ];
    const existingTables = await query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`, [resettableTables]);
    const tableNames = existingTables.rows
        .map(({ tablename }) => tablename)
        .filter((tablename) => resettableTables.includes(tablename));
    if (tableNames.length > 0) {
        const quotedNames = tableNames.map((tablename) => `"${tablename.replace(/"/g, '""')}"`).join(', ');
        await query(`TRUNCATE TABLE ${quotedNames} RESTART IDENTITY CASCADE`);
    }
    console.log('Reset complete: entities, imports, financial data, and KYC records cleared. Organizations and users were kept.');
}
resetData()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error('Reset failed:', error);
    process.exit(1);
});
