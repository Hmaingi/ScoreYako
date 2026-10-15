import { Router } from 'express';
import { query } from '../lib/db.js';

export function createIntelligenceRouter() {
	const router = Router();

	router.get('/entities/:id', async (req, res) => {
		try {
			const organizationId = req.tenant!.organizationId;
			const result = await query(
				`WITH signals AS (
					SELECT e.id, e.legal_name,
						COALESCE(SUM(fr.outstanding_amount), 0) AS outstanding,
						COALESCE(MAX(GREATEST(CURRENT_DATE - fr.due_date, 0)), 0) AS days_overdue,
						COUNT(DISTINCT fr.id)::int AS active_obligations,
						COUNT(ptp.id) FILTER (WHERE ptp.status = 'BROKEN')::int AS broken_promises,
						COALESCE(SUM(p.amount_paid) FILTER (WHERE p.payment_date >= CURRENT_DATE - INTERVAL '60 days'), 0) AS recent_payments
					FROM entities e
					JOIN financial_relationships fr ON fr.entity_id = e.id AND fr.organization_id = e.organization_id
					LEFT JOIN collection_cases cc ON cc.financial_relationship_id = fr.id AND cc.organization_id = fr.organization_id
					LEFT JOIN promises_to_pay ptp ON ptp.case_id = cc.id AND ptp.organization_id = cc.organization_id
					LEFT JOIN payments p ON p.financial_relationship_id = fr.id AND p.organization_id = fr.organization_id
					WHERE e.id = $1 AND e.organization_id = $2 AND fr.outstanding_amount > 0
					GROUP BY e.id, e.legal_name
				)
				SELECT *, LEAST(100, (LEAST(days_overdue, 60) * 0.8 +
					CASE WHEN outstanding >= 250000 THEN 30 WHEN outstanding >= 100000 THEN 20
							 WHEN outstanding >= 50000 THEN 12 ELSE 5 END + broken_promises * 20))::int AS risk_score
				FROM signals`,
				[String(req.params.id), organizationId],
			);
			const signal = result.rows[0];
			if (!signal) return res.status(404).json({ success: false, error: 'Entity not found' });

			const reasons = [
				`${signal.days_overdue} days overdue`,
				`${Number(signal.outstanding).toLocaleString()} outstanding exposure`,
				`${signal.broken_promises} broken promise(s)`,
				`${signal.active_obligations} active obligation(s)`,
			];
			const recommendation = signal.risk_score >= 70
				? 'Escalate today and offer a structured repayment plan.'
				: signal.risk_score >= 40
					? 'Contact this week, confirm affordability, and secure a dated promise.'
					: 'Monitor the next due date and maintain proactive contact.';
			await query(
				'INSERT INTO risk_snapshots (organization_id, entity_id, risk_score, rationale) VALUES ($1, $2, $3, $4)',
				[organizationId, signal.id, signal.risk_score, JSON.stringify({ reasons, recommendation })],
			);
			res.json({ success: true, data: { ...signal, reasons, recommendation } });
		} catch {
			res.status(500).json({ success: false, error: 'Unable to calculate intelligence' });
		}
	});

	router.get('/monitoring/alerts', async (req, res) => {
		try {
			const organizationId = req.tenant!.organizationId;
			const rows = await query(
				`SELECT * FROM (
					SELECT 'BROKEN_PROMISE' AS type, e.id AS entity_id, e.legal_name,
						ptp.promised_amount AS amount, 'Escalate the broken promise today.' AS recommendation
					FROM promises_to_pay ptp
					JOIN collection_cases cc ON cc.id = ptp.case_id AND cc.organization_id = ptp.organization_id
					JOIN entities e ON e.id = ptp.entity_id AND e.organization_id = ptp.organization_id
					WHERE ptp.organization_id = $1 AND cc.organization_id = $1 AND ptp.status = 'BROKEN'
					UNION ALL
					SELECT 'OVERDUE_30_DAYS', e.id, e.legal_name, fr.outstanding_amount,
						'Contact and agree a structured repayment plan.'
					FROM financial_relationships fr
					JOIN entities e ON e.id = fr.entity_id AND e.organization_id = fr.organization_id
					WHERE fr.organization_id = $1 AND e.organization_id = $1
						AND fr.outstanding_amount > 0 AND fr.due_date < CURRENT_DATE - INTERVAL '30 days'
				) alerts ORDER BY amount DESC`,
				[organizationId],
			);
			res.json({ success: true, data: rows.rows });
		} catch {
			res.status(500).json({ success: false, error: 'Unable to load monitoring alerts' });
		}
	});

	return router;
}