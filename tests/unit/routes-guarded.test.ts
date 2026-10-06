import { describe, expect, it } from 'vitest';
import { setLink } from '../../src/lib/server/projects.ts';
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
	params: { pid, id: 'x', userId: 'x', email: 'x@test.local' },
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
