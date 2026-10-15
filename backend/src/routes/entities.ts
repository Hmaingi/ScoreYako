import { Router } from 'express';
import { z } from 'zod';
import pool, { query } from '../lib/db.js';
import { requirePermission, audit } from '../lib/auth.js';
import { redactSensitiveIdentifiers } from '../lib/privacy.js';

const createEntitySchema = z.object({
  entity_type: z.enum(['INDIVIDUAL', 'BUSINESS']),
  legal_name: z.string().min(1),
  tax_id: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional()
});

const updateEntitySchema = z.object({
  entity_type: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  legal_name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
});

export function createEntityRouter() {
  const router = Router();

  router.get('/', requirePermission('entities:read'), async (req, res) => {
    try {
      const organizationId = req.tenant!.organizationId;
      const limit = Number(req.query.limit || 500);
      const offset = Number(req.query.offset || 0);
      const filterOrgId = req.query.organization_id as string | undefined;
      const filterPortfolioId = req.query.portfolio_id as string | undefined;
      const filterType = req.query.entity_type as string | undefined;
      const search = (req.query.search as string | undefined)?.trim();

      if (filterOrgId && filterOrgId !== organizationId) {
        return res.status(404).json({ success: false, error: 'Organization not found' });
      }

      const conditions: string[] = ['e.organization_id = $1'];
      const params: unknown[] = [organizationId];

      if (filterPortfolioId) {
        params.push(filterPortfolioId);
        conditions.push(`e.portfolio_id = $${params.length}`);
      }

      if (filterType && filterType !== 'ALL') {
        params.push(filterType);
        conditions.push(`e.entity_type = $${params.length}`);
      }

      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        conditions.push(`(
          LOWER(e.legal_name) LIKE $${params.length} OR 
          LOWER(COALESCE(e.email, '')) LIKE $${params.length} OR 
          LOWER(COALESCE(e.phone, '')) LIKE $${params.length} OR 
          LOWER(COALESCE(e.tax_id, '')) LIKE $${params.length} OR
          LOWER(COALESCE(e.extra_data::text, '')) LIKE $${params.length}
        )`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const result = await query(
        `
        SELECT 
          e.id,
          e.organization_id,
          e.portfolio_id,
          e.entity_type,
          e.legal_name,
          e.tax_id,
          e.phone,
          e.email,
          e.extra_data,
          e.created_at,
          e.last_imported_at,
          COALESCE(o.name, 'Default Organization') AS organization_name,
          COALESCE(p.name, 'Default Portfolio') AS portfolio_name,
          COALESCE(fr_stats.total_outstanding, 0) AS total_outstanding,
          COALESCE(fr_stats.relationship_count, 0) AS relationship_count,
          COALESCE(fr_stats.account_numbers, ARRAY[]::text[]) AS account_numbers,
          COALESCE(case_stats.case_count, 0) AS case_count
        FROM entities e
        LEFT JOIN organizations o ON o.id = e.organization_id
        LEFT JOIN portfolios p ON p.id = e.portfolio_id
        LEFT JOIN (
          SELECT 
            entity_id,
            SUM(outstanding_amount) AS total_outstanding,
            COUNT(id) AS relationship_count,
            ARRAY_AGG(DISTINCT account_number) FILTER (WHERE account_number IS NOT NULL) AS account_numbers
          FROM financial_relationships
          WHERE organization_id = $1
          GROUP BY entity_id
        ) fr_stats ON fr_stats.entity_id = e.id
        LEFT JOIN (
          SELECT 
            fr.entity_id,
            COUNT(cc.id) AS case_count
          FROM financial_relationships fr
          JOIN collection_cases cc ON cc.financial_relationship_id = fr.id
          WHERE fr.organization_id = $1 AND cc.organization_id = $1
          GROUP BY fr.entity_id
        ) case_stats ON case_stats.entity_id = e.id
        ${whereClause}
        ORDER BY e.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `,
        params
      );

      res.json({ success: true, data: redactSensitiveIdentifiers(result.rows) });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
  });

  router.post('/', requirePermission('entities:write'), async (req, res) => {
    try {
      const parsed = createEntitySchema.parse(req.body);
      const organizationId = req.tenant!.organizationId;

      const result = await query(
        `
          INSERT INTO entities (organization_id, entity_type, legal_name, tax_id, phone, email)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `,
        [organizationId, parsed.entity_type, parsed.legal_name, parsed.tax_id || null, parsed.phone || null, parsed.email || null]
      );

      await audit(req, 'ENTITY_CREATED', 'entity', result.rows[0].id);
      res.status(201).json({ success: true, data: redactSensitiveIdentifiers(result.rows[0]) });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Validation error' });
    }
  });

  router.patch('/:id', requirePermission('entities:write'), async (req, res) => {
    const organizationId = req.tenant!.organizationId;
    const client = await pool.connect();
    try {
      const parsed = updateEntitySchema.parse(req.body);
      if (Object.keys(parsed).length === 0) return res.status(400).json({ success: false, error: 'Provide at least one entity field to update.' });
      await client.query('BEGIN');
      const current = await client.query<{ entity_type: string }>(
        'SELECT entity_type FROM entities WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [String(req.params.id), organizationId],
      );
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Entity not found' });
      }
      const updated = await client.query(
        `UPDATE entities SET
           entity_type = COALESCE($1, entity_type),
           legal_name = COALESCE($2, legal_name),
           phone = CASE WHEN $3 THEN $4 ELSE phone END,
           email = CASE WHEN $5 THEN $6 ELSE email END
         WHERE id = $7 AND organization_id = $8
         RETURNING *`,
        [parsed.entity_type ?? null, parsed.legal_name ?? null, Object.hasOwn(parsed, 'phone'), parsed.phone ?? null, Object.hasOwn(parsed, 'email'), parsed.email ?? null, String(req.params.id), organizationId],
      );
      if (parsed.entity_type && parsed.entity_type !== current.rows[0].entity_type) {
        await client.query(
          `UPDATE kyc_profiles SET kyc_type = $1,
             status = CASE WHEN status = 'VERIFIED' THEN 'IN_PROGRESS' ELSE status END,
             verification_status = CASE WHEN verification_status = 'VERIFIED' THEN 'PENDING' ELSE verification_status END,
             verified_at = NULL, verified_by = NULL, updated_at = NOW()
           WHERE entity_id = $2 AND organization_id = $3`,
          [parsed.entity_type, String(req.params.id), organizationId],
        );
      }
      await client.query('COMMIT');
      await audit(req, 'ENTITY_UPDATED', 'entity', updated.rows[0].id, { fields: Object.keys(parsed) });
      res.json({ success: true, data: redactSensitiveIdentifiers(updated.rows[0]) });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unable to update entity' });
    } finally {
      client.release();
    }
  });

  // Deletes a single entity (business or individual) regardless of whether it has
  // financial relationships, cases, KYC, or raw import data attached — all of that
  // cascades via FK constraints on entities.id.
  router.delete('/:id', requirePermission('entities:write'), async (req, res) => {
    try {
      const organizationId = req.tenant!.organizationId;
      const result = await query<{ id: string }>('DELETE FROM entities WHERE id = $1 AND organization_id = $2 RETURNING id', [String(req.params.id), organizationId]);
      if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Entity not found' });
      await audit(req, 'ENTITY_DELETED', 'entity', result.rows[0].id);
      res.json({ success: true, data: { id: result.rows[0].id } });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unable to delete entity' });
    }
  });

  router.get('/:id/360', requirePermission('entities:read'), async (req, res) => {
    try {
      const entityId = req.params.id;

      const entityResult = await query(
        `SELECT e.*, 
                COALESCE(o.name, 'Default Organization') AS organization_name,
                COALESCE(p.name, 'Default Portfolio') AS portfolio_name,
                p.created_at AS portfolio_created_at,
                p.last_import_at AS portfolio_last_import_at
         FROM entities e
         LEFT JOIN organizations o ON o.id = e.organization_id
         LEFT JOIN portfolios p ON p.id = e.portfolio_id
         WHERE e.id = $1 AND e.organization_id = $2`,
        [entityId, req.tenant!.organizationId]
      );

      if (entityResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Entity not found' });
      }

      const entity = entityResult.rows[0];

      const relationships = await query(
        `SELECT * FROM financial_relationships WHERE entity_id = $1 AND organization_id = $2 ORDER BY due_date ASC`,
        [entityId, entity.organization_id]
      );

      const payments = await query(
        `SELECT p.* 
         FROM payments p 
         JOIN financial_relationships fr ON fr.id = p.financial_relationship_id 
         WHERE fr.entity_id = $1 AND fr.organization_id = $2 AND p.organization_id = $2
         ORDER BY p.payment_date DESC`,
        [entityId, entity.organization_id]
      );

      const cases = await query(
        `SELECT * FROM collection_cases 
         WHERE organization_id = $2 AND financial_relationship_id IN (SELECT id FROM financial_relationships WHERE entity_id = $1 AND organization_id = $2) 
         ORDER BY created_at DESC`,
        [entityId, entity.organization_id]
      );

      const promises = await query(
        `SELECT ptp.* FROM promises_to_pay ptp JOIN collection_cases cc ON cc.id = ptp.case_id AND cc.organization_id = ptp.organization_id WHERE ptp.entity_id = $1 AND ptp.organization_id = $2 AND cc.organization_id = $2 ORDER BY ptp.promised_date DESC`,
        [entityId, entity.organization_id]
      );

      const communications = await query(
        `SELECT * FROM communications WHERE entity_id = $1 AND organization_id = $2 ORDER BY created_at DESC`,
        [entityId, entity.organization_id]
      );

      const rawDataRows = await query<{
        id: string;
        sheet_name: string;
        raw_data: Record<string, unknown>;
        created_at: string;
      }>(
        `SELECT id, sheet_name, raw_data, created_at FROM entity_raw_data WHERE entity_id = $1 AND organization_id = $2 ORDER BY created_at DESC`,
        [entityId, entity.organization_id]
      );

      const kyc = await query(
        `SELECT kp.id, kp.kyc_type, kp.status, kp.risk_level, kp.verification_status,
                kp.verification_method, kp.verified_at, kp.rejection_reason, kp.notes,
                ki.first_name, ki.middle_name, ki.last_name, ki.date_of_birth,
                ki.gender, ki.nationality, ki.national_id, ki.passport_number,
                ki.tax_pin AS individual_tax_pin, ki.other_id_type, ki.other_id_number,
                kb.legal_name AS business_legal_name, kb.trading_name,
                kb.registration_number, kb.tax_pin AS business_tax_pin,
                kb.business_type, kb.incorporation_date, kb.country_of_incorporation,
                kb.registration_country
         FROM kyc_profiles kp
         LEFT JOIN kyc_individuals ki ON ki.kyc_profile_id = kp.id
         LEFT JOIN kyc_businesses kb ON kb.kyc_profile_id = kp.id
         WHERE kp.entity_id = $1 AND kp.organization_id = $2`,
        [entityId, entity.organization_id]
      );
      const kycProfile = kyc.rows[0] || null;

      // Build unified dictionary of all columns & attributes from Excel
      const allAttributes: Record<string, unknown> = {};

      if (entity.extra_data && typeof entity.extra_data === 'object') {
        Object.assign(allAttributes, entity.extra_data);
      }

      for (const rel of relationships.rows) {
        if (rel.account_number) allAttributes['Account Number'] = rel.account_number;
        if (rel.extra_data && typeof rel.extra_data === 'object') {
          Object.assign(allAttributes, rel.extra_data);
        }
      }

      for (const rd of rawDataRows.rows) {
        if (rd.raw_data && typeof rd.raw_data === 'object') {
          Object.assign(allAttributes, rd.raw_data);
        }
      }

      // If no explicit raw_data row in entity_raw_data table but we have attributes, provide a synthesized record
      const primaryRaw = rawDataRows.rows[0] || (
        Object.keys(allAttributes).length > 0 ? {
          id: 'synthesized',
          sheet_name: (entity.extra_data as Record<string, unknown>)?.source_sheet as string || 'Imported Data',
          raw_data: allAttributes,
          created_at: entity.created_at,
        } : null
      );

      res.json({
        success: true,
        data: redactSensitiveIdentifiers({
          entity,
          financial_relationships: relationships.rows,
          payments: payments.rows,
          collection_cases: cases.rows,
          promises_to_pay: promises.rows,
          communications: communications.rows,
          raw_data: primaryRaw,
          raw_records: rawDataRows.rows,
          all_attributes: allAttributes,
          kyc: kycProfile ? {
            ...kycProfile,
            national_id: kycProfile.national_id ? `••••${String(kycProfile.national_id).slice(-4)}` : null,
            passport_number: kycProfile.passport_number ? `••••${String(kycProfile.passport_number).slice(-4)}` : null,
            individual_tax_pin: kycProfile.individual_tax_pin ? `••••${String(kycProfile.individual_tax_pin).slice(-4)}` : null,
            business_tax_pin: kycProfile.business_tax_pin ? `••••${String(kycProfile.business_tax_pin).slice(-4)}` : null,
          } : null,
        })
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
    }
  });

  return router;
}
