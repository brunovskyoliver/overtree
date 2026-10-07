import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAccess, userToken } from '../../src/lib/server/github/accounts.ts';
import { open } from '../../src/lib/server/github/crypto.ts';
import { getLink } from '../../src/lib/server/github/links.ts';
import { readBase } from '../../src/lib/server/github/paths.ts';
import { githubAccounts, githubRuns, memberships, users } from '../../src/lib/server/schema.ts';
import * as accountRoute from '../../src/routes/api/github/account/+server.ts';
import * as callbackRoute from '../../src/routes/api/github/callback/+server.ts';
import * as connectRoute from '../../src/routes/api/github/connect/+server.ts';
import * as branchesRoute from '../../src/routes/api/github/repos/[owner]/[repo]/branches/+server.ts';
import * as reposRoute from '../../src/routes/api/github/repos/+server.ts';
import * as confirmRoute from '../../src/routes/api/projects/[pid]/github/confirm/+server.ts';
import * as linkRoute from '../../src/routes/api/projects/[pid]/github/+server.ts';
import { fakeGitHub } from '../fake-github/server.ts';
import { cleanup, hit, OWNER, project, start, user } from './helpers.ts';

// 012 US1 "Connect GitHub and link a project" against the fake GitHub (T023): connect via OAuth, the repository
// picker, owner-only linking, unlink/disconnect, access checks and the unconfigured integration.

const KEY = readFileSync(join(import.meta.dirname, '../fake-github/key.pem'), 'utf8');
const ENV = {
	GITHUB_APP_ID: '1',
	GITHUB_APP_SLUG: 'overtree-test',
	GITHUB_APP_CLIENT_ID: 'test-client-id',
	GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
	GITHUB_APP_PRIVATE_KEY: KEY
};
const ALL = [...Object.keys(ENV), 'GITHUB_API_URL', 'GITHUB_URL'];
const EDITOR = 'editor@test.local';
const READER = 'reader@test.local';
const CALLBACK = 'http://app.test/api/github/callback';

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
	for (const k of ALL) delete process.env[k];
});

type Handler = (event: never) => Response | Promise<Response>;

/** A SvelteKit cookie jar, enough for the OAuth routes. */
function jar() {
	const m = new Map<string, string>();
	return { get: (n: string) => m.get(n), set: (n: string, v: string) => void m.set(n, v), delete: (n: string) => void m.delete(n), map: m };
}

function event(email: string | null, opts: { url?: string; params?: Record<string, string>; method?: string; body?: unknown; cookies?: ReturnType<typeof jar> } = {}) {
	const method = opts.method ?? 'GET';
	return {
		locals: { user: email ? user(email) : null },
		params: opts.params ?? {},
		url: new URL(opts.url ?? 'http://app.test/'),
		cookies: opts.cookies ?? jar(),
		request: new Request(opts.url ?? 'http://app.test/', {
			method,
			...(opts.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) })
		})
	};
}

const call = (handler: Handler, email: string | null, opts: Parameters<typeof event>[1] = {}) => hit(handler, event(email, opts));

/** A raw response (redirects), or the thrown error's status. */
async function raw(handler: Handler, ev: object) {
	try {
		return await handler(ev as never);
	} catch (e) {
		return new Response(null, { status: (e as { status: number }).status });
	}
}

/** Fake GitHub with user `ada` (installation on her account: `ada/thesis`, `ada/paper`), an organization `acme`
 *  whose installation she can see (`acme/readonly` without push), and `ada/outside` in no installation. */
async function setup() {
	const g = fakeGitHub();
	const { url, stop } = await g.start();
	cleanup.push(stop);
	process.env.GITHUB_API_URL = url;
	process.env.GITHUB_URL = url;
	g.callbackUrl = CALLBACK;
	g.addUser({ login: 'ada', name: 'Ada', email: 'ada@example.com' });
	const inst = g.addInstallation({ account: 'ada' });
	const thesis = g.addRepo({
		name: 'thesis',
		installation: inst.id,
		files: { 'main.tex': 'from GitHub\n', 'refs.bib': '@book{x}\n', '.github/workflows/render-latex.yaml': 'on: push\n', 'main.pdf': 'pdf' }
	});
	g.commitFiles(thesis, 'draft', { 'notes.md': 'draft\n' });
	const paper = g.addRepo({ name: 'paper', installation: inst.id, private: false, files: { 'README.md': '# Paper\n' } });
	const empty = g.addRepo({ name: 'empty', installation: inst.id });
	const org = g.addInstallation({ account: 'acme', users: ['ada'] });
	const readonly = g.addRepo({ name: 'readonly', installation: org.id, files: { 'a.tex': 'a\n' } });
	g.setPush('ada', readonly, false);
	g.addRepo({ name: 'outside', owner: 'ada', files: { 'a.tex': 'a\n' } });
	const server = await start();
	const pid = project();
	return { g, url, inst, org, thesis, paper, empty, readonly, server, pid };
}

