import express from 'express';
import cors from 'cors';
import { authenticate, requirePermission } from './lib/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createEntityRouter } from './routes/entities.js';
import { createPromisesRouter } from './routes/promises.js';
import { createCommunicationsRouter } from './routes/communications.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createCasesRouter } from './routes/cases.js';
import { createReportsRouter } from './routes/reports.js';
import { createIntelligenceRouter } from './routes/intelligence.js';
import { createImportRouter } from './routes/imports.js';
import { createKycRouter } from './routes/kyc.js';
import { createPortfoliosRouter } from './routes/portfolios.js';
import { query } from './lib/db.js';
import { testConnection } from './lib/db.js';
export function createApp() {
    const app = express();
    app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
    app.use(express.json());
    app.get('/api/health', async (_req, res) => {
        try {
            const now = await testConnection();
            res.json({ ok: true, now: now.now });
        }
        catch {
            res.status(500).json({ ok: false, error: 'Database unavailable' });
        }
    });
    app.use('/api/v1/auth', createAuthRouter());
    app.get('/api/v1/organizations', authenticate, async (req, res) => {
        const result = await query('SELECT id, name FROM organizations WHERE id = $1', [req.tenant.organizationId]);
        res.json({ success: true, data: result.rows });
    });
    app.use('/api/v1/entities', authenticate, createEntityRouter());
    app.use('/api/v1/portfolios', authenticate, createPortfoliosRouter());
    app.use('/api/v1/promises-to-pay', authenticate, requirePermission('promises:write'), createPromisesRouter());
    app.use('/api/v1/communications', authenticate, requirePermission('communications:write'), createCommunicationsRouter());
    app.use('/api/v1/dashboard', authenticate, requirePermission('dashboard:read'), createDashboardRouter());
    app.use('/api/v1/cases', authenticate, createCasesRouter());
    app.use('/api/v1/reports', authenticate, requirePermission('reports:read'), createReportsRouter());
    app.use('/api/v1/intelligence', authenticate, requirePermission('intelligence:read'), createIntelligenceRouter());
    app.use('/api/v1/imports', authenticate, createImportRouter());
    app.use('/api/v1/kyc', authenticate, createKycRouter());
    return app;
}
