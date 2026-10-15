import { Router } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.js';
const promiseSchema = z.object({
    case_id: z.string().uuid(),
    entity_id: z.string().uuid(),
    promised_amount: z.number().positive(),
    promised_date: z.string(),
    status: z.enum(['PENDING', 'FULFILLED', 'BROKEN']).default('PENDING')
});
export function createPromisesRouter() {
    const router = Router();
    router.post('/', async (req, res) => {
        try {
            const parsed = promiseSchema.parse(req.body);
            const organizationId = req.tenant.organizationId;
            const caseCheck = await query(`SELECT id FROM collection_cases WHERE id = $1 AND organization_id = $2`, [parsed.case_id, organizationId]);
            if (caseCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Collection case not found in this organization' });
            }
            const entityCheck = await query(`SELECT id FROM entities WHERE id = $1 AND organization_id = $2`, [parsed.entity_id, organizationId]);
            if (entityCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Entity not found in this organization' });
            }
            const result = await query(`
          INSERT INTO promises_to_pay (case_id, entity_id, organization_id, promised_amount, promised_date, status)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `, [parsed.case_id, parsed.entity_id, organizationId, parsed.promised_amount, parsed.promised_date, parsed.status]);
            res.status(201).json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Validation error' });
        }
    });
    return router;
}