/** The whole OAuth round trip as `email`: connect → fake authorize → callback. Returns the callback response. */
async function connectGitHub(email = OWNER, ret = '/project/x?github=1') {
	const cookies = jar();
	const res = await raw(connectRoute.GET as Handler, event(email, { url: `http://app.test/api/github/connect?return=${encodeURIComponent(ret)}`, cookies }));
	expect(res.status).toBe(302);
	const authorize = await fetch(res.headers.get('location')!, { redirect: 'manual' });
	expect(authorize.status).toBe(302);
	const back = authorize.headers.get('location')!;
	expect(back.startsWith(CALLBACK)).toBe(true);
	return raw(callbackRoute.GET as Handler, event(email, { url: back, cookies }));
}

function member(db: Awaited<ReturnType<typeof start>>['db'], pid: string, email: string, role: 'editor' | 'reader') {
	db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
}

async function linkThesis(s: Awaited<ReturnType<typeof setup>>, branch = 'main') {
	return call(linkRoute.PUT as Handler, OWNER, { method: 'PUT', params: { pid: s.pid }, body: { installationId: s.inst.id, repoId: s.thesis.id, branch } });
}

describe('connect (FR-001–003)', () => {
	it('stores sealed tokens and keeps the Overtree user', async () => {
		const { server } = await setup();
		const identity = () => {
			const u = server.db.select().from(users).where(eq(users.id, user().id)).get()!;
			return { id: u.id, email: u.email, name: u.name, role: u.role, disabled: u.disabled };
		};
		const before = identity();
		const res = await connectGitHub(OWNER, '/project/abc?github=1');
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('/project/abc?github=1');
		const acc = server.db.select().from(githubAccounts).where(eq(githubAccounts.userId, user().id)).get()!;
		expect(acc.login).toBe('ada');
		expect(acc.accessToken.toString('latin1')).not.toMatch(/gh[ur]_/);
		expect(open(acc.accessToken)).toMatch(/^ghu_/);
		expect(open(acc.refreshToken)).toMatch(/^ghr_/);
		// the Clerk/test identity is untouched
		expect(identity()).toEqual(before);
		expect(server.db.select().from(users).all()).toHaveLength(1);
		const account = await call(accountRoute.GET as Handler, OWNER);
		expect(account.body).toMatchObject({ connected: true, login: 'ada' });
		expect(JSON.stringify(account.body)).not.toMatch(/gh[ur]_/);
	});

	it('refuses a state that does not match the cookie, the signature or the signed-in user (403)', async () => {
		await setup();
		const cookies = jar();
		const res = await raw(connectRoute.GET as Handler, event(OWNER, { url: 'http://app.test/api/github/connect?return=/', cookies }));
		const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
		const cb = (s: string) => `${CALLBACK}?code=whatever&state=${encodeURIComponent(s)}`;
		// no cookie
		expect((await raw(callbackRoute.GET as Handler, event(OWNER, { url: cb(state) }))).status).toBe(403);
		// cookie of another attempt
		const other = jar();
		other.set('overtree_github_state', `${state}x`);
		expect((await raw(callbackRoute.GET as Handler, event(OWNER, { url: cb(state), cookies: other }))).status).toBe(403);
		// tampered state matching a tampered cookie
		const forged = `${state.split('.')[0]}.AAAA`;
		const forgedJar = jar();
		forgedJar.set('overtree_github_state', forged);
		expect((await raw(callbackRoute.GET as Handler, event(OWNER, { url: cb(forged), cookies: forgedJar }))).status).toBe(403);
		// right state and cookie, someone else signed in
		expect((await raw(callbackRoute.GET as Handler, event(EDITOR, { url: cb(state), cookies }))).status).toBe(403);
		expect(cookies.map.size).toBe(1);
	});

	it('only returns to same-origin paths', async () => {
		await setup();
		for (const bad of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)', '/a\nb']) {
			const res = await call(connectRoute.GET as Handler, OWNER, { url: `http://app.test/api/github/connect?return=${encodeURIComponent(bad)}` });
			expect(res.status, bad).toBe(422);
		}
		const ok = await raw(connectRoute.GET as Handler, event(OWNER, { url: 'http://app.test/api/github/connect' }));
		expect(ok.status).toBe(302);
	});

	it('refreshes a user token that expires within 5 minutes', async () => {
		const { g } = await setup();
		g.accessTtl = 60;
		await connectGitHub();
		const first = await userToken(user().id);
		const second = await userToken(user().id);
		expect(second).not.toBe(first);
		// the refreshed token works
		expect((await call(reposRoute.GET as Handler, OWNER)).status).toBe(200);
	});
});

