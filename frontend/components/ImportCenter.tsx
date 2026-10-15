'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import { apiFetch } from '../lib/client-api';

type FieldMatch = {
  sourceColumn: string;
  canonicalField: string;
  status: string;
  confidence: number;
};

type SheetSummary = {
  name: string;
  rowCount: number;
  confidence: number;
  type: string;
  inspection?: {
    columnCount: number;
    headerRow: number;
    emptyRows: number;
    duplicateColumns: string[];
    headerConfidence?: number;
    uncertainHeader?: boolean;
    repeatedHeaderRows?: number[];
    nonRecordRows?: Array<{ rowNumber: number; reason: string }>;
  };
  headers?: string[];
  sampleRows?: Array<Record<string, unknown>>;
  rejectedRows?: Array<{ sourceRowNumber: number; reason: string; rawData: Record<string, unknown> }>;
};

type Group = {
  id: string;
  name: string;
  confidence: number;
  commonField: string;
  sheets: string[];
  reason: string;
};

type PossibleMatch = {
  candidateA: string;
  candidateB: string;
  confidence: number;
  level?: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  matchType?: string;
  supportingEvidence?: string[];
  conflictingEvidence?: string[];
  sourceWorkbook?: string;
  recommendedAction?: 'ACCEPT' | 'REVIEW';
};

type ReviewItem = {
  id: string;
  type: 'UNCERTAIN_HEADER' | 'DUPLICATE_COLUMNS' | 'INVALID_ROWS';
  sheetName: string;
  title: string;
  detail: string;
  resolved?: boolean;
};

type Preview = {
  jobId: string;
  fileName?: string;
  entityClusters?: number;
  totalRows: number;
  errorRows: number;
  reviewRows?: number;
  validRows: number;
  ready: boolean;
  sheets: SheetSummary[];
  fieldMatches: FieldMatch[];
  uncertainFields?: FieldMatch[];
  unknownFields?: FieldMatch[];
  issues: string[];
  errors: string[];
  groups: Group[];
  possibleMatches: PossibleMatch[];
  deterministicMatches?: PossibleMatch[];
  reviewItems: ReviewItem[];
};

type ImportJob = {
  id: string;
  file_name: string;
  status: string;
  validation_result: Record<string, unknown>;
  created_at: string;
  committed_at: string | null;
};

