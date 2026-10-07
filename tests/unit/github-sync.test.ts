import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMainFileId, getText, setText } from '../../src/lib/server/files.ts';
import { getAccount, saveAccount } from '../../src/lib/server/github/accounts.ts';
import { open } from '../../src/lib/server/github/crypto.ts';
import { confirmLink, getLink, getStatus, linkRepo } from '../../src/lib/server/github/links.ts';
import { projectFiles } from '../../src/lib/server/github/paths.ts';
import { protectedBranch } from '../../src/lib/server/github/push.ts';
import { hasUnpushed, requestSync, tick } from '../../src/lib/server/github/sync.ts';
import { transferOwnership } from '../../src/lib/server/projects.ts';
import { githubLinks, githubRuns, memberships } from '../../src/lib/server/schema.ts';
import * as createBranchRoute from '../../src/routes/api/projects/[pid]/github/create-branch/+server.ts';
import * as pullRoute from '../../src/routes/api/projects/[pid]/github/pull/+server.ts';
import * as pushRoute from '../../src/routes/api/projects/[pid]/github/push/+server.ts';
import * as linkRoute from '../../src/routes/api/projects/[pid]/github/+server.ts';
import { fakeGitHub } from '../fake-github/server.ts';
import { cleanup, connect, ev, hit, json, OWNER, project, start, user, waitFor } from './helpers.ts';

// 012 US4 "See sync status and sync on demand" against the fake GitHub (T042): Push now with a title, Pull now,
// readers refused, failures with backoff and recovery, access problems without retries, one follow-up run for many
// triggers, ownership transfer pausing sync, and no token in status or logs (SC-006).

const KEY = readFileSync(join(import.meta.dirname, '../fake-github/key.pem'), 'utf8');
const ENV: Record<string, string> = {
	GITHUB_APP_ID: '1',
	GITHUB_APP_SLUG: 'overtree-test',
	GITHUB_APP_CLIENT_ID: 'test-client-id',
	GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
	GITHUB_APP_PRIVATE_KEY: KEY,
	GITHUB_TICK_MS: '20',
	GITHUB_GRACE_MS: '200',
	GITHUB_LONG_MS: '3600000',
	GITHUB_PULL_MS: '3600000'
};
const EXTRA = ['GITHUB_API_URL', 'GITHUB_URL'];
const EDITOR = 'b@test.local';
const READER = 'r@test.local';
const TOKEN_RE = /\b(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/;

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
	vi.restoreAllMocks();
	for (const k of [...Object.keys(ENV), ...EXTRA]) delete process.env[k];
});

/** Fake GitHub with `ada/thesis` (main.tex, the CI workflow and its PDF on `main`; `branch` other than main is a
 *  second branch with the same files), a project owned by OWNER with an editor and a reader, OWNER connected as
 *  `ada` and the project linked to `branch` and confirmed. */
async function setup(branch = 'main') {
	const g = fakeGitHub();
	const { url, stop } = await g.start();
	cleanup.push(stop);
	process.env.GITHUB_API_URL = url;
	process.env.GITHUB_URL = url;
	g.addUser({ login: 'ada', name: 'Ada', email: 'ada@example.com' });
	const inst = g.addInstallation({ account: 'ada' });
	const files = { 'main.tex': 'from GitHub\n', '.github/workflows/render-latex.yaml': 'on: push\n', 'main.pdf': '%PDF' };
	const thesis = g.addRepo({ name: 'thesis', installation: inst.id, files });
	if (branch !== 'main') g.commitFiles(thesis, branch, files, undefined, 'Branch');
	const server = await start();
	const pid = project();
	const owner = user().id;
	for (const [email, role] of [
		[EDITOR, 'editor'],
		[READER, 'reader']
	] as const)
		server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
	const userToken = g.userToken('ada');
	saveAccount(owner, { token: userToken, expiresAt: Date.now() + 3600_000, refreshToken: '', refreshExpiresAt: Date.now() + 3600_000 }, { id: 1, login: 'ada' });
	await linkRepo(pid, owner, { installationId: inst.id, repoId: thesis.id, branch });
	await confirmLink(pid, 'merge');
	expect(getLink(pid)!.status).toBe('active');
	return { g, inst, thesis, server, pid, owner, branch, userToken, main: getMainFileId(pid)! };
}

