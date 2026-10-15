import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

test('HTTP security boundaries isolate tenant data and enforce permissions', {
  skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
  const dotenv = await import('dotenv');
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  const configuredUrl = process.env.DATABASE_URL || (dotenv.config({ path: envPath }).parsed?.DATABASE_URL);
  const testUrl = process.env.TEST_DATABASE_URL;
  assert.ok(testUrl);
  const identity = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port}${parsed.pathname}`.toLowerCase();
  };
  assert.notEqual(identity(testUrl), configuredUrl ? identity(configuredUrl) : 'localhost:5432/scoreyako',
    'TEST_DATABASE_URL must not point at the application database');

  process.env.DATABASE_URL = testUrl;
  process.env.AUTH_SECRET = 'route-security-test-secret';
  process.env.NODE_ENV = 'test';
  const [{ runMigrations }, { createApp }, db, auth] = await Promise.all([
    import('../lib/migrate.js'),
    import('../app.js'),
    import('../lib/db.js'),
    import('../lib/auth.js'),
  ]);
  await runMigrations();

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const orgA = (await db.query<{ id: string }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`Security A ${suffix}`])).rows[0].id;
  const orgB = (await db.query<{ id: string }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`Security B ${suffix}`])).rows[0].id;
  const adminA = (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'test-hash') RETURNING id`, [`admin-${suffix}@a.test`])).rows[0].id;
  const userA = (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'test-hash') RETURNING id`, [`user-${suffix}@a.test`])).rows[0].id;
  const userB = (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'test-hash') RETURNING id`, [`user-${suffix}@b.test`])).rows[0].id;
  await db.query(`INSERT INTO organization_memberships (user_id, organization_id, role) VALUES
    ($1, $2, 'ADMIN'), ($3, $2, 'USER'), ($4, $5, 'ADMIN')`, [adminA, orgA, userA, userB, orgB]);

  const portfolioA = (await db.query<{ id: string }>(`INSERT INTO portfolios (organization_id, name, source_type) VALUES ($1, $2, 'EXCEL') RETURNING id`, [orgA, `Portfolio A ${suffix}`])).rows[0].id;
  const portfolioB = (await db.query<{ id: string }>(`INSERT INTO portfolios (organization_id, name, source_type) VALUES ($1, $2, 'EXCEL') RETURNING id`, [orgB, `Portfolio B ${suffix}`])).rows[0].id;
  const entityA = (await db.query<{ id: string }>(`INSERT INTO entities (organization_id, portfolio_id, entity_type, legal_name) VALUES ($1, $2, 'INDIVIDUAL', $3) RETURNING id`, [orgA, portfolioA, `Entity A ${suffix}`])).rows[0].id;
  const entityB = (await db.query<{ id: string }>(`INSERT INTO entities (organization_id, portfolio_id, entity_type, legal_name) VALUES ($1, $2, 'INDIVIDUAL', $3) RETURNING id`, [orgB, portfolioB, `Entity B ${suffix}`])).rows[0].id;
  const relationshipA = (await db.query<{ id: string }>(`INSERT INTO financial_relationships (organization_id, entity_id, relationship_type, original_amount, outstanding_amount, currency) VALUES ($1, $2, 'ACCOUNT', 100, 100, 'USD') RETURNING id`, [orgA, entityA])).rows[0].id;
  const relationshipB = (await db.query<{ id: string }>(`INSERT INTO financial_relationships (organization_id, entity_id, relationship_type, original_amount, outstanding_amount, currency) VALUES ($1, $2, 'ACCOUNT', 100, 100, 'USD') RETURNING id`, [orgB, entityB])).rows[0].id;
  const caseA = (await db.query<{ id: string }>(`INSERT INTO collection_cases (organization_id, financial_relationship_id) VALUES ($1, $2) RETURNING id`, [orgA, relationshipA])).rows[0].id;
  const caseB = (await db.query<{ id: string }>(`INSERT INTO collection_cases (organization_id, financial_relationship_id) VALUES ($1, $2) RETURNING id`, [orgB, relationshipB])).rows[0].id;
  await db.query(`INSERT INTO communications (organization_id, entity_id, comm_type, notes) VALUES ($1, $2, 'CALL', 'tenant test')`, [orgB, entityB]);
  await db.query(`INSERT INTO promises_to_pay (case_id, entity_id, organization_id, promised_amount, promised_date) VALUES ($1, $2, $3, 10, CURRENT_DATE)`, [caseB, entityB, orgB]);

  const profileA = (await db.query<{ id: string }>(`INSERT INTO kyc_profiles (organization_id, entity_id, kyc_type) VALUES ($1, $2, 'INDIVIDUAL') RETURNING id`, [orgA, entityA])).rows[0].id;
  await db.query(`INSERT INTO kyc_individuals (organization_id, kyc_profile_id, national_id, passport_number, tax_pin, other_id_number) VALUES ($1, $2, 'A-NATIONAL-SECRET', 'A-PASSPORT-SECRET', 'A-TAX-SECRET', 'A-OTHER-SECRET')`, [orgA, profileA]);
  const jobA = (await db.query<{ id: string }>(`INSERT INTO import_jobs (organization_id, portfolio_id, status, file_name, file_buffer, parsed_data) VALUES ($1, $2, 'PREVIEW', 'a.csv', $3, $4) RETURNING id`, [orgA, portfolioA, Buffer.from(''), JSON.stringify({ sheets: [{ name: 'Sheet A' }], groups: [] })])).rows[0].id;
  const jobB = (await db.query<{ id: string }>(`INSERT INTO import_jobs (organization_id, portfolio_id, status, file_name, file_buffer, parsed_data) VALUES ($1, $2, 'PREVIEW', 'b.csv', $3, $4) RETURNING id`, [orgB, portfolioB, Buffer.from(''), JSON.stringify({ sheets: [{ name: 'Sheet B' }], groups: [] })])).rows[0].id;

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const adminToken = auth.signAccessToken({ userId: adminA, organizationId: orgA, role: 'ADMIN', email: `admin-${suffix}@a.test` });
  const userToken = auth.signAccessToken({ userId: userA, organizationId: orgA, role: 'USER', email: `user-${suffix}@a.test` });
  const wrongOrgToken = auth.signAccessToken({ userId: adminA, organizationId: orgB, role: 'ADMIN', email: `admin-${suffix}@a.test` });
  const headers = (token?: string): Record<string, string> => token ? { Authorization: `Bearer ${token}` } : {};
  const get = (url: string, token?: string) => fetch(`${baseUrl}${url}`, { headers: headers(token) });

  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.default.end();
  });

  await t.test('authentication rejects missing, invalid, and wrong-organization tokens', async () => {
    assert.equal((await get('/api/v1/entities')).status, 401);
    assert.equal((await get('/api/v1/entities', 'invalid-token')).status, 401);
    assert.equal((await get('/api/v1/entities', wrongOrgToken)).status, 401);
    const valid = await get('/api/v1/entities', adminToken);
    assert.equal(valid.status, 200);
    const entities = await valid.json();
    assert.deepEqual(entities.data.map((entity: { id: string }) => entity.id), [entityA]);
    const spoofedHeader = await fetch(`${baseUrl}/api/v1/entities`, {
      headers: { ...headers(adminToken), 'x-organization-id': orgB },
    });
    assert.deepEqual((await spoofedHeader.json()).data.map((entity: { id: string }) => entity.id), [entityA]);
  });

  await t.test('entity reads, updates, and deletes cannot cross tenant boundaries', async () => {
    assert.equal((await get(`/api/v1/entities/${entityB}/360`, adminToken)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/entities/${entityB}`, { method: 'PATCH', headers: { ...headers(adminToken), 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/entities/${entityB}`, { method: 'DELETE', headers: headers(adminToken) })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/entities/${entityA}`, { method: 'DELETE', headers: headers(userToken) })).status, 403);
    assert.equal((await get(`/api/v1/entities?organization_id=${orgB}`, adminToken)).status, 404);
    const create = await fetch(`${baseUrl}/api/v1/entities`, {
      method: 'POST',
      headers: { ...headers(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'BUSINESS', legal_name: `Tenant-owned ${suffix}`, organization_id: orgB }),
    });
    assert.equal(create.status, 201);
    assert.equal((await create.json()).data.organization_id, orgA);
  });

  await t.test('imports require authentication and scope jobs and groups to the tenant', async () => {
    assert.equal((await fetch(`${baseUrl}/api/v1/imports/preview`, { method: 'POST' })).status, 401);
    const form = new FormData();
    form.set('file', new Blob(['Customer Name,Account Number\nTenant Upload,ACC-1\n'], { type: 'text/csv' }), 'tenant.csv');
    const upload = await fetch(`${baseUrl}/api/v1/imports/preview`, { method: 'POST', headers: headers(adminToken), body: form });
    assert.equal(upload.status, 200);
    assert.equal((await get(`/api/v1/imports/jobs/${jobB}`, adminToken)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/imports/${jobB}/groups`, { method: 'PATCH', headers: { ...headers(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'x', name: 'x', sheets: ['Sheet B'], organization_id: orgA }] }) })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/imports/${jobA}/groups`, { method: 'PATCH', headers: { ...headers(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'x', name: 'x', sheets: ['Sheet A'], organization_id: orgB }] }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/v1/imports/${jobB}/commit`, { method: 'POST', headers: headers(adminToken) })).status, 404);
  });

  await t.test('KYC reads and writes enforce permissions and mask identifiers in every object', async () => {
    assert.equal((await get(`/api/v1/kyc/entities/${entityA}`)).status, 401);
    assert.equal((await get(`/api/v1/kyc/entities/${entityB}`, adminToken)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/kyc/entities/${entityB}`, { method: 'POST', headers: { ...headers(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ kyc_type: 'INDIVIDUAL' }) })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/kyc/entities/${entityA}`, { method: 'POST', headers: { ...headers(userToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ kyc_type: 'INDIVIDUAL' }) })).status, 403);
    const response = await get(`/api/v1/kyc/entities/${entityA}`, adminToken);
    const body = await response.text();
    assert.equal(response.status, 200);
    for (const secret of ['A-NATIONAL-SECRET', 'A-PASSPORT-SECRET', 'A-TAX-SECRET', 'A-OTHER-SECRET']) assert.equal(body.includes(secret), false);
  });

  await t.test('cases, promises, and communications stay within the authenticated organization', async () => {
    const cases = await get('/api/v1/cases', adminToken);
    assert.equal(cases.status, 200);
    assert.equal(JSON.stringify(await cases.json()).includes(caseB), false);
    assert.equal((await fetch(`${baseUrl}/api/v1/cases/${caseB}`, { method: 'PATCH', headers: { ...headers(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CLOSED' }) })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/promises-to-pay`, { method: 'POST', headers: { ...headers(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: caseB, entity_id: entityB, promised_amount: 10, promised_date: '2026-12-01' }) })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/communications`, { method: 'POST', headers: { ...headers(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ entity_id: entityB, comm_type: 'CALL' }) })).status, 404);
  });
});