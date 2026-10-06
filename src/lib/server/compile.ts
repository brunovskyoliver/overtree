import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Compiler, CompileResult, CompileStatus } from '../compile-types.ts';
import { DOC_NAME, getServer } from './collab.ts';
import { compileSettings } from './schema.ts';

const ENGINE_FLAG: Record<Compiler, string> = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' };
const MAX_STDOUT = 256 * 1024 * 1024; // matches the job's /tmp tmpfs
const MAX_STDERR = 64 * 1024;

export type RunOptions = {
	source: string;
	compiler: Compiler;
	stopOnFirstError: boolean;
	image?: string;
	timeoutMs?: number;
	memory?: string;
	cpus?: string;
};

export type RunResult = {
	status: CompileStatus;
	message?: string;
	pdf?: Buffer;
	log?: string;
	synctex?: Buffer;
};

// One throwaway container per compile (research R1): main.tex in on stdin, a tar of
// main.pdf/main.log/main.synctex.gz out on stdout. No network, read-only root, non-root user.
export function runCompile({
	source,
	compiler,
	stopOnFirstError,
	image = process.env.TEXLIVE_IMAGE ?? 'texlive/texlive:latest-medium',
	timeoutMs = Number(process.env.COMPILE_TIMEOUT_MS ?? 20000),
	memory = process.env.COMPILE_MEMORY ?? '512m',
	cpus = process.env.COMPILE_CPUS ?? '1'
}: RunOptions): Promise<RunResult> {
	const name = `overtree-compile-${randomUUID()}`;
	const halt = stopOnFirstError ? ' -halt-on-error' : '';
	const script =
		`cat > main.tex; latexmk ${ENGINE_FLAG[compiler]} -f -interaction=nonstopmode -file-line-error -synctex=1 -no-shell-escape${halt} main.tex >&2; ` +
		'tar -c main.pdf main.log main.synctex.gz 2>/dev/null; ' +
		// The OOM killer only takes the engine, so the job would exit 0; turn a recorded oom_kill into 137.
		// ponytail: cgroup v2 path only; on a cgroup v1 host OOM shows up as `failure`
		"grep -qs '^oom_kill [1-9]' /sys/fs/cgroup/memory.events && exit 137; true";
	const args = [
		'run', '-i', '--rm', '--name', name,
		'--network', 'none', '--memory', memory, '--memory-swap', memory, '--cpus', cpus,
		'--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
		'--read-only', '--tmpfs', '/tmp:rw,exec,size=256m', '--user', '1000:1000',
		'-e', 'HOME=/tmp', '-e', 'TEXMFVAR=/tmp/texmf-var', '-e', 'max_print_line=10000', '-w', '/tmp',
		image, 'sh', '-c', script
	];

	return new Promise((resolve) => {
		const child = spawn('docker', args);
		const chunks: Buffer[] = [];
		let size = 0;
		let stderr = '';
		let timedOut = false;

		// ponytail: output past the cap is dropped (tar gets cut, the PDF goes missing → failure); the tmpfs limit makes this rare
		child.stdout.on('data', (b: Buffer) => {
			size += b.length;
			if (size <= MAX_STDOUT) chunks.push(b);
		});
		child.stderr.on('data', (b: Buffer) => {
			if (stderr.length < MAX_STDERR) stderr += b.toString();
		});

		// Killing the `docker run` client would leave the container running; `docker kill` stops it and --rm removes it.
		const timer = setTimeout(() => {
			timedOut = true;
			spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => {});
		}, timeoutMs);

		child.on('error', (err: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			resolve({ status: 'unavailable', message: err.code === 'ENOENT' ? 'Docker CLI not found.' : err.message });
		});
		child.stdin.on('error', () => {}); // EPIPE when the container dies before reading stdin
		child.stdin.end(source);

		child.on('close', (code) => {
			clearTimeout(timer);
			if (timedOut) return resolve({ status: 'timeout', message: `Compile timed out after ${timeoutMs / 1000} s.` });
			if (code === 137) return resolve({ status: 'oom', message: `Compile ran out of memory (limit ${memory}).` });
			if (code === 125) {
				return resolve({ status: 'unavailable', message: stderr.split('\n').find((l) => l.trim()) ?? 'Docker failed to start the compile.' });
			}
			const files = untar(Buffer.concat(chunks));
			const pdf = files.get('main.pdf');
			resolve({
				status: pdf ? 'success' : 'failure',
				message: pdf ? undefined : 'Compile failed, no PDF was produced.',
				pdf,
				log: files.get('main.log')?.toString('utf8'),
				synctex: files.get('main.synctex.gz')
			});
		});
	});
}