type S = Awaited<ReturnType<typeof setup>>;

const ctx = (s: S, email = OWNER) => ({ userId: user(email).id, projectId: s.pid });
const push = (s: S, email: string, body: object = {}) => hit(pushRoute.POST, ev(email, { pid: s.pid }, json('POST', body)));
const pull = (s: S, email: string) => hit(pullRoute.POST, ev(email, { pid: s.pid }, json('POST', {})));
const runs = (s: S) => s.server.db.select().from(githubRuns).where(eq(githubRuns.projectId, s.pid)).all();
const message = (s: S) => s.g.commit(s.thesis, s.g.head(s.thesis, s.branch)!)!.message;

describe('Push now and Pull now (US4 #2–#4, FR-026)', () => {
	it('Push now with a title uses it as the commit title and reports the commit', async () => {
		const s = await setup();
		await setText(s.main, 'draft text\n', ctx(s, EDITOR));
		expect(getStatus(s.pid, s.owner).link!.state).toBe('unpushed');

		const res = await push(s, EDITOR, { title: '  draft for review  ' });
		expect(res.status).toBe(200);
		expect(res.body.result).toBe('pushed');
		expect(res.body.commit).toBe(s.g.head(s.thesis, 'main'));
		expect(message(s).split('\n')[0]).toBe('draft for review');
		expect(s.g.files(s.thesis, 'main').get('main.tex')!.toString()).toBe('draft text\n');
		const status = getStatus(s.pid, s.owner);
		expect(status.link!.state).toBe('in-sync');
		expect(status.runs![0]).toMatchObject({ kind: 'push', trigger: 'manual', result: 'pushed', user: { name: expect.any(String) } });

		// nothing left: noop; a title over 72 characters after trimming: 422
		expect((await push(s, OWNER)).body.result).toBe('noop');
		expect((await push(s, OWNER, { title: ` ${'x'.repeat(72)} ` })).status).toBe(200);
		expect((await push(s, OWNER, { title: 'x'.repeat(73) })).status).toBe(422);
		expect((await push(s, OWNER, { title: 42 })).status).toBe(422);
	});

	it('Pull now brings a GitHub commit in within the request', async () => {
		const s = await setup();
		s.g.commitFiles(s.thesis, 'main', { 'main.tex': 'edited on GitHub\n', 'notes.md': '# notes\n' }, { name: 'Octo', email: 'o@example.com' });
		const res = await pull(s, EDITOR);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ result: 'pulled', commit: s.g.head(s.thesis, 'main') });
		expect(await getText(s.main)).toBe('edited on GitHub\n');
		expect(getStatus(s.pid, s.owner).runs![0]).toMatchObject({ kind: 'pull', trigger: 'manual', result: 'pulled' });
	});

	it('readers see the status but can’t push or pull; an unlinked or paused link is 409', async () => {
		const s = await setup();
		const before = s.g.head(s.thesis, 'main');
		expect((await push(s, READER)).status).toBe(403);
		expect((await pull(s, READER)).status).toBe(403);
		expect(s.g.head(s.thesis, 'main')).toBe(before);
		const seen = getStatus(s.pid, user(READER).id);
		expect(seen.link!.repo).toBe('ada/thesis');
		expect(seen.canSync).toBe(false);
		expect(seen.link!.ignore).toBeUndefined();
		expect(getStatus(s.pid, user(EDITOR).id).canSync).toBe(true);

		s.server.db.update(githubLinks).set({ status: 'needs-access' }).where(eq(githubLinks.projectId, s.pid)).run();
		expect((await push(s, OWNER)).status).toBe(409);
		expect((await pull(s, EDITOR)).status).toBe(409);
	});
});

