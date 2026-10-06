import { blockedBy } from './auth.svelte.ts';
import { pathOf, sortEntries, type FileEntry, type FileKind, type ProjectInfo } from './files.ts';


/** One line of the upload progress list (contracts/ui.md). */
export type Upload = { id: number; name: string; loaded: number; total: number; error?: string };
let uploadIds = 0;

/** `GET /api/projects/:pid` (contracts/http-api.md). */
export type ProjectDetails = {
	id: string;
	title: string;
	owner: { id: string; name: string } | null;
	role: 'owner' | 'editor' | 'reader';
	mainFileId: string | null;
	link: { token: string; role: 'editor' | 'reader' } | null;
	permissions: { canEdit: boolean };
};

// Client view of one project's tree and its open tabs. Each operation calls the API and reloads the whole list
// on success (live tree events come with US4); failures return the server's message for the UI.
export class Project {
	readonly id: string;
	details = $state<ProjectDetails | null>(null);
	/** status of the last `GET /api/projects/:pid` that failed (404: no access), else null */
	loadError = $state<number | null>(null);
	files = $state<FileEntry[]>([]);
	mainFileId = $state<string | null>(null);
	/** ids of the files open in tabs, in tab order */
	open = $state<string[]>([]);
	active = $state<string | null>(null);
	uploads = $state<Upload[]>([]);
	#restored = false;

	constructor(id: string) {
		this.id = id;
	}

	/** URL of a project API route, e.g. `api('/files')`. */
	api(path = '') {
		return `/api/projects/${this.id}${path}`;
	}

	/** Raw content of a file; `updatedAt` busts the cache (a replaced upload keeps the id). */
	rawUrl(f: FileEntry, download = false) {
		return this.api(`/files/${f.id}/raw?${download ? 'download=1' : `v=${f.updatedAt}`}`);
	}

	get #tabsKey() {
		return `overtree:tabs:${this.id}`;
	}

	/** Title, role and permissions. */
	async loadDetails() {
		const res = await fetch(this.api()).catch(() => undefined);
		if (await blockedBy(res)) return;
		if (!res?.ok) {
			this.loadError = res?.status ?? 0;
			return;
		}
		this.loadError = null;
		this.details = await res.json();
	}

	/** Rename the project (owner only); null when done, else the server's message. */
	async renameProject(title: string): Promise<string | null> {
		const init = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) };
		const res = await fetch(this.api(), init).catch(() => undefined);
		if (await blockedBy(res)) return null;
		if (!res) return 'Network error, try again.';
		if (!res.ok) return (await res.json().catch(() => null))?.message ?? `Rename failed (${res.status}).`;
		if (this.details) this.details.title = (await res.json()).title;
		return null;
	}

	async load() {
		const res = await fetch(this.api('/files')).catch(() => undefined);
		if ((await blockedBy(res)) || !res?.ok) return;
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
			const saved = JSON.parse(localStorage.getItem(this.#tabsKey) ?? 'null');
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
		localStorage.setItem(this.#tabsKey, JSON.stringify({ open: this.open, active: this.active }));
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
		return this.#call(this.api('/files'), 'POST', { kind, name, parentId });
	}

	rename(id: string, name: string) {
		return this.#call(this.api(`/files/${id}`), 'PATCH', { name });
	}

	move(id: string, parentId: string | null) {
		return this.#call(this.api(`/files/${id}`), 'PATCH', { parentId });
	}

	remove(id: string) {
		return this.#call(this.api(`/files/${id}`), 'DELETE');
	}

	setMain(id: string) {
		return this.#call(this.api('/main'), 'PUT', { fileId: id });
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
			xhr.open('POST', this.api('/files'));
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

	/** null on success, otherwise the message to show. */
	async #call(url: string, method: string, body?: object): Promise<string | null> {
		const res = await fetch(url, {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body && JSON.stringify(body)
		}).catch(() => undefined);
		if (!res) return 'Network error, try again.';
		await blockedBy(res); // the page goes to /blocked; the message shows meanwhile
		if (!res.ok) return (await res.json().catch(() => null))?.message ?? `Request failed (${res.status}).`;
		await this.load();
		return null;
	}
}
