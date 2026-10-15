'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

const navigation = [
  { href: '/', label: 'Overview', icon: 'O' },
  { href: '/entities', label: 'Entities', icon: 'E' },
  { href: '/cases', label: 'Cases', icon: 'C' },
  { href: '/reports', label: 'Reports', icon: 'R' },
  { href: '/kyc', label: 'KYC Review', icon: 'K' },
  { href: '/import', label: 'Import Center', icon: 'I' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }
  const links = navigation.map((item) => (
    <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${pathname === item.href ? 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
      <span className="grid h-5 w-5 place-items-center text-base">{item.icon}</span>{item.label}
    </Link>
  ));

  if (pathname === '/login') {
    return <div className="min-h-screen bg-slate-950 text-slate-100">{children}</div>;
  }

  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-800 bg-slate-950/95 p-5 lg:block">
      <div className="mb-10 px-3"><p className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-400">Scoreyako</p><p className="mt-2 text-lg font-bold text-white">Collections OS</p></div>
      <nav className="space-y-2">{links}</nav>
      <div className="absolute bottom-6 left-5 right-5 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400"><p className="font-medium text-slate-200">Portfolio workspace</p><p className="mt-1">Add your organization data</p></div>
    </aside>
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur lg:ml-64 lg:px-8">
      <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-700 text-lg text-slate-200 lg:hidden" aria-label="Open navigation">?</button>
      <div className="hidden text-sm text-slate-400 sm:block">Financial relationship intelligence</div>
      <div className="flex items-center gap-3"><span className="hidden text-sm text-slate-400 sm:block">Ready for your data</span><button onClick={signOut} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-sky-500 hover:text-white">Sign out</button></div>
    </header>
    {open && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-slate-950/75" aria-label="Close navigation" onClick={() => setOpen(false)} /><aside className="relative h-full w-72 border-r border-slate-800 bg-slate-950 p-5"><div className="mb-10 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-400">Scoreyako</p><p className="mt-2 text-lg font-bold text-white">Collections OS</p></div><button onClick={() => setOpen(false)} className="text-xl text-slate-400">×</button></div><nav className="space-y-2">{links}</nav></aside></div>}
    <main className="lg:ml-64">{children}</main>
  </div>;
}