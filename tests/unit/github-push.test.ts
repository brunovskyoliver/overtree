import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getServer } from '../../src/lib/server/collab.ts';
import { createEntry, deleteEntry, getMainFileId, renameOrMove, setText, uploadFile } from '../../src/lib/server/files.ts';
import { saveAccount } from '../../src/lib/server/github/accounts.ts';
import { confirmLink, getLink, linkRepo } from '../../src/lib/server/github/links.ts';
import { commitMessage } from '../../src/lib/server/github/push.ts';
import { hasUnpushed, requestSync } from '../../src/lib/server/github/sync.ts';
import { closeVersion, flushHistory } from '../../src/lib/server/history.ts';
import { restoreVersion } from '../../src/lib/server/restore.ts';
import { files, githubRuns, memberships } from '../../src/lib/server/schema.ts';
import { fakeGitHub } from '../fake-github/server.ts';
import { cleanup, connect, OWNER, project, start, user, waitFor } from './helpers.ts';

// 012 US2 "Overtree changes reach GitHub, once per session" against the fake GitHub (T029), with short scheduler
// timings: session-end pushes after the grace period, long-session pushes, one commit per push, co-authors, never
// forced, "not pulled" files untouched, startup pushes after a restart.

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
const B = 'b@test.local';
const WORKFLOW = '.github/workflows/render-latex.yaml';

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
	for (const k of [...Object.keys(ENV), ...EXTRA]) delete process.env[k];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fake GitHub with `ada/thesis` (main.tex, the CI workflow and its main.pdf), a project owned by OWNER with editor
 *  B, OWNER connected as `ada` and the project linked and confirmed (first push done). `before` runs before the
 *  confirm (files that should be in the first sync). */
async function setup(opts: { dataDir?: string; before?: (pid: string) => unknown | Promise<unknown> } = {}) {
	const g = fakeGitHub();
	const { url, stop } = await g.start();
	cleanup.push(stop);
	process.env.GITHUB_API_URL = url;
	process.env.GITHUB_URL = url;
	g.addUser({ login: 'ada', name: 'Ada', email: 'ada@example.com' });
	const inst = g.addInstallation({ account: 'ada' });
	const thesis = g.addRepo({
		name: 'thesis',
		installation: inst.id,
		files: { 'main.tex': 'from GitHub\n', [WORKFLOW]: 'on: push\n', 'main.pdf': '%PDF workflow output' }
	});
	const server = await start(opts.dataDir);
	const pid = project();
	const owner = user().id;
	server.db.insert(memberships).values({ projectId: pid, userId: user(B).id, role: 'editor', viaLink: false, createdAt: Date.now() }).run();
	saveAccount(owner, { token: g.userToken('ada'), expiresAt: Date.now() + 3600_000, refreshToken: '', refreshExpiresAt: Date.now() + 3600_000 }, { id: 1, login: 'ada' });
	await opts.before?.(pid);
	await linkRepo(pid, owner, { installationId: inst.id, repoId: thesis.id, branch: 'main' });
	await confirmLink(pid, 'merge');
	expect(getLink(pid)!.status).toBe('active');
	return { g, thesis, server, pid, owner, main: getMainFileId(pid)! };
}

type S = Awaited<ReturnType<typeof setup>>;

/** Commits from `from` (exclusive) to the branch head, newest first. */
function commitsSince(s: S, from: string) {
	const out: { sha: string; message: string }[] = [];
	for (let sha = s.g.head(s.thesis, 'main')!; sha !== from; ) {
		const c = s.g.commit(s.thesis, sha)!;
		out.push({ sha, message: c.message });
		expect(c.parents).toHaveLength(1);
		sha = c.parents[0];
	}
	return out;
}

const fileOnGitHub = (s: S, path: string) => s.g.files(s.thesis, 'main').get(path)?.toString();
const ctx = (s: S, email = OWNER) => ({ userId: user(email).id, projectId: s.pid });
const runs = (s: S) => s.server.db.select().from(githubRuns).all();
const neverForced = (s: S) => {
	const patches = s.g.requests.filter((r) => r.method === 'PATCH');
	expect(patches.length).toBeGreaterThan(0);
	for (const p of patches) expect(p.body?.force).toBe(false);
};

