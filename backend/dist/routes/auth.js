import { Router } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { signAccessToken, verifyPassword, authenticate, ensureDevBootstrap, loginEmails } from '../lib/auth.js';
export function createAuthRouter() {
    const router = Router();
    router.post('/login', async (req, res) => {
        try {
            if (process.env.NODE_ENV !== 'production')
                await ensureDevBootstrap();
            const login = z.object({
                email: z.string().email(),
                password: z.string().min(8),
                organization_id: z.string().uuid().optional(),
            }).parse(req.body);
            const lookupEmails = loginEmails(login.email);
            const result = await query(`SELECT u.id, u.email, u.password_hash, m.organization_id, o.name AS organization_name, m.role
				 FROM users u
				 JOIN organization_memberships m ON m.user_id = u.id
				 JOIN organizations o ON o.id = m.organization_id
				 WHERE u.email = ANY($1) ${login.organization_id ? 'AND m.organization_id = $2' : ''}
				 ORDER BY o.name`, login.organization_id ? [lookupEmails, login.organization_id] : [lookupEmails]);
            const validMemberships = [];
            for (const membership of result.rows) {
                if (await verifyPassword(login.password, membership.password_hash))
                    validMemberships.push(membership);
            }
            if (validMemberships.length === 0) {
                return res.status(401).json({ success: false, error: 'Invalid email or password' });
            }
            if (!login.organization_id && validMemberships.length > 1) {
                return res.status(409).json({
                    success: false,
                    error: 'Choose an organization to continue.',
                    requires_organization: true,
                    organizations: validMemberships.map(({ organization_id, organization_name }) => ({ id: organization_id, name: organization_name })),
                });
            }
            const membership = validMemberships[0];
            const token = signAccessToken({
                userId: membership.id,
                organizationId: membership.organization_id,
                role: membership.role,
                email: membership.email,
            });
            res.json({
                success: true,
                data: {
                    access_token: token,
                    user: { email: membership.email, role: membership.role, organization_id: membership.organization_id },
                },
            });
        }
        catch {
            res.status(400).json({ success: false, error: 'Invalid login request' });
        }
    });
    router.get('/me', authenticate, (req, res) => res.json({ success: true, data: req.tenant }));
    return router;
}
