import { Router } from 'express';
import { query } from '../lib/db.js';
import { buildDashboardOverview } from '../lib/dashboard.js';

export function createDashboardRouter() {
  const router = Router();

  router.get('/summary', async (req, res) => {
    try {
      const organizationId = req.tenant!.organizationId;

      const summaryResult = await query(
        `
          WITH org_financials AS (
            SELECT
              COALESCE(SUM(fr.original_amount), 0) AS total_exposure,
              COALESCE(SUM(fr.outstanding_amount), 0) AS outstanding,
              COALESCE(SUM(CASE WHEN fr.status IN ('OVERDUE') OR (fr.due_date < CURRENT_DATE AND fr.outstanding_amount > 0) THEN fr.outstanding_amount ELSE 0 END), 0) AS overdue,
              COUNT(DISTINCT CASE WHEN fr.outstanding_amount > 0 AND fr.status IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE') THEN fr.entity_id END) AS high_risk_entities,
              COALESCE(SUM(CASE WHEN ptp.status = 'BROKEN' THEN ptp.promised_amount ELSE 0 END), 0) AS broken_promises_value,
              COALESCE(SUM(CASE WHEN p.amount_paid > 0 AND p.payment_date >= DATE_TRUNC('month', CURRENT_DATE) THEN p.amount_paid ELSE 0 END), 0) AS recovered_this_month,
              COUNT(DISTINCT CASE WHEN ptp.status = 'BROKEN' THEN ptp.id END) AS broken_promises
            FROM financial_relationships fr
            LEFT JOIN collection_cases cc ON cc.financial_relationship_id = fr.id AND cc.organization_id = fr.organization_id
            LEFT JOIN promises_to_pay ptp ON ptp.case_id = cc.id AND ptp.organization_id = cc.organization_id
            LEFT JOIN payments p ON p.financial_relationship_id = fr.id AND p.organization_id = fr.organization_id
            WHERE fr.organization_id = $1
          )
          SELECT
            total_exposure,
            outstanding,
            overdue,
            high_risk_entities,
            broken_promises,
            broken_promises_value,
            recovered_this_month,
            CASE WHEN total_exposure > 0 THEN ((outstanding / total_exposure) * 100) ELSE 0 END AS debt_rate,
            CASE WHEN total_exposure > 0 THEN ((outstanding - overdue) / total_exposure * 100) ELSE 0 END AS exposure_trend
          FROM org_financials;
        `,
        [organizationId]
      );

      const row = summaryResult.rows[0] || {
        total_exposure: 0,
        outstanding: 0,
        overdue: 0,
        high_risk_entities: 0,
        broken_promises: 0,
        broken_promises_value: 0,
        recovered_this_month: 0,
        debt_rate: 0,
        exposure_trend: 0,
      };

      const overview = buildDashboardOverview({
        totalExposure: Number(row.total_exposure || 0),
        outstanding: Number(row.outstanding || 0),
        overdue: Number(row.overdue || 0),
        highRiskEntities: Number(row.high_risk_entities || 0),
        brokenPromises: Number(row.broken_promises || 0),
        recoveredThisMonth: Number(row.recovered_this_month || 0),
        needsAttention: Number((row.broken_promises || 0) + (row.high_risk_entities || 0)),
        exposureTrend: Number(row.exposure_trend || 0),
      });

      res.json({ success: true, data: overview });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
  });

  router.get('/needs-attention', async (req, res) => {
    try {
      const organizationId = req.tenant!.organizationId;
      const limit = Number(req.query.limit || 50);
      const riskThreshold = Number(req.query.risk_threshold || 50000);

      const rows = await query(
        `
          WITH overdue AS (
            SELECT fr.organization_id, fr.entity_id, e.legal_name, fr.id AS relationship_id, fr.outstanding_amount AS amount,
                   fr.currency, fr.due_date, cc.id AS case_id, cc.priority, 'OVERDUE' AS queue_type
            FROM financial_relationships fr
            JOIN entities e ON e.id = fr.entity_id AND e.organization_id = fr.organization_id
            LEFT JOIN collection_cases cc ON cc.financial_relationship_id = fr.id AND cc.organization_id = fr.organization_id
            WHERE fr.organization_id = $1
              AND fr.outstanding_amount > 0
              AND fr.status IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
              AND fr.due_date < CURRENT_DATE
          ),
          broken_promises AS (
            SELECT cc.organization_id, ptp.entity_id, e.legal_name, ptp.id AS promise_id, ptp.promised_amount AS amount,
                   ptp.promised_date, cc.id AS case_id, cc.priority, 'BROKEN_PROMISE' AS queue_type
            FROM promises_to_pay ptp
            JOIN collection_cases cc ON cc.id = ptp.case_id AND cc.organization_id = ptp.organization_id
            JOIN entities e ON e.id = ptp.entity_id AND e.organization_id = cc.organization_id
            WHERE cc.organization_id = $1 AND ptp.status = 'BROKEN'
          ),
          high_risk AS (
            SELECT fr.organization_id, fr.entity_id, e.legal_name, fr.id AS relationship_id, fr.outstanding_amount AS amount,
                   fr.currency, fr.due_date, cc.id AS case_id, cc.priority, 'HIGH_RISK' AS queue_type
            FROM financial_relationships fr
            JOIN entities e ON e.id = fr.entity_id AND e.organization_id = fr.organization_id
            LEFT JOIN collection_cases cc ON cc.financial_relationship_id = fr.id AND cc.organization_id = fr.organization_id
            WHERE fr.organization_id = $1
              AND fr.outstanding_amount > 0
              AND fr.status IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
              AND fr.outstanding_amount >= $2
          )
          SELECT * FROM (
            SELECT * FROM overdue
            UNION ALL
            SELECT * FROM broken_promises
            UNION ALL
            SELECT * FROM high_risk
          ) q
          ORDER BY CASE q.queue_type
            WHEN 'BROKEN_PROMISE' THEN 1
            WHEN 'OVERDUE' THEN 2
            WHEN 'HIGH_RISK' THEN 3
            ELSE 4
          END,
          q.due_date NULLS LAST,
          q.promised_date NULLS LAST
          LIMIT $3
        `,
        [organizationId, riskThreshold, limit]
      );

      res.json({ success: true, data: rows.rows });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
  });

  return router;
}
