# Scoreyako

Scoreyako is a financial relationship intelligence and action platform built for multi-tenant SaaS collections teams. It centralizes entity data, obligations, payment history, promises to pay, and communication records so collections and portfolio teams can act quickly on risky accounts.

## Architecture

- Backend: Node.js + TypeScript + Express + PostgreSQL
- Frontend: Next.js + React + Tailwind CSS
- Multi-tenant design: every tenant-scoped table stores `organization_id`
- Universal entity record: all people and businesses live in `entities`

## Repository structure

- `backend/` Ã¢â‚¬â€ API server, database schema, migrations, and seed data
- `frontend/` Ã¢â‚¬â€ Next.js dashboard app
- `README.md` Ã¢â‚¬â€ setup and run instructions

## Database schema

The schema is in `backend/database/schema.sql` and includes:

- organizations
- users
- entities
- financial_relationships
- payments
- collection_cases
- promises_to_pay
- communications

## Seed data

The seed script in `backend/database/seed.sql` creates:

- 1 organization
- 2 users
- 5 mixed entities
- overdue balances
- broken promises to pay
- communication logs

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL

Make sure PostgreSQL is running locally and create a database named `scoreyako`.

Example:

```bash
createdb scoreyako
```

Then set environment variables in a `.env` file in the project root:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scoreyako
PORT=4000
```

### 3. Run migrations and seed data

```bash
npm --workspace backend run migrate
```

### 4. Start the backend server

```bash
npm --workspace backend run dev
```

### 5. Start the frontend

```bash
npm --workspace frontend run dev
```

Then open:

- Backend: http://localhost:4000/api/health
- Frontend: http://localhost:3000

## Core API endpoints

- `POST /api/v1/entities` Ã¢â‚¬â€ Create a new entity (individual or business)
- `GET /api/v1/entities/:id/360` Ã¢â‚¬â€ Get complete entity profile with relationships, payments, cases, and communications
- `GET /api/v1/entities` Ã¢â‚¬â€ List all entities for the organization
- `POST /api/v1/promises-to-pay` Ã¢â‚¬â€ Record a payment promise for a case
- `POST /api/v1/communications` Ã¢â‚¬â€ Log a communication event (call, SMS, email, WhatsApp)
- `GET /api/v1/dashboard/summary` Ã¢â‚¬â€ Get portfolio metrics (total exposure, outstanding, overdue, high-risk count)
- `GET /api/v1/dashboard/needs-attention` Ã¢â‚¬â€ Get prioritized queue of entities requiring action

## Frontend pages

- `/` Ã¢â‚¬â€ Dashboard home (portfolio summary + needs attention queue)
- `/entities` Ã¢â‚¬â€ Entity list with search and filter
- `/entities/:id` Ã¢â‚¬â€ Entity 360 view (profile, relationships, activity history, cases)

## Running locally

### Start everything in order:

1. **Terminal 1: Start the backend**
   ```bash
   npm --workspace backend run dev
   ```
   Backend will listen at `http://localhost:4000`

2. **Terminal 2: Start the frontend**
   ```bash
   npm --workspace frontend run dev
   ```
   Frontend will be at `http://localhost:3000`

### Verify connectivity:

- Backend health check: `curl http://localhost:4000/api/health`
- Frontend dashboard: Open `http://localhost:3000`
- Entity list: Visit `http://localhost:3000/entities`
- Entity 360: Click "View 360" on any entity in the queue

### Troubleshooting

- **Frontend shows "ECONNREFUSED"**: The backend is not running. Start it in another terminal with `npm --workspace backend run dev`
- **Database connection fails**: Ensure PostgreSQL is running and the database `scoreyako` exists. Check the `DATABASE_URL` in `.env`
- **Port conflicts**: If port 4000 or 3000 are busy, kill the process or edit `.env` / `next.config.js` to use different ports
- **Audit warnings**: 42 packages may show as looking for funding; run `npm fund` for details. There are known audit warnings. To see details run `npm audit`. To attempt automatic fixes (may include breaking changes) run `npm audit fix --force` (use cautiously in development)

## Feature overview

### Phase 1 MVP (Current)

