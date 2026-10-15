'use client';

import { FormEvent, useState } from 'react';
import { apiFetch } from '../lib/client-api';

type Props = { entityId: string; entityType: 'INDIVIDUAL' | 'BUSINESS'; caseId?: string };
export default function EntityActions({ entityId, entityType: initialEntityType, caseId }: Props) {
  const [mode, setMode] = useState<'promise' | 'communication' | null>(null);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [entityType, setEntityType] = useState(initialEntityType);
  const [savingEntityType, setSavingEntityType] = useState(false);
  const saveEntityType = async () => {
    setSavingEntityType(true);
    const response = await apiFetch(`/api/v1/entities/${entityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: entityType }),
    });
    setMessage(response.ok
      ? 'Entity type saved. Any existing KYC profile was moved back to pending review.'
      : 'Could not update the entity type. Check your permissions and try again.');
    setSavingEntityType(false);
  };
  const removeEntity = async () => {
    if (!window.confirm('Delete this entity and its imported records, relationships, cases, and KYC profile? This cannot be undone.')) return;
    setDeleting(true);
    const response = await apiFetch(`/api/v1/entities/${entityId}`, { method: 'DELETE' });
    if (response.ok) window.location.href = '/entities';
    else { setMessage('Could not delete this entity.'); setDeleting(false); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage('Saving…');
    const form = new FormData(event.currentTarget);
    const isPromise = mode === 'promise';
    const body = isPromise ? { case_id: caseId, entity_id: entityId, promised_amount: Number(form.get('amount')), promised_date: form.get('date'), status: 'PENDING' } : { entity_id: entityId, case_id: caseId || undefined, comm_type: form.get('type'), notes: form.get('notes'), outcome: form.get('outcome'), next_action_date: form.get('date') || undefined };
    const response = await apiFetch(`/api/v1/${isPromise ? 'promises-to-pay' : 'communications'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setMessage(response.ok ? `${isPromise ? 'Promise' : 'Communication'} saved. Refresh to see it in the timeline.` : 'Could not save this update. Check that the backend is running.');
    if (response.ok) event.currentTarget.reset();
  };
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-white">Take action</h2><p className="mt-1 text-sm text-slate-400">Keep the case moving with a documented next step.</p></div><div className="flex gap-2"><button disabled={!caseId} onClick={() => { setMode('promise'); setMessage(''); }} className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Record promise</button><button onClick={() => { setMode('communication'); setMessage(''); }} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-sky-500">Log contact</button></div></div>
    {mode && <form onSubmit={submit} className="mt-5 grid gap-3 border-t border-slate-800 pt-5 sm:grid-cols-2">
      {mode === 'promise' ? <><label className="text-sm text-slate-300">Promised amount<input required name="amount" type="number" min="1" step="0.01" className="field mt-1" /></label><label className="text-sm text-slate-300">Promise date<input required name="date" type="date" className="field mt-1" /></label></> : <><label className="text-sm text-slate-300">Channel<select name="type" className="field mt-1"><option>CALL</option><option>EMAIL</option><option>SMS</option><option>WHATSAPP</option></select></label><label className="text-sm text-slate-300">Next action date<input name="date" type="date" className="field mt-1" /></label><label className="text-sm text-slate-300 sm:col-span-2">Outcome<input name="outcome" placeholder="e.g. Left voicemail" className="field mt-1" /></label><label className="text-sm text-slate-300 sm:col-span-2">Notes<textarea name="notes" rows={3} className="field mt-1" /></label></>}
      <div className="flex items-center gap-3 sm:col-span-2"><button className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">Save update</button><button type="button" onClick={() => setMode(null)} className="text-sm text-slate-400">Cancel</button>{message && <span className="text-sm text-slate-300">{message}</span>}</div>
    </form>}
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-slate-800 pt-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-400">Entity type
          <select value={entityType} onChange={(event) => setEntityType(event.target.value as Props['entityType'])} className="field mt-1 block min-w-40">
            <option value="INDIVIDUAL">Individual</option>
            <option value="BUSINESS">Business / organization</option>
          </select>
        </label>
        <button type="button" onClick={saveEntityType} disabled={savingEntityType || entityType === initialEntityType} className="rounded-lg border border-sky-500/50 px-3 py-2 text-sm font-semibold text-sky-200 hover:bg-sky-500/10 disabled:opacity-50">{savingEntityType ? 'Saving…' : 'Save type'}</button>
      </div>
      <button type="button" onClick={removeEntity} disabled={deleting} className="rounded-lg border border-rose-500/50 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50">{deleting ? 'Deleting…' : 'Delete entity'}</button>
    </div>
  </section>;
}