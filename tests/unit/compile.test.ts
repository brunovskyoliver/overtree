import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { Compiler } from '../../src/lib/compile-types.ts';
import { runCompile } from '../../src/lib/server/compile.ts';

// Real Docker with texlive/texlive:latest-medium pulled (see quickstart.md).
const fixture = (name: string) => readFileSync(new URL(`../fixtures/latex/${name}`, import.meta.url), 'utf8');
const run = (name: string, compiler: Compiler = 'pdflatex', extra = {}) =>
	runCompile({ source: fixture(name), compiler, stopOnFirstError: false, ...extra });
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

	it('reports unavailable for a missing image', async () => {
		const r = await run('ok.tex', 'pdflatex', { image: 'overtree/does-not-exist' });
		expect(r.status).toBe('unavailable');
		expect(r.message).toBeTruthy();
	});
});
