import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Compiler } from '../../src/lib/compile-types.ts';
import { getMainFileId } from '../../src/lib/server/files.ts';
import { compileDir, compileProject, runCompile } from '../../src/lib/server/compile.ts';
import { connect, project, start } from './helpers.ts';

// Real Docker with texlive/texlive:latest-medium pulled (see quickstart.md).
const fixture = (name: string) => readFileSync(new URL(`../fixtures/latex/${name}`, import.meta.url), 'utf8');
const single = (source: string) => ({ files: [{ path: 'main.tex', data: Buffer.from(source) }], mainPath: 'main.tex' });
const run = (name: string, compiler: Compiler = 'pdflatex', extra = {}) =>
	runCompile({ ...single(fixture(name)), compiler, stopOnFirstError: false, ...extra });
const leftovers = () =>
	execFileSync('docker', ['ps', '-aq', '--filter', 'name=overtree-compile-'], { encoding: 'utf8' }).trim();

describe('runCompile sandbox', { timeout: 60_000 }, () => {
	it.each<Compiler>(['pdflatex', 'xelatex', 'lualatex'])('compiles ok.tex with %s', async (compiler) => {
		const r = await run('ok.tex', compiler);
		expect(r.status).toBe('success');
		expect(r.pdf!.subarray(0, 4).toString()).toBe('%PDF');
		expect(r.synctex?.length).toBeGreaterThan(0);
	});

	it.each<Compiler>(['xelatex', 'lualatex'])('compiles fontspec.tex with %s', async (compiler) => {
		expect((await run('fontspec.tex', compiler)).status).toBe('success');
	});

	it('blocks shell escape', async () => {
		const r = await run('escape-shell.tex');
		expect(r.status).toBe('success');
		expect(r.log).toContain('ESCAPE=safe');
		expect(r.log).not.toMatch(/runsystem\(.*\)\.\.\.executed/);
	});

	it('cannot read the app data and sees only its own /etc/hostname', async () => {
		const r = await run('escape-read.tex');
		expect(r.log).toContain('DB=MISSING');
		const host = r.log!.match(/HOSTNAME=(\S+)/)?.[1];
		expect(host).toBeTruthy();
		expect(host).not.toBe(hostname());
	});

	it('fails piped input instead of running curl', async () => {
		const r = await run('escape-pipe.tex');
		expect(r.status).toBe('failure');
		expect(r.log).not.toContain('Example Domain');
	});

	it.each(['/usr/local/pwned.tex', '/etc/pwned.tex'])('cannot write %s', async (target) => {
		const r = await runCompile({
			...single(`\\def\\target{${target}}\n${fixture('escape-write.tex')}`),
			compiler: 'pdflatex',
			stopOnFirstError: false
		});
		expect(r.log).toContain(`I can't write on file \`${target}'`);
		expect(r.log).not.toContain('WRITE=PWNED');
	});

	it('has no network from lualatex', async () => {
		const r = await run('escape-network.tex', 'lualatex');
		expect(r.status).toBe('success');
		expect(r.log).toMatch(/NETWORK=(NOSOCKET|FAILED)/);
	});

	it('times out and leaves no container behind', async () => {
		const start = Date.now();
		const r = await run('loop.tex', 'pdflatex', { timeoutMs: 3000 });
		expect(r.status).toBe('timeout');
		expect(Date.now() - start).toBeLessThan(5000);
		// --rm removal finishes asynchronously after the client exits
		const until = Date.now() + 5000;
		while (leftovers() && Date.now() < until) await new Promise((res) => setTimeout(res, 200));
		expect(leftovers()).toBe('');
	});

	it('reports oom when lualatex exceeds the memory limit', async () => {
		expect((await run('oom.tex', 'lualatex', { memory: '256m' })).status).toBe('oom');
	});

	it('reports unavailable for a missing image without pulling it', async () => {
		const r = await run('ok.tex', 'pdflatex', { image: 'overtree/does-not-exist' });
		expect(r.status).toBe('unavailable');
		expect(r.message).toMatch(/^Compiler unavailable: .*No such image/);
	});

	it('reports unavailable when the Docker daemon is unreachable', async () => {
		const r = await run('ok.tex', 'pdflatex', { env: { ...process.env, DOCKER_HOST: 'unix:///nonexistent.sock' } });
		expect(r.status).toBe('unavailable');
		expect(r.message).toMatch(/^Compiler unavailable: /);
	});
});

describe('compileProject', { timeout: 60_000 }, () => {
	it('coalesces concurrent requests and compiles the latest synced text', async () => {
		const server = await start();
		const pid = project();
		const { provider, text } = await connect(server.url, getMainFileId(pid)!);

		// three calls while idle: the first runs, the other two share one queued run with the latest options
		const [a, b, c] = await Promise.all([false, false, true].map((stopOnFirstError) => compileProject(pid, { stopOnFirstError })));
		expect(a.status).toBe('success');
		expect(b.id).not.toBe(a.id);
		expect(c).toBe(b);
		expect(b.stopOnFirstError).toBe(true);
		expect(b.startedAt).toBeGreaterThanOrEqual(a.startedAt + a.durationMs);
		expect(b.pdfId).toBe(b.id);

		text.insert(text.toString().indexOf('\\end{document}'), '\\typeout{MARK-42}\n');
		while (provider.hasUnsyncedChanges) await new Promise((r) => setTimeout(r, 10));
		expect((await compileProject(pid, { stopOnFirstError: false })).status).toBe('success');
		expect(readFileSync(join(compileDir(pid), 'output.log'), 'utf8')).toContain('MARK-42');
	});

	it('keeps compiles of two projects apart: own output dir, no coalescing across projects', async () => {
		await start();
		const [p1, p2] = [project(), project('other@test.local')];
		const [a, b] = await Promise.all([compileProject(p1, { stopOnFirstError: false }), compileProject(p2, { stopOnFirstError: true })]);
		expect(a.id).not.toBe(b.id);
		expect([a.stopOnFirstError, b.stopOnFirstError]).toEqual([false, true]);
		expect(JSON.parse(readFileSync(join(compileDir(p1), 'result.json'), 'utf8')).id).toBe(a.id);
		expect(JSON.parse(readFileSync(join(compileDir(p2), 'result.json'), 'utf8')).id).toBe(b.id);
	});
});