/** A provider typing `text` at the start of document `id` as `email`; resolves once the server has it. */
async function type(s: S, id: string, email: string, text: string) {
	const conn = await connect(s.server.url, id, email);
	conn.text.insert(0, text);
	await waitFor(() => getServer().hocuspocus.documents.get(id)?.getText('content').toString().startsWith(text) ?? false);
	return conn;
}

describe('session-end push (US2 #1, #2, #6)', () => {
	it('two users edit two files and leave → after the grace period exactly one commit with both, two co-authors', async () => {
		const s = await setup({ before: (pid) => createEntry(pid, { kind: 'text', name: 'b.tex', parentId: null }, user().id) });
		expect(s.g.files(s.thesis, 'main').has('b.tex')).toBe(true);
		const start = s.g.head(s.thesis, 'main')!;
		const bId = s.server.db.select().from(files).all().find((f) => f.name === 'b.tex')!.id;

		const presence = [await connect(s.server.url, `project:${s.pid}`, OWNER), await connect(s.server.url, `project:${s.pid}`, B)];
		const editors = [await type(s, s.main, OWNER, 'Owner was here. '), await type(s, bId, B, 'B wrote this. ')];
		await sleep(400); // longer than the grace period, but people are still there
		expect(commitsSince(s, start)).toHaveLength(0);
		for (const c of [...editors, ...presence]) c.provider.destroy();

		await waitFor(() => s.g.head(s.thesis, 'main') !== start, 3000);
		await sleep(300);
		const commits = commitsSince(s, start);
		expect(commits).toHaveLength(1);
		const msg = commits[0].message;
		expect(msg.split('\n')[0]).toBe('Update b.tex and 1 more file');
		expect(msg).toContain('M b.tex');
		expect(msg).toContain('M main.tex');
		expect(msg).toContain(`Co-authored-by: owner <${OWNER}>`);
		expect(msg).toContain(`Co-authored-by: b <${B}>`);
		expect(fileOnGitHub(s, 'main.tex')!.startsWith('Owner was here. ')).toBe(true);
		expect(fileOnGitHub(s, 'b.tex')).toBe('B wrote this. ');
		expect(runs(s).at(-1)).toMatchObject({ kind: 'push', trigger: 'session-end', result: 'pushed', commit: commits[0].sha });
		expect(hasUnpushed(getLink(s.pid)!)).toBe(false);
		neverForced(s);
	});

	it('coming back within the grace period → no push; leaving for good → one push', async () => {
		process.env.GITHUB_GRACE_MS = '400';
		const s = await setup();
		const start = s.g.head(s.thesis, 'main')!;
		const p1 = await connect(s.server.url, `project:${s.pid}`, OWNER);
		const e1 = await type(s, s.main, OWNER, 'edit ');
		p1.provider.destroy();
		e1.provider.destroy();
		await sleep(150);
		const p2 = await connect(s.server.url, `project:${s.pid}`, OWNER); // back before the grace period ends
		await sleep(600);
		expect(s.g.head(s.thesis, 'main')).toBe(start);
		p2.provider.destroy();
		await waitFor(() => s.g.head(s.thesis, 'main') !== start, 3000);
		expect(commitsSince(s, start)).toHaveLength(1);
	});

	it('a reader keeps the session open too', async () => {
		const s = await setup();
		const R = 'r@test.local';
		s.server.db.insert(memberships).values({ projectId: s.pid, userId: user(R).id, role: 'reader', viaLink: false, createdAt: Date.now() }).run();
		const start = s.g.head(s.thesis, 'main')!;
		const reader = await connect(s.server.url, `project:${s.pid}`, R);
		const p = await connect(s.server.url, `project:${s.pid}`, OWNER);
		await setText(s.main, 'changed\n', ctx(s));
		p.provider.destroy();
		await sleep(500);
		expect(s.g.head(s.thesis, 'main')).toBe(start);
		reader.provider.destroy();
		await waitFor(() => s.g.head(s.thesis, 'main') !== start, 3000);
	});
});

