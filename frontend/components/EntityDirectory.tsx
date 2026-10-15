'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { apiFetch } from '../lib/client-api';

export type Entity = {
  id: string;
  legal_name: string;
  entity_type: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  organization_id?: string;
  organization_name?: string;
  portfolio_id?: string;
  portfolio_name?: string;
  total_outstanding?: number;
  relationship_count?: number;
  account_numbers?: string[];
  case_count?: number;
  extra_data?: Record<string, unknown>;
  created_at?: string;
  last_imported_at?: string;
};

const formatKsh = (amount: number | string | undefined) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  })
    .format(num)
    .replace('KES', 'KSH');
};

// Formats an upload/import date and tags it as "This year" / "Last year" / the actual year so
// users can quickly spot stale vs. freshly (re-)uploaded data during a check-up.
const formatUploadDate = (value?: string): { label: string; tag: string } | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const currentYear = new Date().getFullYear();
  const tag = year === currentYear ? 'This year' : year === currentYear - 1 ? 'Last year' : String(year);
  const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return { label, tag };
};

export default function EntityDirectory({ entities }: { entities: Entity[] }) {
  const [search, setSearch] = useState('');
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');

  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [groupMessage, setGroupMessage] = useState('');

  // Derive business/portfolio groups from entities
  const businessGroups = useMemo(() => {
    const groupsMap = new Map<
      string,
      {
        id: string;
        name: string;
        organizationName: string;
        portfolioId?: string;
        individuals: Entity[];
        businesses: Entity[];
        totalOutstanding: number;
        accountNumbersCount: number;
        firstSeenAt?: string;
        lastUpdatedAt?: string;
      }
    >();

    for (const e of entities) {
      const groupName =
        e.portfolio_name ||
        e.organization_name ||
        (e.extra_data?.source_group as string) ||
        (e.extra_data?.source_sheet as string) ||
        'Primary Business Group';

      const orgName = e.portfolio_name || e.organization_name || 'Organization';

      if (!groupsMap.has(groupName)) {
        groupsMap.set(groupName, {
          id: groupName,
          name: groupName,
          organizationName: orgName,
          portfolioId: e.portfolio_id,
          individuals: [],
          businesses: [],
          totalOutstanding: 0,
          accountNumbersCount: 0,
        });
      }

      const grp = groupsMap.get(groupName)!;
      const outstanding = Number(e.total_outstanding) || 0;
      grp.totalOutstanding += outstanding;
      if (!grp.portfolioId && e.portfolio_id) grp.portfolioId = e.portfolio_id;

      const createdAt = e.created_at;
      const updatedAt = e.last_imported_at || e.created_at;
      if (createdAt && (!grp.firstSeenAt || new Date(createdAt) < new Date(grp.firstSeenAt))) grp.firstSeenAt = createdAt;
      if (updatedAt && (!grp.lastUpdatedAt || new Date(updatedAt) > new Date(grp.lastUpdatedAt))) grp.lastUpdatedAt = updatedAt;

      if (e.account_numbers && e.account_numbers.length > 0) {
        grp.accountNumbersCount += e.account_numbers.length;
      }

      if (e.entity_type === 'BUSINESS') {
        grp.businesses.push(e);
      } else {
        grp.individuals.push(e);
      }
    }

    return Array.from(groupsMap.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }, [entities]);

  // Active business group when drilled down
  const activeGroup = useMemo(() => {
    if (!selectedBusiness) return null;
    return businessGroups.find((g) => g.id === selectedBusiness) || null;
  }, [selectedBusiness, businessGroups]);

  const deleteBusinessGroup = async () => {
    if (!activeGroup) return;
    if (!activeGroup.portfolioId) {
      setGroupMessage('This group has no linked business/org record to delete.');
      return;
    }
    const memberCount = activeGroup.individuals.length + activeGroup.businesses.length;
    if (
      !window.confirm(
        `Delete "${activeGroup.name}" and all ${memberCount} entities in it (relationships, cases, KYC, and imported data included)? This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingGroup(activeGroup.id);
    setGroupMessage('');
    try {
      const response = await apiFetch(`/api/v1/portfolios/${activeGroup.portfolioId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        window.location.href = '/entities';
      } else {
        const body = await response.json().catch(() => null);
        setGroupMessage(body?.error || 'Could not delete this business/org group.');
        setDeletingGroup(null);
      }
    } catch {
      setGroupMessage('Could not reach the backend to delete this group.');
      setDeletingGroup(null);
    }
  };

  // Filtered individuals within the selected business group
  const filteredGroupIndividuals = useMemo(() => {
    if (!activeGroup) return [];
    const term = search.toLowerCase();
    return activeGroup.individuals.filter((ind) => {
      if (!term) return true;
      const accs = (ind.account_numbers || []).join(' ');
      const extra = JSON.stringify(ind.extra_data || '');
      const fullText = `${ind.legal_name} ${ind.email || ''} ${ind.phone || ''} ${accs} ${extra}`.toLowerCase();
      return fullText.includes(term);
    });
  }, [activeGroup, search]);

  // Filtered entities for flat view
  const filteredFlatEntities = useMemo(() => {
    const term = search.toLowerCase();
    return entities.filter((e) => {
      if (!term) return true;
      const accs = (e.account_numbers || []).join(' ');
      const extra = JSON.stringify(e.extra_data || '');
      const fullText = `${e.legal_name} ${e.email || ''} ${e.phone || ''} ${e.organization_name || ''} ${e.portfolio_name || ''} ${accs} ${extra}`.toLowerCase();
      return fullText.includes(term);
    });
  }, [entities, search]);

  return (
    <div className="space-y-6">
      {/* Top Navigation & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {selectedBusiness ? (
            <button
              onClick={() => setSelectedBusiness(null)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm font-medium text-sky-400 hover:bg-slate-700 hover:text-sky-300 transition"
            >
              ← Back to all businesses
            </button>
          ) : (
            <div className="flex rounded-xl border border-slate-800 bg-slate-900/80 p-1">
              <button
                onClick={() => {
                  setViewMode('grouped');
                  setSelectedBusiness(null);
                }}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                  viewMode === 'grouped'
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🏢 Group by Business / Org
              </button>
              <button
                onClick={() => setViewMode('flat')}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                  viewMode === 'flat'
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                👥 All Individuals List
              </button>
            </div>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative flex-1 sm:max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              selectedBusiness
                ? `Search members in ${activeGroup?.name}...`
                : 'Search by name, account no, conn no, phone...'
            }
            className="w-full rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: DRILLED DOWN INTO SPECIFIC BUSINESS */}
      {selectedBusiness && activeGroup && (
        <div className="space-y-6">
          {/* Business Banner */}
          <div className="relative overflow-hidden rounded-2xl border border-sky-500/30 bg-gradient-to-r from-sky-950/40 via-slate-900/90 to-slate-900/90 p-6 shadow-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-sky-500/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-sky-400 border border-sky-500/30">
                    Business / Organization
                  </span>
                  <span className="text-xs text-slate-400">
                    Organization group: {activeGroup.organizationName}
                  </span>
                </div>
                <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
                  {activeGroup.name}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Showing all registered members, debtors, and individuals under this business.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  {formatUploadDate(activeGroup.firstSeenAt) && (
                    <span>
                      First uploaded: {formatUploadDate(activeGroup.firstSeenAt)!.label}{' '}
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                        {formatUploadDate(activeGroup.firstSeenAt)!.tag}
                      </span>
                    </span>
                  )}
                  {formatUploadDate(activeGroup.lastUpdatedAt) && (
                    <span>
                      Last updated: {formatUploadDate(activeGroup.lastUpdatedAt)!.label}{' '}
                      <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        {formatUploadDate(activeGroup.lastUpdatedAt)!.tag}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-wider text-slate-400">Total Members</p>
                  <p className="mt-1 text-xl font-bold text-white">
                    {activeGroup.individuals.length}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3">
                  <p className="text-xs uppercase tracking-wider text-amber-300">Total Exposure</p>
                  <p className="mt-1 text-xl font-bold text-amber-400">
                    {formatKsh(activeGroup.totalOutstanding)}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-800/60 pt-4">
              <span className="text-xs text-slate-500">
                Deleting removes every entity in this business/org and all of its imported data, relationships, cases, and history.
              </span>
              <div className="flex items-center gap-3">
                {groupMessage && <span className="text-xs text-rose-300">{groupMessage}</span>}
                <button
                  type="button"
                  onClick={deleteBusinessGroup}
                  disabled={deletingGroup === activeGroup.id}
                  className="rounded-lg border border-rose-500/50 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                >
                  {deletingGroup === activeGroup.id ? 'Deleting…' : 'Delete this business/org'}
                </button>
              </div>
            </div>
          </div>

          {/* Individuals Table / Cards */}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg">
            <div className="border-b border-slate-800/80 px-6 py-4 flex items-center justify-between">
              <h3 className="font-semibold text-white">
                Individuals & Members ({filteredGroupIndividuals.length})
              </h3>
              <p className="text-xs text-slate-400">
                Click "View 360" for complete imported Excel data & history
              </p>
            </div>

            {filteredGroupIndividuals.length > 0 ? (
              <div className="divide-y divide-slate-800">
                {filteredGroupIndividuals.map((ind) => {
                  const connNo =
                    (ind.extra_data?.conn_no as string) ||
                    (ind.extra_data?.['Conn No'] as string) ||
                    (ind.extra_data?.['CONN_NO'] as string) ||
                    (ind.extra_data?.connection_number as string);
                  const accNo =
                    (ind.account_numbers && ind.account_numbers[0]) ||
                    (ind.extra_data?.account_number as string) ||
                    (ind.extra_data?.['Account Number'] as string) ||
                    (ind.extra_data?.['ACC_NO'] as string);
                  const reason =
                    (ind.extra_data?.reason as string) ||
                    (ind.extra_data?.['Reason for Non-payment'] as string) ||
                    (ind.extra_data?.['REASON'] as string) ||
                    (ind.extra_data?.notes as string) ||
                    (ind.extra_data?.remarks as string);
                  const zone =
                    (ind.extra_data?.zone as string) ||
                    (ind.extra_data?.['Zone'] as string) ||
                    (ind.extra_data?.['ZONE'] as string) ||
                    (ind.extra_data?.area as string);

                  return (
                    <div
                      key={ind.id}
                      className="flex flex-col gap-4 p-5 hover:bg-slate-800/40 transition sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/entities/${ind.id}`}
                            className="font-semibold text-white hover:text-sky-300 text-base transition truncate"
                          >
                            {ind.legal_name}
                          </Link>
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                            {ind.entity_type}
                          </span>
                          {accNo && (
                            <span className="rounded bg-sky-950/60 border border-sky-800/50 px-2 py-0.5 text-xs font-mono text-sky-300">
                              Acc: {accNo}
                            </span>
                          )}
                          {connNo && (
                            <span className="rounded bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 text-xs font-mono text-emerald-300">
                              Conn: {connNo}
                            </span>
                          )}
                          {zone && (
                            <span className="rounded bg-purple-950/60 border border-purple-800/50 px-2 py-0.5 text-xs text-purple-300">
                              Zone: {zone}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                          {ind.phone && <span>📞 {ind.phone}</span>}
                          {ind.email && <span>✉️ {ind.email}</span>}
                          {ind.tax_id && <span>🆔 ID/PIN: {ind.tax_id}</span>}
                          {reason && (
                            <span className="text-amber-300/90 truncate max-w-md">
                              📝 Note: {reason}
                            </span>
                          )}
                          {formatUploadDate(ind.last_imported_at || ind.created_at) && (
                            <span>
                              🗓 Uploaded {formatUploadDate(ind.last_imported_at || ind.created_at)!.label}{' '}
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                                {formatUploadDate(ind.last_imported_at || ind.created_at)!.tag}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-5 sm:self-center">
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-wider text-slate-400">Outstanding</p>
                          <p className="font-bold text-white text-base">
                            {formatKsh(ind.total_outstanding)}
                          </p>
                        </div>
                        <Link
                          href={`/entities/${ind.id}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 shadow-sm transition"
                        >
                          View 360 →
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-400">
                <p className="text-base font-medium">No individuals matched your search.</p>
                <p className="text-xs mt-1 text-slate-500">Try clearing the search query.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: BUSINESSES CARDS GRID (DEFAULT) */}
      {!selectedBusiness && viewMode === 'grouped' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">
              Select a business to view all its individual accounts and history ({businessGroups.length} business groups)
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {businessGroups.map((grp) => (
              <div
                key={grp.id}
                onClick={() => setSelectedBusiness(grp.id)}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-6 hover:border-sky-500/50 hover:bg-slate-850 hover:shadow-xl hover:shadow-sky-500/5 transition cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-sky-400">
                      Business Group
                    </span>
                    <span className="text-xs text-slate-500 truncate max-w-[120px]">
                      {grp.organizationName}
                    </span>
                  </div>

                  <h3 className="mt-4 text-xl font-bold text-white group-hover:text-sky-300 transition line-clamp-1">
                    {grp.name}
                  </h3>

                  <p className="mt-1 text-xs text-slate-400">
                    {grp.individuals.length} {grp.individuals.length === 1 ? 'Individual Member' : 'Individual Members'}
                  </p>

                  <div className="mt-5 space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Total Exposure:</span>
                      <span className="font-bold text-amber-400">
                        {formatKsh(grp.totalOutstanding)}
                      </span>
                    </div>
                    {grp.accountNumbersCount > 0 && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Total Accounts:</span>
                        <span className="font-medium text-slate-300">
                          {grp.accountNumbersCount}
                        </span>
                      </div>
                    )}
                    {formatUploadDate(grp.lastUpdatedAt) && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Last updated:</span>
                        <span className="font-medium text-emerald-300">
                          {formatUploadDate(grp.lastUpdatedAt)!.tag}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between pt-4 border-t border-slate-800/60 text-xs font-semibold text-sky-400 group-hover:text-sky-300">
                  <span>View Individuals</span>
                  <span className="transition-transform group-hover:translate-x-1">→</span>
                </div>
              </div>
            ))}
          </div>

          {businessGroups.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-12 text-center">
              <p className="text-lg font-semibold text-white">No businesses or entities found</p>
              <p className="mt-2 text-sm text-slate-400">
                Upload your Excel sheets in the Import Center to create business groups and individuals.
              </p>
              <Link
                href="/import"
                className="mt-5 inline-block rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500"
              >
                Go to Import Center →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: FLAT LIST OF ALL ENTITIES */}
      {!selectedBusiness && viewMode === 'flat' && (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
            <h3 className="font-semibold text-white">
              All Registered Entities ({filteredFlatEntities.length})
            </h3>
          </div>

          <div className="divide-y divide-slate-800">
            {filteredFlatEntities.map((e) => (
              <div
                key={e.id}
                className="flex flex-col gap-4 p-5 hover:bg-slate-800/40 transition sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/entities/${e.id}`}
                      className="font-semibold text-white hover:text-sky-300 transition truncate"
                    >
                      {e.legal_name}
                    </Link>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                      {e.entity_type}
                    </span>
                    {e.portfolio_name && (
                      <span className="rounded bg-sky-950/60 border border-sky-800/50 px-2 py-0.5 text-xs text-sky-300">
                        {e.portfolio_name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {e.email || e.phone || 'No contact on file'} · Org: {e.organization_name || 'Default'}
                  </p>
                  {formatUploadDate(e.last_imported_at || e.created_at) && (
                    <p className="text-xs text-slate-500">
                      🗓 Uploaded {formatUploadDate(e.last_imported_at || e.created_at)!.label}{' '}
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                        {formatUploadDate(e.last_imported_at || e.created_at)!.tag}
                      </span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-slate-400">Outstanding</p>
                    <p className="font-semibold text-white">{formatKsh(e.total_outstanding)}</p>
                  </div>
                  <Link
                    href={`/entities/${e.id}`}
                    className="rounded-lg bg-sky-600/80 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 transition"
                  >
                    View 360 →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
/*
  const filtered = useMemo(() => entities.filter((e) => (type === 'ALL' || e.entity_type === type) && `${e.legal_name} ${e.email || ''} ${e.phone || ''}`.toLowerCase().includes(search.toLowerCase())), [entities, search, type]);
  return <><div className="mb-5 flex flex-col gap-3 sm:flex-row"><input value={search} onChange={(e) => setSearch(e.target.value)} className="field flex-1" placeholder="Search by entity, email or phone" /><select value={type} onChange={(e) => setType(e.target.value)} className="field sm:w-44"><option value="ALL">All entities</option><option value="BUSINESS">Businesses</option><option value="INDIVIDUAL">Individuals</option></select></div><p className="mb-3 text-sm text-slate-400">{filtered.length} {filtered.length === 1 ? 'entity' : 'entities'} in view</p><div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70"><div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-800/70 text-xs uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Entity</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Primary contact</th><th className="px-5 py-3"></th></tr></thead><tbody className="divide-y divide-slate-800">{filtered.map((e) => <tr key={e.id} className="hover:bg-slate-800/40"><td className="px-5 py-4 font-medium text-white">{e.legal_name}</td><td className="px-5 py-4"><span className="badge">{e.entity_type}</span></td><td className="px-5 py-4 text-slate-400">{e.email || e.phone || 'No contact on file'}</td><td className="px-5 py-4 text-right"><Link href={`/entities/${e.id}`} className="text-sky-300 hover:text-sky-200">View 360 ?</Link></td></tr>)}</tbody></table></div><div className="divide-y divide-slate-800 md:hidden">{filtered.map((e) => <Link key={e.id} href={`/entities/${e.id}`} className="block p-4 hover:bg-slate-800/40"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-white">{e.legal_name}</p><p className="mt-1 text-sm text-slate-400">{e.email || e.phone || 'No contact on file'}</p></div><span className="badge">{e.entity_type}</span></div><p className="mt-3 text-sm text-sky-300">View 360 ?</p></Link>)}</div>{filtered.length === 0 && <div className="p-10 text-center text-slate-400">No entities match those filters.</div>}</div></>;
}*/