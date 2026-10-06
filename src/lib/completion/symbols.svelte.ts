import type { EditorState } from '@codemirror/state';
import { scanBib, scanTex, type BibKey, type ProjectSymbols, type TexSymbols } from './scan.ts';

type FileSymbols = TexSymbols & { bibKeys: BibKey[] };
const EMPTY: ProjectSymbols = { labels: [], commands: [], environments: [], bibKeys: [], files: [] };

const unique = <T>(items: T[], key: (t: T) => string) => [...new Map(items.map((t) => [key(t), t])).values()];

// Project symbols for completion (research R13): the server scans every file; open tabs are scanned here
// from their live text and replace that file's server entries (the next fetch leaves them out).
export class Symbols {
	#server: ProjectSymbols = EMPTY;
	#live = new Map<string, FileSymbols>();
	#fetchTimer: ReturnType<typeof setTimeout> | undefined;
	#scanTimers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Refetch from the server, debounced 500 ms (on load, after tree operations and on tab switch). */
	refresh() {
		clearTimeout(this.#fetchTimer);
		this.#fetchTimer = setTimeout(async () => {
			const exclude = [...this.#live.keys()].join(',');
			const res = await fetch(`/api/project/symbols?exclude=${encodeURIComponent(exclude)}`).catch(() => undefined);
			if (res?.ok) this.#server = await res.json();
		}, 500);
	}

	/** Rescan an open tab's text, debounced 300 ms. */
	scan(fileId: string, bib: boolean, state: EditorState) {
		clearTimeout(this.#scanTimers.get(fileId));
		this.#scanTimers.set(
			fileId,
			setTimeout(() => {
				this.#scanTimers.delete(fileId);
				const text = state.doc.toString();
				this.#live.set(fileId, bib ? { labels: [], commands: [], environments: [], bibKeys: scanBib(text) } : { ...scanTex(text), bibKeys: [] });
			}, 300)
		);
	}

	/** A closed tab: its entries come from the server again. */
	forget(fileId: string) {
		clearTimeout(this.#scanTimers.get(fileId));
		this.#scanTimers.delete(fileId);
		if (this.#live.delete(fileId)) this.refresh();
	}

	#all<K extends keyof FileSymbols>(key: K): FileSymbols[K] {
		return [this.#server, ...this.#live.values()].flatMap((s) => s[key] as unknown[]) as FileSymbols[K];
	}

	get labels() {
		return unique(this.#all('labels'), (l) => l);
	}
	get commands() {
		return unique(this.#all('commands'), (c) => c.name);
	}
	get environments() {
		return unique(this.#all('environments'), (e) => e);
	}
	get bibKeys() {
		return unique(this.#all('bibKeys'), (b) => b.key);
	}
	get files() {
		return this.#server.files;
	}
}
