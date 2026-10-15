import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

test('isolated import preview stages only and commit is atomic', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const dotenv = await import('dotenv');
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.AUTH_SECRET = 'import-verification-secret';
  process.env.NODE_ENV = 'test';
  dotenv.config({ path: envPath });
  const [{ createApp }, db, auth] = await Promise.all([
    import('../app.js'), import('../lib/db.js'), import('../lib/auth.js'),
  ]);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const orgA = (await db.query<{ id: string }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`Import A ${suffix}`])).rows[0].id;
  const orgB = (await db.query<{ id: string }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`Import B ${suffix}`])).rows[0].id;
  const userA = (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'test') RETURNING id`, [`import-${suffix}@a.test`])).rows[0].id;
  const userB = (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'test') RETURNING id`, [`import-${suffix}@b.test`])).rows[0].id;
  await db.query(`INSERT INTO organization_memberships (user_id, organization_id, role) VALUES ($1, $2, 'ADMIN'), ($3, $4, 'ADMIN')`, [userA, orgA, userB, orgB]);

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const tokenA = auth.signAccessToken({ userId: userA, organizationId: orgA, role: 'ADMIN', email: `import-${suffix}@a.test` });
  const tokenB = auth.signAccessToken({ userId: userB, organizationId: orgB, role: 'ADMIN', email: `import-${suffix}@b.test` });
  const postPreview = async (contents: BlobPart, filename = 'messy.csv') => {
    const form = new FormData();
    form.set('file', new Blob([contents], { type: filename.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    return fetch(`${base}/api/v1/imports/preview`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}`, 'x-organization-id': orgB }, body: form });
  };

  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.default.end();
  });

  const preview = await postPreview('Collections report\n\nBorrower Full Name,Mobile No.,Email,Account Number,Balance Due,Unknown Field\nJOHN KAMAU,0712 345 678, JOHN@EXAMPLE.COM ,ACC-1,"KES 1,200.50",kept');
  assert.equal(preview.status, 200);
  const body = await preview.json() as { data: { jobId: string; unknownFields: Array<{ sourceColumn: string }>; ready: boolean } };
  assert.ok(body.data.unknownFields.some((field) => field.sourceColumn === 'Unknown Field'));
  const before = await db.query<{ portfolios: string; entities: string; relationships: string; jobs: string }>(
    `SELECT (SELECT COUNT(*) FROM portfolios WHERE organization_id = $1)::text AS portfolios,
            (SELECT COUNT(*) FROM entities WHERE organization_id = $1)::text AS entities,
            (SELECT COUNT(*) FROM financial_relationships WHERE organization_id = $1)::text AS relationships,
            (SELECT COUNT(*) FROM import_jobs WHERE organization_id = $1 AND id = $2)::text AS jobs`, [orgA, body.data.jobId],
  );
  assert.deepEqual(before.rows[0], { portfolios: '0', entities: '0', relationships: '0', jobs: '1' });
  const staged = await db.query<{ organization_id: string; portfolio_id: string | null; status: string }>('SELECT organization_id, portfolio_id, status FROM import_jobs WHERE id = $1', [body.data.jobId]);
  assert.deepEqual(staged.rows[0], { organization_id: orgA, portfolio_id: null, status: 'PREVIEW' });
  assert.equal((await fetch(`${base}/api/v1/imports/jobs/${body.data.jobId}`, { headers: { Authorization: `Bearer ${tokenB}` } })).status, 404);
  assert.equal((await fetch(`${base}/api/v1/imports/${body.data.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${tokenB}` } })).status, 404);
  assert.equal((await fetch(`${base}/api/v1/imports/${body.data.jobId}/groups`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ organization_id: orgB }] }) })).status, 404);
  assert.equal((await fetch(`${base}/api/v1/imports/${body.data.jobId}/groups`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [] }) })).status, 400);
  assert.equal((await fetch(`${base}/api/v1/imports/${body.data.jobId}/groups`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'renamed', name: 'Verified portfolio', confidence: 100, commonField: 'account_number', reason: 'same tenant', sheets: ['Sheet1'] }] }) })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/imports/${body.data.jobId}/groups`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [] }) })).status, 401);

  const duplicateHeaderPreview = await postPreview('Customer Name,Account Number,Balance,Balance\nAmbiguous Credit,ACC-DUP,100,200', 'duplicate-headers.csv');
  assert.equal(duplicateHeaderPreview.status, 200);
  const duplicateHeaderJob = (await duplicateHeaderPreview.json()) as { data: { jobId: string; ready: boolean; reviewRows: number; reviewItems: Array<{ id: string }> } };
  assert.equal(duplicateHeaderJob.data.ready, false);
  assert.equal(duplicateHeaderJob.data.reviewRows, 1);
  assert.equal((await fetch(`${base}/api/v1/imports/${duplicateHeaderJob.data.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } })).status, 409);
  const duplicateReview = await fetch(`${base}/api/v1/imports/${duplicateHeaderJob.data.jobId}/reviews`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolvedItemId: duplicateHeaderJob.data.reviewItems[0].id }),
  });
  assert.equal(duplicateReview.status, 200);
  assert.equal((await duplicateReview.json() as { data: { ready: boolean; reviewRows: number } }).data.ready, true);
  assert.equal((await fetch(`${base}/api/v1/imports/${duplicateHeaderJob.data.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } })).status, 200);

  const rawRowPreview = await postPreview('Customer Name,Account Number,Balance\n,RAW-1,100', 'unmapped-row.csv');
  assert.equal(rawRowPreview.status, 200);
  const rawRowJob = (await rawRowPreview.json()) as { data: { jobId: string; reviewItems: Array<{ id: string; type: string }> } };
  const invalidRowsReview = rawRowJob.data.reviewItems.find((item) => item.type === 'INVALID_ROWS');
  assert.ok(invalidRowsReview);
  const resolvedRawReview = await fetch(`${base}/api/v1/imports/${rawRowJob.data.jobId}/reviews`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolvedItemId: invalidRowsReview.id }),
  });
  assert.equal(resolvedRawReview.status, 200);
  const rawCommit = await fetch(`${base}/api/v1/imports/${rawRowJob.data.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } });
  assert.equal(rawCommit.status, 200);
  assert.equal((await rawCommit.json() as { data: { rawRowsPreserved: number } }).data.rawRowsPreserved, 1);
  const retainedRow = await db.query<{ organization_id: string; sheet_name: string; source_row_number: number; raw_data: Record<string, unknown> }>(
    'SELECT organization_id, sheet_name, source_row_number, raw_data FROM import_job_raw_rows WHERE import_job_id = $1',
    [rawRowJob.data.jobId],
  );
  assert.deepEqual(retainedRow.rows[0], {
    organization_id: orgA,
    sheet_name: 'Sheet1',
    source_row_number: 2,
    raw_data: { 'Customer Name': '', 'Account Number': 'RAW-1', Balance: '100' },
  });

  const committed = await fetch(`${base}/api/v1/imports/${body.data.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } });
  assert.equal(committed.status, 200);
  const after = await db.query<{ portfolios: string; entities: string; relationships: string }>(
    `SELECT (SELECT COUNT(*) FROM portfolios WHERE organization_id = $1)::text AS portfolios,
            (SELECT COUNT(*) FROM entities WHERE organization_id = $1)::text AS entities,
            (SELECT COUNT(*) FROM financial_relationships WHERE organization_id = $1)::text AS relationships`, [orgA],
  );
  assert.deepEqual(after.rows[0], { portfolios: '1', entities: '1', relationships: '1' });

  const signedPreview = await postPreview('Customer Name,Account Number,Balance Due\nCredit Person,ACC-NEG,"(1,250.50)"');
  assert.equal(signedPreview.status, 200);
  const signedJob = (await signedPreview.json() as { data: { jobId: string } }).data.jobId;
  assert.equal((await fetch(`${base}/api/v1/imports/${signedJob}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } })).status, 200);
  const signed = await db.query<{ outstanding_amount: string }>(`SELECT fr.outstanding_amount::text FROM financial_relationships fr JOIN entities e ON e.id = fr.entity_id WHERE e.organization_id = $1 AND e.legal_name = 'Credit Person'`, [orgA]);
  assert.equal(signed.rows[0].outstanding_amount, '-1250.50');

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['People extract'], [], ['Borrower Full Name', 'Mobile No.', 'Email', 'Account Number', 'Custom Tag'],
    ['JANE KAMAU', '0712 555 000', ' JANE@EXAMPLE.COM ', 'ACC-MULTI', 'priority'],
  ]), 'People');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Obligation snapshot'], ['Customer Name', 'Account Number', 'Outstanding Amt', 'Due Date'],
    ['Jane Kamau', 'ACC-MULTI', 'KES 2,500.00', '31/10/2026'],
  ]), 'Obligations');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Owner', 'Account Number', 'Property', 'Location', 'Custom Property Note'],
    ['Jane Kamau', 'ACC-MULTI', 'Plot 42', 'Nairobi', 'gate key held'],
  ]), 'Properties');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Customer Name', 'Account Number', 'Communication Type', 'Notes'],
    ['Jane Kamau', 'ACC-MULTI', 'Call', 'Confirmed contact'],
  ]), 'Communications');
  const multiPreview = await postPreview(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), 'multi-sheet.xlsx');
  assert.equal(multiPreview.status, 200);
  const multi = await multiPreview.json() as { data: { jobId: string; groups: Array<{ id: string; sheets: string[] }> } };
  assert.equal(multi.data.groups.length, 4);
  const mergedGroups = [{ id: 'all-sheets', name: 'Multi-sheet portfolio', confidence: 100, commonField: 'account_number', reason: 'Verified related source sheets', sheets: ['People', 'Obligations', 'Properties', 'Communications'] }];
  assert.equal((await fetch(`${base}/api/v1/imports/${multi.data.jobId}/groups`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: mergedGroups }) })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/imports/${multi.data.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } })).status, 200);
  const multiResult = await db.query<{ entities: string; relationships: string; communications: string; property: string }>(
    `SELECT (SELECT COUNT(*) FROM entities WHERE organization_id = $1 AND legal_name = 'Jane Kamau')::text AS entities,
            (SELECT COUNT(*) FROM financial_relationships fr JOIN entities e ON e.id = fr.entity_id WHERE e.organization_id = $1 AND e.legal_name = 'Jane Kamau')::text AS relationships,
            (SELECT COUNT(*) FROM communications c JOIN entities e ON e.id = c.entity_id WHERE e.organization_id = $1 AND e.legal_name = 'Jane Kamau')::text AS communications,
            (SELECT fr.extra_data->>'property_reference' FROM financial_relationships fr JOIN entities e ON e.id = fr.entity_id WHERE e.organization_id = $1 AND e.legal_name = 'Jane Kamau' LIMIT 1) AS property`, [orgA],
  );
  assert.deepEqual(multiResult.rows[0], { entities: '1', relationships: '1', communications: '1', property: 'Plot 42' });

  const oversizedName = `Rollback ${'X'.repeat(300)}`;
  const failingPreview = await postPreview(`Customer Name,Account Number,Balance Due\n${oversizedName},RB-1,100`);
  assert.equal(failingPreview.status, 200);
  const failingJob = (await failingPreview.json() as { data: { jobId: string } }).data.jobId;
  assert.equal((await fetch(`${base}/api/v1/imports/${failingJob}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } })).status, 500);
  const rollback = await db.query<{ entities: string; relationships: string; status: string }>(
    `SELECT (SELECT COUNT(*) FROM entities WHERE organization_id = $1 AND legal_name = $3)::text AS entities,
            (SELECT COUNT(*) FROM financial_relationships fr JOIN entities e ON e.id = fr.entity_id WHERE e.organization_id = $1 AND e.legal_name = $3)::text AS relationships,
            (SELECT status FROM import_jobs WHERE id = $2) AS status`, [orgA, failingJob, oversizedName],
  );
  assert.deepEqual(rollback.rows[0], { entities: '0', relationships: '0', status: 'PREVIEW' });
});
