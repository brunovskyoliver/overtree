import { blockedBy } from './auth.svelte.ts';
import type { GitHubAccountInfo, GitHubBranches, GitHubPreview, GitHubRepos, GitHubStatus, GitHubSyncResult } from './github-types.ts';

// Browser side of GitHub sync (012 contracts/http-api.md, ui.md): the project's link status (refetched on `github`
// project events), the user's connection and repositories, and the actions. Every action resolves to an error
// message or null.

export type GitHubResult = { error: string | null; reconnect?: boolean };

async function errorOf(res: Response | undefined): Promise<GitHubResult> {
	if (await blockedBy(res)) return { error: 'Blocked.' };
	if (!res) return { error: 'Network error, try again.' };
	if (res.ok) return { error: null };
	const body = await res.json().catch(() => null);
	return {
		error: body?.message ?? `Request failed (${res.status}).`,
		reconnect: !!body?.reconnect
	};
}

export class GitHub {
	readonly pid: string;
	status = $state<GitHubStatus | null>(null);
	account = $state<GitHubAccountInfo | null>(null);
	repos = $state<GitHubRepos | null>(null);
	busy = $state(false);

	constructor(pid: string) {
		this.pid = pid;
	}

	#api = (path = '') => `/api/projects/${encodeURIComponent(this.pid)}/github${path}`;

	/** `/api/github/connect` that comes back to this project with the dialog open. */
	get connectUrl() {
		return `/api/github/connect?return=${encodeURIComponent(`/project/${this.pid}?github=1`)}`;
	}

	#touch: ReturnType<typeof setTimeout> | undefined;

	/** A local edit: an `in-sync` indicator turns "Not pushed yet" without waiting for the next sync event. */
	touched() {
		if (this.status?.link?.state !== 'in-sync' || this.#touch) return;
		this.#touch = setTimeout(() => {
			this.#touch = undefined;
			void this.load();
		}, 1500);
	}

	/** The project's link status; call on load and on `github` events. */
	async load() {
		const res = await fetch(this.#api()).catch(() => undefined);
		if (res?.ok) this.status = await res.json();
	}

	async loadAccount() {
		const res = await fetch('/api/github/account').catch(() => undefined);
		if (res?.ok) this.account = await res.json();
	}

	/** The repositories the connection can push to; a dead connection reloads the account. */
	async loadRepos(): Promise<GitHubResult> {
		const res = await fetch('/api/github/repos').catch(() => undefined);
		if (res?.ok) {
			this.repos = await res.json();
			return { error: null };
		}
		return errorOf(res);
	}

	/** Branches of `fullName` (`owner/repo`), or the error. */
	async branches(fullName: string): Promise<GitHubBranches | GitHubResult> {
		const [owner, repo] = fullName.split('/');
		const res = await fetch(`/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`).catch(() => undefined);
		return res?.ok ? ((await res.json()) as GitHubBranches) : errorOf(res);
	}

	/** What the first sync of a `pending` link would do (owner), or the error. */
	async preview(): Promise<GitHubPreview | GitHubResult> {
		const res = await fetch(this.#api('/preview')).catch(() => undefined);
		return res?.ok ? ((await res.json()) as GitHubPreview) : errorOf(res);
	}

	/** One request; a status in the answer replaces ours. */
	async #call(url: string, method: string, body?: object): Promise<GitHubResult> {
		this.busy = true;
		try {
			const res = await fetch(url, {
				method,
				headers: body ? { 'Content-Type': 'application/json' } : undefined,
				body: body && JSON.stringify(body)
			}).catch(() => undefined);
			const result = await errorOf(res);
			if (!result.error && res!.status === 200 && url.startsWith(this.#api())) {
				const data = await res!.json().catch(() => null);
				if (data && 'configured' in data) this.status = data;
			}
			return result;
		} finally {
			this.busy = false;
		}
	}

	async disconnect() {
		const r = await this.#call('/api/github/account', 'DELETE');
		await Promise.all([this.loadAccount(), this.load()]);
		this.repos = null;
		return r;
	}

	link(installationId: number, repoId: number, branch: string) {
		return this.#call(this.#api(), 'PUT', { installationId, repoId, branch });
	}

	patch(change: { ignore?: string[]; branch?: string; dismissNote?: true; confirmOwner?: true; recheck?: true }) {
		return this.#call(this.#api(), 'PATCH', change);
	}

	async unlink() {
		const r = await this.#call(this.#api(), 'DELETE');
		await this.load();
		return r;
	}

	confirm(mode: 'merge' | 'import' = 'merge') {
		return this.#call(this.#api('/confirm'), 'POST', { mode });
	}

	/** A manual run (contracts "POST …/github/push|pull", "create-branch"): `done` false when the server answered 202
	 *  (still running, the status follows by broadcast); a failed run is an error too. */
	async #sync(path: string, body: object = {}): Promise<GitHubResult & { done?: boolean; outcome?: GitHubSyncResult }> {
		this.busy = true;
		try {
			const res = await fetch(this.#api(path), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}).catch(() => undefined);
			const result = await errorOf(res);
			if (result.error) return result;
			if (res!.status === 202) return { error: null, done: false };
			const outcome = (await res!.json().catch(() => null)) as GitHubSyncResult | null;
			if (outcome?.result === 'failed') return { error: outcome.error ?? 'The sync failed.', done: true, outcome };
			return { error: null, done: true, outcome: outcome ?? undefined };
		} finally {
			this.busy = false;
			void this.load();
		}
	}

	push(title?: string) {
		return this.#sync('/push', title ? { title } : {});
	}

	pull() {
		return this.#sync('/pull');
	}

	createBranch() {
		return this.#sync('/create-branch');
	}
}