- **Portfolio Dashboard** Ã¢â‚¬â€ At-a-glance totals: exposure, outstanding, overdue, high-risk entities, broken promises
- **Needs Attention Queue** Ã¢â‚¬â€ Prioritized list of overdue invoices, broken promises, and high-risk accounts
- **Entity 360** Ã¢â‚¬â€ Complete view of an entity including:
  - Identity (name, tax ID, contact info)
  - All financial relationships (invoices, loans, trade credit)
  - Payment history
  - Collection cases
  - Promises to pay
  - Communication log (calls, SMS, emails, WhatsApp)
- **Entity List** Ã¢â‚¬â€ Browse all entities, search and filter by name
- **Multi-tenant isolation** Ã¢â‚¬â€ Every organization's data is isolated via `organization_id`

### Planned features (Phase 2 & beyond)

- KYC/KYB verification framework
- Financial health analysis
- Dispute management
- Advanced monitoring and alerts
- Payment reconciliation and integrations
- AI-powered document extraction and analysis
## Architecture notes

- **Multi-tenancy**: Each request's organization is resolved from the authenticated user's membership. Organization headers do not grant tenant access.
- **Entity-first design**: All relationships, payments, and cases flow through entities
- **Scalable database schema**: Proper indexing and constraints for high-volume financial data
- **Async-ready frontend**: Pages use server-side data fetching with fallback mocks for offline development

## Dashboard features

- Needs Attention queue
- financial relationship risk summary
- priority action list
- entity profile 360 panel
- quick promise/communication capture modal workflow

## Notes

This project is a Phase 1 MVP scaffold designed to be expanded into a production-grade SaaS platform with tenant-aware services, RBAC, auditing, and analytics.

## Change documentation policy

When a feature, API route, user workflow, configuration value, or setup step changes, update this README in the same change. Keep the API route list, frontend page list, feature status, and local/Neon setup instructions aligned with the implemented application.

## Latest delivered capabilities

- **Case management**: The `/cases` board supports filtering cases and updating owner, status, priority, and workflow stage.
- **Collection intelligence**: The `/reports` page presents aging buckets, collector workload, and transparent risk scores. The score combines days overdue, outstanding exposure, and broken promises, capped at 100.
- **New API routes**: `GET /api/v1/cases`, `GET /api/v1/cases/assignees`, `PATCH /api/v1/cases/:id`, and `GET /api/v1/reports/collection-health`.
- **Responsive operations UI**: Navigation and collection workflows work across mobile, tablet, and desktop layouts.
- **Neon PostgreSQL**: Set the root `DATABASE_URL` to the Neon connection string. The backend loads that root environment file when run through an npm workspace command.
## Authentication and tenancy

The backend bearer token is stored by the Next.js application in an HttpOnly, same-site cookie and revalidated against `organization_memberships` on each protected request. Development does not bypass authentication or permission checks. If a user belongs to multiple organizations, sign-in requires choosing one of that user's memberships.

All `/api/v1/*` business routes now resolve organization scope from the authenticated userâ€™s `organization_memberships` record. The legacy `x-organization-id` header is no longer used for tenant selection.

- `POST /api/v1/auth/login` returns an eight-hour signed bearer token.
- `GET /api/v1/auth/me` returns the authenticated userâ€™s tenant context.
- Roles are `ADMIN`, `MANAGER`, `COLLECTIONS`, and `USER`; permissions are enforced server-side.
- Case and entity mutations are recorded in `audit_events`.
- `DEV_USER_EMAIL` configures the local bootstrap account only. Every protected route requires a valid bearer session and a matching organization membership.

Apply the ordered schema migrations with:

```bash
npm --workspace backend run migrate
```

Development sign-in: `admin@northstar.test` with password `ChangeMe123!` (the legacy `admin@local.test` address is still accepted for compatibility). Change this immediately outside local development.

## Intelligence and monitoring

- `GET /api/v1/intelligence/entities/:id` produces an entity-level risk score, reasons, and a recommended collection action.
- `GET /api/v1/intelligence/monitoring/alerts` returns broken-promise and materially overdue monitoring alerts.
- `risk_snapshots` preserves every generated score and rationale for future trend analysis.
- The Entity 360 page displays the current risk explanation and recommended next step.
## Import Center

