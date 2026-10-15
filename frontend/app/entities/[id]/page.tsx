import Link from 'next/link';
import EntityActions from '../../../components/EntityActions';
import IntelligencePanel from '../../../components/IntelligencePanel';
import RawDataViewer from '../../../components/RawDataViewer';
import { serverApiFetch } from '../../../lib/server-api';

type Entity360 = {
  entity: { id: string; legal_name: string; entity_type: 'INDIVIDUAL' | 'BUSINESS'; phone?: string; email?: string; tax_id?: string; created_at?: string; last_imported_at?: string };
  kyc?: {
    id?: string; status: string; kyc_type: string; risk_level?: string; verification_status?: string;
    verification_method?: string; verified_at?: string; rejection_reason?: string; notes?: string;
    first_name?: string; middle_name?: string; last_name?: string; date_of_birth?: string;
    gender?: string; nationality?: string; national_id?: string; passport_number?: string;
    individual_tax_pin?: string; other_id_type?: string; other_id_number?: string;
    business_legal_name?: string; trading_name?: string; registration_number?: string;
    business_tax_pin?: string; business_type?: string; incorporation_date?: string;
    country_of_incorporation?: string; registration_country?: string;
  } | null;
  financial_relationships: any[];
  payments: any[];
  collection_cases: any[];
  promises_to_pay: any[];
  communications: any[];
  raw_data?: { id?: string; raw_data: Record<string, unknown>; sheet_name: string; created_at: string } | null;
  raw_records: Array<{ id?: string; raw_data: Record<string, unknown>; sheet_name: string; created_at: string }>;
  all_attributes: Record<string, unknown>;
};

const money = (amount: number, currency = 'KES') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));

// Tags an upload/import date as "This year" / "Last year" / the actual year so a check-up can
// tell freshly (re-)uploaded data from old data at a glance.
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

async function fetchEntity360(id: string): Promise<Entity360 | null> {
  try {
    const res = await serverApiFetch(`/api/v1/entities/${id}/360`);
    return res.ok ? (await res.json()).data : null;
  } catch {
    return null;
  }
}

