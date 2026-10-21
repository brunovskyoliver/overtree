// Shared by the compile server module and the client (see specs/002-live-compile-pdf/data-model.md).

export type Compiler = 'pdflatex' | 'xelatex' | 'lualatex';

export type CompileStatus =
	| 'success' // PDF produced (may still have errors)
	| 'failure' // finished, no PDF
	| 'timeout' // killed at COMPILE_TIMEOUT_MS
	| 'oom' // killed at COMPILE_MEMORY
	| 'unavailable'; // docker CLI/daemon/image missing

/** A plain-language reading of a log entry (compile-hints.ts). */
export type Hint = {
	explanation: string;
	fix?: string;
	/** the source text the entry is about (`\includegraphics`, a label key): the editor underlines it on the line */
	token?: string;
};

export type LogEntry = {
	level: 'error' | 'warning' | 'typesetting' | 'chktex'; // chktex: a ChkTeX warning (016), not from the TeX log
	message: string;
	file?: string; // project path for project files (e.g. 'chapters/intro.tex'), else as in the log, './' stripped
	fileId?: string; // set when `file` is a text file of the project
	line?: number;
	column?: number; // 1-based, with length: the exact range (ChkTeX only)
	length?: number;
	/** the `l.<n>` text TeX shows for an error (the line up to where it stopped), or the `*** (…)` reason of an emergency stop */
	context?: string;
	hint?: Hint; // set by the server (016)
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
	rootId?: string | null; // the standalone .tex compiled instead of the main document; null/absent: the main one
};
