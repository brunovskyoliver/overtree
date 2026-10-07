import { blockedBy } from './auth.svelte.ts';
import type { Compare, HistoryPage, Label, VersionDiff, VersionInfo } from './history-types.ts';

// The History view's state (research R13): the timeline in pages of 50 (newest first), the selected version, its
// diff and the compare mode. Refetches on the `history` project event while open (research R8); no polling.

async function get<T>(url: string): Promise<T | string> {
	const res = await fetch(url).catch(() => undefined);
	if (await blockedBy(res)) return 'Your account is blocked.';
	if (!res?.ok) return ((await res?.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Couldn’t load the history.';
	return res.json();
}

export class History {
	readonly #pid: string;
	open = $state(false);
	versions = $state<VersionInfo[]>([]);
	hasMore = $state(false);
	loading = $state(false);
	error = $state<string | null>(null);
	labelsOnly = $state(false);
	selected = $state<number | null>(null);
	compare = $state<Compare>('current');
	diff = $state<VersionDiff | null>(null);
	diffLoading = $state(false);
	diffError = $state<string | null>(null);
	restoring = $state(false);
	/** After a restore: what it did, or why it failed (shown in the diff header). */
	restoreNote = $state<{ ok: boolean; text: string; skipped: string[] } | null>(null);
	#diffSeq = 0;
	#listSeq = 0;

	constructor(pid: string) {
		this.#pid = pid;
	}

	#url(path = '') {
		return `/api/projects/${this.#pid}/history${path}`;
	}

	toggle() {
		if (this.open) this.close();
		else {
			this.open = true;
			this.load();
		}
	}

	close() {
		this.open = false;
	}

	/** First page; keeps the selection when it is still listed, else selects the newest version. */
	async load() {
		const seq = ++this.#listSeq;
		this.loading = true;
		const page = await get<HistoryPage>(this.#url(`?limit=50${this.labelsOnly ? '&labels=1' : ''}`));
		if (seq !== this.#listSeq) return;
		this.loading = false;
		if (typeof page === 'string') return void (this.error = page);
		this.error = null;
		this.versions = page.versions;
		this.hasMore = page.hasMore;
		if (this.selected === null || !page.versions.some((v) => v.id === this.selected)) {
			if (page.versions.length) this.select(page.versions[0].id);
			else (this.selected = null), (this.diff = null);
		}
	}

	/** The next 50 older versions (end of the timeline reached). */
	async more() {
		if (!this.hasMore || this.loading) return;
		const seq = ++this.#listSeq;
		this.loading = true;
		const before = this.versions.at(-1)!.id;
		const page = await get<HistoryPage>(this.#url(`?before=${before}&limit=50${this.labelsOnly ? '&labels=1' : ''}`));
		if (seq !== this.#listSeq) return;
		this.loading = false;
		if (typeof page === 'string') return void (this.error = page);
		this.versions = [...this.versions, ...page.versions];
		this.hasMore = page.hasMore;
	}

	/** A new version or label (`history` event): the first page again, older loaded pages kept; a diff against
	 *  the current state is stale too. */
	async refresh() {
		if (!this.open) return;
		const seq = ++this.#listSeq;
		const page = await get<HistoryPage>(this.#url(`?limit=50${this.labelsOnly ? '&labels=1' : ''}`));
		if (seq !== this.#listSeq || typeof page === 'string') return;
		const oldest = page.versions.at(-1)?.id ?? 0;
		this.versions = page.hasMore ? [...page.versions, ...this.versions.filter((v) => v.id < oldest)] : page.versions;
		if (!page.hasMore) this.hasMore = false;
		if (this.selected !== null && this.compare === 'current') this.#loadDiff();
	}

	setLabelsOnly(on: boolean) {
		this.labelsOnly = on;
		this.selected = null;
		this.load();
	}

	select(id: number) {
		if (this.selected === id && this.diff?.version.id === id) return;
		this.selected = id;
		this.restoreNote = null;
		this.#loadDiff();
	}

	setCompare(c: Compare) {
		if (this.compare === c) return;
		this.compare = c;
		this.#loadDiff();
	}

	/** Restore the selected version: one file (`fileId`) or the whole project (US2). The new version and the tree
	 *  arrive as `history` and `tree` events. */
	async restore(fileId?: string) {
		const id = this.selected;
		if (id === null || this.restoring) return;
		this.restoring = true;
		this.restoreNote = null;
		const init = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(fileId ? { fileId } : {})
		};
		const res = await fetch(this.#url(`/${id}/restore`), init).catch(() => undefined);
		this.restoring = false;
		if (await blockedBy(res)) return;
		if (!res?.ok) {
			const message = ((await res?.json().catch(() => null)) as { message?: string } | null)?.message;
			this.restoreNote = {
				ok: false,
				text: message ?? 'Couldn’t restore, try again.',
				skipped: []
			};
			return;
		}
		const { version, skipped }: { version: VersionInfo | null; skipped: string[] } = await res.json();
		const what = fileId ? 'File restored.' : 'Project restored.';
		const text = version ? what : skipped.length ? 'Nothing restored.' : 'Nothing to restore: no differences.';
		this.restoreNote = { ok: true, text, skipped };
	}

	/** Adds, renames or deletes a label (US5); null when done, else why not. The list refreshes now (the `history`
	 *  event refreshes the other clients). */
	async #label(path: string, method: string, body?: object): Promise<string | null> {
		const init = body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method };
		const res = await fetch(this.#url(`/labels${path}`), init).catch(() => undefined);
		if (await blockedBy(res)) return 'Your account is blocked.';
		if (!res?.ok) {
			const message = ((await res?.json().catch(() => null)) as { message?: string } | null)?.message;
			return message ?? 'Couldn’t save the label, try again.';
		}
		await this.refresh();
		return null;
	}

	/** Labels version `versionId`, or the current state without it (open edits become a version first). */
	addLabel = (name: string, versionId?: number) => this.#label('', 'POST', { name, versionId });
	renameLabel = (label: Label, name: string) => this.#label(`/${label.id}`, 'PATCH', { name });
	deleteLabel = (label: Label) => this.#label(`/${label.id}`, 'DELETE');

	async #loadDiff() {
		const id = this.selected;
		if (id === null) return;
		const seq = ++this.#diffSeq;
		this.diffLoading = true;
		const d = await get<VersionDiff>(this.#url(`/${id}?compare=${this.compare}`));
		if (seq !== this.#diffSeq) return;
		this.diffLoading = false;
		if (typeof d === 'string') return void (this.diffError = d);
		this.diffError = null;
		this.diff = d;
	}
}