export default function ImportCenter() {
  const [file, setFile] = useState<File | null>(null);
  const [portfolioName, setPortfolioName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const response = await apiFetch('/api/v1/imports/jobs');
        if (!response.ok) return;
        const json = await response.json();
        setJobs(json.data ?? []);
      } catch {
        // The upload flow remains available when import history is unavailable.
      }
    };

    void loadJobs();
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setMessage('');
  };

  async function previewFile() {
    if (!file) return;
    setBusy(true);
    setMessage('');

    try {
      const form = new FormData();
      form.append('file', file);
      if (portfolioName.trim()) form.append('portfolioName', portfolioName.trim());

      const response = await apiFetch('/api/v1/imports/preview', {
        method: 'POST',
        body: form,
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Preview failed');

      setPreview(json.data);
      setMessage(json.data.ready ? 'Workbook reviewed and ready to import.' : 'Workbook needs review before it can be imported.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function resolveReviewItem(itemId: string) {
    if (!preview) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await apiFetch(`/api/v1/imports/${preview.jobId}/reviews`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolvedItemId: itemId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not save this review decision.');
      setPreview((current) => current && ({ ...current, ...json.data }));
      setMessage(json.data.ready
        ? 'All required review decisions are saved. This preview is ready to import.'
        : `${json.data.reviewRows} review item(s) remain.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this review decision.');
    } finally {
      setBusy(false);
    }
  }

  function reviewActionLabel(type: ReviewItem['type']) {
    if (type === 'UNCERTAIN_HEADER') return 'Use detected header';
    if (type === 'DUPLICATE_COLUMNS') return 'Use first match, preserve all';
    return 'Keep rows as-is';
  }

  function displayCell(value: unknown) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function renameGroup(groupId: string, name: string) {
    setPreview((current) => current && {
      ...current,
      groups: current.groups.map((group) => (group.id === groupId ? { ...group, name } : group)),
    });
  }

  function moveSheet(sheetName: string, targetGroupId: string) {
    setPreview((current) => {
      if (!current) return current;
      const groups = current.groups
        .map((group) => ({ ...group, sheets: group.sheets.filter((s) => s !== sheetName) }))
        .map((group) => (group.id === targetGroupId ? { ...group, sheets: [...group.sheets, sheetName] } : group))
        .filter((group) => group.sheets.length > 0);
      return { ...current, groups };
    });
  }

  function splitSheetIntoNewGroup(sheetName: string) {
    setPreview((current) => {
      if (!current) return current;
      const groups = current.groups
        .map((group) => ({ ...group, sheets: group.sheets.filter((s) => s !== sheetName) }))
        .filter((group) => group.sheets.length > 0);
      groups.push({
        id: `group-custom-${Date.now()}`,
        name: sheetName,
        confidence: 60,
        commonField: 'manual',
        sheets: [sheetName],
        reason: 'Manually split into its own group.',
      });
      return { ...current, groups };
    });
  }

  function mergeGroupInto(sourceGroupId: string, targetGroupId: string) {
    if (sourceGroupId === targetGroupId) return;
    setPreview((current) => {
      if (!current) return current;
      const source = current.groups.find((g) => g.id === sourceGroupId);
      if (!source) return current;
      const groups = current.groups
        .filter((group) => group.id !== sourceGroupId)
        .map((group) => (group.id === targetGroupId ? { ...group, sheets: [...group.sheets, ...source.sheets] } : group));
      return { ...current, groups };
    });
  }

  async function persistGroups(groups: Group[]) {
    if (!preview) throw new Error('Preview the workbook before saving its organization name.');
    const response = await apiFetch(`/api/v1/imports/${preview.jobId}/groups`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || 'Could not save organization group names.');
  }

  async function saveGroups() {
    if (!preview) return;
    try {
      setBusy(true);
      await persistGroups(preview.groups);
      setMessage('Portfolio group names saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save organization group names.');
    } finally {
      setBusy(false);
    }
  }

  async function saveOrganizationName() {
    if (!preview) {
      setMessage('Preview the workbook first, then save its portfolio name.');
      return;
    }
    const name = portfolioName.trim();
    if (!name) {
      setMessage('Enter a portfolio name before saving.');
      return;
    }
    const groups = preview.groups.map((group, index) => index === 0 ? { ...group, name } : group);
    setPreview({ ...preview, groups });
    try {
      setBusy(true);
      await persistGroups(groups);
      setMessage(`Portfolio name "${name}" saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the portfolio name.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setMessage('');

    try {
      await saveGroups();
      const response = await apiFetch(`/api/v1/imports/${preview.jobId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Import failed');

      const extras = [
        json.data.propertiesLinked ? `${json.data.propertiesLinked} properties linked` : null,
        json.data.communications ? `${json.data.communications} communications` : null,
        json.data.promises ? `${json.data.promises} promises to pay` : null,
        json.data.rawRowsPreserved ? `${json.data.rawRowsPreserved} source rows preserved as-is` : null,
      ].filter(Boolean).join(', ');
      setMessage(`Imported ${json.data.entities} customers, ${json.data.relationships} accounts/obligations, and ${json.data.payments} payments${extras ? ` (plus ${extras})` : ''}.`);
      setPreview(null);
      setFile(null);
      setJobs((current) => current.map((job) =>
        job.file_name === file?.name ? { ...job, status: 'COMMITTED', committed_at: new Date().toISOString() } : job,
      ));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <p className="eyebrow">Data onboarding</p>
        <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">Import Center</h1>
        <p className="mt-2 max-w-2xl text-slate-400">
          Upload Excel workbooks, detect the sheet layout, match columns to known fields, and preview before any data is committed.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="panel p-5 sm:p-6">
          <h2 className="font-semibold text-white">Upload workbook</h2>
          <p className="mt-1 text-sm text-slate-400">Excel or CSV, up to 5 MB. Unrecognized columns are preserved with the import.</p>

          <label className="mt-6 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-slate-600 bg-slate-900/40 p-8 text-center transition hover:border-sky-500 hover:bg-slate-900/70">
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            <span className="text-lg font-medium text-slate-200">{file ? file.name : 'Choose Excel file'}</span>
            <span className="mt-2 text-sm text-slate-400">Upload a workbook and review the import pipeline before committing.</span>
          </label>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-slate-200">Portfolio group name</span>
            <input
              value={portfolioName}
              onChange={(event) => setPortfolioName(event.target.value)}
              placeholder="For example: VALL Accounts Organization"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={saveOrganizationName}
              disabled={!preview || busy}
              className="mt-3 rounded-lg border border-sky-500/70 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save portfolio name
            </button>
            <p className="mt-2 text-xs text-slate-500">Preview the workbook first. Each sheet starts as its own group so you can name it individually, then merge sheets later if they belong to the same organization.</p>
          </label>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={previewFile}
              disabled={!file || busy}
              className="rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Processing…' : 'Preview workbook'}
            </button>

            <button
              type="button"
              onClick={commit}
              disabled={!file || !preview || !preview.ready || busy}
              className="rounded-lg border border-emerald-500/80 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Import records
            </button>
          </div>

          {message && (
            <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-200">
              {message}
            </div>
          )}
        </section>

        <aside className="panel p-5 sm:p-6">
          <h2 className="font-semibold text-white">Pipeline status</h2>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Upload</p>
              <p className="mt-1 text-sm text-slate-200">{file ? 'File selected' : 'Waiting for workbook'}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Preview</p>
              <p className="mt-1 text-sm text-slate-200">{preview ? 'Workbook scanned' : 'Not started'}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Import</p>
              <p className="mt-1 text-sm text-slate-200">{preview?.ready ? 'Ready to commit' : 'Awaiting validation'}</p>
            </div>
          </div>
        </aside>
      </div>

      {preview && (
        <section className="mt-8 space-y-6">
          <div className="panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Workbook summary</p>
                <h3 className="mt-1 text-xl font-semibold text-white">{preview.fileName || 'Imported workbook'}</h3>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${preview.ready ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}>
                {preview.ready ? 'Ready' : 'Needs review'}
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-5">
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">Rows</div>
                <div className="mt-2 text-2xl font-bold text-white">{preview.totalRows}</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">Valid</div>
                <div className="mt-2 text-2xl font-bold text-emerald-200">{preview.validRows}</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">Errors</div>
                <div className="mt-2 text-2xl font-bold text-rose-200">{preview.errorRows}</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">Customers detected</div>
                <div className="mt-2 text-2xl font-bold text-sky-200">{preview.entityClusters ?? 0}</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">Custom fields</div>
                <div className="mt-2 text-2xl font-bold text-amber-200">{preview.unknownFields?.length ?? 0}</div>
              </div>
            </div>
            {(preview.reviewRows ?? 0) > 0 && <p className="mt-4 text-sm text-amber-200">{preview.reviewRows} review item(s) need a decision below. Invalid rows remain out of imported records when skipped.</p>}
          </div>

          {preview.reviewItems.length > 0 && (
            <div className="panel p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Review detected data</h3>
                  <p className="mt-1 text-sm text-slate-400">Inspect the source samples, then decide how each flagged sheet should be handled.</p>
                </div>
                <span className="text-sm text-amber-200">{preview.reviewRows ?? 0} remaining</span>
              </div>
              <div className="mt-4 space-y-3">
                {preview.reviewItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        <div className="mt-1 text-xs text-sky-200">{item.sheetName}</div>
                        <p className="mt-2 text-sm text-slate-300">{item.detail}</p>
                        {item.type === 'INVALID_ROWS' && (preview.sheets.find((sheet) => sheet.name === item.sheetName)?.rejectedRows?.length ?? 0) > 0 && (
                          <div className="mt-3 space-y-2">
                            {preview.sheets.find((sheet) => sheet.name === item.sheetName)?.rejectedRows?.map((row) => (
                              <div key={`${item.sheetName}-${row.sourceRowNumber}`} className="rounded border border-slate-700 bg-slate-950/70 p-2">
                                <div className="text-xs text-amber-200">Row {row.sourceRowNumber}: {row.reason}</div>
                                <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify(row.rawData, null, 2)}</pre>
                              </div>
                            ))}
                            {(preview.sheets.find((sheet) => sheet.name === item.sheetName)?.rejectedRows?.length ?? 0) >= 5 && (
                              <p className="text-xs text-slate-500">Showing up to five rejected rows. All rejected rows are retained on commit.</p>
                            )}
                          </div>
                        )}
                      </div>
                      {item.resolved ? (
                        <span className="shrink-0 text-xs font-medium text-emerald-200">Decision saved</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => resolveReviewItem(item.id)}
                          disabled={busy}
                          className="shrink-0 rounded-md border border-amber-500/60 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
                        >
                          {reviewActionLabel(item.type)}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.groups.length > 0 && (
            <div className="panel p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                    <h3 className="text-lg font-semibold text-white">Portfolio groups</h3>
                <button
                  type="button"
                  onClick={saveGroups}
                  disabled={busy}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-500"
                >
                  Save group names
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-400">Each group remains a separate portfolio inside your authenticated organization.</p>
              <div className="mt-4 space-y-3">
                {preview.groups.map((group) => (
                  <div key={group.id} className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1">
                        <input
                          value={group.name}
                          onChange={(event) => renameGroup(group.id, event.target.value)}
                          placeholder="Group name (e.g., Organization A)"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1.5 text-sm font-medium text-white outline-none focus:border-sky-500"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-200">{group.confidence}%</span>
                        {preview.groups.length > 1 && (
                          <select
                            defaultValue=""
                            onChange={(event) => {
                              if (event.target.value) mergeGroupInto(group.id, event.target.value);
                              event.target.value = '';
                            }}
                            className="rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1 text-xs text-slate-200"
                          >
                            <option value="" disabled>Merge into…</option>
                            {preview.groups.filter((g) => g.id !== group.id).map((g) => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {group.sheets.map((sheetName) => (
                        <div key={sheetName} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/60 px-2 py-1.5 text-xs text-slate-300">
                          <span>{sheetName}</span>
                          <div className="flex items-center gap-2">
                            {preview.groups.length > 1 && (
                              <select
                                defaultValue=""
                                onChange={(event) => {
                                  if (event.target.value) moveSheet(sheetName, event.target.value);
                                  event.target.value = '';
                                }}
                                className="rounded border border-slate-700 bg-slate-900/70 px-1.5 py-1 text-xs text-slate-300"
                              >
                                <option value="" disabled>Move to…</option>
                                {preview.groups.filter((g) => g.id !== group.id).map((g) => (
                                  <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                              </select>
                            )}
                            {group.sheets.length > 1 && (
                              <button
                                type="button"
                                onClick={() => splitSheetIntoNewGroup(sheetName)}
                                className="rounded border border-slate-600 px-1.5 py-1 text-xs text-slate-300 hover:border-sky-500"
                              >
                                Split out
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>Common field: {group.commonField}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{group.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(preview.deterministicMatches?.length ?? 0) > 0 && (
            <div className="panel p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-white">Deterministic entity matches</h3>
              <p className="mt-1 text-sm text-slate-400">Exact account or tax identifiers with no detected identifier conflict.</p>
              <div className="mt-4 space-y-3">
                {preview.deterministicMatches!.map((match, index) => (
                  <div key={`${match.candidateA}-${index}`} className="rounded-xl border border-emerald-700/60 bg-slate-900/50 p-3">
                    <div className="text-sm text-slate-200">{match.candidateA} ↔ {match.candidateB}</div>
                    <div className="mt-1 text-xs text-emerald-200">{match.confidence}% · {match.supportingEvidence?.join(' ')}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.possibleMatches.length > 0 && (
            <div className="panel p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-white">Possible entity matches</h3>
              <p className="mt-1 text-sm text-slate-400">Not merged automatically — review and reconcile manually if needed.</p>
              <div className="mt-4 space-y-3">
                {preview.possibleMatches.map((pm, index) => (
                  <div key={`${pm.candidateA}-${index}`} className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-slate-200">{pm.candidateA} ↔ {pm.candidateB}</div>
                      <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200">{pm.level ?? 'REVIEW'} · {pm.confidence}%</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{pm.reason}</div>
                    {pm.supportingEvidence?.length ? <div className="mt-1 text-xs text-slate-500">Evidence: {pm.supportingEvidence.join(' ')}</div> : null}
                    {pm.conflictingEvidence?.length ? <div className="mt-1 text-xs text-rose-300">Conflicts: {pm.conflictingEvidence.join(' ')}</div> : null}
                    {pm.sourceWorkbook ? <div className="mt-1 text-xs text-slate-500">Source: {pm.sourceWorkbook}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="panel p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-white">Field mapping</h3>
              <div className="mt-4 space-y-3">
                {preview.fieldMatches.length ? (
                  preview.fieldMatches.map((match) => (
                    <div key={`${match.canonicalField}-${match.sourceColumn}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/50 p-3">
                      <div>
                        <div className="text-sm font-medium text-white">{match.sourceColumn}</div>
                        <div className="text-xs text-slate-400">→ {match.canonicalField}</div>
                      </div>
                      <span className="rounded-full bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-200">
                        {match.confidence}%
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No field matches were detected yet.</p>
                )}
                {(preview.unknownFields?.length ?? 0) > 0 && (
                  <div className="border-t border-slate-700 pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-200">Preserved custom fields</p>
                    <p className="mt-1 text-xs text-slate-400">These are retained as source metadata, not discarded.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {preview.unknownFields!.map((field) => <span key={field.sourceColumn} className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-100">{field.sourceColumn}</span>)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="panel p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-white">Sheet detection</h3>
              <div className="mt-4 space-y-3">
                {preview.sheets.length ? (
                  preview.sheets.map((sheet) => (
                    <div key={sheet.name} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{sheet.name}</div>
                        <div className="text-xs text-slate-400">{sheet.type} • {sheet.rowCount} rows • {sheet.inspection?.columnCount ?? 0} columns</div>
                        {sheet.inspection && <div className="mt-1 text-xs text-slate-500">Header row {sheet.inspection.headerRow}{sheet.inspection.headerConfidence !== undefined ? ` (${sheet.inspection.headerConfidence}% recognized)` : ''}; {sheet.inspection.emptyRows} blank rows{sheet.inspection.duplicateColumns.length ? `; duplicate: ${sheet.inspection.duplicateColumns.join(', ')}` : ''}{sheet.inspection.repeatedHeaderRows?.length ? `; repeated headers on row(s) ${sheet.inspection.repeatedHeaderRows.join(', ')}` : ''}{sheet.inspection.nonRecordRows?.length ? `; skipped ${sheet.inspection.nonRecordRows.length} total/non-record row(s)` : ''}{sheet.inspection.uncertainHeader ? '; review header' : ''}</div>}
                      </div>
                      <span className="text-xs font-medium text-emerald-200">{sheet.confidence}%</span>
                      </div>
                      {(sheet.sampleRows?.length ?? 0) > 0 && (sheet.headers?.length ?? 0) > 0 && (
                        <div className="mt-3 overflow-x-auto border-t border-slate-700 pt-3">
                          <p className="mb-2 text-xs text-slate-500">First {sheet.sampleRows!.length} detected rows</p>
                          <table className="min-w-full text-left text-xs">
                            <thead>
                              <tr>{sheet.headers!.slice(0, 8).map((header) => <th key={header} className="max-w-40 px-2 py-1 font-medium text-slate-400">{header}</th>)}</tr>
                            </thead>
                            <tbody>
                              {sheet.sampleRows!.map((row, rowIndex) => (
                                <tr key={`${sheet.name}-sample-${rowIndex}`} className="border-t border-slate-800">
                                  {sheet.headers!.slice(0, 8).map((header) => {
                                    const value = displayCell(row[header]);
                                    return <td key={header} title={value} className="max-w-40 truncate px-2 py-1.5 text-slate-300">{value || '—'}</td>;
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No sheets were detected.</p>
                )}
              </div>
            </div>
          </div>

          <div className="panel p-5 sm:p-6">
            <h3 className="text-lg font-semibold text-white">Issues to review</h3>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              {preview.issues.length ? (
                preview.issues.map((issue, index) => (
                  <li key={`${issue}-${index}`} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                    {issue}
                  </li>
                ))
              ) : (
                <li className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">No issues detected.</li>
              )}
            </ul>
          </div>
        </section>
      )}

      {jobs.length > 0 && (
        <section className="mt-8 panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Database import history</p>
              <h2 className="mt-1 text-xl font-semibold text-white">Stored workbooks</h2>
            </div>
            <span className="text-sm text-slate-400">{jobs.length} recent imports</span>
          </div>
          <div className="mt-4 space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/50 p-3">
                <div>
                  <p className="font-medium text-white">{job.file_name}</p>
                  <p className="text-xs text-slate-400">{new Date(job.created_at).toLocaleString()}</p>
                </div>
                <span className="rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-200">{job.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
