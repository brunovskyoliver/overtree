// Shared by the compile server module and the client (see specs/002-live-compile-pdf/data-model.md).

export type Compiler = 'pdflatex' | 'xelatex' | 'lualatex';

export type CompileStatus =
	| 'success' // PDF produced (may still have errors)
	| 'failure' // finished, no PDF
	| 'timeout' // killed at COMPILE_TIMEOUT_MS
	| 'oom' // killed at COMPILE_MEMORY
	| 'unavailable'; // docker CLI/daemon/image missing

export type LogEntry = {
	level: 'error' | 'warning' | 'typesetting';
	message: string;
	file?: string; // as in the log, './' stripped, e.g. 'main.tex'
	line?: number;
	raw: string; // the source log line(s)
};

export type CompileResult = {
	id: string; // uuid of this compile
	status: CompileStatus;
	compiler: Compiler;
	stopOnFirstError: boolean;
	startedAt: number; // epoch ms
	durationMs: number;
	pdfId?: string; // id of the compile whose PDF is currently stored (this one or an earlier one)
	entries: LogEntry[];
	message?: string; // human text for timeout/oom/unavailable/failure
};
