import { pathOf, sortEntries, type FileEntry, type FileKind, type ProjectInfo } from './files.ts';

const TABS = 'overtree:tabs';

// Client view of the project tree and the open tabs. Each operation calls the API and reloads the whole list
// on success (research R10: no live tree sync until 006); failures return the server's message for the UI.
export class Project {
	files = $state<FileEntry[]>([]);
	mainFileId = $state<string | null>(null);
	/** ids of the files open in tabs, in tab order */
	open = $state<string[]>([]);
	active = $state<string | null>(null);
	#restored = false;

	async load() {
		const res = await fetch('/api/files').catch(() => undefined);
		if (!res?.ok) return;
		const info: ProjectInfo = await res.json();
		this.files = info.files;
		this.mainFileId = info.mainFileId;
		if (!this.#restored) this.#restore();
		// deleted files (folders take their descendants) lose their tabs; rename and move keep the id
		for (const id of [...this.open]) if (!this.files.some((f) => f.id === id && f.kind !== 'folder')) this.closeFile(id);
	}

	/** Tabs from the last visit; the first visit opens the main document. */
	#restore() {
		this.#restored = true;
		try {
			const saved = JSON.parse(localStorage.getItem(TABS) ?? 'null');
			if (Array.isArray(saved?.open)) {
				this.open = saved.open.filter((id: unknown) => typeof id === 'string');
				this.active = this.open.includes(saved.active) ? saved.active : (this.open[0] ?? null);
				return;
			}
		} catch {
			// unreadable storage: like a first visit
		}
		if (this.mainFileId) this.openFile(this.mainFileId);
	}

	openFile(id: string) {
		if (!this.open.includes(id)) this.open.push(id);
		this.active = id;
		this.#save();
	}

	/** Close a tab; the right neighbour (else the left one) becomes active. */
	closeFile(id: string) {
		const i = this.open.indexOf(id);
		if (i < 0) return;
		this.open.splice(i, 1);
		if (this.active === id) this.active = this.open[Math.min(i, this.open.length - 1)] ?? null;
		this.#save();
	}

	#save() {
		localStorage.setItem(TABS, JSON.stringify({ open: this.open, active: this.active }));
	}

	children(parentId: string | null) {
		return this.files.filter((f) => f.parentId === parentId).sort(sortEntries);
	}

	path(id: string) {
		return pathOf(id, this.files);
	}

	// ponytail: O(files × depth) per lookup, fine for the 2,000-file limit
	byPath(path: string) {
		return this.files.find((f) => this.path(f.id) === path);
	}

	create(kind: Exclude<FileKind, 'binary'>, name: string, parentId: string | null) {
		return this.#call('/api/files', 'POST', { kind, name, parentId });
	}

	rename(id: string, name: string) {
		return this.#call(`/api/files/${id}`, 'PATCH', { name });
	}

	move(id: string, parentId: string | null) {
		return this.#call(`/api/files/${id}`, 'PATCH', { parentId });
	}

	remove(id: string) {
		return this.#call(`/api/files/${id}`, 'DELETE');
	}

	setMain(id: string) {
		return this.#call('/api/project', 'PUT', { mainFileId: id });
	}

	/** null on success, otherwise the message to show. */
	async #call(url: string, method: string, body?: object): Promise<string | null> {
		const res = await fetch(url, {
			method,
			headers: body && { 'Content-Type': 'application/json' },
			body: body && JSON.stringify(body)
		}).catch(() => undefined);
		if (!res) return 'Network error, try again.';
		if (!res.ok) return (await res.json().catch(() => null))?.message ?? `Request failed (${res.status}).`;
		await this.load();
		return null;
	}
}
