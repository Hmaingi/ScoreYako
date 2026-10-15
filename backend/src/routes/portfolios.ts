import { Router } from 'express';
import pool, { query } from '../lib/db.js';
import { requirePermission, audit } from '../lib/auth.js';

export function createPortfoliosRouter() {
  const router = Router();

  // GET /api/v1/portfolios — list business/org groups (portfolios) with counts and import dates,
  // so users can tell when a group was first created vs. most recently (re-)uploaded.
  router.get('/', requirePermission('entities:read'), async (req, res) => {
    try {
      const organizationId = req.tenant!.organizationId;

      const result = await query(
        `
        SELECT
          p.id,
          p.organization_id,
          p.name,
          p.created_at,
          p.last_import_at,
          COALESCE(o.name, 'Default Organization') AS organization_name,
          COALESCE(e_stats.entity_count, 0) AS entity_count,
          COALESCE(e_stats.total_outstanding, 0) AS total_outstanding
        FROM portfolios p
        LEFT JOIN organizations o ON o.id = p.organization_id
        LEFT JOIN (
          SELECT
            e.portfolio_id,
            e.organization_id,
            COUNT(e.id) AS entity_count,
            COALESCE(SUM(fr_stats.total_outstanding), 0) AS total_outstanding
          FROM entities e
          LEFT JOIN (
            SELECT entity_id, organization_id, SUM(outstanding_amount) AS total_outstanding
            FROM financial_relationships
            GROUP BY entity_id, organization_id
          ) fr_stats ON fr_stats.entity_id = e.id AND fr_stats.organization_id = e.organization_id
          WHERE e.organization_id = $1
          GROUP BY e.portfolio_id, e.organization_id
        ) e_stats ON e_stats.portfolio_id = p.id AND e_stats.organization_id = p.organization_id
        WHERE p.organization_id = $1
        ORDER BY p.last_import_at DESC NULLS LAST, p.created_at DESC
        `,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
  });

  // DELETE /api/v1/portfolios/:id — deletes an entire business/org group: every entity under
  // it (which cascades to relationships, payments, cases, promises, communications, raw data,
  // and KYC via FK ON DELETE CASCADE), then the portfolio itself. Works whether or not the
  // group's entities have any data attached.
  router.delete('/:id', requirePermission('entities:write'), async (req, res) => {
    const portfolioId = String(req.params.id);
    const organizationId = req.tenant!.organizationId;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const portfolio = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM portfolios WHERE id = $1 AND organization_id = $2',
        [portfolioId, organizationId]
      );
      if (!portfolio.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Business/org group not found' });
      }

      const deletedEntities = await client.query<{ id: string }>(
        'DELETE FROM entities WHERE portfolio_id = $1 AND organization_id = $2 RETURNING id',
        [portfolioId, organizationId]
      );

      await client.query('DELETE FROM portfolios WHERE id = $1 AND organization_id = $2', [portfolioId, organizationId]);

      await client.query('COMMIT');

      const result = { id: portfolio.rows[0].id, name: portfolio.rows[0].name, deletedEntityCount: deletedEntities.rows.length };
      await audit(req, 'PORTFOLIO_DELETED', 'portfolio', result.id);
      res.json({ success: true, data: result });
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unable to delete business/org group' });
    } finally {
      client.release();
    }
  });

  return router;
}
