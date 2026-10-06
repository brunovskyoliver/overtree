import { pathOf, sortEntries, type FileEntry, type FileKind, type ProjectInfo } from './files.ts';

const TABS = 'overtree:tabs';

/** One line of the upload progress list (contracts/ui.md). */
export type Upload = { id: number; name: string; loaded: number; total: number; error?: string };
let uploadIds = 0;

// Client view of the project tree and the open tabs. Each operation calls the API and reloads the whole list
// on success (research R10: no live tree sync until 006); failures return the server's message for the UI.
export class Project {
	files = $state<FileEntry[]>([]);
	mainFileId = $state<string | null>(null);
	/** ids of the files open in tabs, in tab order */
	open = $state<string[]>([]);
	active = $state<string | null>(null);
	uploads = $state<Upload[]>([]);
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

	/** Adds a waiting line per file to the progress list, in the order they will go. */
	queueUploads(files: File[]) {
		return files.map((f) => {
			this.uploads.push({ id: ++uploadIds, name: f.name, loaded: 0, total: f.size });
			return this.uploads.at(-1)!; // the reactive proxy: progress set on it shows
		});
	}

	/** Upload one file (research R6) as one XMLHttpRequest, because fetch has no upload progress. Resolves with the
	 *  status and the JSON body; the line is removed on success and keeps the error otherwise, except for a name
	 *  clash (409 with `existingId`: the caller asks Replace/Cancel and calls again or `dismiss`es). */
	send(line: Upload, file: File, parentId: string | null, replace = false): Promise<{ status: number; body: { message?: string; existingId?: string } }> {
		const form = new FormData();
		form.append('file', file);
		form.append('parentId', parentId ?? '');
		if (replace) form.append('replace', '1');
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			xhr.open('POST', '/api/files');
			xhr.upload.onprogress = (e) => {
				line.loaded = e.loaded;
				line.total = e.total;
			};
			xhr.onloadend = () => {
				let body: { message?: string; existingId?: string } = {};
				try {
					body = JSON.parse(xhr.responseText);
				} catch {
					// not JSON: an error page from the proxy or adapter
				}
				const status = xhr.status;
				if (status >= 200 && status < 300) this.dismiss(line);
				else if (!body.existingId) line.error = body.message ?? (status ? `Upload failed (${status}).` : 'Network error, try again.');
				resolve({ status, body });
			};
			xhr.send(form);
		});
	}

	dismiss(line: Upload) {
		this.uploads = this.uploads.filter((u) => u.id !== line.id);
	}

	/** Replace the whole project with a zip (contracts/files-api.md); the old tabs close, the new main opens. */
	async importZip(file: File) {
		const form = new FormData();
		form.append('file', file);
		const err = await this.#call('/api/project/zip', 'POST', form);
		if (!err && this.mainFileId) this.openFile(this.mainFileId);
		return err;
	}

	/** null on success, otherwise the message to show. */
	async #call(url: string, method: string, body?: object): Promise<string | null> {
		const form = body instanceof FormData;
		const res = await fetch(url, {
			method,
			headers: body && !form ? { 'Content-Type': 'application/json' } : undefined,
			body: form ? body : body && JSON.stringify(body)
		}).catch(() => undefined);
		if (!res) return 'Network error, try again.';
		if (!res.ok) return (await res.json().catch(() => null))?.message ?? `Request failed (${res.status}).`;
		await this.load();
		return null;
	}
}
