-- A preview is staging only. Do not create a portfolio (or any business data)
-- until the user explicitly confirms the import.
ALTER TABLE import_jobs ALTER COLUMN portfolio_id DROP NOT NULL;
