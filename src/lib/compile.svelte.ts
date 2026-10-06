import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { Compiler, CompileResult } from './compile-types.ts';

const OPTIONS_KEY = 'overtree:compile';
const AUTO_DELAY_MS = 2000;

type Options = { autoCompile: boolean; stopOnFirstError: boolean };

// Client side of the compile loop: one request in flight, clicks during it collapse into one follow-up (research R6).
// The compiler lives on the server; auto-compile and stop-on-first-error per browser (research R9).
export class CompileState {
	compiling = $state(false);
	last = $state<CompileResult | null>(null);
	compiler = $state<Compiler>('pdflatex');
	autoCompile = $state(false);
	stopOnFirstError = $state(false);
	/** the compiler is a project setting: readers see it but can't change it (FR-037); set by the page */
	canConfigure = $state(true);
	readonly #base: string;
	#pending = false;
	#provider: () => HocuspocusProvider | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(projectId: string, provider: () => HocuspocusProvider | undefined) {
		this.#base = `/api/projects/${projectId}/compile`;
		this.#provider = provider;
		try {
			const saved: Partial<Options> = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}');
			this.autoCompile = saved.autoCompile === true;
			this.stopOnFirstError = saved.stopOnFirstError === true;
		} catch {
			// unreadable storage: defaults
		}
	}

	get pdfUrl() {
		return this.last?.pdfId ? `${this.#base}/output.pdf?id=${this.last.pdfId}` : undefined;
	}

	get logUrl() {
		return `${this.#base}/output.log`;
	}

	setOption(name: keyof Options, value: boolean) {
		this[name] = value;
		const options: Options = { autoCompile: this.autoCompile, stopOnFirstError: this.stopOnFirstError };
		localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
	}

	async setCompiler(compiler: Compiler) {
		const previous = this.compiler;
		this.compiler = compiler;
		const res = await fetch(`${this.#base}/settings`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ compiler })
		}).catch(() => undefined);
		if (!res?.ok) this.compiler = previous;
	}

	/** A local edit: (re)start the idle timer (research R11). */
	onLocalEdit() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.autoCompile && this.compile(), AUTO_DELAY_MS);
	}

	async load() {
		const res = await fetch(this.#base);
		if (!res.ok) return;
		({ compiler: this.compiler, last: this.last } = await res.json());
	}

	async compile() {
		clearTimeout(this.#timer); // a manual compile covers the pending auto one
		if (this.compiling) {
			this.#pending = true;
			return;
		}
		this.compiling = true;
		try {
			do {
				this.#pending = false;
				// the server compiles what it has: let local edits reach it first
				// ponytail: gives up after 5 s (offline) and compiles the server's text
				const until = Date.now() + 5000;
				while (this.#provider()?.hasUnsyncedChanges && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
				try {
					const res = await fetch(this.#base, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ stopOnFirstError: this.stopOnFirstError })
					});
					if (res.ok) this.last = await res.json();
					else this.#requestFailed(res.status);
				} catch (err) {
					this.#requestFailed(err instanceof Error ? err.message : String(err));
				}
			} while (this.#pending);
		} finally {
			this.compiling = false;
		}
	}

	/** The request itself failed: show it in the banner, keep the previous PDF and log entries. */
	#requestFailed(reason: string | number) {
		this.last = {
			id: this.last?.id ?? 'request-failed',
			status: 'failure',
			compiler: this.compiler,
			stopOnFirstError: this.stopOnFirstError,
			startedAt: Date.now(),
			durationMs: 0,
			pdfId: this.last?.pdfId,
			entries: this.last?.entries ?? [],
			message: `Compile request failed (${reason})`
		};
	}
}
