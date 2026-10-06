import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Compiler, CompileResult, CompileStatus, LogEntry } from '../compile-types.ts';
import { pathOf } from '../files.ts';
import { parseLog } from '../log-parser.ts';
import { getServer } from './collab.ts';
import { fileOr404, getMainFileId, getText, listFiles, readBlob } from './files.ts';
import { compileSettings } from './schema.ts';

const ENGINE_FLAG: Record<Compiler, string> = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' };
const MAX_STDOUT = 256 * 1024 * 1024; // matches the job's /tmp tmpfs
const MAX_STDERR = 64 * 1024;
const DOCKER_ERROR = /Cannot connect|failed to connect|permission denied|Error response from daemon|No such image/i;

// Containers left behind by a crashed app: remove them once on load. No Docker, nothing left: ignore.
// Only stopped ones: running jobs may belong to another process (a second server, parallel tests)
// and end themselves through the in-container `timeout`.
const STOPPED = ['--filter', 'status=created', '--filter', 'status=exited', '--filter', 'status=dead'];
execFile('docker', ['ps', '-aq', '--filter', 'name=overtree-compile-', ...STOPPED], (err, out) => {
	const ids = out.split(/\s+/).filter(Boolean);
	if (!err && ids.length) execFile('docker', ['rm', '-f', ...ids], () => {});
});

export type ProjectFile = { path: string; data: Buffer };

export type RunOptions = {
	files: ProjectFile[];
	mainPath: string; // e.g. 'src/thesis.tex'
	compiler: Compiler;
	stopOnFirstError: boolean;
	image?: string;
	timeoutMs?: number;
	memory?: string;
	cpus?: string;
	env?: NodeJS.ProcessEnv; // for the docker CLI (tests point DOCKER_HOST at a dead socket)
	name?: string; // container name, must start with `overtree-compile-`; random by default
};

export type RunResult = {
	status: CompileStatus;
	message?: string;
	pdf?: Buffer;
	log?: string;
	synctex?: Buffer;
};

