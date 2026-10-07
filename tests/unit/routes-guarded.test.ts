import { describe, expect, it } from 'vitest';
import { lastVersion } from '../../src/lib/server/history.ts';
import { setLink } from '../../src/lib/server/projects.ts';
import { memberships, versionLabels } from '../../src/lib/server/schema.ts';
import { load as shareLoad } from '../../src/routes/share/[token]/+page.server.ts';
import { hit, project, start, user } from './helpers.ts';

// Security pass (005 T055): every API route guards itself, so a new one can't skip it. hooks.server.ts answers
// 401/403 for /api/* first; these call the handlers directly, as if the hook were missing.

type Handler = (event: never) => Response | Promise<Response>;
const routes = import.meta.glob<Record<string, Handler>>('../../src/routes/api/**/+server.ts', { eager: true });
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const handlers = Object.entries(routes).flatMap(([file, mod]) =>
	METHODS.filter((m) => m in mod).map((m) => ({ name: `${m} ${file.replace('../../src/routes', '').replace('/+server.ts', '')}`, method: m, fn: mod[m] }))
);

const event = (method: string, email: string | null, pid: string) => ({
	locals: { user: email ? user(email) : null },
	params: { pid, id: 'x', userId: 'x', email: 'x@test.local', vid: 'x', lid: 'x' },
	request: new Request('http://x/', method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: '{}' }),
	url: new URL('http://x/')
});

describe('API routes', () => {
	it('finds the routes', () => expect(handlers.length).toBeGreaterThan(30));

	it.each(handlers)('$name: 401 signed out', async ({ method, fn }) => {
		await start();
		expect((await hit(fn, event(method, null, project()))).status).toBe(401);
	});

	// the first user is the admin; this one is a plain user without access to the project
	it.each(handlers.filter((h) => h.name.includes('/[pid]') || h.name.includes('/admin/')))(
		'$name: 403/404 for a non-member',
		async ({ name, method, fn }) => {
			await start();
			const pid = project();
			expect((await hit(fn, event(method, 'stranger@test.local', pid))).status).toBe(name.includes('/admin/') ? 403 : 404);
		}
	);
});

describe('history routes (008)', () => {
	it.each(handlers.filter((h) => h.method === 'GET' && h.name.includes('/history')))('$name: 200 for a reader', async ({ fn }) => {
		const { db } = await start();
		const pid = project();
		const reader = user('reader@test.local');
		db.insert(memberships).values({ projectId: pid, userId: reader.id, role: 'reader', viaLink: false, createdAt: Date.now() }).run();
		const e = event('GET', 'reader@test.local', pid);
		e.params.vid = String(lastVersion(pid)!.id);
		expect((await hit(fn, e)).status).toBe(200);
	});
});

describe('label routes (008)', () => {
	const labels = handlers.filter((h) => h.name.includes('/history/labels'));
	it('finds them', () =>
		expect(labels.map((h) => h.name).sort()).toEqual([
			'DELETE /api/projects/[pid]/history/labels/[lid]',
			'PATCH /api/projects/[pid]/history/labels/[lid]',
			'POST /api/projects/[pid]/history/labels'
		]));

	// a reader neither adds nor changes labels (the label routes check authorship past the project guard)
	it.each(labels)('$name: 403 for a reader', async ({ method, fn }) => {
		const { db } = await start();
		const pid = project();
		const v = lastVersion(pid)!;
		const label = db
			.insert(versionLabels)
			.values({ projectId: pid, versionId: v.id, name: 'x', userId: user().id, createdAt: 1 })
			.returning()
			.get();
		const reader = user('reader@test.local');
		db.insert(memberships).values({ projectId: pid, userId: reader.id, role: 'reader', viaLink: false, createdAt: Date.now() }).run();
		const e = event(method, 'reader@test.local', pid);
		e.params.lid = String(label.id);
		e.request = new Request('http://x/', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'y' }) });
		expect((await hit(fn, e)).status).toBe(403);
	});
});

describe('sync routes (008)', () => {
	const sync = handlers.filter((h) => h.name.includes('/compile/sync/'));
	it('finds them', () => expect(sync.map((h) => h.name).sort()).toEqual(['GET /api/projects/[pid]/compile/sync/code', 'GET /api/projects/[pid]/compile/sync/pdf']));

	// readers navigate too (FR-024); without a compile there is no mapping
	it.each(sync)('$name: a reader gets past the guard, 404 before a compile, 400 on bad params', async ({ fn }) => {
		const { db } = await start();
		const pid = project();
		const reader = user('reader@test.local');
		db.insert(memberships).values({ projectId: pid, userId: reader.id, role: 'reader', viaLink: false, createdAt: Date.now() }).run();
		const e = event('GET', 'reader@test.local', pid);
		expect((await hit(fn, e)).status).toBe(400);
		e.url = new URL('http://x/?pdfId=nope&fileId=x&line=1&page=1&x=10&y=10');
		expect((await hit(fn, e)).status).toBe(404);
	});
});

describe('/share/[token]', () => {
	it('shows a signed-out visitor the title and nothing else', async () => {
		await start();
		const pid = project(undefined, 'Secret thesis');
		const { token } = setLink(pid, 'reader', false)!;
		const signedOut = { params: { token }, locals: { user: null } } as never;
		expect(await shareLoad(signedOut)).toEqual({ project: { title: 'Secret thesis' } });
		expect(await shareLoad({ params: { token: 'nope' }, locals: { user: null } } as never)).toEqual({ project: null });
	});
});