describe('long sessions and triggers (US2 #3, #4)', () => {
	it('continuous editing longer than the long-session interval with a closed version → a push while connected', async () => {
		process.env.GITHUB_LONG_MS = '300';
		const s = await setup();
		const start = s.g.head(s.thesis, 'main')!;
		await connect(s.server.url, `project:${s.pid}`, OWNER);
		const e = await type(s, s.main, OWNER, 'a ');
		await sleep(400);
		// unpushed but no version closed since the last push: no push yet
		expect(s.g.head(s.thesis, 'main')).toBe(start);
		closeVersion(s.pid, 'edit');
		await waitFor(() => s.g.head(s.thesis, 'main') !== start, 3000);
		expect(runs(s).at(-1)).toMatchObject({ kind: 'push', trigger: 'long-session', result: 'pushed' });
		// still connected and typing: the next one waits for another interval and another version
		e.text.insert(0, 'b ');
		const second = s.g.head(s.thesis, 'main')!;
		await sleep(150);
		expect(s.g.head(s.thesis, 'main')).toBe(second);
	});

	it('a push without changes makes no commit (FR-014)', async () => {
		const s = await setup();
		const start = s.g.head(s.thesis, 'main')!;
		const writes = () => s.g.requests.filter((r) => r.method !== 'GET' && !r.path.endsWith('/access_tokens')).length;
		const before = writes();
		expect(await requestSync(s.pid, { kind: 'push', trigger: 'manual', userId: s.owner })).toMatchObject({ result: 'noop' });
		expect(s.g.head(s.thesis, 'main')).toBe(start);
		expect(writes()).toBe(before);
		expect(runs(s).at(-1)).toMatchObject({ kind: 'push', trigger: 'manual', result: 'noop' });
	});

	it('three requests during a running push → exactly one follow-up run (FR-022); a custom title is used', async () => {
		const s = await setup();
		const start = s.g.head(s.thesis, 'main')!;
		const before = runs(s).length;
		await setText(s.main, 'one\n', ctx(s));
		const first = requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		const more = [
			requestSync(s.pid, { kind: 'pull', trigger: 'periodic' }),
			requestSync(s.pid, { kind: 'push', trigger: 'manual', title: 'kept' }),
			requestSync(s.pid, { kind: 'pull', trigger: 'open' })
		];
		expect((await first).result).toBe('pushed');
		const followUps = await Promise.all(more);
		// one run answered all three: push won over the pulls
		expect(followUps.every((r) => r === followUps[0])).toBe(true);
		expect(runs(s).slice(before).map((r) => `${r.kind}:${r.trigger}:${r.result}`)).toEqual(['push:manual:pushed', 'push:manual:noop']);
		expect(commitsSince(s, start)).toHaveLength(1);

		await setText(s.main, 'two\n', ctx(s));
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual', title: '  Chapter two  ' })).result).toBe('pushed');
		expect(commitsSince(s, start)[0].message.split('\n')[0]).toBe('Chapter two');
	});
});