Use `/import` to load portfolio data from an Excel `.xlsx` or `.xls` workbook (maximum 5 MB). The Import Center previews and validates every row before committing a single change.

The workbook must contain two sheets:

- **Companies**: required `company_name`; optional `entity_type` (`BUSINESS` or `INDIVIDUAL`), `tax_id`, `phone`, and `email`.
- **Relationships**: required `company_name`, `original_amount`, and `outstanding_amount`; optional `relationship_type` (`INVOICE`, `LOAN`, or `TRADE_CREDIT`), `currency`, `status`, and `due_date`.

Company names must match between sheets. Existing companies are matched by name; missing companies are created in the authenticated user’s organization. Imports run in a database transaction and are recorded in the audit log.

API routes:

- `POST /api/v1/imports/preview` — validate an uploaded workbook without writing data.
- `POST /api/v1/imports/commit` — create companies and relationships after validation.

### Sheet grouping and organization assignment

During import preview, workbook sheets can be assigned to named portfolio groups inside the authenticated organization. Multiple sheets can share a group, but groups cannot route records into another organization. Group assignments are saved with the tenant-scoped import job.

The `/entities` page opens in a business or organization-group view. Select a group to see its individual members, search by name, account number, connection number, phone, or imported fields, and open an individual’s 360 profile.

### Complete Entity 360 data

The Entity 360 endpoint (`GET /api/v1/entities/:id/360`) returns the entity profile, financial relationships, payments, collection cases, promises to pay, communications, merged imported attributes, and every stored raw source row. Raw Excel rows are stored in `entity_raw_data` as JSONB, preserving columns such as account number, connection number, non-payment reason, notes, remarks, zone, and any custom headers from the workbook.

The Entity 360 source-data panel supports searching field names and values, switching between table and detailed views, and exporting the imported data as JSON, CSV, or Excel-compatible tab-separated data. Monetary values are displayed in Kenyan shillings (`KSH`).

## KYC and customer verification

KYC is attached to the existing tenant-scoped `entities` records. Each entity can have one KYC profile with structured individual or business details, addresses, documents, checks, verification history, and business ownership links to existing individual entities. Imported information remains unverified until a reviewer submits and approves it.

The KYC migration is `backend/database/006_kyc.sql` and is applied by `npm --workspace backend run migrate`. Documents store a file reference and metadata only; document files are not stored in PostgreSQL. Normal API responses and Entity 360 mask identity numbers.

KYC routes include:

- `GET /api/v1/kyc` and `GET /api/v1/kyc/stats` — tenant-scoped profile list and status totals.
- `GET /api/v1/kyc/entities/:entityId` — profile, addresses, documents, checks, verification history, and ownership.
- `POST/PATCH /api/v1/kyc/entities/:entityId` — create or update the entity profile.
- `POST /api/v1/kyc/entities/:entityId/documents|checks|relationships` — add KYC records and link existing entities.
- `POST /api/v1/kyc/entities/:entityId/submit|verify|reject` — transition workflow status while preserving history.

The `/kyc` page provides the verification overview and reviewer queue. Entity 360 displays the current KYC status and masked identity details. Entity resolution continues to use strong identifiers for automatic clustering and presents uncertain name-only matches for review rather than silently merging them.

## Canonical database and migrations

`backend/database/schema.sql` is the version-0 base schema. `npm --workspace backend run migrate` applies SQL migrations `001` through `009` in order and records completed versions and filenames in `schema_migrations`. Each migration runs transactionally. Existing databases are recorded as having the base schema, then receive only unrecorded migrations; shipped migration files remain unchanged.

Run backend tests with `npm --workspace backend run test`. The HTTP security suite requires a dedicated `TEST_DATABASE_URL`; it skips when none is configured and refuses to run against the application's `DATABASE_URL` database.

