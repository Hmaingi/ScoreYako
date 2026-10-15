import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createAuthenticate, loginEmails, requirePermission, signAccessToken, type TenantContext } from './auth.js';
import { redactSensitiveIdentifiers } from './privacy.js';

process.env.AUTH_SECRET = 'security-test-secret';

const userA: TenantContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: 'ADMIN',
  email: 'user-a@example.test',
};

function responseHarness() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

async function invokeMiddleware(middleware: any, authorization?: string, tenant?: TenantContext) {
  const req = { headers: authorization ? { authorization } : {}, tenant } as Request;
  const res = responseHarness();
  let nextCalled = false;
  await middleware(req, res as unknown as Response, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

test('authentication rejects missing and invalid bearer tokens', async () => {
  const authenticate = createAuthenticate(async () => userA);
  const missing = await invokeMiddleware(authenticate);
  const invalid = await invokeMiddleware(authenticate, 'Bearer invalid.token');

  assert.equal(missing.res.statusCode, 401);
  assert.equal(missing.nextCalled, false);
  assert.equal(invalid.res.statusCode, 401);
  assert.equal(invalid.nextCalled, false);
});

test('authentication resolves tenant from a matching organization membership', async () => {
  const authenticate = createAuthenticate(async (userId, organizationId) =>
    userId === userA.userId && organizationId === userA.organizationId ? userA : null);
  const valid = await invokeMiddleware(authenticate, `Bearer ${signAccessToken(userA)}`);
  const wrongOrganization = await invokeMiddleware(authenticate, `Bearer ${signAccessToken({
    ...userA,
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })}`);

  assert.equal(valid.nextCalled, true);
  assert.deepEqual(valid.req.tenant, userA);
  assert.equal(wrongOrganization.res.statusCode, 401);
  assert.equal(wrongOrganization.nextCalled, false);
});

test('permissions are enforced outside production mode', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const denied = await invokeMiddleware(requirePermission('entities:write'), undefined, { ...userA, role: 'USER' });
    const allowed = await invokeMiddleware(requirePermission('entities:write'), undefined, userA);

    assert.equal(denied.res.statusCode, 403);
    assert.equal(denied.nextCalled, false);
    assert.equal(allowed.nextCalled, true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('sensitive identifiers are redacted recursively in alternate response objects', () => {
  const value = redactSensitiveIdentifiers({
    profile: { national_id: '123456789', business_tax_pin: 'AB1234567' },
    document: { document_number: 'P1234567', metadata: { other_id_number: '99887766' } },
    public_value: 'visible',
  });

  assert.equal(JSON.stringify(value).includes('123456789'), false);
  assert.equal(JSON.stringify(value).includes('AB1234567'), false);
  assert.equal(JSON.stringify(value).includes('P1234567'), false);
  assert.equal(JSON.stringify(value).includes('99887766'), false);
  assert.equal(value.public_value, 'visible');
});

test('development login aliases do not apply to arbitrary submitted emails', () => {
  assert.deepEqual(loginEmails('attacker@example.test'), ['attacker@example.test']);
  assert.ok(loginEmails('admin@local.test').includes('admin@northstar.test'));
});