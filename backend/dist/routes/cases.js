import { Router } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { requirePermission, audit } from '../lib/auth.js';
const organizationId = (value) => value || '';
const updateSchema = z.object({
    assigned_user_id: z.string().uuid().nullable().optional(),
    status: z.enum(['OPEN', 'ACTIVE', 'ESCALATED', 'RESOLVED', 'CLOSED']).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    stage: z.enum(['INITIAL_CONTACT', 'PROMISE_TO_PAY', 'NEGOTIATION', 'LEGAL', 'COLLECTION', 'RESOLVED']).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export function createCasesRouter() {
    const router = Router();
    router.get('/', requirePermission('cases:read'), async (req, res) => {
        try {
            const orgId = req.tenant.organizationId;
            const result = await query(`
        SELECT cc.*, e.id AS entity_id, e.legal_name, fr.outstanding_amount, fr.currency, fr.due_date,
          u.email AS assigned_user_email,
          COUNT(ptp.id) FILTER (WHERE ptp.status = 'BROKEN')::int AS broken_promises
        FROM collection_cases cc
        JOIN financial_relationships fr ON fr.id = cc.financial_relationship_id AND fr.organization_id = cc.organization_id
        JOIN entities e ON e.id = fr.entity_id AND e.organization_id = fr.organization_id
        LEFT JOIN organization_memberships m ON m.user_id = cc.assigned_user_id AND m.organization_id = cc.organization_id
        LEFT JOIN users u ON u.id = m.user_id
        LEFT JOIN promises_to_pay ptp ON ptp.case_id = cc.id AND ptp.organization_id = cc.organization_id
        WHERE cc.organization_id = $1
        GROUP BY cc.id, e.id, fr.id, u.email
        ORDER BY CASE cc.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, fr.due_date ASC NULLS LAST`, [orgId]);
            res.json({ success: true, data: result.rows });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
        }
    });
    router.get('/assignees', requirePermission('cases:read'), async (req, res) => {
        try {
            const result = await query(`SELECT u.id, u.email, m.role FROM users u JOIN organization_memberships m ON m.user_id = u.id WHERE m.organization_id = $1 ORDER BY u.email`, [req.tenant.organizationId]);
            res.json({ success: true, data: result.rows });
        }
        catch (error) {
            res.status(500).json({ success: false, error: 'Unable to load assignees' });
        }
    });
    router.patch('/:id', requirePermission('cases:write'), async (req, res) => {
        try {
            const orgId = req.tenant.organizationId;
            const changes = updateSchema.parse(req.body);
            if (changes.assigned_user_id) {
                const assignee = await query(`SELECT u.id FROM users u JOIN organization_memberships m ON m.user_id = u.id WHERE u.id = $1 AND m.organization_id = $2`, [changes.assigned_user_id, orgId]);
                if (!assignee.rows.length)
                    return res.status(404).json({ success: false, error: 'Assignee not found in this organization' });
            }
            const fields = Object.keys(changes);
            const values = fields.map((field) => changes[field]);
            const statement = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
            const result = await query(`UPDATE collection_cases SET ${statement} WHERE id = $${values.length + 1} AND organization_id = $${values.length + 2} RETURNING *`, [...values, req.params.id, orgId]);
            if (!result.rows.length)
                return res.status(404).json({ success: false, error: 'Case not found' });
            await audit(req, 'CASE_UPDATED', 'collection_case', String(req.params.id), changes);
            res.json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unable to update case' });
        }
    });
    return router;
}
