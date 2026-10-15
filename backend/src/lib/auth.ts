import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { query } from './db.js';

export type Role = 'ADMIN' | 'MANAGER' | 'COLLECTIONS' | 'USER';
export type TenantContext = { userId: string; organizationId: string; role: Role; email: string };
declare global { namespace Express { interface Request { tenant?: TenantContext; } } }

const developmentSecret = process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex');
const secret = () => process.env.AUTH_SECRET || developmentSecret;
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const canonicalDevEmail = () => (process.env.DEV_USER_EMAIL || 'admin@northstar.test').trim().toLowerCase();
export const devEmails = () => Array.from(new Set([canonicalDevEmail(), 'admin@northstar.test', 'admin@local.test'])).filter(Boolean);
export const loginEmails = (email: string) => {
  const normalizedEmail = email.trim().toLowerCase();
  return devEmails().includes(normalizedEmail) ? devEmails() : [normalizedEmail];
};
const devPassword = () => process.env.DEV_PASSWORD || 'ChangeMe123!';

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
  });
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function ensureDevBootstrap() {
  if (process.env.NODE_ENV === 'production') return;

  const email = canonicalDevEmail();
  const existingOrg = await query<{ id: string }>(`SELECT id FROM organizations WHERE name = 'Local Workspace' ORDER BY created_at ASC LIMIT 1`);
  const orgId = existingOrg.rows[0]?.id || (await query<{ id: string }>(
    `INSERT INTO organizations (name, currency) VALUES ($1, $2) RETURNING id`,
    ['Local Workspace', 'USD'],
  )).rows[0].id;

  const existingUser = await query<{ id: string }>(`SELECT id FROM users WHERE email = ANY($1) ORDER BY created_at ASC LIMIT 1`, [devEmails()]);
  let userId = existingUser.rows[0]?.id;
  if (!userId) {
    const passwordHash = await hashPassword(devPassword());
    const user = await query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`, [email, passwordHash]);
    userId = user.rows[0].id;
  }
  await query(
    `INSERT INTO organization_memberships (user_id, organization_id, role)
     VALUES ($1, $2, 'ADMIN') ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role`,
    [userId, orgId],
  );
}

export function signAccessToken(payload: TenantContext) { const signingSecret = secret(); if (!signingSecret) throw new Error('AUTH_SECRET must be configured'); const body = encode({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8 }); const signature = crypto.createHmac('sha256', signingSecret).update(body).digest('base64url'); return `${body}.${signature}`; }
function parseToken(token: string) { const [body, signature] = token.split('.'); const signingSecret = secret(); if (!body || !signature || !signingSecret) return null; const expected = crypto.createHmac('sha256', signingSecret).update(body).digest('base64url'); if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null; const value = JSON.parse(Buffer.from(body, 'base64url').toString()) as TenantContext & { exp: number }; return value.exp > Math.floor(Date.now() / 1000) ? value : null; }
export async function verifyPassword(password: string, stored: string) { const [algorithm, salt, digest] = stored.split('$'); if (algorithm !== 'scrypt' || !salt || !digest) return false; const actual = await new Promise<Buffer>((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key))); return crypto.timingSafeEqual(actual, Buffer.from(digest, 'hex')); }
export type MembershipLookup = (userId: string, organizationId: string) => Promise<TenantContext | null>;

const lookupMembership: MembershipLookup = async (userId, organizationId) => {
  const membership = await query<TenantContext>(
    `SELECT u.id AS "userId", m.organization_id AS "organizationId", m.role, u.email
     FROM users u JOIN organization_memberships m ON m.user_id = u.id
     WHERE u.id = $1 AND m.organization_id = $2`,
    [userId, organizationId],
  );
  return membership.rows[0] || null;
};

export function createAuthenticate(findMembership: MembershipLookup = lookupMembership) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      const identity = token ? parseToken(token) : null;
      if (!identity) return res.status(401).json({ success: false, error: 'Authentication required' });

      const membership = await findMembership(identity.userId, identity.organizationId);
      if (!membership) return res.status(401).json({ success: false, error: 'Authentication required' });
      req.tenant = membership;
      next();
    } catch {
      res.status(401).json({ success: false, error: 'Invalid authentication' });
    }
  };
}

export const authenticate = createAuthenticate();
const permissions: Record<Role, string[]> = { ADMIN: ['*'], MANAGER: ['entities:read','entities:write','cases:read','cases:write','reports:read','communications:write','promises:write','dashboard:read','intelligence:read','imports:read','imports:write','kyc:read','kyc:write','kyc:review'], COLLECTIONS: ['entities:read','cases:read','cases:write','reports:read','communications:write','promises:write','dashboard:read','intelligence:read','imports:read','kyc:read','kyc:write'], USER: ['entities:read','cases:read','reports:read','dashboard:read','intelligence:read','kyc:read'] };
export function hasPermission(role: Role | undefined, permission: string) {
  return Boolean(role && (permissions[role].includes('*') || permissions[role].includes(permission)));
}
export function requirePermission(permission: string) { return (req: Request, res: Response, next: NextFunction) => { if (!hasPermission(req.tenant?.role, permission)) return res.status(403).json({ success: false, error: 'Insufficient permissions' }); next(); }; }
export async function audit(req: Request, action: string, resourceType: string, resourceId?: string, metadata: object = {}) { if (!req.tenant) return; await query(`INSERT INTO audit_events (organization_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,$3,$4,$5,$6)`, [req.tenant.organizationId, req.tenant.userId, action, resourceType, resourceId || null, JSON.stringify(metadata)]); }