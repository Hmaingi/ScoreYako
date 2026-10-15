'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
export default function LoginForm() {
	const router = useRouter();
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);
	const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setError('');
		const form = new FormData(event.currentTarget);

		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: form.get('email'),
					password: form.get('password'),
					organization_id: form.get('organization_id') || undefined,
				}),
			});
			const body = await response.json();
			if (response.status === 409 && body.requires_organization) {
				setOrganizations(body.organizations || []);
				setError(body.error || 'Choose an organization to continue.');
				return;
			}
			if (!response.ok) throw new Error(body.error || 'Sign-in failed');
			setOrganizations([]);
			router.push('/');
			router.refresh();
		} catch (submitError) {
			setError(submitError instanceof Error ? submitError.message : 'Sign-in failed');
		} finally {
			setLoading(false);
		}
	}

	return <form onSubmit={submit} className="panel w-full max-w-md p-6"><p className="eyebrow">Secure workspace</p><h1 className="mt-2 text-2xl font-bold text-white">Sign in to Scoreyako</h1><p className="mt-2 text-sm text-slate-400">Use your organization account to continue.</p><label className="mt-6 block text-sm text-slate-300">Email<input name="email" type="email" autoComplete="username" required className="field mt-1" /></label><label className="mt-4 block text-sm text-slate-300">Password<input name="password" type="password" autoComplete="current-password" required className="field mt-1" /></label>{organizations.length > 0 && <label className="mt-4 block text-sm text-slate-300">Organization<select name="organization_id" required defaultValue="" className="field mt-1"><option value="" disabled>Select organization</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}{error && <p className="mt-3 text-sm text-rose-300">{error}</p>}<button disabled={loading} className="mt-6 w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{loading ? 'Signing in…' : 'Sign in'}</button></form>;
}