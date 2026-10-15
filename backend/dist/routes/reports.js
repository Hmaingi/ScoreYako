import { Router } from 'express';
import { query } from '../lib/db.js';
const org = (value) => value || '';
export function createReportsRouter() {
    const router = Router();
    router.get('/collection-health', async (req, res) => {
        try {
            const organizationId = req.tenant.organizationId;
            const [aging, collectors, risks] = await Promise.all([
                query(`SELECT
          COALESCE(SUM(CASE WHEN due_date >= CURRENT_DATE THEN outstanding_amount ELSE 0 END), 0) AS current,
          COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE AND due_date >= CURRENT_DATE - INTERVAL '30 days' THEN outstanding_amount ELSE 0 END), 0) AS days_1_30,
          COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE - INTERVAL '30 days' AND due_date >= CURRENT_DATE - INTERVAL '60 days' THEN outstanding_amount ELSE 0 END), 0) AS days_31_60,
          COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE - INTERVAL '60 days' AND due_date >= CURRENT_DATE - INTERVAL '90 days' THEN outstanding_amount ELSE 0 END), 0) AS days_61_90,
          COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE - INTERVAL '90 days' THEN outstanding_amount ELSE 0 END), 0) AS days_90_plus
          FROM financial_relationships WHERE organization_id = $1 AND outstanding_amount > 0`, [organizationId]),
                query(`SELECT COALESCE(u.email, 'Unassigned') AS collector, COUNT(cc.id)::int AS active_cases,
          COALESCE(SUM(fr.outstanding_amount), 0) AS assigned_balance,
          COUNT(cc.id) FILTER (WHERE cc.status IN ('RESOLVED', 'CLOSED'))::int AS resolved_cases
          FROM collection_cases cc JOIN financial_relationships fr ON fr.id = cc.financial_relationship_id AND fr.organization_id = cc.organization_id
          LEFT JOIN organization_memberships m ON m.user_id = cc.assigned_user_id AND m.organization_id = cc.organization_id
          LEFT JOIN users u ON u.id = m.user_id
          WHERE cc.organization_id = $1 GROUP BY u.email ORDER BY assigned_balance DESC`, [organizationId]),
                query(`WITH risk_base AS (
          SELECT e.id, e.legal_name, COALESCE(SUM(fr.outstanding_amount), 0) AS outstanding,
            COALESCE(MAX(GREATEST(CURRENT_DATE - fr.due_date, 0)), 0) AS days_overdue,
            COUNT(ptp.id) FILTER (WHERE ptp.status = 'BROKEN')::int AS broken_promises
          FROM entities e JOIN financial_relationships fr ON fr.entity_id = e.id AND fr.organization_id = e.organization_id
          LEFT JOIN collection_cases cc ON cc.financial_relationship_id = fr.id AND cc.organization_id = fr.organization_id
          LEFT JOIN promises_to_pay ptp ON ptp.case_id = cc.id AND ptp.organization_id = cc.organization_id
          WHERE e.organization_id = $1 AND fr.organization_id = $1 AND fr.outstanding_amount > 0
          GROUP BY e.id, e.legal_name
        ) SELECT *, LEAST(100, (LEAST(days_overdue, 60) * 0.8 + CASE WHEN outstanding >= 250000 THEN 30 WHEN outstanding >= 100000 THEN 20 WHEN outstanding >= 50000 THEN 12 ELSE 5 END + broken_promises * 20))::int AS risk_score
        FROM risk_base ORDER BY risk_score DESC, outstanding DESC LIMIT 10`, [organizationId])
            ]);
            res.json({ success: true, data: { aging: aging.rows[0], collectors: collectors.rows, risks: risks.rows, scoring: 'Risk score = days overdue (max 48 points) + exposure (5–30 points) + 20 points per broken promise; capped at 100.' } });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unable to build report' });
        }
    });
    return router;
}