// Minimal ustar reader: 512-byte headers (name at 0..100, octal size at 124..136), data padded to 512.
function untar(buf: Buffer) {
	const files = new Map<string, Buffer>();
	let off = 0;
	while (off + 512 <= buf.length && buf[off] !== 0) {
		const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/s, '');
		const size = parseInt(buf.toString('ascii', off + 124, off + 136).replace(/\0/g, '').trim() || '0', 8);
		files.set(name, buf.subarray(off + 512, off + 512 + size));
		off += 512 + Math.ceil(size / 512) * 512;
	}
	return files;
}

// ponytail: one project ('main') until feature 005; per-project maps then
export const compileDir = () => join(getServer().dataDir, 'compile', 'main');

export function getCompiler(): Compiler {
	const row = getServer().db.select().from(compileSettings).where(eq(compileSettings.project, 'main')).get();
	return row?.compiler ?? 'pdflatex';
}

export function getLastResult(): CompileResult | null {
	try {
		return JSON.parse(readFileSync(join(compileDir(), 'result.json'), 'utf8'));
	} catch {
		return null;
	}
}

// Coalescing (research R6): one compile runs, at most one is queued behind it; later callers join the queued one.
let running: Promise<CompileResult> | undefined;
let queued: Promise<CompileResult> | undefined;

export function compileProject(opts: { stopOnFirstError: boolean }): Promise<CompileResult> {
	const start = () => (running = compileOnce(opts).finally(() => (running = undefined)));
	if (!running) return start();
	const next = () => {
		queued = undefined;
		return start();
	};
	return (queued ??= running.then(next, next));
}

async function compileOnce({ stopOnFirstError }: { stopOnFirstError: boolean }): Promise<CompileResult> {
	const id = randomUUID();
	const startedAt = Date.now();
	const conn = await getServer().hocuspocus.openDirectConnection(DOC_NAME);
	const source = conn.document!.getText('content').toString();
	await conn.disconnect();

	const compiler = getCompiler();
	const r = await runCompile({ source, compiler, stopOnFirstError });

	const dir = compileDir();
	mkdirSync(dir, { recursive: true });
	// temp file + rename: a reader never sees a half-written file
	const write = (name: string, data: string | Buffer) => {
		writeFileSync(join(dir, `${name}.tmp`), data);
		renameSync(join(dir, `${name}.tmp`), join(dir, name));
	};
	const previous = getLastResult();
	if (r.pdf) {
		write('output.pdf', r.pdf);
		if (r.synctex) write('output.synctex.gz', r.synctex);
		else rmSync(join(dir, 'output.synctex.gz'), { force: true });
	}
	// no log (timeout, unavailable): drop the old one so it isn't shown as this compile's
	if (r.log !== undefined) write('output.log', r.log);
	else rmSync(join(dir, 'output.log'), { force: true });

	const result: CompileResult = {
		id,
		status: r.status,
		compiler,
		stopOnFirstError,
		startedAt,
		durationMs: Date.now() - startedAt,
		pdfId: r.pdf ? id : previous?.pdfId,
		entries: [],
		message: r.message
	};
	write('result.json', JSON.stringify(result));
	return result;
}