describe('failures (US4 #5, SC-007, FR-024)', () => {
	it('GitHub 500s → failing with the reason, retries 1 → 2 → 4 min, changes kept; recovery pushes them', async () => {
		const s = await setup();
		await setText(s.main, 'kept while failing\n', ctx(s));
		const before = s.g.head(s.thesis, 'main');
		for (const minutes of [1, 2, 4]) {
			s.g.failNext(500);
			const t = Date.now();
			const r = await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
			expect(r.result).toBe('failed');
			const link = getLink(s.pid)!;
			expect(link.status).toBe('failing');
			expect(link.error).toMatch(/temporary problem/);
			expect(link.nextAttemptAt! - t).toBeGreaterThanOrEqual(minutes * 60_000 - 50);
			expect(link.nextAttemptAt! - Date.now()).toBeLessThanOrEqual(minutes * 60_000);
			expect(hasUnpushed(link)).toBe(true);
			const status = getStatus(s.pid, s.owner);
			expect(status.link).toMatchObject({ state: 'failed', nextAttemptAt: link.nextAttemptAt });
			expect(status.canSync).toBe(true); // Push now still offered while retrying
		}
		expect(s.g.head(s.thesis, 'main')).toBe(before);

		// the retry is due: the scheduler pushes and the link recovers
		s.server.db.update(githubLinks).set({ nextAttemptAt: Date.now() - 1 }).where(eq(githubLinks.projectId, s.pid)).run();
		tick();
		await waitFor(() => getLink(s.pid)!.status === 'active' && s.g.head(s.thesis, 'main') !== before);
		expect(s.g.files(s.thesis, 'main').get('main.tex')!.toString()).toBe('kept while failing\n');
		expect(getLink(s.pid)).toMatchObject({ failCount: 0, nextAttemptAt: null, error: null });
		expect(runs(s).some((r) => r.trigger === 'retry' && r.result === 'pushed')).toBe(true);
	});

	it('GitHub 403 → needs-access, no automatic retry; the hourly access check brings it back (T054)', async () => {
		const s = await setup();
		await setText(s.main, 'x\n', ctx(s));
		s.g.failNext(403);
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('failed');
		const link = getLink(s.pid)!;
		expect(link).toMatchObject({ status: 'needs-access', nextAttemptAt: null });
		const count = s.g.count;
		tick(Date.now() + 30 * 60_000);
		await new Promise((r) => setTimeout(r, 100));
		expect(s.g.count).toBe(count);
		expect(getStatus(s.pid, s.owner)).toMatchObject({ canSync: false, link: { state: 'needs-access', branchMissing: false } });

		// an hour after the last check: access is checked again, it is fine, the link resumes and catches up
		tick(Date.now() + 3600_000 + 1000);
		await waitFor(() => s.g.files(s.thesis, 'main').get('main.tex')?.toString() === 'x\n');
		await waitFor(() => getLink(s.pid)!.status === 'active');
		expect(runs(s).at(-1)).toMatchObject({ kind: 'push', trigger: 'retry', result: 'pushed' });
	});

	it('a deleted branch → needs-access with branchMissing; Create branch makes it on the default branch head and pushes', async () => {
		const s = await setup('draft');
		await setText(s.main, 'project text\n', ctx(s));
		s.g.deleteBranch(s.thesis, 'draft');
		const r = await pull(s, OWNER);
		expect(r.body).toMatchObject({ result: 'failed' });
		expect(getStatus(s.pid, s.owner)).toMatchObject({ canSync: false, link: { state: 'needs-access', branchMissing: true } });

		expect((await hit(createBranchRoute.POST, ev(EDITOR, { pid: s.pid })))).toMatchObject({ status: 403 });
		const res = await hit(createBranchRoute.POST, ev(OWNER, { pid: s.pid }));
		expect(res.status).toBe(200);
		expect(res.body.result).toBe('pushed');
		const head = s.g.head(s.thesis, 'draft')!;
		expect(s.g.commit(s.thesis, head)!.parents).toEqual([s.g.head(s.thesis, 'main')]);
		const onGitHub = s.g.files(s.thesis, 'draft');
		expect(onGitHub.get('main.tex')!.toString()).toBe('project text\n');
		expect(onGitHub.has('.github/workflows/render-latex.yaml')).toBe(true);
		expect(getLink(s.pid)).toMatchObject({ status: 'active', baseCommit: head, error: null });
		// not missing any more: 409
		expect((await hit(createBranchRoute.POST, ev(OWNER, { pid: s.pid }))).status).toBe(409);
	});

	it('a revoked GitHub authorization → needs-reconnect at the next access check', async () => {
		const s = await setup();
		s.g.revoke('ada');
		s.server.db.update(githubLinks).set({ lastCheckAt: 0 }).where(eq(githubLinks.projectId, s.pid)).run();
		expect((await requestSync(s.pid, { kind: 'pull', trigger: 'manual' })).result).toBe('failed');
		expect(getLink(s.pid)).toMatchObject({ status: 'needs-reconnect', nextAttemptAt: null });
		expect(getStatus(s.pid, s.owner).link!.state).toBe('needs-reconnect');
	});
});

