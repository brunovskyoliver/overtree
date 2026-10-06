import { pathOf, sortEntries, type FileEntry, type FileKind, type ProjectInfo } from './files.ts';

// Client view of the project tree. Each operation calls the API and reloads the whole list on success
// (research R10: no live tree sync until 006); failures return the server's message for the UI.
export class Project {
	files = $state<FileEntry[]>([]);
	mainFileId = $state<string | null>(null);

	async load() {
		const res = await fetch('/api/files').catch(() => undefined);
		if (!res?.ok) return;
		const info: ProjectInfo = await res.json();
		this.files = info.files;
		this.mainFileId = info.mainFileId;
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