After migration `009`, `organization_memberships` is the authoritative user-to-organization and role relationship. `users` stores identity and password credentials. Organizations own portfolios, entities, financial relationships, cases, communications, KYC records, and import jobs. Payments, promises, and raw import rows carry organization ownership with tenant-consistent foreign keys. Import groups are portfolio groupings stored in `import_jobs.parsed_data`; `group_assignments` mirrors that value for compatibility. The older `import_job_sheet_mappings` table is retained but is not read or written by current routes.

## Clearing local data for a fresh start

Every dashboard, entity, and KYC number is computed live from PostgreSQL on each request — there is no mock or seeded data compiled into the app. If `/` or `/entities` shows numbers you don't recognize, that data is already sitting in your local database (usually from an earlier test import), not from the code.

To clear imported/transactional data while keeping your organization and login intact:

```bash
RESET_CONFIRM=yes npm --workspace backend run reset:data
```

This truncates `entities`, `financial_relationships`, `payments`, `collection_cases`, `promises_to_pay`, `communications`, `entity_raw_data`, `import_jobs`, `portfolios`, `risk_snapshots`, `audit_events`, and all `kyc_*` tables. It does **not** touch `organizations`, `users`, or `organization_memberships`, so you do not need to re-create your login. The script refuses to run when `NODE_ENV=production` or without `RESET_CONFIRM=yes`.

## End-to-end import flow

1. Go to `/import` and upload an `.xlsx`/`.xls`/`.csv` workbook (max 5 MB). This calls `POST /api/v1/imports/preview`, which parses every sheet **once**, classifies each sheet (customers, obligations, payments, etc.), maps recognizable columns (name, phone, email, account number, tax/PIN, national ID, etc.), and clusters rows that share a strong identifier into a single entity. Nothing is written to the database yet.
2. Review the preview: sheet classification, matched fields, validation issues, and any `possibleMatches` (same name but no shared identifier — these require your review, not automatic merging).
3. Assign each sheet to a named portfolio group. The group name is saved through `PATCH /api/v1/imports/:jobId/groups`; all groups remain inside the authenticated organization. Multiple sheets can share a group if they belong to the same business; unrelated sheets should stay separate.
4. Commit with `POST /api/v1/imports/:jobId/commit`. This is the only step that writes data: it creates/matches entities by name within the selected portfolio, creates financial relationships, payments, and raw source rows, and records the action in `audit_events` — all inside one transaction per job.
5. Open `/entities`, pick the group/organization, and use "View 360" to see everything for that person: financial relationships, payments, cases, promises, communications, every stored raw row from the original sheet, and a merged view of every imported field (`raw_records` / `all_attributes` in the 360 response).

## KYC verification flow (including entities that already exist)

KYC never runs automatically from an import — importing data only makes it available, it does not verify it.

1. Every entity (new or already existing) starts with **no KYC profile** (shown as `NOT_STARTED` in `/kyc` and Entity 360).
2. A reviewer opens the entity and creates a profile with `POST /api/v1/kyc/entities/:entityId` — for individuals this captures identity/contact/address fields; for businesses it captures registration/contact/address fields. This can be filled in from data already imported for that entity (national ID, phone, tax PIN, etc.) — pulling in existing data is still just data entry, not verification.
3. Add supporting evidence as needed: `POST /api/v1/kyc/entities/:entityId/documents` (document metadata + a file reference only — files are not stored in PostgreSQL) and `POST /api/v1/kyc/entities/:entityId/checks` (identity, phone, email, address, duplicate, watchlist, etc.).
4. When the profile is complete enough for review, call `POST /api/v1/kyc/entities/:entityId/submit`. Status becomes `PENDING_REVIEW`.
5. A reviewer with the review permission calls `POST /api/v1/kyc/entities/:entityId/verify` or `.../reject`. Every one of these transitions is written to `kyc_verifications`, so the full history is preserved — statuses are never silently overwritten.
6. `/kyc` shows the reviewer queue (everything not yet `VERIFIED`) and the status totals (`GET /api/v1/kyc/stats`) so you can see, at a glance, how many entities are not started, in progress, pending review, verified, rejected, or expired — all computed live from the current data, with no manual per-entity check required to see the overall picture. Reviewing and verifying individual profiles is still a deliberate action, by design, so imported data can never silently become "verified".