describe('repository picker (FR-006)', () => {
	it('lists only repositories with push permission inside installations, grouped by account', async () => {
		await setup();
		await connectGitHub();
		const res = await call(reposRoute.GET as Handler, OWNER);
		expect(res.status).toBe(200);
		const accounts = res.body.accounts as { login: string; repos: { fullName: string; private: boolean }[] }[];
		expect(accounts.map((a) => a.login).sort()).toEqual(['acme', 'ada']);
		const names = accounts.flatMap((a) => a.repos.map((r) => r.fullName));
		expect(names.sort()).toEqual(['ada/empty', 'ada/paper', 'ada/thesis']);
		expect(accounts.find((a) => a.login === 'ada')!.repos.find((r) => r.fullName === 'ada/paper')!.private).toBe(false);
	});

	it('lists branches with the default branch', async () => {
		await setup();
		await connectGitHub();
		const res = await call(branchesRoute.GET as Handler, OWNER, { params: { owner: 'ada', repo: 'thesis' } });
		expect(res.body).toEqual({ branches: ['draft', 'main'], defaultBranch: 'main' });
	});

	it('answers 409 with reconnect when the connection is gone', async () => {
		await setup();
		expect(await call(reposRoute.GET as Handler, OWNER)).toMatchObject({ status: 409 });
		const res = await Promise.resolve()
			.then(() => reposRoute.GET(event(OWNER) as never))
			.catch((e: { body: unknown }) => e);
		expect(res.body).toMatchObject({ reconnect: true });
	});
});

