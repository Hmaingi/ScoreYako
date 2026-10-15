import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import type { PoolClient } from 'pg';
import pool, { query } from '../lib/db.js';
import { requirePermission } from '../lib/auth.js';
import {
  parseWorkbookSheets,
  inspectSheetMatrix,
  buildImportReviewItems,
  clusterEntities,
  normalizeName,
  text,
  type EntityRecord,
  type ParsedWorkbook,
  type ParsedSheetResult,
  type GroupSuggestion,
  type ImportReviewItem,
  type SheetInspection,
} from '../lib/importer.js';

export { parseCustomerSheet, parseObligationsSheet, parsePaymentsSheet } from '../lib/importer.js';

type StoredGroup = GroupSuggestion & { id: string };

type StoredRawSheet = {
  name: string;
  rows: Record<string, unknown>[];
  inspection?: SheetInspection;
};

// === Helpers shared with the persisted import job ===

async function getOrCreatePortfolio(
  organizationId: string,
  name: string,
  client: PoolClient | typeof pool = pool,
  touchLastImport = false,
): Promise<string> {
  const portfolioName = text(name) || 'Imported Portfolio';
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM portfolios WHERE organization_id = $1 AND name = $2 LIMIT 1',
    [organizationId, portfolioName],
  );
  if (existing.rows[0]) {
    // Same name within the same organization means the same business/org group: merge into it
    // and, only at actual commit time, record this as its most recent (re-)upload.
    if (touchLastImport) {
      await client.query('UPDATE portfolios SET last_import_at = NOW() WHERE id = $1', [existing.rows[0].id]);
    }
    return existing.rows[0].id;
  }
  const created = await client.query<{ id: string }>(
    `INSERT INTO portfolios (organization_id, name, source_type, last_import_at)
     VALUES ($1, $2, 'EXCEL', ${touchLastImport ? 'NOW()' : 'NULL'})
     RETURNING id`,
    [organizationId, portfolioName],
  );
  return created.rows[0].id;
}

function defaultGroups(parsed: ParsedWorkbook, portfolioNameHint: string): StoredGroup[] {
  if (parsed.sheets.length === 0) return [];

  // Default to one portfolio group per sheet so users can rename and merge related sheets.
  if (parsed.sheets.length > 1) {
    return parsed.sheets.map((sheet, index) => ({
      id: `group-${index + 1}`,
      name: sheet.name || `Sheet ${index + 1}`,
      confidence: 95,
      commonField: 'sheet_name',
      sheets: [sheet.name],
      reason: 'Each sheet starts as its own portfolio group so it can be renamed individually.',
    }));
  }

  const singleSheet = parsed.sheets[0];
  return [{
    id: 'group-1',
    name: portfolioNameHint || singleSheet.name || 'Imported Organization',
    confidence: 95,
    commonField: 'sheet_name',
    sheets: [singleSheet.name],
    reason: 'Single-sheet workbook, ready for a custom portfolio name.',
  }];
}

async function findExistingEntityKeys(organizationId: string, portfolioId: string): Promise<Set<string>> {
  const rows = await query<{ legal_name: string }>(
    `SELECT LOWER(legal_name) AS legal_name FROM entities WHERE organization_id = $1 AND portfolio_id = $2`,
    [organizationId, portfolioId],
  );
  return new Set(rows.rows.map((row) => row.legal_name));
}

async function insertRawImportRows(
  client: PoolClient,
  organizationId: string,
  importJobId: string,
  rows: Array<{ sheetName: string; sourceRowNumber: number; reason: string; rawData: Record<string, unknown> }>,
): Promise<number> {
  let insertedCount = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const values: unknown[] = [];
    const placeholders = chunk.map((row, index) => {
      const base = index * 6;
      values.push(organizationId, importJobId, row.sheetName, row.sourceRowNumber, row.reason, JSON.stringify(row.rawData));
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    }).join(', ');
    const result = await client.query(
      `INSERT INTO import_job_raw_rows (organization_id, import_job_id, sheet_name, source_row_number, reason, raw_data)
       VALUES ${placeholders}
       ON CONFLICT (import_job_id, sheet_name, source_row_number) DO NOTHING`,
      values,
    );
    insertedCount += result.rowCount ?? 0;
  }
  return insertedCount;
}

