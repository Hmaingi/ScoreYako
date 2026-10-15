'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/client-api';

type Stats = { total_entities: number; not_started: number; in_progress: number; pending_review: number; verified: number; rejected: number; expired: number };
type Row = { entity_id: string; legal_name: string; entity_type: string; status: string; risk_level?: string };

async function get(path: string) {
  const response = await apiFetch(path, { cache: 'no-store' });
  return response.ok ? (await response.json()).data : null;
}

export default function KycPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => { Promise.all([get('/api/v1/kyc/stats'), get('/api/v1/kyc')]).then(([nextStats, nextRows]) => { setStats(nextStats); setRows(nextRows || []); }); }, []);
  async function startProfile(row: Row) {
    const response = await apiFetch(`/api/v1/kyc/entities/${row.entity_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kyc_type: row.entity_type }) });
    if (response.ok) { setRows((current) => current.map((item) => item.entity_id === row.entity_id ? { ...item, status: 'NOT_STARTED' } : item)); setMessage(`KYC profile started for ${row.legal_name}.`); }
    else setMessage('Could not start the KYC profile.');
  }
  const cards = [
    ['Total entities', stats?.total_entities ?? 0, 'text-white'],
    ['Not started', stats?.not_started ?? 0, 'text-slate-300'],
    ['In progress', stats?.in_progress ?? 0, 'text-sky-300'],
    ['Pending review', stats?.pending_review ?? 0, 'text-amber-300'],
    ['Verified', stats?.verified ?? 0, 'text-emerald-300'],
    ['Rejected / expired', (stats?.rejected ?? 0) + (stats?.expired ?? 0), 'text-rose-300'],
  ];
  return <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
    <header className="mb-8"><p className="eyebrow">Customer verification</p><h1 className="mt-2 text-3xl font-bold text-white">KYC overview</h1><p className="mt-2 text-slate-400">Review entity verification status without exposing sensitive identifiers.</p></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label, value, tone]) => <div key={label} className="metric-card"><p className="text-sm text-slate-400">{label}</p><p className={`mt-3 text-3xl font-bold ${tone}`}>{value}</p></div>)}</section>
    <section className="panel mt-6 overflow-hidden"><div className="border-b border-slate-800 p-5"><h2 className="font-semibold text-white">Verification queue</h2><p className="mt-1 text-sm text-slate-400">Existing entities can start KYC here. Imported information remains unverified.</p>{message && <p className="mt-2 text-sm text-emerald-300">{message}</p>}</div><div className="divide-y divide-slate-800">{rows.filter((row) => row.status !== 'VERIFIED').slice(0, 20).map((row) => <div key={row.entity_id} className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-slate-800/30"><Link href={`/entities/${row.entity_id}`}><p className="font-medium text-white">{row.legal_name}</p><p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{row.entity_type}</p></Link><div className="flex items-center gap-3"><span className={`status status-${row.status.toLowerCase().replace('_', '-')}`}>{row.status.replace('_', ' ')}</span>{row.status === 'NOT_STARTED' && <button type="button" onClick={() => startProfile(row)} className="rounded-lg border border-sky-500/50 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/10">Start KYC</button>}</div></div>)}{rows.filter((row) => row.status !== 'VERIFIED').length === 0 && <p className="p-6 text-sm text-slate-400">No profiles currently require attention.</p>}</div></section>
  </div>;
}
