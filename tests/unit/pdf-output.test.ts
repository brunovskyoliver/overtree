import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileDir } from '../../src/lib/server/compile.ts';
import { GET } from '../../src/routes/api/projects/[pid]/compile/output.pdf/+server.ts';
import { ev, hit, OWNER, project, start } from './helpers.ts';

describe('PDF output', () => {
	it('streams the opened PDF across an atomic replacement, with download and cache headers', async () => {
		await start();
		const pid = project(OWNER, 'Paper');
		const dir = compileDir(pid);
		await mkdir(dir, { recursive: true });
		const bytes = Buffer.alloc(512 * 1024, 42);
		await writeFile(join(dir, 'output.pdf'), bytes);
		const event = ev(OWNER, { pid });
		event.url.search = '?download=1';
		const response = await GET(event as never);
		expect(response.headers.get('content-type')).toBe('application/pdf');
		expect(response.headers.get('cache-control')).toBe('no-cache');
		expect(response.headers.get('content-disposition')).toContain('main.pdf');
		// Compiles replace the path by rename; this response must finish the version it opened.
		await writeFile(join(dir, 'output.pdf.tmp'), 'new PDF');
		await rename(join(dir, 'output.pdf.tmp'), join(dir, 'output.pdf'));
		const reader = response.body!.getReader();
		const first = await reader.read();
		expect(first.value!.byteLength).toBeLessThan(bytes.byteLength);
		const chunks = [first.value!];
		for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value);
		expect(Buffer.concat(chunks)).toEqual(bytes);
		const latest = await GET(ev(OWNER, { pid }) as never);
		expect(await latest.text()).toBe('new PDF');
		const cancelled = await GET(ev(OWNER, { pid }) as never);
		await cancelled.body!.cancel();
	});

	it('keeps missing PDFs and inaccessible projects as 404 responses', async () => {
		await start();
		const pid = project();
		expect((await hit(GET, ev(OWNER, { pid }))).status).toBe(404);
		expect((await hit(GET, ev('stranger@test.local', { pid }))).status).toBe(404);
		expect((await hit(GET, { ...ev(OWNER, { pid }), locals: { user: null } })).status).toBe(401);
	});
});