describe('one run at a time (US4 #6, FR-022)', () => {
	it('three triggers during a running push → exactly one follow-up run', async () => {
		const s = await setup();
		await setText(s.main, 'first\n', ctx(s));
		const before = runs(s).length;
		const first = requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		const later = [
			requestSync(s.pid, { kind: 'pull', trigger: 'periodic' }),
			requestSync(s.pid, { kind: 'push', trigger: 'manual', title: 'follow-up' }),
			requestSync(s.pid, { kind: 'pull', trigger: 'open' })
		];
		const results = await Promise.all([first, ...later]);
		expect(results[0].result).toBe('pushed');
		// the three share one follow-up run (a push, since push wins)
		expect(new Set(results.slice(1))).toHaveProperty('size', 1);
		const added = runs(s).slice(before);
		expect(added).toHaveLength(2);
		expect(added.map((r) => r.kind)).toEqual(['push', 'push']);
		expect(added[1]).toMatchObject({ trigger: 'manual', result: 'noop' }); // the first one took everything
	});
});

describe('ownership transfer (FR-027)', () => {
	it('pauses sync as owner-changed until the new owner takes the link over with their own connection', async () => {
		const s = await setup();
		const b = user(EDITOR).id;
		transferOwnership(s.pid, s.owner, b);
		expect(getLink(s.pid)!.status).toBe('owner-changed');
		expect(getStatus(s.pid, b)).toMatchObject({ canManage: true, canSync: false, link: { state: 'owner-changed' } });

		// nothing syncs meanwhile, not even when asked or when the old owner disconnects
		await setText(s.main, 'while paused\n', ctx(s, EDITOR));
		const before = s.g.count;
		expect((await push(s, EDITOR)).status).toBe(409);
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('noop');
		tick(Date.now() + 3600_000);
		await new Promise((r) => setTimeout(r, 100));
		expect(s.g.count).toBe(before);

		const patch = () => hit(linkRoute.PATCH, ev(EDITOR, { pid: s.pid }, json('PATCH', { confirmOwner: true })));
		expect((await hit(linkRoute.PATCH, ev(OWNER, { pid: s.pid }, json('PATCH', { confirmOwner: true })))).status).toBe(403); // not the owner any more
		expect((await patch()).status).toBe(409); // no connection
		s.g.addUser({ login: 'bob', name: 'Bob' });
		saveAccount(b, { token: s.g.userToken('bob'), expiresAt: Date.now() + 3600_000, refreshToken: '', refreshExpiresAt: Date.now() + 3600_000 }, { id: 2, login: 'bob' });
		expect((await patch()).status).toBe(409); // bob can't see the repository
		expect(getLink(s.pid)!.status).toBe('owner-changed');

		s.inst.users.add('bob');
		const res = await patch();
		expect(res.status).toBe(200);
		expect(res.body.link.linkedBy.id).toBe(b);
		expect(getLink(s.pid)).toMatchObject({ userId: b, error: null });
		// taking over catches up: the paused edit reaches GitHub
		await waitFor(() => s.g.files(s.thesis, 'main').get('main.tex')?.toString() === 'while paused\n');
		await waitFor(() => getLink(s.pid)!.status === 'active');
	});
});