describe('link (FR-005–007)', () => {
	it('links as pending after checking push access and the branch', async () => {
		const s = await setup();
		await connectGitHub();
		const res = await linkThesis(s);
		expect(res.status).toBe(200);
		expect(res.body.link).toMatchObject({ repo: 'ada/thesis', branch: 'main', state: 'pending', linkedBy: { id: user().id } });
		expect(res.body.link.url).toBe(`${s.url}/ada/thesis/tree/main`);
		expect(res.body.link.ignore).toContain('.github/**');
		expect(res.body.canManage).toBe(true);
		expect(JSON.stringify(res.body)).not.toMatch(/gh[usr]_/);
		expect((await linkThesis(s, 'nope')).status).toBe(422);
		const ro = await call(linkRoute.PUT as Handler, OWNER, { method: 'PUT', params: { pid: s.pid }, body: { installationId: s.org.id, repoId: s.readonly.id, branch: 'main' } });
		expect(ro.status).toBe(422);
		// a repository of another installation than the one named
		const wrong = await call(linkRoute.PUT as Handler, OWNER, { method: 'PUT', params: { pid: s.pid }, body: { installationId: s.org.id, repoId: s.paper.id, branch: 'main' } });
		expect(wrong.status).toBe(422);
		// any branch for an empty repository: the first push creates it
		const empty = await call(linkRoute.PUT as Handler, OWNER, { method: 'PUT', params: { pid: s.pid }, body: { installationId: s.inst.id, repoId: s.empty.id, branch: 'main' } });
		expect(empty.status).toBe(200);
		expect(getLink(s.pid)!.repo).toBe('ada/empty');
	});

	it('is owner-only to change; every member sees it (US1 #3)', async () => {
		const s = await setup();
		member(s.server.db, s.pid, EDITOR, 'editor');
		member(s.server.db, s.pid, READER, 'reader');
		await connectGitHub();
		await linkThesis(s);
		for (const email of [EDITOR, READER]) {
			const opts = { params: { pid: s.pid }, body: { installationId: s.inst.id, repoId: s.thesis.id, branch: 'main' } };
			expect((await call(linkRoute.PUT as Handler, email, { ...opts, method: 'PUT' })).status).toBe(403);
			expect((await call(linkRoute.PATCH as Handler, email, { ...opts, method: 'PATCH', body: { ignore: [] } })).status).toBe(403);
			expect((await call(linkRoute.DELETE as Handler, email, { params: { pid: s.pid }, method: 'DELETE' })).status).toBe(403);
			expect((await call(confirmRoute.POST as Handler, email, { params: { pid: s.pid }, method: 'POST', body: { mode: 'merge' } })).status).toBe(403);
			const seen = await call(linkRoute.GET as Handler, email, { params: { pid: s.pid } });
			expect(seen.status).toBe(200);
			expect(seen.body.link).toMatchObject({ repo: 'ada/thesis', branch: 'main', state: 'pending' });
			expect(seen.body.link.ignore).toBeUndefined();
			expect(seen.body.canManage).toBe(false);
		}
		expect((await call(linkRoute.GET as Handler, 'stranger@test.local', { params: { pid: s.pid } })).status).toBe(404);
	});

	it('patches patterns and branch, validating them', async () => {
		const s = await setup();
		await connectGitHub();
		await linkThesis(s);
		const patch = (body: unknown) => call(linkRoute.PATCH as Handler, OWNER, { method: 'PATCH', params: { pid: s.pid }, body });
		expect((await patch({ ignore: [' *.pdf ', '', 'build/**'] })).body.link.ignore).toEqual(['*.pdf', 'build/**']);
		expect((await patch({ ignore: Array.from({ length: 51 }, (_, i) => `p${i}`) })).status).toBe(422);
		expect((await patch({ ignore: ['x'.repeat(201)] })).status).toBe(422);
		expect((await patch({ ignore: 'x' })).status).toBe(422);
		expect((await patch({ branch: 'nope' })).status).toBe(422);
		expect((await patch({ branch: 'bad name' })).status).toBe(422);
		const draft = await patch({ branch: 'draft' });
		expect(draft.body.link).toMatchObject({ branch: 'draft', state: 'pending' });
	});

	it('confirm (merge) sets the first-sync base and runs the first sync (T020)', async () => {
		const s = await setup();
		await connectGitHub();
		await linkThesis(s);
		const before = s.g.head(s.thesis, 'main')!;
		const res = await call(confirmRoute.POST as Handler, OWNER, { method: 'POST', params: { pid: s.pid }, body: { mode: 'merge' } });
		expect(res.status).toBe(200);
		expect(res.body.link.state).not.toBe('pending');
		const link = getLink(s.pid)!;
		expect(link.status).toBe('active');
		// the first push: one commit on top of GitHub's head, the project's main.tex wins
		const head = s.g.head(s.thesis, 'main')!;
		expect(s.g.commit(s.thesis, head)!.parents).toEqual([before]);
		expect(link.baseCommit).toBe(head);
		const files = s.g.files(s.thesis, 'main');
		expect(files.get('main.tex')!.toString()).not.toBe('from GitHub\n');
		// GitHub-only and "not pulled" files are left alone (refs.bib arrives with Phase 5's pull)
		expect(files.get('refs.bib')!.toString()).toBe('@book{x}\n');
		expect(files.get('main.pdf')!.toString()).toBe('pdf');
		const base = readBase(link);
		expect(Object.keys(base)).toEqual(['main.tex']);
		expect(base['main.tex'].hash).toBeDefined();
		const runs = s.server.db.select().from(githubRuns).all();
		expect(runs.map((r) => `${r.kind}:${r.trigger}:${r.result}`)).toEqual(['pull:link:noop', 'push:link:pushed']);
		// once set up, confirm refuses
		expect((await call(confirmRoute.POST as Handler, OWNER, { method: 'POST', params: { pid: s.pid }, body: { mode: 'merge' } })).status).toBe(409);
	});

	it('confirm on an empty repository creates the branch with the project (Contents API seed + one commit)', async () => {
		const s = await setup();
		await connectGitHub();
		await call(linkRoute.PUT as Handler, OWNER, { method: 'PUT', params: { pid: s.pid }, body: { installationId: s.inst.id, repoId: s.empty.id, branch: 'main' } });
		expect((await call(confirmRoute.POST as Handler, OWNER, { method: 'POST', params: { pid: s.pid }, body: { mode: 'merge' } })).status).toBe(200);
		const link = getLink(s.pid)!;
		const head = s.g.head(s.empty, 'main');
		expect(link).toMatchObject({ status: 'active', baseCommit: head });
		expect([...s.g.files(s.empty, 'main').keys()]).toEqual(['main.tex']);
		expect(Object.keys(readBase(link))).toEqual(['main.tex']);
		// a project with one file needs only the seed commit
		expect(s.g.requests.filter((r) => r.method === 'PUT' && r.path.includes('/contents/'))).toHaveLength(1);
	});

	it('unlink deletes nothing on GitHub (FR-010)', async () => {
		const s = await setup();
		await connectGitHub();
		await linkThesis(s);
		const head = s.g.head(s.thesis, 'main');
		const before = s.g.count;
		const res = await call(linkRoute.DELETE as Handler, OWNER, { method: 'DELETE', params: { pid: s.pid } });
		expect(res.status).toBe(204);
		expect(getLink(s.pid)).toBeNull();
		expect(s.g.count).toBe(before);
		expect(s.g.requests.filter((r) => r.method !== 'GET' && !r.path.startsWith('/login/'))).toEqual([]);
		expect(s.g.head(s.thesis, 'main')).toBe(head);
		expect((await call(linkRoute.GET as Handler, OWNER, { params: { pid: s.pid } })).body.link).toBeNull();
	});
});