// === Multer / XLSX ingestion ===

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, /\.(xlsx|xls|csv)$/i.test(file.originalname)),
});

export function readWorkbookSheets(buffer: Buffer): Array<{ name: string; rows: Record<string, unknown>[]; inspection: import('../lib/importer.js').SheetInspection }> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return Object.entries(workbook.Sheets)
    .filter(([, worksheet]) => Boolean(worksheet))
    .map(([name, worksheet]) => {
      // header: 1 preserves title rows, blank cells, and duplicate headings so the
      // inspection stage can choose a header rather than SheetJS choosing row one.
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: false, blankrows: true });
      return inspectSheetMatrix(name, matrix);
    });
}

export function createImportRouter() {
  const router = Router();

  router.get('/jobs', requirePermission('imports:read'), async (req: Request, res: Response) => {
    try {
      const result = await query<{
        id: string;
        file_name: string;
        status: string;
        validation_result: Record<string, unknown>;
        created_at: string;
        committed_at: string | null;
      }>(
        `SELECT id, file_name, status, validation_result, created_at, committed_at
         FROM import_jobs
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [req.tenant!.organizationId],
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unable to load import history.',
      });
    }
  });

  router.get('/jobs/:jobId', requirePermission('imports:read'), async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT id, file_name, status, validation_result, created_at, committed_at,
                created_entities, created_relationships
         FROM import_jobs WHERE id = $1 AND organization_id = $2`,
        [String(req.params.jobId), req.tenant!.organizationId],
      );
      if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Import job not found.' });
      res.json({ success: true, data: result.rows[0] });
    } catch {
      res.status(500).json({ success: false, error: 'Unable to load import job.' });
    }
  });

  // POST /api/v1/imports/preview — parses the workbook once and persists the result so the
  // reviewed data (not a re-parse of the file) is what gets committed later.
  router.post('/preview', requirePermission('imports:write'), upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Upload an .xlsx, .xls, or .csv workbook under 5 MB.' });
    }

    try {
      const sheetRows = readWorkbookSheets(req.file.buffer);
      const parsed = parseWorkbookSheets(sheetRows, req.file.originalname);

      if (parsed.totalRows === 0) {
        return res.status(400).json({ success: false, error: 'No data found in workbook.' });
      }

      const portfolioNameHint = text(req.body.portfolioName) || req.file.originalname.replace(/\.(xlsx|xls|csv)$/i, '');
      const groups = defaultGroups(parsed, portfolioNameHint);

      const organizationId = req.tenant!.organizationId;
      const allFieldMappings = parsed.sheets.flatMap((sheet) => sheet.fieldMappings);
      const allIssues = parsed.sheets.flatMap((sheet) => sheet.validationResult.issues.map((issue) => `${sheet.name}: ${issue}`));
      const reviewItems = buildImportReviewItems(parsed, new Map(sheetRows.map((sheet) => [sheet.name, sheet.inspection])));
      const reviewRows = reviewItems.length;

      const jobResult = await query<{ id: string }>(
        `INSERT INTO import_jobs (
           organization_id, status, file_name, file_buffer,
           parsed_data, field_mappings, validation_result
         ) VALUES ($1, 'PREVIEW', $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          organizationId,
          req.file.originalname,
          req.file.buffer,
          JSON.stringify({ ...parsed, groups, rawSheets: sheetRows }),
          JSON.stringify(allFieldMappings),
          JSON.stringify({
            totalRows: parsed.totalRows,
            validRows: parsed.validRows,
            errorRows: parsed.errorRows,
            reviewRows,
            reviewItems,
            reviewedItemIds: [],
            issues: allIssues,
          }),
        ],
      );

      res.json({
        success: true,
        data: {
          jobId: jobResult.rows[0].id,
          fileName: parsed.fileName,
          totalRows: parsed.totalRows,
          validRows: parsed.validRows,
          errorRows: parsed.errorRows,
          reviewRows,
          entityClusters: parsed.entityClusterCount,
          sheets: parsed.sheets.map((sheet) => ({
            name: sheet.name,
            type: sheet.type,
            confidence: sheet.confidence,
            rowCount: sheet.validationResult.totalRows,
            headers: sheet.headers,
            inspection: sheetRows.find((source) => source.name === sheet.name)?.inspection,
            sampleRows: sheetRows.find((source) => source.name === sheet.name)?.rows.slice(0, 5) ?? [],
            rejectedRows: (sheet.validationResult.skippedRows ?? []).slice(0, 5),
          })),
          fieldMatches: allFieldMappings.filter((fm) => fm.status === 'MATCHED'),
          uncertainFields: allFieldMappings.filter((fm) => fm.status === 'REVIEW'),
          unknownFields: allFieldMappings.filter((fm) => fm.status === 'UNKNOWN'),
          issues: allIssues.slice(0, 30),
          ready: parsed.errorRows === 0 && reviewRows === 0,
          reviewItems,
          groups,
          possibleMatches: parsed.possibleMatches.slice(0, 30),
          deterministicMatches: parsed.deterministicMatches.slice(0, 30),
        },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unable to read workbook.',
      });
    }
  });

  router.patch('/:jobId/reviews', requirePermission('imports:write'), async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<{
        status: string;
        parsed_data: ParsedWorkbook & { rawSheets?: StoredRawSheet[] };
        validation_result: Record<string, unknown>;
      }>(
        'SELECT status, parsed_data, validation_result FROM import_jobs WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [jobId, req.tenant!.organizationId],
      );
      const job = result.rows[0];
      if (!job) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Import job not found.' });
      }
      if (job.status !== 'PREVIEW') {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: `Job is already ${job.status.toLowerCase()}.` });
      }

      const resolvedItemId = req.body.resolvedItemId;
      if (typeof resolvedItemId !== 'string') {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Provide a review item to resolve.' });
      }

      const inspections = new Map((job.parsed_data.rawSheets ?? [])
        .filter((sheet) => sheet.inspection)
        .map((sheet) => [sheet.name, sheet.inspection as SheetInspection]));
      const reviewItems = buildImportReviewItems(job.parsed_data, inspections);
      if (!reviewItems.some((item) => item.id === resolvedItemId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'That review item does not belong to this import.' });
      }

      const validation = job.validation_result ?? {};
      const reviewedItemIds = new Set(Array.isArray(validation.reviewedItemIds)
        ? validation.reviewedItemIds.filter((id): id is string => typeof id === 'string')
        : []);
      reviewedItemIds.add(resolvedItemId);
      const resolvedIds = [...reviewedItemIds];
      const updatedItems: ImportReviewItem[] = reviewItems.map((item) => ({ ...item, resolved: reviewedItemIds.has(item.id) }));
      const remaining = updatedItems.filter((item) => !item.resolved).length;
      const invalidRowsRemain = updatedItems.some((item) => item.type === 'INVALID_ROWS' && !item.resolved);
      const ready = remaining === 0 && !invalidRowsRemain;

      await client.query(
        'UPDATE import_jobs SET validation_result = $1 WHERE id = $2 AND organization_id = $3',
        [JSON.stringify({ ...validation, reviewItems: updatedItems, reviewedItemIds: resolvedIds, reviewRows: remaining }), jobId, req.tenant!.organizationId],
      );
      await client.query('COMMIT');
      res.json({ success: true, data: { reviewItems: updatedItems, reviewRows: remaining, ready } });
    } catch {
      try { await client.query('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      res.status(500).json({ success: false, error: 'Unable to save import review decision.' });
    } finally {
      client.release();
    }
  });

  // PATCH /api/v1/imports/:jobId/groups — rename, merge, split, or move sheets between tenant-local portfolios.
  router.patch('/:jobId/groups', requirePermission('imports:write'), async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const jobResult = await client.query<{ parsed_data: ParsedWorkbook & { groups: StoredGroup[] }; status: string }>(
        'SELECT parsed_data, status FROM import_jobs WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [jobId, req.tenant!.organizationId],
      );
      const job = jobResult.rows[0];
      if (!job) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Import job not found.' });
      }
      if (job.status !== 'PREVIEW') {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: `Job is already ${job.status.toLowerCase()}.` });
      }

      // Do the tenant-scoped resource lookup before inspecting mutation content. This
      // prevents a malformed request from revealing whether another tenant's job exists.
      const nextGroups = req.body.groups as StoredGroup[] | undefined;
      if (!Array.isArray(nextGroups) || nextGroups.length === 0 || nextGroups.some((group) => !group || typeof group !== 'object' || Array.isArray(group))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Provide a non-empty groups array.' });
      }
      if (nextGroups.some((group) => 'organization_id' in (group as object))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Import groups cannot select an organization.' });
      }
      if (nextGroups.some((group) => typeof group.name !== 'string' || !group.name.trim() || group.name.length > 255 || !Array.isArray(group.sheets)
        || group.sheets.some((sheet) => typeof sheet !== 'string'))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Each group needs a name and a sheets array.' });
      }

      const allSheetNames = new Set(job.parsed_data.sheets.map((sheet) => sheet.name));
      const assignedSheetNames = nextGroups.flatMap((group) => group.sheets);
      if (new Set(assignedSheetNames).size !== assignedSheetNames.length
        || assignedSheetNames.length !== allSheetNames.size
        || assignedSheetNames.some((name) => !allSheetNames.has(name))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Each workbook sheet must belong to exactly one group.' });
      }
      
      const updatedParsedData = { ...job.parsed_data, groups: nextGroups };
      await client.query('UPDATE import_jobs SET parsed_data = $1, group_assignments = $2 WHERE id = $3 AND organization_id = $4',
        [JSON.stringify(updatedParsedData), JSON.stringify({ groups: nextGroups }), jobId, req.tenant!.organizationId]);
      await client.query('COMMIT');

      res.json({ success: true, data: { groups: nextGroups } });
    } catch {
      try { await client.query('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      res.status(500).json({ success: false, error: 'Unable to update import groups.' });
    } finally {
      client.release();
    }
  });

  // POST /api/v1/imports/:jobId/commit — commits exactly the reviewed parsed_data for this job.
  // The original workbook is never re-parsed here.
  router.post('/:jobId/commit', requirePermission('imports:write'), async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const jobResult = await client.query<{
        organization_id: string;
        file_name: string;
        status: string;
        validation_result: { errorRows?: number; reviewRows?: number; reviewItems?: ImportReviewItem[]; reviewedItemIds?: string[] };
        parsed_data: ParsedWorkbook & { groups: StoredGroup[]; rawSheets?: StoredRawSheet[] };
      }>('SELECT organization_id, file_name, status, validation_result, parsed_data FROM import_jobs WHERE id = $1 AND organization_id = $2 FOR UPDATE', [jobId, req.tenant!.organizationId]);
      const job = jobResult.rows[0];

      if (!job) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Import job not found.' });
      }
      if (job.status !== 'PREVIEW') {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: `Job is already ${job.status.toLowerCase()}.` });
      }

      const validationErrors = Number(job.validation_result?.errorRows ?? 0);
      const reviewedItemIds = new Set(job.validation_result?.reviewedItemIds ?? []);
      const reviewItems = job.validation_result?.reviewItems ?? buildImportReviewItems(
        job.parsed_data,
        new Map((job.parsed_data.rawSheets ?? []).filter((sheet) => sheet.inspection).map((sheet) => [sheet.name, sheet.inspection as SheetInspection])),
      );
      const unresolvedReviewItems = reviewItems.filter((item) => !reviewedItemIds.has(item.id));
      const invalidRowsUnreviewed = reviewItems.some((item) => item.type === 'INVALID_ROWS' && !reviewedItemIds.has(item.id));
      const legacyReviewRows = Number(job.validation_result?.reviewRows ?? 0);
      if (unresolvedReviewItems.length > 0 || (validationErrors > 0 && invalidRowsUnreviewed)
        || (legacyReviewRows > 0 && reviewItems.length === 0)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: 'Import has unresolved review items. Resolve each item in the preview before committing.' });
      }

      const parsed = job.parsed_data;
      const groups: StoredGroup[] = parsed.groups?.length ? parsed.groups : defaultGroups(parsed, job.file_name);
      const expectedSheets = new Set(parsed.sheets.map((sheet) => sheet.name));
      const assignedSheets = groups.flatMap((group) => Array.isArray(group.sheets) ? group.sheets : []);
      if (groups.some((group) => typeof group.name !== 'string' || !group.name.trim() || group.name.length > 255)
        || new Set(assignedSheets).size !== assignedSheets.length
        || assignedSheets.length !== expectedSheets.size
        || assignedSheets.some((sheetName) => !expectedSheets.has(sheetName))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: 'Import sheet assignments are invalid. Review the preview and save its groups again.' });
      }
      const baseOrganizationId = job.organization_id;
      const rawSheetMap = new Map<string, Record<string, unknown>[]>();
      if (parsed.rawSheets) {
        for (const sheet of parsed.rawSheets) {
          rawSheetMap.set(sheet.name, sheet.rows);
        }
      }

      const orgResult = await client.query<{ currency: string }>(
        'SELECT currency FROM organizations WHERE id = $1', 
        [baseOrganizationId]
      );
      const fallbackCurrency = orgResult.rows[0]?.currency || 'USD';

      let createdEntities = 0;
      let createdRelationships = 0;
      let createdPayments = 0;
      let linkedProperties = 0;
      let createdCommunications = 0;
      let createdPromises = 0;
      let preservedRawRows = 0;

      const sheetByName = new Map<string, ParsedSheetResult>(parsed.sheets.map((sheet) => [sheet.name, sheet]));

      for (const group of groups) {
        const groupSheets = group.sheets.map((name) => sheetByName.get(name)).filter((s): s is ParsedSheetResult => Boolean(s));
        if (groupSheets.length === 0) continue;

        const organizationId = baseOrganizationId;
        const portfolioId = await getOrCreatePortfolio(organizationId, group.name, client, true);
        const existingKeys = await findExistingEntityKeys(organizationId, portfolioId);

        const allEntities: EntityRecord[] = groupSheets.flatMap((sheet) => sheet.entities);
        const { clusterOf } = clusterEntities(allEntities);

        // Pick one canonical entity per cluster: the first row with a name, merging extra_data.
        const canonicalByCluster = new Map<number, EntityRecord>();
        allEntities.forEach((entity, index) => {
          const clusterId = clusterOf[index];
          const existing = canonicalByCluster.get(clusterId);
          if (!existing) {
            canonicalByCluster.set(clusterId, { ...entity, extra_data: { ...entity.extra_data } });
          } else {
            canonicalByCluster.set(clusterId, {
              ...existing,
              phone: existing.phone || entity.phone,
              email: existing.email || entity.email,
              account_number: existing.account_number || entity.account_number,
              tax_id: existing.tax_id || entity.tax_id,
              extra_data: { ...entity.extra_data, ...existing.extra_data },
            });
          }
        });

        const entityIdByKey = new Map<string, string>();
        const insertRows: Array<[string, string, string, string, string | null, string | null, string | null, string]> = [];
        const entitiesToInsert: EntityRecord[] = [];

        for (const entity of canonicalByCluster.values()) {
          const key = normalizeName(entity.customer_name).toLowerCase();
          if (existingKeys.has(key)) continue;

          entitiesToInsert.push(entity);
          insertRows.push([
            organizationId,
            portfolioId,
            entity.entity_type,
            entity.customer_name,
            entity.tax_id || null,
            entity.phone || null,
            entity.email || null,
            JSON.stringify({ ...entity.extra_data, source_group: group.name, source_file: job.file_name }),
          ]);
        }

        if (insertRows.length > 0) {
          const values = insertRows.flatMap((row) => row);
          const placeholders = insertRows
            .map((_, i) => `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`)
            .join(', ');
          const inserted = await client.query<{ id: string; legal_name: string }>(
            `INSERT INTO entities (organization_id, portfolio_id, entity_type, legal_name, tax_id, phone, email, extra_data)
             VALUES ${placeholders}
             RETURNING id, legal_name`,
            values,
          );
          for (const row of inserted.rows) entityIdByKey.set(row.legal_name.toLowerCase(), row.id);
          createdEntities += inserted.rows.length;
        }

        // Resolve every entity key (existing or newly inserted) to an id for relationship linking and raw data storage.
        if (existingKeys.size > 0) {
          const lookup = await client.query<{ id: string; legal_name: string }>(
            `SELECT id, LOWER(legal_name) AS legal_name FROM entities WHERE organization_id = $1 AND portfolio_id = $2`,
            [organizationId, portfolioId],
          );
          for (const row of lookup.rows) if (!entityIdByKey.has(row.legal_name)) entityIdByKey.set(row.legal_name, row.id);
        }

        // Store comprehensive raw data for all entities (new and existing)
        for (const entity of canonicalByCluster.values()) {
          const key = normalizeName(entity.customer_name).toLowerCase();
          const entityId = entityIdByKey.get(key);
          if (!entityId) continue;

          // Update extra_data with all attributes and stamp this as the most recent upload
          // for this entity, distinct from its original created_at.
          await client.query(
            `UPDATE entities 
             SET extra_data = COALESCE(extra_data, '{}'::jsonb) || $1::jsonb,
                 last_imported_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(entity.extra_data), entityId]
          );

          // Search all raw rows in the group sheets for matches to this entity
          const normalizedEntityName = normalizeName(entity.customer_name).toLowerCase();
          const entityAcc = entity.account_number ? String(entity.account_number).trim().toLowerCase() : '';
          const entityPhone = entity.phone ? String(entity.phone).replace(/\D/g, '') : '';
          const entityEmail = entity.email ? String(entity.email).trim().toLowerCase() : '';

          let storedAnyRaw = false;

          for (const sheet of groupSheets) {
            const rawRows = rawSheetMap.get(sheet.name);
            if (!rawRows) continue;

            for (const row of rawRows) {
              let isMatch = false;

              for (const [col, val] of Object.entries(row)) {
                if (val === null || val === undefined) continue;
                const strVal = String(val).trim();
                const lowerVal = strVal.toLowerCase();

                if (lowerVal === normalizedEntityName || normalizeName(strVal).toLowerCase() === normalizedEntityName) {
                  isMatch = true;
                  break;
                }
                if (entityAcc && (lowerVal === entityAcc || (col.toLowerCase().includes('acc') && lowerVal === entityAcc))) {
                  isMatch = true;
                  break;
                }
                if (entityEmail && lowerVal === entityEmail) {
                  isMatch = true;
                  break;
                }
                if (entityPhone && entityPhone.length >= 7) {
                  const numOnly = strVal.replace(/\D/g, '');
                  if (numOnly.length >= 7 && (numOnly.includes(entityPhone) || entityPhone.includes(numOnly))) {
                    isMatch = true;
                    break;
                  }
                }
              }

              if (isMatch) {
                await client.query(
                  `INSERT INTO entity_raw_data (entity_id, organization_id, import_job_id, sheet_name, raw_data)
                   VALUES ($1, $2, $3, $4, $5)`,
                  [entityId, organizationId, jobId, sheet.name, JSON.stringify(row)],
                );
                storedAnyRaw = true;
              }
            }
          }

          // Fallback: if no raw row matched by value search, store the entity's parsed extra_data as raw record
          if (!storedAnyRaw && Object.keys(entity.extra_data).length > 0) {
            await client.query(
              `INSERT INTO entity_raw_data (entity_id, organization_id, import_job_id, sheet_name, raw_data)
               VALUES ($1, $2, $3, $4, $5)`,
              [entityId, organizationId, jobId, groupSheets[0]?.name || 'Sheet', JSON.stringify(entity.extra_data)],
            );
          }
        }

        // Relationships (accounts/obligations), tagged with account_number for downstream payment linking.
        const relationshipIdByAccount = new Map<string, string>();
        const entityIdByAccount = new Map<string, string>();
        const relationships = groupSheets.flatMap((sheet) => sheet.relationships);
        const relationshipRows: Array<[string, string, string, number, number, string, string, string | null, string | null, string]> = [];

        for (const rel of relationships) {
          const key = normalizeName(rel.customer_name).toLowerCase();
          const entityId = entityIdByKey.get(key);
          if (!entityId) continue;
          if (rel.account_number) entityIdByAccount.set(rel.account_number, entityId);

          relationshipRows.push([
            organizationId,
            entityId,
            rel.relationship_type,
            rel.original_amount,
            rel.outstanding_amount,
            rel.currency || fallbackCurrency,
            rel.status,
            rel.due_date || null,
            rel.account_number || null,
            JSON.stringify({ ...rel.extra_data, source_group: group.name, source_file: job.file_name }),
          ]);
        }

        if (relationshipRows.length > 0) {
          const values = relationshipRows.flatMap((row) => row);
          const placeholders = relationshipRows
            .map((_, i) => `($${i * 10 + 1}, $${i * 10 + 2}, $${i * 10 + 3}, $${i * 10 + 4}, $${i * 10 + 5}, $${i * 10 + 6}, $${i * 10 + 7}, $${i * 10 + 8}, $${i * 10 + 9}, $${i * 10 + 10})`)
            .join(', ');
          const inserted = await client.query<{ id: string; account_number: string | null }>(
            `INSERT INTO financial_relationships (
               organization_id, entity_id, relationship_type, original_amount, outstanding_amount,
               currency, status, due_date, account_number, extra_data
             ) VALUES ${placeholders}
             RETURNING id, account_number`,
            values,
          );
          inserted.rows.forEach((row) => {
            if (row.account_number) relationshipIdByAccount.set(row.account_number, row.id);
          });
          createdRelationships += inserted.rows.length;
        }

        // Payments, linked to relationships by account number (falling back to customer name via entity id).
        const payments = groupSheets.flatMap((sheet) => sheet.payments);
        const paymentRows: Array<[string, string, number, string | null, string, string | null, string]> = [];

        for (const payment of payments) {
          let relationshipId = payment.account_number ? relationshipIdByAccount.get(payment.account_number) : undefined;
          if (!relationshipId && payment.customer_name) {
            const entityId = entityIdByKey.get(normalizeName(payment.customer_name).toLowerCase());
            if (entityId) {
              const matchByEntity = await client.query<{ id: string }>(
                'SELECT id FROM financial_relationships WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1',
                [entityId],
              );
              relationshipId = matchByEntity.rows[0]?.id;
            }
          }
          if (!relationshipId) continue;

          paymentRows.push([
            organizationId,
            relationshipId,
            payment.amount_paid,
            payment.payment_date || null,
            payment.payment_method,
            payment.reference_no || null,
            JSON.stringify({ ...payment.extra_data, account_number: payment.account_number, source_group: group.name }),
          ]);
        }

        if (paymentRows.length > 0) {
          const values = paymentRows.flatMap((row) => row);
          const placeholders = paymentRows
            .map((_, i) => {
              const base = i * 7;
              const dateExpr = `COALESCE($${base + 4}::timestamptz, NOW())`;
              return `($${base + 1}, $${base + 2}, $${base + 3}, ${dateExpr}, $${base + 5}, $${base + 6}, $${base + 7})`;
            })
            .join(', ');
          const inserted = await client.query(
            `INSERT INTO payments (organization_id, financial_relationship_id, amount_paid, payment_date, payment_method, reference_no, extra_data)
             VALUES ${placeholders}`,
            values,
          );
          createdPayments += inserted.rowCount ?? paymentRows.length;
        }

        // Properties have no dedicated table; merge their fields into the matching account's extra_data.
        const properties = groupSheets.flatMap((sheet) => sheet.properties);
        for (const property of properties) {
          const relationshipId = property.account_number ? relationshipIdByAccount.get(property.account_number) : undefined;
          if (!relationshipId) continue;

          await client.query(
            `UPDATE financial_relationships SET extra_data = extra_data || $1::jsonb WHERE id = $2`,
            [JSON.stringify({ ...property.extra_data, property_reference: property.property_reference }), relationshipId],
          );
          linkedProperties++;
        }

        // Communications, resolved to an entity by account number (via the account's owner) or name.
        const communications = groupSheets.flatMap((sheet) => sheet.communications);
        const communicationRows: Array<[string, string, string | null, string, string | null, string | null, string | null]> = [];

        for (const comm of communications) {
          const entityId = (comm.account_number && entityIdByAccount.get(comm.account_number))
            || (comm.customer_name && entityIdByKey.get(normalizeName(comm.customer_name).toLowerCase()));
          if (!entityId) continue;

          communicationRows.push([
            organizationId,
            entityId,
            null,
            comm.comm_type,
            comm.notes || null,
            comm.outcome || null,
            comm.next_action_date || null,
          ]);
        }

        if (communicationRows.length > 0) {
          const values = communicationRows.flatMap((row) => row);
          const placeholders = communicationRows
            .map((_, i) => `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`)
            .join(', ');
          const inserted = await client.query(
            `INSERT INTO communications (organization_id, entity_id, case_id, comm_type, notes, outcome, next_action_date)
             VALUES ${placeholders}`,
            values,
          );
          createdCommunications += inserted.rowCount ?? communicationRows.length;
        }

        // Promises to pay require a case; find-or-create one on the matching account for each entity.
        const promises = groupSheets.flatMap((sheet) => sheet.promises);
        for (const promise of promises) {
          const entityId = (promise.account_number && entityIdByAccount.get(promise.account_number))
            || (promise.customer_name && entityIdByKey.get(normalizeName(promise.customer_name).toLowerCase()));
          if (!entityId) continue;

          const relationshipId = (promise.account_number && relationshipIdByAccount.get(promise.account_number)) || (
            await client.query<{ id: string }>(
              'SELECT id FROM financial_relationships WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1',
              [entityId],
            )
          ).rows[0]?.id;
          if (!relationshipId) continue;

          const existingCase = await client.query<{ id: string }>(
            'SELECT id FROM collection_cases WHERE financial_relationship_id = $1 LIMIT 1',
            [relationshipId],
          );
          const caseId = existingCase.rows[0]?.id || (
            await client.query<{ id: string }>(
              `INSERT INTO collection_cases (organization_id, financial_relationship_id, status, priority, stage)
               VALUES ($1, $2, 'OPEN', 'MEDIUM', 'PROMISE_TO_PAY')
               RETURNING id`,
              [organizationId, relationshipId],
            )
          ).rows[0].id;

          await client.query(
            `INSERT INTO promises_to_pay (case_id, entity_id, organization_id, promised_amount, promised_date, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [caseId, entityId, organizationId, promise.promised_amount, promise.promised_date, promise.status],
          );
          createdPromises++;
        }
      }

      const rawRowsToPreserve = groups.flatMap((group) => group.sheets.flatMap((sheetName) => {
        const sheet = sheetByName.get(sheetName);
        return (sheet?.validationResult.skippedRows ?? []).map((row) => ({ sheetName, ...row }));
      }));
      preservedRawRows = await insertRawImportRows(client, baseOrganizationId, jobId, rawRowsToPreserve);

      await client.query(
        `UPDATE import_jobs SET status = 'COMMITTED', committed_at = NOW(), created_entities = $1, created_relationships = $2 WHERE id = $3 AND organization_id = $4`,
        [createdEntities, createdRelationships, jobId, baseOrganizationId],
      );

      await client.query(
        `INSERT INTO audit_events (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [baseOrganizationId, req.tenant!.userId, 'WORKBOOK_IMPORTED', 'import', jobId, JSON.stringify({
          entities: createdEntities,
          relationships: createdRelationships,
          payments: createdPayments,
          propertiesLinked: linkedProperties,
          communications: createdCommunications,
          promises: createdPromises,
          rawRowsPreserved: preservedRawRows,
          file: job.file_name,
        })],
      );
      await client.query('COMMIT');

      res.json({
        success: true,
        data: {
          entities: createdEntities,
          relationships: createdRelationships,
          payments: createdPayments,
          propertiesLinked: linkedProperties,
          communications: createdCommunications,
          promises: createdPromises,
          rawRowsPreserved: preservedRawRows,
        },
      });
    } catch {
      try { await client.query('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      res.status(500).json({ success: false, error: 'Import could not be committed. No changes were saved.' });
    } finally {
      client.release();
    }
  });

  return router;
}
