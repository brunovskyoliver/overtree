import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { Compiler, CompileResult } from './compile-types.ts';

// Client side of the compile loop: one request in flight, clicks during it collapse into one follow-up (research R6).
export class CompileState {
	compiling = $state(false);
	last = $state<CompileResult | null>(null);
	compiler = $state<Compiler>('pdflatex');
	pdfUrl = $derived(this.last?.pdfId ? `/api/compile/output.pdf?id=${this.last.pdfId}` : undefined);
	#pending = false;
	#provider: () => HocuspocusProvider | undefined;

	constructor(provider: () => HocuspocusProvider | undefined) {
		this.#provider = provider;
	}

	async load() {
		const res = await fetch('/api/compile');
		if (!res.ok) return;
		({ compiler: this.compiler, last: this.last } = await res.json());
	}

	async compile() {
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
					body: JSON.stringify({ stopOnFirstError: false })
				});
				if (res.ok) this.last = await res.json();
			} while (this.#pending);
		} finally {
			this.compiling = false;
		}
	}
}
