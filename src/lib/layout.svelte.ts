import type { CompileResult } from './compile-types.ts';
import type { CompileState } from './compile.svelte.ts';

// Layout menu and the separate PDF window (research R12, contracts/ui.md "Top bar").

export type LayoutMode = 'split' | 'editor' | 'pdf' | 'window';

export const LAYOUT_MODES: { mode: LayoutMode; label: string }[] = [
	{ mode: 'split', label: 'Side-by-side' },
	{ mode: 'editor', label: 'Editor only' },
	{ mode: 'pdf', label: 'PDF only' },
	{ mode: 'window', label: 'PDF in separate window' }
];

const KEY = 'overtree:layout-mode';
const POLL_MS = 1000;
/** how long a `bye` (or the ping after a reload) waits for a `hello` before the window counts as gone */
const GONE_MS = 1000;

/** Messages between the project page and its PDF window over `BroadcastChannel('overtree:pdf:<projectId>')`. */
export type PdfMessage =
	| { type: 'compiled'; last: CompileResult }
	| { type: 'forward'; fileId: string; line: number }
	| { type: 'open-at'; fileId: string; line: number }
	| { type: 'hello' }
	| { type: 'bye' };

type Side = 'main' | 'pdf';

/** One side of the channel; messages carry their sender so the main windows of the same project ignore each other. */
export function pdfChannel(projectId: string, side: Side, onmessage: (m: PdfMessage) => void) {
	const ch = new BroadcastChannel(`overtree:pdf:${projectId}`);
	ch.onmessage = (e: MessageEvent<PdfMessage & { from: Side }>) => {
		if (e.data?.from !== side) onmessage(e.data);
	};
	return {
		post: (m: PdfMessage) => ch.postMessage({ ...m, from: side }),
		close: () => ch.close()
	};
}

/** Mirror compile results between the windows: a new result is posted once, the other side's is taken as is.
 *  Call during component init (it sets up an effect); returns the handler for incoming `compiled` messages. */
export function mirrorCompile(compile: CompileState, post: (m: PdfMessage) => void) {
	let seen: string | undefined;
	$effect(() => {
		const last = compile.last;
		if (!last || last.id === seen) return;
		seen = last.id;
		post({ type: 'compiled', last: $state.snapshot(last) });
	});
	return (last: CompileResult) => {
		seen = last.id;
		compile.root = last.rootId ?? null; // the window's own reloads (a stale sync) ask for the same document
		compile.last = last;
	};
}

/** The project page's side: the mode (per device), the PDF window and its channel. */
export class Layout {
	mode = $state<LayoutMode>('split');
	/** counts the mode changes made in this page (Workspace applies each one, not the stored mode at load) */
	changes = $state(0);
	/** shown under the Layout button for a while, e.g. when the popup was blocked */
	notice = $state('');
	readonly #url: string;
	readonly #name: string;
	#win: Window | null = null;
	#poll: ReturnType<typeof setInterval> | undefined;
	#gone: ReturnType<typeof setTimeout> | undefined;
	#noticeTimer: ReturnType<typeof setTimeout> | undefined;
	#channel: ReturnType<typeof pdfChannel>;
	#onCompiled?: (last: CompileResult) => void;

	constructor(projectId: string, onopenat: (fileId: string, line: number) => void) {
		this.#url = `/project/${projectId}/pdf`;
		this.#name = `overtree-pdf-${projectId}`;
		this.#channel = pdfChannel(projectId, 'main', (m) => {
			if (m.type === 'compiled') this.#onCompiled?.(m.last);
			else if (m.type === 'open-at' && this.mode === 'window') onopenat(m.fileId, m.line);
			else if (m.type === 'hello') clearTimeout(this.#gone);
			else if (m.type === 'bye') this.#maybeGone();
		});
		let stored: string | null = null;
		try {
			stored = localStorage.getItem(KEY);
		} catch {
			// unreadable storage: default
		}
		if (stored && LAYOUT_MODES.some((l) => l.mode === stored)) this.mode = stored as LayoutMode;
		// After a reload the window handle is gone and a popup can't be opened without a click (browsers block it):
		// a PDF window that is still open answers the ping and the mode stays; otherwise back to side-by-side.
		if (this.mode === 'window') {
			this.#channel.post({ type: 'hello' });
			this.#maybeGone();
		}
	}

	/** Mirror compile results with the PDF window (see mirrorCompile); call during component init. */
	mirror(compile: CompileState) {
		this.#onCompiled = mirrorCompile(compile, this.#channel.post);
	}

	/** A Layout menu choice. */
	set(mode: LayoutMode) {
		if (mode === 'window') {
			if (this.#win && !this.#win.closed) return void this.#win.focus();
			const win = window.open(this.#url, this.#name, `popup,width=820,height=${screen.availHeight}`);
			if (!win) return this.#notify('Allow pop-ups to open the PDF in a new window');
			this.#win = win;
			clearInterval(this.#poll);
			this.#poll = setInterval(() => this.#win?.closed && this.#closed(), POLL_MS);
		} else if (this.mode === 'window') {
			// the window was opened by script, so it may close; one found again after a reload closes on `bye`
			this.#stop();
			this.#channel.post({ type: 'bye' });
			this.#win?.close();
			this.#win = null;
		}
		this.#store(mode);
	}

	/** "→" while the PDF is in its own window. */
	forward(fileId: string, line: number) {
		this.#channel.post({ type: 'forward', fileId, line });
	}

	destroy() {
		this.#stop();
		clearTimeout(this.#noticeTimer);
		this.#channel.close();
	}

	/** `bye` arrives on any unload, a reload of the window included: gone unless it says hello again. */
	#maybeGone() {
		clearTimeout(this.#gone);
		this.#gone = setTimeout(() => {
			if (!this.#win || this.#win.closed) this.#closed();
		}, GONE_MS);
	}

	#closed() {
		if (this.mode !== 'window') return;
		this.#stop();
		this.#win = null;
		this.#store('split');
	}

	#stop() {
		clearInterval(this.#poll);
		clearTimeout(this.#gone);
	}

	#store(mode: LayoutMode) {
		this.mode = mode;
		this.changes++;
		try {
			localStorage.setItem(KEY, mode);
		} catch {
			// storage full or blocked: the mode lasts for this page
		}
	}

	#notify(message: string) {
		this.notice = message;
		clearTimeout(this.#noticeTimer);
		this.#noticeTimer = setTimeout(() => (this.notice = ''), 6000);
	}

	dismiss() {
		clearTimeout(this.#noticeTimer);
		this.notice = '';
	}
}