// One throwaway container per compile (research R1, R8): a tar of the project in on stdin, a tar of
// output.pdf/output.log/output.synctex.gz out on stdout. No network, read-only root, non-root user.
export function runCompile({
	files,
	mainPath,
	compiler,
	stopOnFirstError,
	image = process.env.TEXLIVE_IMAGE ?? 'texlive/texlive:latest-medium',
	timeoutMs = Number(process.env.COMPILE_TIMEOUT_MS ?? 20000),
	memory = process.env.COMPILE_MEMORY ?? '512m',
	cpus = process.env.COMPILE_CPUS ?? '1',
	env,
	name = `overtree-compile-${randomUUID()}`
}: RunOptions): Promise<RunResult> {
	let input: Buffer;
	try {
		input = tarProject(files);
	} catch (e) {
		return Promise.resolve({ status: 'failure', message: (e as Error).message });
	}
	const halt = stopOnFirstError ? ' -halt-on-error' : '';
	// the container ends itself even if the app dies before its `docker kill`
	const limit = Math.ceil(timeoutMs / 1000) + 2;
	// MAIN_DIR/MAIN_FILE come in as env and are only used quoted; `./` keeps a name starting with `-` from being an option.
	// The outputs get fixed names, so the reader below needs no long-name tar support.
	// ponytail: project + outputs share the 256 MB /tmp tmpfs (bigger ones end as "no PDF"); raise it with COMPILE_TMPFS in 011
	const script =
		'mkdir p && tar -x --no-same-owner -C p && cd "p/$MAIN_DIR" || exit 1; ' +
		`timeout -s KILL ${limit} latexmk ${ENGINE_FLAG[compiler]} -f -interaction=nonstopmode -file-line-error -synctex=1 -no-shell-escape${halt} "./$MAIN_FILE" >&2; ` +
		'base="${MAIN_FILE%.*}"; for x in pdf log synctex.gz; do mv -f "$base.$x" "/tmp/output.$x" 2>/dev/null; done; ' +
		'cd /tmp && tar -c output.pdf output.log output.synctex.gz 2>/dev/null; ' +
		// The OOM killer only takes the engine, so the job would exit 0; turn a recorded oom_kill into 137.
		// ponytail: cgroup v2 path only; on a cgroup v1 host OOM shows up as `failure`
		"grep -qs '^oom_kill [1-9]' /sys/fs/cgroup/memory.events && exit 137; true";
	const args = [
		'run', '-i', '--rm', '--pull', 'never', '--name', name,
		'--network', 'none', '--memory', memory, '--memory-swap', memory, '--cpus', cpus,
		'--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
		'--read-only', '--tmpfs', '/tmp:rw,exec,size=256m', '--user', '1000:1000',
		'-e', 'HOME=/tmp', '-e', 'TEXMFVAR=/tmp/texmf-var', '-e', 'max_print_line=10000', '-w', '/tmp',
		'-e', `MAIN_DIR=${posix.dirname(mainPath)}`, '-e', `MAIN_FILE=${posix.basename(mainPath)}`,
		image, 'sh', '-c', script
	];

	return new Promise((resolve) => {
		const child = spawn('docker', args, { env });
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

		const timeout = () => resolve({ status: 'timeout', message: `Compile timed out after ${timeoutMs / 1000} s.` });
		// Killing the `docker run` client would leave the container running; `docker kill` stops it and --rm removes it.
		// The kill misses a container that isn't created yet: then drop the client after 3 s, the in-container `timeout` ends the job.
		const timer = setTimeout(() => {
			timedOut = true;
			spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => {});
			setTimeout(() => {
				child.kill('SIGKILL');
				timeout();
			}, 3000).unref();
		}, timeoutMs);

		child.on('error', (err: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			resolve({ status: 'unavailable', message: err.code === 'ENOENT' ? 'Docker CLI not found.' : err.message });
		});
		child.stdin.on('error', () => {}); // EPIPE when the container dies before reading stdin
		child.stdin.end(input);

		child.on('close', (code) => {
			clearTimeout(timer);
			if (timedOut) return timeout();
			if (code === 137) return resolve({ status: 'oom', message: `Compile ran out of memory (limit ${memory}).` });
			// 125: docker couldn't start the container; 1 with no output: the client couldn't reach the daemon
			if (code === 125 || (code !== 0 && !size && DOCKER_ERROR.test(stderr))) {
				const lines = stderr.split('\n').filter((l) => l.trim());
				const line = lines.find((l) => l.startsWith('docker:') || l.includes('Error response')) ?? lines.at(-1);
				return resolve({ status: 'unavailable', message: `Compiler unavailable: ${line ?? 'Docker failed to start the compile.'}` });
			}
			const out = untar(Buffer.concat(chunks));
			const pdf = out.get('output.pdf');
			resolve({
				status: pdf ? 'success' : 'failure',
				message: pdf ? undefined : 'Compile failed, no PDF was produced.',
				pdf,
				log: out.get('output.log')?.toString('utf8'),
				synctex: out.get('output.synctex.gz')
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

/** A ustar stream of regular files (mode 0644) at their paths. The paths are names checked by validateName
 *  joined with `/`: never absolute, never `..`. */
// ponytail: paths up to 255 bytes (name 100 + prefix 155, split at a `/`), longer ones fail the compile; upgrade: pax headers
export function tarProject(files: ProjectFile[]): Buffer {
	const blocks: Buffer[] = [];
	for (const { path, data } of files) {
		const h = Buffer.alloc(512);
		let [prefix, name] = ['', path];
		if (Buffer.byteLength(path) > 100) {
			// the shortest prefix whose rest fits in `name`
			const cut = [...path.matchAll(/\//g)].map((m) => m.index).find((i) => Buffer.byteLength(path.slice(i + 1)) <= 100);
			if (cut === undefined || Buffer.byteLength(path.slice(0, cut)) > 155) throw new Error(`Path too long to compile: ${path}`);
			[prefix, name] = [path.slice(0, cut), path.slice(cut + 1)];
		}
		const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, '0') + '\0';
		h.write(name, 0, 100);
		h.write('0000644\0', 100);
		h.write(octal(0, 8), 108); // uid
		h.write(octal(0, 8), 116); // gid
		h.write(octal(data.length, 12), 124);
		h.write(octal(Math.floor(Date.now() / 1000), 12), 136);
		h.write('0', 156); // regular file
		h.write('ustar\u000000', 257);
		h.write(prefix, 345, 155);
		h.write(' '.repeat(8), 148); // the checksum sums the header with its own field as spaces
		h.write(octal(h.reduce((a, b) => a + b, 0), 7) + ' ', 148);
		blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	return Buffer.concat(blocks);
}

/** Every file of the project at its path (text from Yjs, binary from its blob), the main document's path and
 *  the ids of the text files by path. */
export async function collectProject(pid: string) {
	const all = listFiles(pid);
	const files: ProjectFile[] = [];
	const paths = new Map<string, string>();
	for (const f of all) {
		if (f.kind === 'folder') continue;
		const path = pathOf(f.id, all);
		if (f.kind === 'text') paths.set(path, f.id);
		files.push({ path, data: f.kind === 'text' ? Buffer.from(await getText(f.id)) : readBlob(fileOr404(pid, f.id).hash!) });
	}
	const mainId = getMainFileId(pid);
	return { files, mainPath: mainId ? pathOf(mainId, all) : null, paths };
}

export const NO_MAIN = 'No main document. Right-click a .tex file and choose Set as main document.';

/** Download name of the PDF: the main document's name with `.pdf`. */
export function pdfName(pid: string) {
	const id = getMainFileId(pid);
	return `${id ? fileOr404(pid, id).name.replace(/\.[^.]*$/, '') : 'main'}.pdf`;
}

export const compileDir = (pid: string) => join(getServer().dataDir, 'compile', pid);

export function getCompiler(pid: string): Compiler {
	const row = getServer().db.select().from(compileSettings).where(eq(compileSettings.project, pid)).get();
	return row?.compiler ?? 'pdflatex';
}

export function setCompiler(pid: string, compiler: Compiler) {
	getServer()
		.db.insert(compileSettings)
		.values({ project: pid, compiler })
		.onConflictDoUpdate({ target: compileSettings.project, set: { compiler } })
		.run();
}

export function getLastResult(pid: string): CompileResult | null {
	try {
		return JSON.parse(readFileSync(join(compileDir(pid), 'result.json'), 'utf8'));
	} catch {
		return null;
	}
}

type Opts = { stopOnFirstError: boolean };
// Coalescing per project (research R6): one compile runs, at most one is queued behind it; later callers join the
// queued one with their options.
// ponytail: compiles are unbounded across projects (one container per compiling project); feature 011 adds a cap
const coalesce = new Map<string, { running?: Promise<CompileResult>; queued?: Promise<CompileResult>; queuedOpts: Opts }>();

export function compileProject(pid: string, opts: Opts): Promise<CompileResult> {
	let state = coalesce.get(pid);
	if (!state) coalesce.set(pid, (state = { queuedOpts: opts }));
	const s = state;
	const start = (o: Opts) =>
		(s.running = compileOnce(pid, o).finally(() => {
			s.running = undefined;
			if (!s.queued) coalesce.delete(pid);
		}));
	if (!s.running) return start(opts);
	s.queuedOpts = opts;
	const next = () => {
		s.queued = undefined;
		return start(s.queuedOpts);
	};
	return (s.queued ??= s.running.then(next, next));
}

async function compileOnce(pid: string, { stopOnFirstError }: Opts): Promise<CompileResult> {
	const id = randomUUID();
	const startedAt = Date.now();
	const compiler = getCompiler(pid);
	const { files, mainPath, paths } = await collectProject(pid);
	const r: RunResult = mainPath ? await runCompile({ files, mainPath, compiler, stopOnFirstError }) : { status: 'failure', message: NO_MAIN };

	const dir = compileDir(pid);
	mkdirSync(dir, { recursive: true });
	// temp file + rename: a reader never sees a half-written file
	const write = (name: string, data: string | Buffer) => {
		writeFileSync(join(dir, `${name}.tmp`), data);
		renameSync(join(dir, `${name}.tmp`), join(dir, name));
	};
	const previous = getLastResult(pid);
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
		entries: r.log && mainPath ? parseLog(r.log, posix.basename(mainPath)).map((e) => resolveEntry(e, mainPath, paths)) : [],
		message: r.message
	};
	write('result.json', JSON.stringify(result));
	return result;
}

/** Log paths are relative to the main's folder: make them project paths and link project text files. */
function resolveEntry(e: LogEntry, mainPath: string, paths: Map<string, string>): LogEntry {
	if (!e.file || e.file.startsWith('/')) return e;
	const file = posix.normalize(posix.join(posix.dirname(mainPath), e.file));
	const fileId = paths.get(file);
	return fileId ? { ...e, file, fileId } : e;
}
