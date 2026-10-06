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
	pdfUrl = $derived(this.last?.pdfId ? `/api/compile/output.pdf?id=${this.last.pdfId}` : undefined);
	#pending = false;
	#provider: () => HocuspocusProvider | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(provider: () => HocuspocusProvider | undefined) {
		this.#provider = provider;
		try {
			const saved: Partial<Options> = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}');
			this.autoCompile = saved.autoCompile === true;
			this.stopOnFirstError = saved.stopOnFirstError === true;
		} catch {
			// unreadable storage: defaults
		}
	}

	setOption(name: keyof Options, value: boolean) {
		this[name] = value;
		const options: Options = { autoCompile: this.autoCompile, stopOnFirstError: this.stopOnFirstError };
		localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
	}

	async setCompiler(compiler: Compiler) {
		this.compiler = compiler;
		await fetch('/api/compile/settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ compiler })
		});
	}

	/** A local edit: (re)start the idle timer (research R11). */
	onLocalEdit() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.autoCompile && this.compile(), AUTO_DELAY_MS);
	}

	async load() {
		const res = await fetch('/api/compile');
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
				const res = await fetch('/api/compile', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ stopOnFirstError: this.stopOnFirstError })
				});
				if (res.ok) this.last = await res.json();
			} while (this.#pending);
		} finally {
			this.compiling = false;
		}
	}
}
