'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/client-api';

type KycEntity = { id: string; legal_name: string; entity_type: 'INDIVIDUAL' | 'BUSINESS' };
type KycProfile = Record<string, unknown> & { id: string; status: string; verification_status: string; risk_level?: string | null; notes?: string | null };
type KycDocument = { id: string; document_type: string; document_number?: string | null; document_status: string; file_name?: string | null; content_type?: string | null; has_file?: boolean; uploaded_at: string; rejection_reason?: string | null };
type KycCheck = { id: string; check_type: string; status: string; result?: string | null; notes?: string | null; provider?: string | null; performed_at?: string | null };
type KycRelationship = { id: string; related_entity_id: string; related_entity_name: string; related_entity_type: string; relationship_type: string; ownership_percentage?: number | null };
type RelatedEntity = { id: string; legal_name: string; entity_type: string };
type KycData = { entity: KycEntity; profile: KycProfile | null; addresses: Array<Record<string, unknown>>; documents: KycDocument[]; checks: KycCheck[]; verifications: Array<Record<string, unknown>>; relationships: KycRelationship[] };

const individualFields = [
  ['first_name', 'First name'], ['middle_name', 'Middle name'], ['last_name', 'Last name'],
  ['date_of_birth', 'Date of birth'], ['gender', 'Gender'], ['nationality', 'Nationality'],
  ['national_id', 'National ID number'], ['passport_number', 'Passport number'], ['tax_pin', 'Tax PIN'],
  ['other_id_type', 'Other ID type'], ['other_id_number', 'Other ID number'],
] as const;
const businessFields = [
  ['legal_name', 'Registered legal name'], ['trading_name', 'Trading name'],
  ['registration_number', 'Registration number'], ['tax_pin', 'Tax PIN'], ['business_type', 'Business type'],
  ['incorporation_date', 'Incorporation date'], ['country_of_incorporation', 'Country of incorporation'],
  ['registration_country', 'Registration country'],
] as const;
const documentTypes = ['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'TAX_CERTIFICATE', 'BUSINESS_REGISTRATION', 'CERTIFICATE_OF_INCORPORATION', 'PROOF_OF_ADDRESS', 'OTHER'];
const relationshipTypes = ['CLIENT', 'CUSTOMER', 'SUPPLIER', 'PARENT_COMPANY', 'SUBSIDIARY', 'BUSINESS_PARTNER', 'DIRECTOR', 'SHAREHOLDER', 'BENEFICIAL_OWNER', 'AUTHORIZED_REPRESENTATIVE', 'CONTACT_PERSON'];

export default function KycEntityReviewPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<KycData | null>(null);
  const [relatedEntities, setRelatedEntities] = useState<RelatedEntity[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [documentType, setDocumentType] = useState('NATIONAL_ID');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [relationshipType, setRelationshipType] = useState('CLIENT');
  const [relatedEntityId, setRelatedEntityId] = useState('');
  const [checkType, setCheckType] = useState('IDENTITY');
  const [checkStatus, setCheckStatus] = useState('REVIEW');

  async function load() {
    const [profileResponse, entitiesResponse] = await Promise.all([
      apiFetch(`/api/v1/kyc/entities/${params.id}`, { cache: 'no-store' }),
      apiFetch('/api/v1/entities?limit=500', { cache: 'no-store' }),
    ]);
    if (!profileResponse.ok) throw new Error('Could not load this KYC profile. Check your access and try again.');
    const profileBody = await profileResponse.json();
    setData(profileBody.data);
    const profile = profileBody.data.profile as Record<string, unknown> | null;
    const address = profileBody.data.addresses?.[0] as Record<string, unknown> | undefined;
    const nextDraft: Record<string, string> = {};
    for (const [field] of [...individualFields, ...businessFields]) nextDraft[field] = String(profile?.[field] ?? '');
    for (const field of ['notes', 'risk_level']) nextDraft[field] = String(profile?.[field] ?? '');
    for (const field of ['country', 'county', 'city', 'physical_address', 'postal_address']) nextDraft[`address_${field}`] = String(address?.[field] ?? '');
    setDraft(nextDraft);
    if (entitiesResponse.ok) {
      const entityBody = await entitiesResponse.json();
      setRelatedEntities((entityBody.data ?? []).filter((entity: RelatedEntity) => entity.id !== params.id));
    }
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load KYC data.'));
  }, [params.id]);

  function setField(name: string, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setBusy(true);
    setMessage('');
    const fields = data.entity.entity_type === 'INDIVIDUAL' ? individualFields : businessFields;
    const detail = Object.fromEntries(fields.map(([key]) => [key, draft[key] || null]));
    const addressValues = ['country', 'county', 'city', 'physical_address', 'postal_address'];
    const hasAddress = addressValues.some((key) => draft[`address_${key}`]?.trim());
    const body = {
      kyc_type: data.entity.entity_type,
      status: 'IN_PROGRESS',
      risk_level: draft.risk_level || null,
      notes: draft.notes || null,
      [data.entity.entity_type === 'INDIVIDUAL' ? 'individual' : 'business']: detail,
      addresses: hasAddress ? [{ address_type: data.entity.entity_type === 'BUSINESS' ? 'REGISTERED' : 'RESIDENTIAL', is_primary: true, ...Object.fromEntries(addressValues.map((key) => [key, draft[`address_${key}`] || null])) }] : undefined,
    };
    try {
      const response = await apiFetch(`/api/v1/kyc/entities/${params.id}`, {
        method: data.profile ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save KYC profile.');
      await load();
      setMessage('KYC profile saved. Submitted data remains unverified until reviewed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save KYC profile.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || !data?.profile) return;
    setBusy(true);
    const form = new FormData();
    form.append('document_type', documentType);
    form.append('file', selectedFile);
    try {
      const response = await apiFetch(`/api/v1/kyc/entities/${params.id}/documents/upload`, { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Upload failed. Use a JPEG, PNG, WebP, or PDF under 5 MB.');
      setSelectedFile(null);
      await load();
      setMessage('Evidence uploaded and marked pending review.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload evidence.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadDocument(document: KycDocument) {
    const response = await apiFetch(`/api/v1/kyc/entities/${params.id}/documents/${document.id}/file`);
    if (!response.ok) {
      setMessage('Document retrieval requires KYC reviewer access.');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = document.file_name || `${document.document_type}-evidence`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function compareSavedValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const response = await apiFetch(`/api/v1/kyc/entities/${params.id}/checks/compare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_number: form.get('document_number'), phone: form.get('phone') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Comparison failed.');
      await load();
      setMessage(`Saved-record comparison: ID ${result.data.idMatches ? 'matches' : 'does not match'}; phone ${result.data.phoneMatches ? 'matches' : 'does not match'}. Both checks remain for human review; this is not external verification.`);
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Comparison failed.');
    } finally {
      setBusy(false);
    }
  }

  async function recordCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const response = await apiFetch(`/api/v1/kyc/entities/${params.id}/checks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ check_type: checkType, status: checkStatus, provider: 'Manual reviewer', notes: form.get('notes'), result: form.get('result') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not record check.');
      await load();
      setMessage('Review check recorded.');
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not record check.');
    } finally {
      setBusy(false);
    }
  }

  async function addRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const response = await apiFetch(`/api/v1/kyc/entities/${params.id}/relationships`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ related_entity_id: relatedEntityId, relationship_type: relationshipType, ownership_percentage: form.get('ownership_percentage') ? Number(form.get('ownership_percentage')) : null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not add relationship.');
      await load();
      setMessage('Business relationship saved.');
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add relationship.');
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: 'submit' | 'verify' | 'reject') {
    const reason = action === 'reject' ? window.prompt('Reason for rejection?') : null;
    if (action === 'reject' && !reason) return;
    setBusy(true);
    try {
      const response = await apiFetch(`/api/v1/kyc/entities/${params.id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'KYC status could not be updated.');
      await load();
      setMessage(action === 'verify' ? 'KYC marked verified by reviewer.' : action === 'reject' ? 'KYC rejected.' : 'KYC submitted for review.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'KYC status could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <main className="mx-auto max-w-6xl p-6"><Link href="/kyc" className="text-sky-300">Back to KYC queue</Link><p className="mt-6 text-sm text-slate-400">{message || 'Loading KYC profile…'}</p></main>;
  const fields = data.entity.entity_type === 'INDIVIDUAL' ? individualFields : businessFields;
  const isBusiness = data.entity.entity_type === 'BUSINESS';

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
    <header>
      <Link href="/kyc" className="text-sm text-sky-300 hover:text-sky-200">← KYC queue</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">{data.entity.entity_type} verification</p><h1 className="mt-2 text-3xl font-bold text-white">{data.entity.legal_name}</h1></div>
        <div className="flex gap-2"><Link href={`/entities/${params.id}`} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200">Entity 360</Link><span className="status">{data.profile?.status || 'NOT_STARTED'}</span></div>
      </div>
      <p className="mt-3 text-sm text-amber-200">Manual evidence review only. ID-record comparison does not query a government registry; phone ownership requires an SMS or voice provider, which is not configured.</p>
      {message && <p role="status" className="mt-3 text-sm text-sky-200">{message}</p>}
    </header>

    <form onSubmit={saveProfile} className="panel space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Identity profile</h2><p className="mt-1 text-sm text-slate-400">Enter details from the person’s ID or the business registration record.</p></div><span className="text-xs text-slate-500">Risk level is a reviewer classification, not an automatic score.</span></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([key, label]) => <label key={key} className="text-xs text-slate-400">{label}<input type={key.includes('date') ? 'date' : 'text'} value={draft[key] || ''} onChange={(event) => setField(key, event.target.value)} className="field mt-1" /></label>)}
        <label className="text-xs text-slate-400">Reviewer risk level<select value={draft.risk_level || ''} onChange={(event) => setField('risk_level', event.target.value)} className="field mt-1"><option value="">Not assessed</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {['country', 'county', 'city', 'physical_address', 'postal_address'].map((key) => <label key={key} className="text-xs capitalize text-slate-400">{key.replaceAll('_', ' ')}<input value={draft[`address_${key}`] || ''} onChange={(event) => setField(`address_${key}`, event.target.value)} className="field mt-1" /></label>)}
      </div>
      <label className="block text-xs text-slate-400">Reviewer notes<textarea value={draft.notes || ''} onChange={(event) => setField('notes', event.target.value)} rows={3} className="field mt-1" /></label>
      <button disabled={busy} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save profile'}</button>
    </form>

    <section className="panel space-y-4 p-5 sm:p-6">
      <div><h2 className="font-semibold text-white">Identity evidence</h2><p className="mt-1 text-sm text-slate-400">JPEG, PNG, WebP, or PDF, up to 5 MB. Evidence is stored privately in the tenant’s database and only KYC reviewers can retrieve it.</p></div>
      <form onSubmit={uploadDocument} className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400">Document type<select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="field mt-1 min-w-52">{documentTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="min-w-56 flex-1 text-xs text-slate-400">ID photo or document<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-sm text-slate-300" /></label>
        <button disabled={busy || !data.profile || !selectedFile} className="rounded-md border border-sky-500/50 px-3 py-2 text-sm text-sky-200 disabled:opacity-50">Upload evidence</button>
      </form>
      {!data.profile && <p className="text-xs text-amber-200">Save the identity profile before uploading evidence.</p>}
      <div className="divide-y divide-slate-800">
        {data.documents.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="text-sm font-medium text-white">{document.document_type} <span className="ml-2 text-xs text-slate-400">{document.document_status}</span></p><p className="mt-1 text-xs text-slate-500">{document.file_name || 'No file attached'} · {new Date(document.uploaded_at).toLocaleString()}</p>{document.rejection_reason && <p className="mt-1 text-xs text-rose-300">{document.rejection_reason}</p>}</div>
          {document.has_file && <button type="button" onClick={() => void downloadDocument(document)} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200">Download evidence</button>}
        </div>)}
        {data.documents.length === 0 && <p className="py-3 text-sm text-slate-500">No evidence uploaded.</p>}
      </div>
    </section>

    <section className="panel space-y-4 p-5 sm:p-6">
      <div><h2 className="font-semibold text-white">Compare ID and phone against saved records</h2><p className="mt-1 text-sm text-slate-400">The entered values are compared server-side and never stored in the check log. This checks consistency only; it does not prove document authenticity or phone ownership.</p></div>
      <form onSubmit={compareSavedValues} className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-400">ID / registration number<input name="document_number" required className="field mt-1" /></label>
        <label className="text-xs text-slate-400">Phone number<input name="phone" type="tel" required className="field mt-1" /></label>
        <button disabled={busy || !data.profile} className="self-end rounded-md border border-amber-500/50 px-3 py-2 text-sm text-amber-100 disabled:opacity-50">Compare saved records</button>
      </form>
    </section>

    {isBusiness && <section className="panel space-y-4 p-5 sm:p-6">
      <div><h2 className="font-semibold text-white">Business relationships</h2><p className="mt-1 text-sm text-slate-400">Link this business to business or individual clients, suppliers, owners, and representatives.</p></div>
      <form onSubmit={addRelationship} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-400">Relationship<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)} className="field mt-1">{relationshipTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="text-xs text-slate-400">Related entity<select required value={relatedEntityId} onChange={(event) => setRelatedEntityId(event.target.value)} className="field mt-1"><option value="">Choose entity</option>{relatedEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name} ({entity.entity_type})</option>)}</select></label>
        {['DIRECTOR', 'SHAREHOLDER', 'BENEFICIAL_OWNER'].includes(relationshipType) && <label className="text-xs text-slate-400">Ownership %<input name="ownership_percentage" type="number" min="0" max="100" step="0.01" className="field mt-1" /></label>}
        <button disabled={busy || !relatedEntityId} className="self-end rounded-md border border-sky-500/50 px-3 py-2 text-sm text-sky-200 disabled:opacity-50">Add relationship</button>
      </form>
      <div className="divide-y divide-slate-800">{data.relationships.map((relation) => <div key={relation.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="text-white">{relation.related_entity_name} <span className="text-xs text-slate-500">{relation.related_entity_type}</span></span><span className="text-sky-200">{relation.relationship_type}{relation.ownership_percentage !== null ? ` · ${relation.ownership_percentage}%` : ''}</span></div>)}{data.relationships.length === 0 && <p className="py-3 text-sm text-slate-500">No entity relationships recorded.</p>}</div>
    </section>}

    <section className="panel space-y-4 p-5 sm:p-6">
      <div><h2 className="font-semibold text-white">Manual verification review</h2><p className="mt-1 text-sm text-slate-400">Record what was reviewed. Only a user with KYC reviewer permission can complete checks or approve the profile.</p></div>
      <form onSubmit={recordCheck} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-400">Check<select value={checkType} onChange={(event) => setCheckType(event.target.value)} className="field mt-1"><option value="IDENTITY">Identity document</option><option value="PHONE">Phone contact</option><option value="BUSINESS_REGISTRATION">Business registration</option><option value="ADDRESS">Address</option></select></label>
        <label className="text-xs text-slate-400">Decision<select value={checkStatus} onChange={(event) => setCheckStatus(event.target.value)} className="field mt-1"><option value="REVIEW">Needs review</option><option value="PENDING">Pending</option><option value="PASSED">Passed (reviewer only)</option><option value="FAILED">Failed (reviewer only)</option></select></label>
        <label className="text-xs text-slate-400">Finding<input name="result" required placeholder="What did you compare?" className="field mt-1" /></label>
        <label className="text-xs text-slate-400">Reviewer note<input name="notes" required placeholder="Evidence or contact method" className="field mt-1" /></label>
        <button disabled={busy || !data.profile} className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 sm:col-span-2 disabled:opacity-50">Record check</button>
      </form>
      <div className="divide-y divide-slate-800">{data.checks.map((check) => <div key={check.id} className="py-3"><p className="text-sm font-medium text-white">{check.check_type} · {check.status}</p><p className="mt-1 text-sm text-slate-300">{check.result}</p><p className="mt-1 text-xs text-slate-500">{check.provider || 'Manual'}{check.notes ? ` · ${check.notes}` : ''}</p></div>)}{data.checks.length === 0 && <p className="py-3 text-sm text-slate-500">No checks recorded.</p>}</div>
      <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
        <button type="button" disabled={busy || !data.profile} onClick={() => void transition('submit')} className="rounded-md border border-amber-500/50 px-3 py-2 text-sm text-amber-100 disabled:opacity-50">Submit for review</button>
        <button type="button" disabled={busy || !data.profile} onClick={() => void transition('verify')} className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Approve KYC</button>
        <button type="button" disabled={busy || !data.profile} onClick={() => void transition('reject')} className="rounded-md border border-rose-500/50 px-3 py-2 text-sm text-rose-200 disabled:opacity-50">Reject KYC</button>
      </div>
    </section>
  </main>;
}