describe('what a push contains (US2 #5, #7, FR-013)', () => {
	it('add, rename, move, delete and a binary upload in one commit; never forced; workflow files untouched', async () => {
		let ids: Record<string, string> = {};
		const s = await setup({
			before: async (pid) => {
				const o = user().id;
				const old = createEntry(pid, { kind: 'text', name: 'old.tex', parentId: null }, o);
				const gone = createEntry(pid, { kind: 'text', name: 'gone.tex', parentId: null }, o);
				await setText(old.id, 'old content\n', { userId: o, projectId: pid });
				await setText(gone.id, 'gone\n', { userId: o, projectId: pid });
				ids = { old: old.id, gone: gone.id };
			}
		});
		const start = s.g.head(s.thesis, 'main')!;
		const workflow = fileOnGitHub(s, WORKFLOW);
		const pdf = fileOnGitHub(s, 'main.pdf');
		expect(fileOnGitHub(s, 'old.tex')).toBe('old content\n');

		const o = s.owner;
		const added = createEntry(s.pid, { kind: 'text', name: 'added.tex', parentId: null }, o);
		await setText(added.id, 'new file\n', ctx(s));
		const folder = createEntry(s.pid, { kind: 'folder', name: 'chapters', parentId: null }, o);
		renameOrMove(s.pid, ids.old, { name: 'one.tex', parentId: folder.id }, o);
		deleteEntry(s.pid, ids.gone, o);
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
		await uploadFile(s.pid, folder.id, 'fig.png', png, false, o);
		await setText(s.main, 'main edited\n', ctx(s));

		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
		const commits = commitsSince(s, start);
		expect(commits).toHaveLength(1);
		const onGitHub = s.g.files(s.thesis, 'main');
		expect([...onGitHub.keys()].sort()).toEqual([WORKFLOW, 'added.tex', 'chapters/fig.png', 'chapters/one.tex', 'main.pdf', 'main.tex']);
		expect(onGitHub.get('chapters/fig.png')!.equals(png)).toBe(true);
		expect(onGitHub.get('chapters/one.tex')!.toString()).toBe('old content\n');
		expect(onGitHub.get('main.tex')!.toString()).toBe('main edited\n');
		// FR-013: the workflow and its PDF are byte for byte what they were
		expect(fileOnGitHub(s, WORKFLOW)).toBe(workflow);
		expect(fileOnGitHub(s, 'main.pdf')).toBe(pdf);
		const msg = commits[0].message;
		expect(msg).toContain('A added.tex');
		expect(msg).toContain('A chapters/fig.png');
		expect(msg).toContain('R old.tex -> chapters/one.tex');
		expect(msg).toContain('D gone.tex');
		expect(msg).toContain('M main.tex');
		// the binary went up as a blob, texts inline
		expect(s.g.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/git/blobs'))).toHaveLength(1);
		neverForced(s);
	});

	it('a restore (008) is pushed like an edit', async () => {
		const s = await setup();
		await setText(s.main, 'version one\n', ctx(s));
		const v1 = closeVersion(s.pid, 'edit')!;
		await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		await setText(s.main, 'version two\n', ctx(s));
		await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		expect(fileOnGitHub(s, 'main.tex')).toBe('version two\n');
		await restoreVersion(s.pid, v1.id, s.owner);
		expect(hasUnpushed(getLink(s.pid)!)).toBe(true);
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
		expect(fileOnGitHub(s, 'main.tex')).toBe('version one\n');
	});

	it('a workflow commit (PDF only) in between: the push goes on top, the PDF stays GitHub’s', async () => {
		const s = await setup();
		const pdfCommit = s.g.commitFiles(s.thesis, 'main', { 'main.pdf': '%PDF new build' }, undefined, 'Render PDF');
		await setText(s.main, 'after the build\n', ctx(s));
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
		const head = s.g.head(s.thesis, 'main')!;
		expect(s.g.commit(s.thesis, head)!.parents).toEqual([pdfCommit]);
		expect(fileOnGitHub(s, 'main.pdf')).toBe('%PDF new build');
		expect(fileOnGitHub(s, 'main.tex')).toBe('after the build\n');
		neverForced(s);
	});

	it('a GitHub edit to a tracked file: the push merges it first, then commits on top (US2 #7)', async () => {
		const s = await setup();
		await setText(s.main, 'a\nb\nc\n', ctx(s));
		await requestSync(s.pid, { kind: 'push', trigger: 'manual' });
		const theirs = s.g.commitFiles(s.thesis, 'main', { 'main.tex': 'a\nb\nC on GitHub\n' });
		await setText(s.main, 'A in Overtree\nb\nc\n', ctx(s));
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
		const head = s.g.head(s.thesis, 'main')!;
		expect(s.g.commit(s.thesis, head)!.parents).toEqual([theirs]);
		expect(fileOnGitHub(s, 'main.tex')).toBe('A in Overtree\nb\nC on GitHub\n');
		expect(getLink(s.pid)).toMatchObject({ status: 'active', baseCommit: head });
		expect(hasUnpushed(getLink(s.pid)!)).toBe(false);
		neverForced(s);
	});

	it('an empty repository gets the project: Contents API seed, then the rest in one commit', async () => {
		const g = fakeGitHub();
		const { url, stop } = await g.start();
		cleanup.push(stop);
		process.env.GITHUB_API_URL = url;
		process.env.GITHUB_URL = url;
		g.addUser({ login: 'ada', name: 'Ada', email: 'ada@example.com' });
		const inst = g.addInstallation({ account: 'ada' });
		const empty = g.addRepo({ name: 'empty', installation: inst.id });
		await start();
		const pid = project();
		const o = user().id;
		createEntry(pid, { kind: 'text', name: 'refs.bib', parentId: null }, o);
		await uploadFile(pid, null, 'logo.png', Buffer.from([1, 2, 3]), false, o);
		saveAccount(o, { token: g.userToken('ada'), expiresAt: Date.now() + 3600_000, refreshToken: '', refreshExpiresAt: Date.now() + 3600_000 }, { id: 1, login: 'ada' });
		await linkRepo(pid, o, { installationId: inst.id, repoId: empty.id, branch: 'main' });
		await confirmLink(pid, 'merge');
		const head = g.head(empty, 'main')!;
		expect([...g.files(empty, head).keys()].sort()).toEqual(['logo.png', 'main.tex', 'refs.bib']);
		const top = g.commit(empty, head)!;
		expect(top.parents).toHaveLength(1);
		expect(g.commit(empty, top.parents[0])!.parents).toEqual([]); // the seed
		expect(getLink(pid)).toMatchObject({ status: 'active', baseCommit: head });
	});
});

describe('restart (FR-023)', () => {
	it('unpushed changes at shutdown are pushed by startSync', async () => {
		const s = await setup();
		const start0 = s.g.head(s.thesis, 'main')!;
		await setText(s.main, 'written before the restart\n', ctx(s));
		flushHistory();
		await s.server.stop();
		await start(s.server.dataDir);
		await waitFor(() => s.g.head(s.thesis, 'main') !== start0, 3000);
		expect(fileOnGitHub(s, 'main.tex')).toBe('written before the restart\n');
		const last = getServer().db.select().from(githubRuns).all().at(-1);
		expect(last).toMatchObject({ kind: 'push', trigger: 'startup', result: 'pushed' });
	});
});

describe('commit message (R9)', () => {
	it('titles, body limit, renames and co-authors', () => {
		const many = Array.from({ length: 25 }, (_, i) => ({ op: 'M' as const, path: `f${String(i).padStart(2, '0')}.tex` }));
		const msg = commitMessage(many, [
			{ name: 'Ada', email: 'ada@example.com' },
			{ name: 'Nobody', email: null }
		]);
		const lines = msg.split('\n');
		expect(lines[0]).toBe('Update f00.tex and 24 more files');
		expect(lines.filter((l) => l.startsWith('M '))).toHaveLength(20);
		expect(msg).toContain('…and 5 more');
		expect(msg).toContain('Also edited by Nobody');
		expect(lines.at(-1)).toBe('Co-authored-by: Ada <ada@example.com>');
		expect(commitMessage([{ op: 'A', path: 'a.tex' }], []).split('\n')[0]).toBe('Update a.tex');
		expect(commitMessage([{ op: 'A', path: 'a.tex' }], [], ` ${'x'.repeat(100)} `).split('\n')[0]).toBe('x'.repeat(72));
		expect(
			commitMessage(
				[
					{ op: 'A', path: 'b/new.tex', sha: '1' },
					{ op: 'D', path: 'old.tex', sha: '1' }
				],
				[]
			)
		).toBe('Update b/new.tex\n\nR old.tex -> b/new.tex');
	});
});