describe('no tokens in status or logs (SC-006)', () => {
	it('status JSON, run errors and console output never contain a token', async () => {
		const logged: unknown[] = [];
		for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a) => void logged.push(...a));
		const s = await setup();
		await setText(s.main, 'x\n', ctx(s));
		s.g.failNext(500);
		await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		s.g.failNext(401);
		await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		const acc = getAccount(s.owner)!;
		const secrets = [s.userToken, open(acc.accessToken), acc.accessToken, acc.refreshToken];
		for (const email of [OWNER, EDITOR, READER]) {
			const body = JSON.stringify((await hit(linkRoute.GET, ev(email, { pid: s.pid }))).body);
			expect(body).toContain('ada/thesis');
			expect(body).not.toMatch(TOKEN_RE);
			for (const t of secrets) expect(body).not.toContain(t);
		}
		const text = logged.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join('\n');
		expect(text).not.toMatch(TOKEN_RE);
		for (const t of secrets) expect(text).not.toContain(t);
	});

	it('a GitHub reply or network error that echoes a token never reaches the link error, the runs or the logs (T050)', async () => {
		const logged: unknown[] = [];
		for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a) => void logged.push(...a));
		const s = await setup();
		await setText(s.main, 'y\n', ctx(s));
		const leaked = 'ghs_0123456789abcdefLEAKED';
		const real = globalThis.fetch;
		const toGitHub = (url: unknown) => String(url instanceof Request ? url.url : url).startsWith(s.g.url);
		const spy = vi.spyOn(globalThis, 'fetch');
		spy.mockImplementationOnce((url, init) =>
			toGitHub(url) ? Promise.resolve(Response.json({ message: `Bad credentials for ${leaked}` }, { status: 500 })) : real(url, init)
		);
		await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		expect(getLink(s.pid)!.error).toContain('[token]');
		spy.mockImplementationOnce((url, init) => (toGitHub(url) ? Promise.reject(new TypeError(`fetch failed: Bearer ${leaked}`)) : real(url, init)));
		await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		spy.mockRestore();
		const stored = JSON.stringify([getLink(s.pid), runs(s), (await hit(linkRoute.GET, ev(OWNER, { pid: s.pid }))).body]);
		const text = logged.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join('\n');
		for (const out of [stored, text]) {
			expect(out).not.toContain(leaked);
			expect(out).not.toMatch(TOKEN_RE);
		}
	});
});

describe('pulls continue while pushes fail (T053, FR-016)', () => {
	it('a failing push with unpushed changes: the open project still gets GitHub commits within pullMs, the retry schedule stays', async () => {
		process.env.GITHUB_PULL_MS = '300';
		const s = await setup();
		const onGitHub = s.g.files(s.thesis, 'main').get('main.tex')!.toString();
		await setText(s.main, 'waiting to be pushed\n', ctx(s));
		s.g.failNext(500);
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('failed');
		const failed = getLink(s.pid)!;
		expect(failed).toMatchObject({ status: 'failing', failCount: 1 });

		await connect(s.server.url, `project:${s.pid}`, OWNER); // the open pull
		await waitFor(() => runs(s).some((r) => r.trigger === 'open' && r.result !== 'failed'));
		s.g.commitFiles(s.thesis, 'main', { 'notes.md': 'from GitHub\n' });
		await waitFor(() => projectFiles(s.pid).has('notes.md'), 3000);

		const link = getLink(s.pid)!;
		expect(link).toMatchObject({ status: 'failing', failCount: 1, nextAttemptAt: failed.nextAttemptAt, error: failed.error });
		expect(hasUnpushed(link)).toBe(true);
		expect(s.g.files(s.thesis, 'main').get('main.tex')!.toString()).toBe(onGitHub);
		expect(await getText(s.main)).toBe('waiting to be pushed\n');
	});
});

