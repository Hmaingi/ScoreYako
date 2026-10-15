'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/client-api';

type QueueRow = { queue_type: string; legal_name: string; amount: number; currency: string; priority?: string; due_date?: string; promised_date?: string; case_id?: string; entity_id?: string };
type Summary = { needsAttention: number; outstanding: number; brokenPromises: number; highRiskEntities: number; totalExposure: number; overdue: number; recoveredThisMonth: number; debtRate: number };

const currency = (value: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(value)).replace('KES', 'KSH');

async function request(path: string) {
  try {
    const result = await apiFetch(path, { cache: 'no-store' });
    return result.ok ? (await result.json()).data : null;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [queue, setQueue] = useState<QueueRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const session = await apiFetch('/api/v1/auth/me', { cache: 'no-store' });
      if (!session.ok) {
        router.replace('/login');
        return;
      }
      const [summaryData, queueData] = await Promise.all([
        request('/api/v1/dashboard/summary') as Promise<Summary | null>,
        request('/api/v1/dashboard/needs-attention?limit=6') as Promise<QueueRow[] | null>
      ]);
      setSummary(summaryData);
      setQueue(queueData);
      setReady(true);
    })();
  }, [router]);

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;

  const cards = [
    { label: 'Needs attention', value: summary?.needsAttention ?? 0, note: 'Cases requiring action', tone: 'rose' },
    { label: 'Outstanding', value: currency(summary?.outstanding ?? 0), note: 'Open portfolio balance', tone: 'amber' },
    { label: 'Broken promises', value: summary?.brokenPromises ?? 0, note: 'Follow up today', tone: 'rose' },
    { label: 'High-risk entities', value: summary?.highRiskEntities ?? 0, note: 'Above risk threshold', tone: 'sky' }
  ];

  const isError = queue === null;
  const items: QueueRow[] = queue ?? [];
  const collectionRate = summary?.totalExposure ? Math.round(((summary.totalExposure - summary.outstanding) / summary.totalExposure) * 100) : 0;

  return <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow">Portfolio overview</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Move every account forward.</h1><p className="mt-2 max-w-xl text-slate-400">Prioritise risk, document conversations and keep recovery work in one clear flow.</p></div><div className="flex flex-wrap gap-3"><Link href="/entities" className="button-secondary">Browse entities <span>?</span></Link><Link href="/kyc" className="button-primary">KYC Review <span>→</span></Link></div></section>
  <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <div key={card.label} className={`metric-card metric-${card.tone}`}><p className="text-sm text-slate-400">{card.label}</p><p className="mt-3 text-3xl font-bold text-white">{card.value}</p><p className="mt-2 text-xs text-slate-500">{card.note}</p></div>)}</section>
  <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]"><div className="panel overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-white">Priority queue</h2><p className="mt-1 text-sm text-slate-400">Highest-impact collection work, ordered for action.</p></div><span className="badge">{items.length} items</span></div><div className="divide-y divide-slate-800">{isError ? <div className="p-6 text-center text-sm text-amber-300">Backend unavailable — data could not be loaded. Check backend and database connection.</div> : items.length === 0 ? <div className="p-6 text-center text-sm text-slate-400">No items in the priority queue.</div> : items.map((item, index) => <div key={`${item.queue_type}-${index}`} className="flex flex-col gap-3 p-5 transition hover:bg-slate-800/30 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`status status-${item.queue_type.toLowerCase().replace('_', '-')}`}>{item.queue_type.replace('_', ' ')}</span><span className="text-xs text-slate-500">{item.priority || 'MEDIUM'} priority</span></div><p className="mt-3 truncate font-semibold text-white">{item.legal_name}</p><p className="mt-1 text-sm text-slate-400">{item.promised_date ? `Promise due ${item.promised_date}` : `Due ${item.due_date || 'date unavailable'}`}</p></div><div className="flex items-center justify-between gap-5 sm:block sm:text-right"><p className="font-semibold text-white">{currency(item.amount)}</p><Link href={item.entity_id ? `/entities/${item.entity_id}` : '/entities'} className="mt-2 inline-block text-sm text-sky-300 hover:text-sky-200">Open 360</Link></div></div>)}</div></div>
  <aside className="space-y-6"><div className="panel p-5"><p className="text-sm text-slate-400">Portfolio health</p><p className="mt-2 text-3xl font-bold text-white">{collectionRate}%</p><p className="mt-1 text-sm text-slate-400">of total exposure collected</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${collectionRate}%` }} /></div><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><span className="text-slate-400">Total exposure</span><b>{currency(summary?.totalExposure ?? 0)}</b></div><div className="flex justify-between"><span className="text-slate-400">Overdue balance</span><b className="text-amber-300">{currency(summary?.overdue ?? 0)}</b></div><div className="flex justify-between"><span className="text-slate-400">Recovered this month</span><b className="text-emerald-300">{currency(summary?.recoveredThisMonth ?? 0)}</b></div></div></div><div className="panel p-5"><p className="text-sm text-slate-400">Today’s playbook</p><ol className="mt-4 space-y-4 text-sm"><li className="flex gap-3"><span className="step">1</span><span><b className="text-white">Resolve broken promises</b><br /><span className="text-slate-400">Start with the highest committed amount.</span></span></li><li className="flex gap-3"><span className="step">2</span><span><b className="text-white">Contact overdue accounts</b><br /><span className="text-slate-400">Log the outcome and next date.</span></span></li><li className="flex gap-3"><span className="step">3</span><span><b className="text-white">Review risk signals</b><br /><span className="text-slate-400">Escalate accounts exceeding threshold.</span></span></li></ol></div></aside></section></div>;
}