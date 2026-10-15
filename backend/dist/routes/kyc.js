import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { query } from '../lib/db.js';
import { audit, hasPermission, requirePermission } from '../lib/auth.js';
import { redactSensitiveIdentifiers } from '../lib/privacy.js';
const profileSchema = z.object({
    kyc_type: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS']).optional(),
    risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
    verification_method: z.string().max(80).nullable().optional(),
    rejection_reason: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    individual: z.object({ first_name: z.string().nullable().optional(), middle_name: z.string().nullable().optional(), last_name: z.string().nullable().optional(), date_of_birth: z.string().nullable().optional(), gender: z.string().nullable().optional(), nationality: z.string().nullable().optional(), national_id: z.string().nullable().optional(), passport_number: z.string().nullable().optional(), tax_pin: z.string().nullable().optional(), other_id_type: z.string().nullable().optional(), other_id_number: z.string().nullable().optional() }).optional(),
    business: z.object({ legal_name: z.string().nullable().optional(), trading_name: z.string().nullable().optional(), registration_number: z.string().nullable().optional(), tax_pin: z.string().nullable().optional(), business_type: z.string().nullable().optional(), incorporation_date: z.string().nullable().optional(), country_of_incorporation: z.string().nullable().optional(), registration_country: z.string().nullable().optional() }).optional(),
    addresses: z.array(z.object({ id: z.string().uuid().optional(), address_type: z.enum(['RESIDENTIAL', 'REGISTERED', 'BUSINESS', 'POSTAL', 'OTHER']), country: z.string().nullable().optional(), county: z.string().nullable().optional(), city: z.string().nullable().optional(), physical_address: z.string().nullable().optional(), postal_address: z.string().nullable().optional(), is_primary: z.boolean().optional() })).optional(),
});
const documentSchema = z.object({ document_type: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'TAX_CERTIFICATE', 'BUSINESS_REGISTRATION', 'CERTIFICATE_OF_INCORPORATION', 'PROOF_OF_ADDRESS', 'OTHER']), document_number: z.string().nullable().optional(), file_reference: z.string().nullable().optional(), document_status: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']).optional(), issued_by: z.string().nullable().optional(), issued_at: z.string().nullable().optional(), expires_at: z.string().nullable().optional(), rejection_reason: z.string().nullable().optional(), metadata: z.record(z.unknown()).optional() });
const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)),
});
const uploadDocumentSchema = z.object({ document_type: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'TAX_CERTIFICATE', 'BUSINESS_REGISTRATION', 'CERTIFICATE_OF_INCORPORATION', 'PROOF_OF_ADDRESS', 'OTHER']) });
const checkSchema = z.object({ check_type: z.enum(['IDENTITY', 'DOCUMENT', 'PHONE', 'EMAIL', 'ADDRESS', 'BUSINESS_REGISTRATION', 'TAX_ID', 'DUPLICATE', 'WATCHLIST']), status: z.enum(['NOT_RUN', 'PENDING', 'PASSED', 'FAILED', 'REVIEW']), result: z.string().nullable().optional(), provider: z.string().nullable().optional(), reference: z.string().nullable().optional(), notes: z.string().nullable().optional(), metadata: z.record(z.unknown()).optional() });
const compareSchema = z.object({ document_number: z.string().trim().min(1).max(100), phone: z.string().trim().min(7).max(50) });
const relationSchema = z.object({ related_entity_id: z.string().uuid(), relationship_type: z.enum(['DIRECTOR', 'SHAREHOLDER', 'BENEFICIAL_OWNER', 'AUTHORIZED_REPRESENTATIVE', 'CONTACT_PERSON', 'CLIENT', 'CUSTOMER', 'SUPPLIER', 'PARENT_COMPANY', 'SUBSIDIARY', 'BUSINESS_PARTNER']), ownership_percentage: z.number().min(0).max(100).nullable().optional() });
const individualRelatedTypes = new Set(['DIRECTOR', 'SHAREHOLDER', 'BENEFICIAL_OWNER', 'AUTHORIZED_REPRESENTATIVE', 'CONTACT_PERSON']);
function normalizeIdValue(value) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function normalizePhoneValue(value) {
    let digits = value.replace(/\D/g, '');
    if (/^0[17]\d{8}$/.test(digits))
        digits = `254${digits.slice(1)}`;
    else if (/^[17]\d{8}$/.test(digits))
        digits = `254${digits}`;
    if (digits.startsWith('00'))
        digits = digits.slice(2);
    return digits;
}
function safeProfile(row) {
    if (!row)
        return null;
    return redactSensitiveIdentifiers({ ...row, verified_by: row.verified_by || null });
}
async function getEntity(entityId, organizationId) {
    const result = await query('SELECT id, entity_type, legal_name FROM entities WHERE id = $1 AND organization_id = $2', [entityId, organizationId]);
    return result.rows[0];
}
async function getProfile(entityId, organizationId) {
    const result = await query(`SELECT kp.*, ki.first_name, ki.middle_name, ki.last_name, ki.date_of_birth, ki.gender, ki.nationality, ki.national_id, ki.passport_number, ki.tax_pin AS individual_tax_pin, ki.other_id_type, ki.other_id_number, kb.legal_name AS business_legal_name, kb.trading_name, kb.registration_number, kb.tax_pin AS business_tax_pin, kb.business_type, kb.incorporation_date, kb.country_of_incorporation, kb.registration_country FROM kyc_profiles kp LEFT JOIN kyc_individuals ki ON ki.kyc_profile_id = kp.id LEFT JOIN kyc_businesses kb ON kb.kyc_profile_id = kp.id WHERE kp.entity_id = $1 AND kp.organization_id = $2`, [entityId, organizationId]);
    return result.rows[0] || null;
}
function hasValidDocumentSignature(mimeType, data) {
    if (mimeType === 'image/jpeg')
        return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    if (mimeType === 'image/png')
        return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === 'image/webp')
        return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    if (mimeType === 'application/pdf')
        return data.toString('ascii', 0, 5) === '%PDF-';
    return false;
}
export function createKycRouter() {
    const router = Router();
    router.get('/', requirePermission('kyc:read'), async (req, res) => {
        const organizationId = req.tenant.organizationId;
        try {
            const result = await query(`SELECT e.id AS entity_id, e.legal_name, e.entity_type, COALESCE(kp.status, 'NOT_STARTED') AS status, kp.risk_level, kp.updated_at FROM entities e LEFT JOIN kyc_profiles kp ON kp.entity_id = e.id AND kp.organization_id = e.organization_id WHERE e.organization_id = $1 ORDER BY kp.updated_at DESC NULLS LAST, e.legal_name`, [organizationId]);
            res.json({ success: true, data: result.rows });
        }
        catch {
            res.status(500).json({ success: false, error: 'Unable to load KYC profiles' });
        }
    });
    router.get('/stats', requirePermission('kyc:read'), async (req, res) => {
        const organizationId = req.tenant.organizationId;
        try {
            const result = await query(`SELECT COUNT(*)::int AS total_entities, COUNT(*) FILTER (WHERE kp.id IS NULL OR kp.status = 'NOT_STARTED')::int AS not_started, COUNT(*) FILTER (WHERE kp.status = 'IN_PROGRESS')::int AS in_progress, COUNT(*) FILTER (WHERE kp.status = 'PENDING_REVIEW')::int AS pending_review, COUNT(*) FILTER (WHERE kp.status = 'VERIFIED')::int AS verified, COUNT(*) FILTER (WHERE kp.status = 'REJECTED')::int AS rejected, COUNT(*) FILTER (WHERE kp.status = 'EXPIRED')::int AS expired FROM entities e LEFT JOIN kyc_profiles kp ON kp.entity_id = e.id AND kp.organization_id = e.organization_id WHERE e.organization_id = $1`, [organizationId]);
            res.json({ success: true, data: result.rows[0] });
        }
        catch {
            res.status(500).json({ success: false, error: 'Unable to load KYC statistics' });
        }
    });
    router.get('/entities/:entityId', requirePermission('kyc:read'), async (req, res) => {
        const orgId = req.tenant.organizationId;
        try {
            const entity = await getEntity(String(req.params.entityId), orgId);
            if (!entity)
                return res.status(404).json({ success: false, error: 'Entity not found' });
            const profile = await getProfile(entity.id, orgId);
            if (!profile)
                return res.json({ success: true, data: { entity, profile: null, addresses: [], documents: [], checks: [], verifications: [], relationships: [] } });
            const [addresses, documents, checks, verifications, relationships] = await Promise.all([
                query('SELECT * FROM kyc_addresses WHERE kyc_profile_id = $1 AND organization_id = $2 ORDER BY is_primary DESC, created_at', [profile.id, orgId]),
                query('SELECT id, organization_id, kyc_profile_id, document_type, document_number, file_reference, document_status, file_name, content_type, file_data IS NOT NULL AS has_file, issued_by, issued_at, expires_at, uploaded_at, verified_at, verified_by, rejection_reason, metadata, created_at, updated_at FROM kyc_documents WHERE kyc_profile_id = $1 AND organization_id = $2 ORDER BY uploaded_at DESC', [profile.id, orgId]),
                query('SELECT * FROM kyc_checks WHERE kyc_profile_id = $1 AND organization_id = $2 ORDER BY created_at DESC', [profile.id, orgId]),
                query('SELECT * FROM kyc_verifications WHERE kyc_profile_id = $1 AND organization_id = $2 ORDER BY performed_at DESC', [profile.id, orgId]),
                query(`SELECT r.*, e.legal_name AS related_entity_name, e.entity_type AS related_entity_type FROM kyc_entity_relationships r JOIN entities e ON e.id = r.related_entity_id AND e.organization_id = r.organization_id WHERE r.business_entity_id = $1 AND r.organization_id = $2 ORDER BY r.relationship_type, e.legal_name`, [entity.id, orgId]),
            ]);
            const individual = profile.kyc_type === 'INDIVIDUAL' ? safeProfile(profile) : null;
            const business = profile.kyc_type === 'BUSINESS' ? safeProfile(profile) : null;
            res.json({ success: true, data: redactSensitiveIdentifiers({ entity, profile: safeProfile(profile), individual, business, addresses: addresses.rows, documents: documents.rows, checks: checks.rows, verifications: verifications.rows, relationships: relationships.rows }) });
        }
        catch {
            res.status(500).json({ success: false, error: 'Unable to load KYC profile' });
        }
    });
    router.post('/entities/:entityId', requirePermission('kyc:write'), async (req, res) => saveProfile(req, res, false));
    router.patch('/entities/:entityId', requirePermission('kyc:write'), async (req, res) => saveProfile(req, res, true));
    async function saveProfile(req, res, updating) {
        const orgId = req.tenant.organizationId;
        try {
            const entity = await getEntity(req.params.entityId, orgId);
            if (!entity)
                return res.status(404).json({ success: false, error: 'Entity not found' });
            const parsed = profileSchema.parse(req.body);
            const type = parsed.kyc_type || entity.entity_type;
            if (type !== entity.entity_type)
                return res.status(400).json({ success: false, error: 'KYC type must match the entity type' });
            const existing = await getProfile(entity.id, orgId);
            if (updating && !existing)
                return res.status(404).json({ success: false, error: 'KYC profile not found' });
            const profile = await query(`INSERT INTO kyc_profiles (organization_id, entity_id, kyc_type, status, risk_level, verification_method, rejection_reason, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id, entity_id) DO UPDATE SET kyc_type = EXCLUDED.kyc_type, status = EXCLUDED.status, risk_level = EXCLUDED.risk_level, verification_method = EXCLUDED.verification_method, rejection_reason = EXCLUDED.rejection_reason, notes = EXCLUDED.notes, updated_at = NOW() RETURNING *`, [orgId, entity.id, type, parsed.status || existing?.status || 'NOT_STARTED', parsed.risk_level ?? existing?.risk_level ?? null, parsed.verification_method ?? existing?.verification_method ?? null, parsed.rejection_reason ?? null, parsed.notes ?? null]);
            const profileId = profile.rows[0].id;
            const detail = type === 'INDIVIDUAL' ? parsed.individual : parsed.business;
            if (detail) {
                const table = type === 'INDIVIDUAL' ? 'kyc_individuals' : 'kyc_businesses';
                const columns = Object.keys(detail);
                const values = Object.values(detail);
                const updates = columns.map((column, i) => `${column} = $${i + 3}`).join(', ');
                await query(`INSERT INTO ${table} (organization_id, kyc_profile_id, ${columns.join(', ')}) VALUES ($1,$2,${columns.map((_, i) => `$${i + 3}`).join(',')}) ON CONFLICT (kyc_profile_id) DO UPDATE SET ${updates}, updated_at = NOW()`, [orgId, profileId, ...values]);
            }
            if (parsed.addresses)
                for (const address of parsed.addresses) {
                    if (address.id)
                        await query(`UPDATE kyc_addresses SET address_type=$1,country=$2,county=$3,city=$4,physical_address=$5,postal_address=$6,is_primary=$7,updated_at=NOW() WHERE id=$8 AND kyc_profile_id=$9 AND organization_id=$10`, [address.address_type, address.country || null, address.county || null, address.city || null, address.physical_address || null, address.postal_address || null, address.is_primary ?? false, address.id, profileId, orgId]);
                    else
                        await query(`INSERT INTO kyc_addresses (organization_id, kyc_profile_id, address_type, country, county, city, physical_address, postal_address, is_primary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [orgId, profileId, address.address_type, address.country || null, address.county || null, address.city || null, address.physical_address || null, address.postal_address || null, address.is_primary ?? false]);
                }
            await audit(req, updating ? 'KYC_UPDATED' : 'KYC_CREATED', 'kyc_profile', profileId);
            res.status(updating ? 200 : 201).json({ success: true, data: safeProfile(await getProfile(entity.id, orgId)) });
        }
        catch {
            res.status(400).json({ success: false, error: 'Invalid KYC data' });
        }
    }
    router.post('/entities/:entityId/documents', requirePermission('kyc:write'), async (req, res) => {
        try {
            const orgId = req.tenant.organizationId;
            const entity = await getEntity(String(req.params.entityId), orgId);
            const profile = entity && await getProfile(entity.id, orgId);
            if (!profile)
                return res.status(404).json({ success: false, error: 'KYC profile not found' });
            const document = documentSchema.parse(req.body);
            if (document.document_status && document.document_status !== 'PENDING' && !hasPermission(req.tenant.role, 'kyc:review')) {
                return res.status(403).json({ success: false, error: 'Insufficient permissions' });
            }
            const result = await query(`INSERT INTO kyc_documents (organization_id, kyc_profile_id, document_type, document_number, file_reference, document_status, issued_by, issued_at, expires_at, rejection_reason, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, document_type, document_status, issued_at, expires_at, uploaded_at`, [orgId, profile.id, document.document_type, document.document_number || null, document.file_reference || null, document.document_status || 'PENDING', document.issued_by || null, document.issued_at || null, document.expires_at || null, document.rejection_reason || null, JSON.stringify(document.metadata || {})]);
            await audit(req, 'KYC_DOCUMENT_ADDED', 'kyc_document', result.rows[0].id);
            res.status(201).json({ success: true, data: redactSensitiveIdentifiers(result.rows[0]) });
        }
        catch {
            res.status(400).json({ success: false, error: 'Invalid document' });
        }
    });
    router.post('/entities/:entityId/documents/upload', requirePermission('kyc:write'), documentUpload.single('file'), async (req, res) => {
        try {
            const orgId = req.tenant.organizationId;
            const entity = await getEntity(String(req.params.entityId), orgId);
            const profile = entity && await getProfile(entity.id, orgId);
            if (!profile)
                return res.status(404).json({ success: false, error: 'KYC profile not found' });
            if (!req.file || !hasValidDocumentSignature(req.file.mimetype, req.file.buffer)) {
                return res.status(400).json({ success: false, error: 'Upload a valid JPEG, PNG, WebP, or PDF document under 5 MB.' });
            }
            const { document_type: documentType } = uploadDocumentSchema.parse(req.body);
            const result = await query(`INSERT INTO kyc_documents (organization_id, kyc_profile_id, document_type, file_name, content_type, file_data, file_reference, document_status)
         VALUES ($1,$2,$3,$4,$5,$6,'private-db','PENDING')
         RETURNING id, document_type, document_status, file_name, content_type, uploaded_at`, [orgId, profile.id, documentType, req.file.originalname.slice(0, 255), req.file.mimetype, req.file.buffer]);
            await audit(req, 'KYC_DOCUMENT_UPLOADED', 'kyc_document', result.rows[0].id);
            res.status(201).json({ success: true, data: result.rows[0] });
        }
        catch {
            res.status(400).json({ success: false, error: 'Unable to upload document. Check file type, size, and KYC profile.' });
        }
    });
    router.get('/entities/:entityId/documents/:documentId/file', requirePermission('kyc:review'), async (req, res) => {
        try {
            const result = await query(`SELECT d.file_name, d.content_type, d.file_data
         FROM kyc_documents d
         JOIN kyc_profiles kp ON kp.id = d.kyc_profile_id AND kp.organization_id = d.organization_id
         WHERE d.id = $1 AND kp.entity_id = $2 AND d.organization_id = $3 AND d.file_data IS NOT NULL`, [String(req.params.documentId), String(req.params.entityId), req.tenant.organizationId]);
            const document = result.rows[0];
            if (!document)
                return res.status(404).json({ success: false, error: 'Document not found' });
            res.setHeader('Content-Type', document.content_type);
            res.setHeader('Content-Disposition', `attachment; filename="${document.file_name.replace(/["\\\r\n]/g, '_')}"`);
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.send(document.file_data);
        }
        catch {
            res.status(500).json({ success: false, error: 'Unable to retrieve document' });
        }
    });
    router.post('/entities/:entityId/checks/compare', requirePermission('kyc:write'), async (req, res) => {
        try {
            const orgId = req.tenant.organizationId;
            const entityId = String(req.params.entityId);
            const entity = await getEntity(entityId, orgId);
            const profile = entity && await getProfile(entity.id, orgId);
            if (!entity || !profile)
                return res.status(404).json({ success: false, error: 'KYC profile not found' });
            const submitted = compareSchema.parse(req.body);
            const values = await query(`SELECT e.phone, ki.national_id, ki.passport_number, ki.other_id_number, kb.registration_number
         FROM entities e
         LEFT JOIN kyc_profiles kp ON kp.entity_id = e.id AND kp.organization_id = e.organization_id
         LEFT JOIN kyc_individuals ki ON ki.kyc_profile_id = kp.id AND ki.organization_id = kp.organization_id
         LEFT JOIN kyc_businesses kb ON kb.kyc_profile_id = kp.id AND kb.organization_id = kp.organization_id
         WHERE e.id = $1 AND e.organization_id = $2`, [entity.id, orgId]);
            const stored = values.rows[0];
            const storedIds = [stored?.national_id, stored?.passport_number, stored?.other_id_number, stored?.registration_number].filter((value) => Boolean(value));
            const idMatches = storedIds.some((value) => normalizeIdValue(value) === normalizeIdValue(submitted.document_number));
            const phoneMatches = Boolean(stored?.phone && normalizePhoneValue(stored.phone) === normalizePhoneValue(submitted.phone));
            const records = await Promise.all([
                query(`INSERT INTO kyc_checks (organization_id, kyc_profile_id, check_type, status, result, performed_at, performed_by, provider, notes, metadata)
               VALUES ($1,$2,'IDENTITY','REVIEW',$3,NOW(),$4,'Stored record comparison',$5,$6) RETURNING id`, [orgId, profile.id, idMatches ? 'Submitted number matches a value already on file.' : 'Submitted number does not match an ID value on file.', req.tenant.userId, 'This is an internal consistency check only, not a government registry lookup.', JSON.stringify({ matchesSavedRecord: idMatches, externalVerification: false })]),
                query(`INSERT INTO kyc_checks (organization_id, kyc_profile_id, check_type, status, result, performed_at, performed_by, provider, notes, metadata)
               VALUES ($1,$2,'PHONE','REVIEW',$3,NOW(),$4,'Stored record comparison',$5,$6) RETURNING id`, [orgId, profile.id, phoneMatches ? 'Submitted number matches the entity phone on file.' : 'Submitted number does not match the entity phone on file.', req.tenant.userId, 'Phone ownership is not confirmed; an SMS/voice provider is required for that.', JSON.stringify({ matchesSavedRecord: phoneMatches, externalVerification: false })]),
            ]);
            await audit(req, 'KYC_RECORD_COMPARISON', 'kyc_profile', profile.id, { idMatches, phoneMatches });
            res.json({ success: true, data: { idMatches, phoneMatches, externalVerification: false, checksCreated: records.length } });
        }
        catch {
            res.status(400).json({ success: false, error: 'Unable to compare the submitted details.' });
        }
    });
    router.post('/entities/:entityId/checks', requirePermission('kyc:write'), async (req, res) => {
        try {
            const orgId = req.tenant.organizationId;
            const entity = await getEntity(String(req.params.entityId), orgId);
            const profile = entity && await getProfile(entity.id, orgId);
            if (!profile)
                return res.status(404).json({ success: false, error: 'KYC profile not found' });
            const check = checkSchema.parse(req.body);
            if (['PASSED', 'FAILED'].includes(check.status) && !hasPermission(req.tenant.role, 'kyc:review')) {
                return res.status(403).json({ success: false, error: 'Only KYC reviewers can complete a check' });
            }
            const result = await query(`INSERT INTO kyc_checks (organization_id, kyc_profile_id, check_type, status, result, performed_at, performed_by, provider, reference, notes, metadata)
         VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,$10) RETURNING *`, [orgId, profile.id, check.check_type, check.status, check.result || null, req.tenant.userId, check.provider || null, check.reference || null, check.notes || null, JSON.stringify(check.metadata || {})]);
            await audit(req, 'KYC_CHECK_RECORDED', 'kyc_check', result.rows[0].id);
            res.status(201).json({ success: true, data: redactSensitiveIdentifiers(result.rows[0]) });
        }
        catch {
            res.status(400).json({ success: false, error: 'Invalid check' });
        }
    });
    router.post('/entities/:entityId/relationships', requirePermission('kyc:write'), async (req, res) => {
        try {
            const orgId = req.tenant.organizationId;
            const entity = await getEntity(String(req.params.entityId), orgId);
            if (!entity || entity.entity_type !== 'BUSINESS')
                return res.status(404).json({ success: false, error: 'Business entity not found' });
            const data = relationSchema.parse(req.body);
            const related = await getEntity(data.related_entity_id, orgId);
            if (!related || related.id === entity.id)
                return res.status(400).json({ success: false, error: 'Related entity must be a different entity in the same organization' });
            if (individualRelatedTypes.has(data.relationship_type) && related.entity_type !== 'INDIVIDUAL') {
                return res.status(400).json({ success: false, error: 'Ownership and representative relationships require an individual entity' });
            }
            if (!individualRelatedTypes.has(data.relationship_type) && data.ownership_percentage !== undefined && data.ownership_percentage !== null) {
                return res.status(400).json({ success: false, error: 'Ownership percentage is only valid for ownership relationships' });
            }
            const result = await query(`INSERT INTO kyc_entity_relationships (organization_id, business_entity_id, related_entity_id, relationship_type, ownership_percentage)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organization_id, business_entity_id, related_entity_id, relationship_type)
         DO UPDATE SET ownership_percentage = EXCLUDED.ownership_percentage
         RETURNING *`, [orgId, entity.id, related.id, data.relationship_type, data.ownership_percentage ?? null]);
            await audit(req, 'KYC_RELATIONSHIP_ADDED', 'kyc_entity_relationship', result.rows[0].id);
            res.status(201).json({ success: true, data: redactSensitiveIdentifiers({ ...result.rows[0], related_entity_name: related.legal_name, related_entity_type: related.entity_type }) });
        }
        catch {
            res.status(400).json({ success: false, error: 'Invalid business relationship' });
        }
    });
    async function transition(req, res, status, reason) { const orgId = req.tenant.organizationId; try {
        const entity = await getEntity(String(req.params.entityId), orgId);
        const profile = entity && await getProfile(entity.id, orgId);
        if (!profile)
            return res.status(404).json({ success: false, error: 'KYC profile not found' });
        const verification = await query(`INSERT INTO kyc_verifications (organization_id, kyc_profile_id, status, method, performed_by, reason, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [orgId, profile.id, status, profile.verification_method, req.tenant.userId, reason || null, req.body.notes || null]);
        await query(`UPDATE kyc_profiles SET status=$1, verification_status=$2, verified_at=CASE WHEN $1='VERIFIED' THEN NOW() ELSE NULL END, verified_by=CASE WHEN $1 IN ('VERIFIED','REJECTED') THEN $3 ELSE NULL END, rejection_reason=CASE WHEN $1='REJECTED' THEN $6 ELSE NULL END, updated_at=NOW() WHERE id=$4 AND organization_id=$5`, [status, status === 'VERIFIED' ? 'VERIFIED' : status === 'REJECTED' ? 'REJECTED' : 'PENDING', req.tenant.userId, profile.id, orgId, reason || null]);
        await audit(req, `KYC_${status}`, 'kyc_profile', profile.id);
        res.json({ success: true, data: redactSensitiveIdentifiers(verification.rows[0]) });
    }
    catch {
        res.status(400).json({ success: false, error: 'Unable to update KYC status' });
    } }
    router.post('/entities/:entityId/submit', requirePermission('kyc:write'), (req, res) => transition(req, res, 'PENDING_REVIEW'));
    router.post('/entities/:entityId/verify', requirePermission('kyc:review'), (req, res) => transition(req, res, 'VERIFIED'));
    router.post('/entities/:entityId/reject', requirePermission('kyc:review'), (req, res) => transition(req, res, 'REJECTED', req.body.reason));
    return router;
}
