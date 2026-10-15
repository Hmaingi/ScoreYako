import { Router } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.js';

const communicationSchema = z.object({
  entity_id: z.string().uuid(),
  case_id: z.string().uuid().optional(),
  comm_type: z.enum(['CALL', 'SMS', 'EMAIL', 'WHATSAPP']),
  notes: z.string().optional(),
  outcome: z.string().optional(),
  next_action_date: z.string().optional()
});

export function createCommunicationsRouter() {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const parsed = communicationSchema.parse(req.body);
      const organizationId = req.tenant!.organizationId;

      const entityCheck = await query(
        `SELECT id FROM entities WHERE id = $1 AND organization_id = $2`,
        [parsed.entity_id, organizationId]
      );

      if (entityCheck.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Entity not found in this organization' });
      }

      if (parsed.case_id) {
        const caseCheck = await query(
          `SELECT id FROM collection_cases WHERE id = $1 AND organization_id = $2`,
          [parsed.case_id, organizationId]
        );

        if (caseCheck.rows.length === 0) {
          return res.status(404).json({ success: false, error: 'Case not found in this organization' });
        }
      }

      const result = await query(
        `
          INSERT INTO communications (organization_id, entity_id, case_id, comm_type, notes, outcome, next_action_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `,
        [organizationId, parsed.entity_id, parsed.case_id || null, parsed.comm_type, parsed.notes || null, parsed.outcome || null, parsed.next_action_date || null]
      );

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Validation error' });
    }
  });

  return router;
}