describe('branch protection (T055)', () => {
	it('a protected branch: one attempt, named plainly, changes kept, pulls continue; lifted → the retry pushes', async () => {
		const s = await setup();
		await setText(s.main, 'kept\n', ctx(s));
		s.g.protect(s.thesis, 'main');
		const patches = () => s.g.requests.filter((r) => r.method === 'PATCH' && r.path.includes('/git/refs/')).length;
		const before = patches();
		const r = await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		expect(r).toMatchObject({ result: 'failed', error: protectedBranch('main') });
		expect(patches() - before).toBe(1); // not retried as a fast-forward race
		const failed = getLink(s.pid)!;
		expect(failed).toMatchObject({ status: 'failing', failCount: 1, error: protectedBranch('main') });
		expect(getStatus(s.pid, s.owner).link).toMatchObject({ state: 'failed', error: protectedBranch('main') });
		expect(hasUnpushed(failed)).toBe(true);

		s.g.commitFiles(s.thesis, 'main', { 'notes.md': 'pulled anyway\n' });
		expect((await pull(s, EDITOR)).body).toMatchObject({ result: 'pulled' });
		expect(projectFiles(s.pid).has('notes.md')).toBe(true);
		expect(getLink(s.pid)).toMatchObject({ status: 'failing', failCount: 1, nextAttemptAt: failed.nextAttemptAt });

		s.g.protect(s.thesis, 'main', false);
		s.server.db.update(githubLinks).set({ nextAttemptAt: Date.now() - 1 }).where(eq(githubLinks.projectId, s.pid)).run();
		tick();
		await waitFor(() => getLink(s.pid)!.status === 'active');
		expect(s.g.files(s.thesis, 'main').get('main.tex')!.toString()).toBe('kept\n');
	});
});

describe('access comes back (T054, R12)', () => {
	it('needs-access, a GitHub edit meanwhile, access granted + Check again → active with the base kept: the edit is merged', async () => {
		const s = await setup();
		await setText(s.main, 'a\nb\nc\n', ctx(s));
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
		const base = getLink(s.pid)!.baseCommit;

		s.g.setPush('ada', s.thesis, false);
		s.server.db.update(githubLinks).set({ lastCheckAt: 0 }).where(eq(githubLinks.projectId, s.pid)).run();
		expect((await requestSync(s.pid, { kind: 'pull', trigger: 'manual' })).result).toBe('failed');
		expect(getLink(s.pid)!.status).toBe('needs-access');
		s.g.commitFiles(s.thesis, 'main', { 'main.tex': 'a\nb\nC on GitHub\n' });
		await setText(s.main, 'A in Overtree\nb\nc\n', ctx(s));

		const recheck = (email: string) => hit(linkRoute.PATCH, ev(email, { pid: s.pid }, json('PATCH', { recheck: true })));
		expect((await recheck(EDITOR)).status).toBe(403);
		const still = await recheck(OWNER);
		expect(still.status).toBe(409);
		expect(getLink(s.pid)!.status).toBe('needs-access');

		s.g.setPush('ada', s.thesis, true);
		const res = await recheck(OWNER);
		expect(res.status).toBe(200);
		expect(getLink(s.pid)!.baseCommit).toBe(base); // not a first sync
		await waitFor(() => s.g.files(s.thesis, 'main').get('main.tex')?.toString() === 'A in Overtree\nb\nC on GitHub\n');
		await waitFor(() => getLink(s.pid)!.status === 'active');
		expect(await getText(s.main)).toBe('A in Overtree\nb\nC on GitHub\n');
		expect((await recheck(OWNER)).status).toBe(409); // nothing to check any more
	});
});

describe('renamed or transferred repositories (T057)', () => {
	for (const redirect of [true, false])
		it(`renamed (${redirect ? '301' : '404'} under the old name) → the next sync follows it and the status shows the new name`, async () => {
			const s = await setup();
			s.g.moveRepo(s.thesis, { name: 'dissertation', redirect });
			await setText(s.main, 'after the rename\n', ctx(s));
			expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
			expect(s.g.files(s.thesis, 'main').get('main.tex')!.toString()).toBe('after the rename\n');
			expect(getLink(s.pid)).toMatchObject({ status: 'active', repo: 'ada/dissertation' });
			expect(getStatus(s.pid, s.owner).link!.repo).toBe('ada/dissertation');
		});

	it('transferred out of the installation → needs-access (not a missing branch)', async () => {
		const s = await setup();
		s.g.moveRepo(s.thesis, { owner: 'elsewhere' });
		await setText(s.main, 'x\n', ctx(s));
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('failed');
		expect(getLink(s.pid)).toMatchObject({ status: 'needs-access', nextAttemptAt: null });
		expect(getStatus(s.pid, s.owner).link).toMatchObject({ state: 'needs-access', branchMissing: false });
	});
});