export default async function EntityPage({ params }: { params: { id: string } }) {
  const data = await fetchEntity360(params.id);

  if (!data) {
    return (
      <div className="p-8">
        <Link href="/entities" className="text-sky-300">
          ← Back to entities
        </Link>
        <h1 className="mt-5 text-2xl font-bold">Entity not found or backend unavailable</h1>
      </div>
    );
  }

  const outstanding = data.financial_relationships.reduce((sum, r) => sum + Number(r.outstanding_amount), 0);
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <Link href="/entities" className="text-sm text-sky-300 hover:text-sky-200">
        ← All entities
      </Link>

      <header className="mt-5 flex flex-col gap-4 border-b border-slate-800 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">{data.entity.entity_type}</p>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{data.entity.legal_name}</h1>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Phone</dt>
              <dd className="mt-0.5 text-slate-200">{data.entity.phone ? <a href={`tel:${data.entity.phone}`} className="hover:text-sky-200">{data.entity.phone}</a> : 'Not on file'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
              <dd className="mt-0.5 break-all text-slate-200">{data.entity.email ? <a href={`mailto:${data.entity.email}`} className="hover:text-sky-200">{data.entity.email}</a> : 'Not on file'}</dd>
            </div>
            {data.entity.tax_id && <div><dt className="text-xs uppercase tracking-wide text-slate-500">Tax identifier</dt><dd className="mt-0.5 text-slate-200">{data.entity.tax_id}</dd></div>}
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            {formatUploadDate(data.entity.created_at) && (
              <span>
                First uploaded: {formatUploadDate(data.entity.created_at)!.label}{' '}
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {formatUploadDate(data.entity.created_at)!.tag}
                </span>
              </span>
            )}
            {formatUploadDate(data.entity.last_imported_at) && (
              <span>
                Last updated: {formatUploadDate(data.entity.last_imported_at)!.label}{' '}
                <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-300">
                  {formatUploadDate(data.entity.last_imported_at)!.tag}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/kyc" className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 hover:bg-sky-500/15">KYC queue</Link>
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-amber-200">Outstanding exposure</p>
            <p className="mt-1 text-2xl font-bold text-white">{money(outstanding)}</p>
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-5">
              <div><h2 className="font-semibold text-white">KYC profile</h2><p className="mt-1 text-sm text-slate-400">Sensitive identifiers are masked by default.</p></div>
              <div className="flex items-center gap-2">
                <span className={`status status-${(data.kyc?.status || 'NOT_STARTED').toLowerCase().replace('_', '-')}`}>{(data.kyc?.status || 'NOT_STARTED').replace('_', ' ')}</span>
                <Link href="/kyc" className="rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-sky-500 hover:text-sky-200">Open KYC queue</Link>
              </div>
            </div>
            {data.kyc ? (
              <dl className="grid gap-4 p-5 sm:grid-cols-2">
                {Object.entries(data.kyc).filter(([key]) => key !== 'id').map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">{key.replaceAll('_', ' ')}</dt>
                    <dd className="mt-1 break-words text-sm text-white">{value === null || value === undefined || value === '' ? 'Not recorded' : String(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="p-5 text-sm text-slate-400">No KYC profile has been started for this entity. <Link href="/kyc" className="ml-2 text-sky-300 hover:text-sky-200">Start from KYC review</Link></div>
            )}
          </section>
          {/* Financial Relationships */}
          <section className="panel overflow-hidden">
            <div className="border-b border-slate-800 p-5">
              <h2 className="font-semibold text-white">Financial relationships</h2>
            </div>
            <div className="divide-y divide-slate-800">
              {data.financial_relationships.length > 0 ? (
                data.financial_relationships.map((r) => (
                  <div key={r.id} className="space-y-3 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{r.relationship_type.replace('_', ' ')}</p>
                        <p className="mt-1 text-sm text-slate-400">Account {r.account_number || '—'} · Due {r.due_date || '—'} · <span className="uppercase">{r.status}</span></p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">Outstanding</p>
                        <p className="font-semibold text-white">{money(r.outstanding_amount || 0, r.currency || 'KES')}</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">Original amount: {money(r.original_amount || 0, r.currency || 'KES')}</p>
                    {r.extra_data && Object.keys(r.extra_data).length > 0 && (
                      <dl className="grid gap-x-4 gap-y-2 border-t border-slate-800 pt-3 sm:grid-cols-2">
                        {Object.entries(r.extra_data).map(([key, value]) => <div key={key}><dt className="text-xs text-slate-500">{key}</dt><dd className="break-words text-sm text-slate-300">{String(value ?? '—')}</dd></div>)}
                      </dl>
                    )}
                  </div>
                ))
              ) : (
                <p className="p-5 text-slate-400">No financial relationships found.</p>
              )}
            </div>
          </section>

          {/* Payments */}
          {data.payments.length > 0 && (
            <section className="panel overflow-hidden">
              <div className="border-b border-slate-800 p-5">
                <h2 className="font-semibold text-white">Payment history <span className="ml-2 text-xs font-normal text-slate-500">{data.payments.length} records</span></h2>
              </div>
              <div className="divide-y divide-slate-800">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-5">
                    <div>
                      <p className="font-medium text-white">{p.payment_method}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {new Date(p.payment_date).toLocaleDateString()} {p.reference_no && `• ${p.reference_no}`}
                      </p>
                    </div>
                    <p className="font-semibold text-emerald-200">{money(p.amount_paid || 0)}</p>
                    {p.extra_data && <pre className="w-full overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-500">{JSON.stringify(p.extra_data, null, 2)}</pre>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Communications */}
          {data.communications.length > 0 && (
            <section className="panel overflow-hidden">
              <div className="border-b border-slate-800 p-5">
                <h2 className="font-semibold text-white">Communications <span className="ml-2 text-xs font-normal text-slate-500">{data.communications.length} records</span></h2>
              </div>
              <div className="divide-y divide-slate-800">
                {data.communications.map((c) => (
                  <div key={c.id} className="space-y-1 p-5">
                    <p className="font-medium text-white">{c.comm_type}</p>
                    {c.notes && <p className="text-sm text-slate-400">{c.notes}</p>}
                    {c.outcome && <p className="mt-1 text-xs text-emerald-200">Outcome: {c.outcome}</p>}
                    <p className="mt-1 text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Raw Data from Excel Import */}
          {(data.raw_records?.length > 0 || data.raw_data || Object.keys(data.all_attributes || {}).length > 0) && (
            <section className="panel overflow-hidden">
              <div className="border-b border-slate-800 p-5">
                <h2 className="font-semibold text-white">Complete imported data</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Every imported column from {data.raw_records?.length || 1} source row{(data.raw_records?.length || 1) === 1 ? '' : 's'}.
                </p>
              </div>
              <div className="space-y-6 p-5">
                {Object.keys(data.all_attributes || {}).length > 0 && (
                  <div>
                    <h3 className="mb-3 font-semibold text-white">All fields across this individual</h3>
                    <RawDataViewer
                      rawData={{
                        raw_data: data.all_attributes,
                        sheet_name: 'Merged imported fields',
                        created_at: data.entity.created_at || '',
                      }}
                    />
                  </div>
                )}
                {(data.raw_records?.length ? data.raw_records : data.raw_data ? [data.raw_data] : []).map((record, index) => (
                  <div key={record.id || `${record.sheet_name}-${index}`} className="border-t border-slate-800 pt-5">
                    <h3 className="mb-3 font-semibold text-white">
                      Source row {index + 1} <span className="font-normal text-slate-400">from {record.sheet_name || 'Imported sheet'}</span>
                    </h3>
                    <RawDataViewer rawData={record} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          {/* Current Case */}
          {data.collection_cases.length > 0 && (
            <section className="panel p-5">
              <h2 className="font-semibold text-white">Cases <span className="ml-2 text-xs font-normal text-slate-500">{data.collection_cases.length}</span></h2>
              <div className="mt-4 space-y-3">
                {data.collection_cases.map((item) => (
                  <div key={item.id} className="border-t border-slate-800 pt-3 first:border-0 first:pt-0">
                    <p className="text-sm font-medium text-white">{item.status} · {item.priority} · {String(item.stage).replaceAll('_', ' ')}</p>
                    <p className="mt-1 text-xs text-slate-400">Created {new Date(item.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Promises to Pay */}
          {data.promises_to_pay.length > 0 && (
            <section className="panel p-5">
              <h2 className="font-semibold text-white">Promises to pay <span className="ml-2 text-xs font-normal text-slate-500">{data.promises_to_pay.length}</span></h2>
              <div className="mt-4 space-y-2">
                {data.promises_to_pay.map((p) => (
                  <div key={p.id} className="rounded-lg bg-slate-900/50 p-3">
                    <p className="text-sm font-medium text-white">{money(p.promised_amount || 0)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      By {new Date(p.promised_date).toLocaleDateString()} • {p.status}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Intelligence */}
          <IntelligencePanel entityId={params.id} />
        </aside>
      </div>

      <EntityActions entityId={params.id} entityType={data.entity.entity_type} />
    </div>
  );
}