describe('disconnect and access (FR-010, US1 #5–6)', () => {
	it('disconnect → needs-reconnect; reconnecting resumes the link', async () => {
		const s = await setup();
		await connectGitHub();
		await linkThesis(s);
		await call(confirmRoute.POST as Handler, OWNER, { method: 'POST', params: { pid: s.pid }, body: { mode: 'merge' } });
		expect((await call(accountRoute.DELETE as Handler, OWNER, { method: 'DELETE' })).status).toBe(204);
		expect(s.server.db.select().from(githubAccounts).all()).toEqual([]);
		const status = await call(linkRoute.GET as Handler, OWNER, { params: { pid: s.pid } });
		expect(status.body.link.state).toBe('needs-reconnect');
		expect(status.body.link.error).toMatch(/reconnect/i);
		expect((await call(accountRoute.GET as Handler, OWNER)).body).toMatchObject({ connected: false });
		await connectGitHub();
		expect(getLink(s.pid)).toMatchObject({ status: 'active', error: null });
	});

	it('a revoked connection fails the access check with needs-reconnect; lost push → needs-access', async () => {
		const s = await setup();
		await connectGitHub();
		await linkThesis(s);
		expect(await checkAccess(getLink(s.pid)!)).toBe('ok');
		s.g.renameRepo(s.thesis, 'dissertation');
		expect(await checkAccess(getLink(s.pid)!)).toBe('ok');
		expect(getLink(s.pid)!.repo).toBe('ada/dissertation');
		expect(getLink(s.pid)!.lastCheckAt).toBeGreaterThan(0);
		s.g.setPush('ada', s.thesis, false);
		expect(await checkAccess(getLink(s.pid)!)).toBe('needs-access');
		s.g.setPush('ada', s.thesis, true);
		s.g.revoke('ada');
		expect(await checkAccess(getLink(s.pid)!)).toBe('needs-reconnect');
	});
});

describe('unconfigured (FR-004)', () => {
	type Mod = Record<string, Handler>;
	const routes = {
		...import.meta.glob<Mod>('../../src/routes/api/github/**/+server.ts', { eager: true }),
		...import.meta.glob<Mod>('../../src/routes/api/projects/*/github/**/+server.ts', { eager: true })
	};
	const handlers = Object.entries(routes).flatMap(([file, mod]) =>
		['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => m in mod).map((m) => ({ name: `${m} ${file.replace('../../src/routes', '')}`, method: m, fn: mod[m] }))
	);

	it('finds the routes', () => expect(handlers.length).toBeGreaterThanOrEqual(9));

	it.each(handlers)('$name: 404', async ({ method, fn }) => {
		for (const k of ALL) delete process.env[k];
		await start();
		const pid = project();
		const res = await call(fn, OWNER, { method, params: { pid, owner: 'ada', repo: 'thesis' }, body: method === 'GET' ? undefined : {} });
		expect(res.status).toBe(404);
	});
});
