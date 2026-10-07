import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getServer } from '../../src/lib/server/collab.ts';
import { createEntry, deleteEntry, getMainFileId, setText, uploadFile } from '../../src/lib/server/files.ts';
import { saveAccount } from '../../src/lib/server/github/accounts.ts';
import { confirmLink, getLink, linkRepo } from '../../src/lib/server/github/links.ts';
import { readBase } from '../../src/lib/server/github/paths.ts';
import { mergeText, REWRITTEN } from '../../src/lib/server/github/pull.ts';
import { hasUnpushed, requestSync } from '../../src/lib/server/github/sync.ts';
import { closeVersion, currentText, manifestPaths } from '../../src/lib/server/history.ts';
import { restoreVersion } from '../../src/lib/server/restore.ts';
import { files, githubRuns, memberships, versions } from '../../src/lib/server/schema.ts';
import { fakeGitHub, type FileMap } from '../fake-github/server.ts';
import { cleanup, connect, OWNER, project, start, user, waitFor } from './helpers.ts';

// 012 US3 "GitHub changes flow back into Overtree" against the fake GitHub (T035): diff3 merges into live documents,
// overlap markers, tree changes, kept files, the workflow's PDF commits, `github` versions, rewritten history.

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
const PARAS = ['First paragraph.', 'Second paragraph.', 'Third paragraph.', 'Fourth paragraph.', 'Fifth paragraph.', 'Sixth paragraph.'];
const DOC = PARAS.map((p) => `${p}\n`).join('\n');

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
	for (const k of [...Object.keys(ENV), ...EXTRA]) delete process.env[k];
});

/** Fake GitHub with `ada/thesis` (main.tex, the CI workflow, its main.pdf and `extra`), a project owned by OWNER with
 *  editor B, linked and confirmed; then main.tex set to DOC and pushed, so both sides start from DOC. */
async function setup(opts: { before?: (pid: string) => unknown | Promise<unknown>; extra?: FileMap } = {}) {
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
		files: { 'main.tex': 'from GitHub\n', [WORKFLOW]: 'on: push\n', 'main.pdf': '%PDF workflow output', ...opts.extra }
	});
	const server = await start();
	const pid = project();
	const owner = user().id;
	server.db.insert(memberships).values({ projectId: pid, userId: user(B).id, role: 'editor', viaLink: false, createdAt: Date.now() }).run();
	saveAccount(owner, { token: g.userToken('ada'), expiresAt: Date.now() + 3600_000, refreshToken: '', refreshExpiresAt: Date.now() + 3600_000 }, { id: 1, login: 'ada' });
	await opts.before?.(pid);
	await linkRepo(pid, owner, { installationId: inst.id, repoId: thesis.id, branch: 'main' });
	await confirmLink(pid, 'merge');
	expect(getLink(pid)!.status).toBe('active');
	const main = getMainFileId(pid)!;
	await setText(main, DOC, { userId: owner, projectId: pid });
	expect((await requestSync(pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
	return { g, thesis, server, pid, owner, main };
}

type S = Awaited<ReturnType<typeof setup>>;

const fileOnGitHub = (s: S, path: string) => s.g.files(s.thesis, 'main').get(path)?.toString();
const ctx = (s: S, email = OWNER) => ({ userId: user(email).id, projectId: s.pid });
const pull = (s: S) => requestSync(s.pid, { kind: 'pull', trigger: 'manual' });
const githubVersions = (s: S) => s.server.db.select().from(versions).where(eq(versions.kind, 'github')).all();
/** The project's files as path → kind (folders included). */
function tree(s: S) {
	const rows = s.server.db.select().from(files).where(eq(files.projectId, s.pid)).all();
	const paths = manifestPaths(rows);
	return Object.fromEntries(rows.map((r) => [paths.get(r.id)!, r.kind]).sort(([a], [b]) => (a < b ? -1 : 1)));
}
const idOf = (s: S, name: string) => s.server.db.select().from(files).all().find((f) => f.name === name && f.projectId === s.pid)!.id;
const withPara = (i: number, text: string) => PARAS.map((p, j) => `${j === i ? text : p}\n`).join('\n');

describe('mergeText (R6)', () => {
	it('merges separate changes, keeps the trailing newline, marks overlaps', () => {
		expect(mergeText('a1\nb\nc\n', 'a\nb\nc\n', 'a\nb\nc2\n', 'abc1234')).toEqual({ text: 'a1\nb\nc2\n', overlap: false });
		expect(mergeText('a\nb', 'a\nb', 'a2\nb', 'abc1234')).toEqual({ text: 'a2\nb', overlap: false });
		expect(mergeText('x\nours\ny\n', 'x\nbase\ny\n', 'x\ntheirs\ny\n', 'abc1234')).toEqual({
			text: 'x\n% <<<<<<< Overtree\nours\n% ======= GitHub abc1234\ntheirs\n% >>>>>>>\ny\n',
			overlap: true
		});
		// same change on both sides is no overlap
		expect(mergeText('a\nsame\n', 'a\nb\n', 'a\nsame\n', 'abc1234')).toEqual({ text: 'a\nsame\n', overlap: false });
		// a conflict at the end without a final newline still closes its markers on lines of their own
		expect(mergeText('ours', 'base', 'theirs', 'abc1234').text).toBe('% <<<<<<< Overtree\nours\n% ======= GitHub abc1234\ntheirs\n% >>>>>>>\n');
	});
});

describe('text merges into live documents (US3 #1, #3, #4)', () => {
	it('typing in paragraph 1 while GitHub changes paragraph 5 → both kept, every copy converges (SC-004)', async () => {
		const s = await setup();
		const editor = await connect(s.server.url, s.main, B);
		const reader = await connect(s.server.url, s.main, OWNER);
		editor.text.insert(0, 'Typed ');
		s.g.commitFiles(s.thesis, 'main', { 'main.tex': withPara(4, 'Fifth paragraph, edited on GitHub.') }, { name: 'Grace', email: 'grace@example.com' }, 'Edit paragraph five');
		const pulling = pull(s);
		// keeps typing while the pull runs
		editor.text.insert(6, 'more ');
		expect((await pulling).result).toBe('pulled');
		editor.text.insert(0, '!');
		const want = `!Typed more ${withPara(4, 'Fifth paragraph, edited on GitHub.')}`;
		await waitFor(() => [editor.text, reader.text].every((t) => t.toString() === want) && currentText(s.main) === want);
		expect(getLink(s.pid)!.note).toBeNull();
		expect(getLink(s.pid)!.pendingPush).toBe(false);
	});

	it('a project opened after GitHub commits pulls on the presence connect (US3 #2)', async () => {
		const s = await setup();
		s.g.commitFiles(s.thesis, 'main', { 'main.tex': withPara(1, 'Second, from GitHub.') });
		await connect(s.server.url, `project:${s.pid}`, B);
		await waitFor(() => currentText(s.main).includes('Second, from GitHub.'));
		const run = s.server.db.select().from(githubRuns).all().at(-1);
		expect(run).toMatchObject({ kind: 'pull', trigger: 'open', result: 'pulled' });
	});

	it('the same lines changed on both sides → both kept between % markers, noted, pushed at the next session end (#4, H1)', async () => {
		const s = await setup();
		await setText(s.main, withPara(2, 'Third, Overtree.'), ctx(s, B));
		const theirs = s.g.commitFiles(s.thesis, 'main', { 'main.tex': withPara(2, 'Third, GitHub.') });
		expect((await pull(s)).result).toBe('pulled');
		const merged = withPara(2, `% <<<<<<< Overtree\nThird, Overtree.\n% ======= GitHub ${theirs.slice(0, 7)}\nThird, GitHub.\n% >>>>>>>`);
		expect(currentText(s.main)).toBe(merged);
		const link = getLink(s.pid)!;
		expect(JSON.parse(link.note!)).toMatchObject({ commit: theirs, files: [{ path: 'main.tex', reason: 'overlap' }] });
		expect(link.pendingPush).toBe(true);
		const v = githubVersions(s);
		expect(v).toHaveLength(1);
		expect(JSON.parse(v[0].source!).notes).toEqual([{ path: 'main.tex', reason: 'overlap' }]);

		// H1: even with every edit counted as pushed, the merge result differs from GitHub and goes up at session end
		const p = await connect(s.server.url, `project:${s.pid}`, OWNER);
		const { lastLog } = s.server.db.$client.prepare('select max(id) as lastLog from history_log').get() as { lastLog: number };
		s.server.db.$client.prepare('update github_links set watermark = ?').run(lastLog);
		expect(hasUnpushed(getLink(s.pid)!)).toBe(true);
		p.provider.destroy();
		await waitFor(() => s.g.head(s.thesis, 'main') !== theirs, 3000);
		expect(fileOnGitHub(s, 'main.tex')).toBe(merged);
		expect(s.g.commit(s.thesis, s.g.head(s.thesis, 'main')!)!.parents).toEqual([theirs]);
		expect(getLink(s.pid)!.pendingPush).toBe(false);
		expect(hasUnpushed(getLink(s.pid)!)).toBe(false);
	});
});

describe('tree changes (US3 #5, #6)', () => {
	it('GitHub adds, renames, moves and deletes; a deleted file edited in Overtree is kept; emptied folders go', async () => {
		const ids: Record<string, string> = {};
		const s = await setup({
			before: async (pid) => {
				const o = user().id;
				const old = createEntry(pid, { kind: 'folder', name: 'old', parentId: null }, o);
				for (const [name, parentId] of [
					['a.tex', null],
					['b.tex', old.id],
					['keep.tex', null]
				] as const) {
					const f = createEntry(pid, { kind: 'text', name, parentId }, o);
					await setText(f.id, `${name}\n`, { userId: o, projectId: pid });
					ids[name] = f.id;
				}
			}
		});
		await setText(ids['keep.tex'], 'edited in Overtree\n', ctx(s));
		s.g.commitFiles(s.thesis, 'main', {
			'new.tex': 'new on GitHub\n',
			'dir/deep/x.tex': 'deep\n',
			'a.tex': null,
			'moved/a2.tex': 'a.tex\n',
			'old/b.tex': null,
			'keep.tex': null,
			'img.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9])
		});
		expect((await pull(s)).result).toBe('pulled');
		expect(tree(s)).toEqual({
			dir: 'folder',
			'dir/deep': 'folder',
			'dir/deep/x.tex': 'text',
			'img.png': 'binary',
			'keep.tex': 'text',
			'main.tex': 'text',
			moved: 'folder',
			'moved/a2.tex': 'text',
			'new.tex': 'text'
		});
		expect(idOf(s, 'a2.tex')).toBe(ids['a.tex']); // a move, not delete + add
		expect(currentText(idOf(s, 'new.tex'))).toBe('new on GitHub\n');
		expect(currentText(ids['keep.tex'])).toBe('edited in Overtree\n');
		expect(JSON.parse(getLink(s.pid)!.note!).files).toEqual([{ path: 'keep.tex', reason: 'kept-deleted' }]);
		expect(getLink(s.pid)!.pendingPush).toBe(true);
		// a new document opens with GitHub's text
		const c = await connect(s.server.url, idOf(s, 'x.tex'), OWNER);
		expect(c.text.toString()).toBe('deep\n');
		// the kept file goes back up with the next push
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
		expect(fileOnGitHub(s, 'keep.tex')).toBe('edited in Overtree\n');
		expect(fileOnGitHub(s, 'moved/a2.tex')).toBe('a.tex\n');
		expect(getLink(s.pid)!.pendingPush).toBe(false);
	});

	it('an image changed on both sides → Overtree’s kept, noted, and pushed next (#6)', async () => {
		const ours = Buffer.from([1, 2, 3, 4]);
		const s = await setup({ before: (pid) => uploadFile(pid, null, 'fig.png', Buffer.from([1, 1, 1]), false, user().id) });
		await uploadFile(s.pid, null, 'fig.png', ours, true, s.owner);
		s.g.commitFiles(s.thesis, 'main', { 'fig.png': Buffer.from([9, 9, 9]) });
		await pull(s);
		const row = s.server.db.select().from(files).all().find((f) => f.name === 'fig.png')!;
		expect(row.size).toBe(4);
		expect(JSON.parse(getLink(s.pid)!.note!).files).toEqual([{ path: 'fig.png', reason: 'kept-binary' }]);
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
		expect(s.g.files(s.thesis, 'main').get('fig.png')!.equals(ours)).toBe(true);
	});

	it('an image changed only on GitHub is updated; an Overtree delete of a GitHub-edited file brings it back', async () => {
		const s = await setup({
			before: async (pid) => {
				await uploadFile(pid, null, 'fig.png', Buffer.from([1, 1, 1]), false, user().id);
				createEntry(pid, { kind: 'text', name: 'gone.tex', parentId: null }, user().id);
			}
		});
		deleteEntry(s.pid, idOf(s, 'gone.tex'), s.owner);
		s.g.commitFiles(s.thesis, 'main', { 'fig.png': Buffer.from([7, 7]), 'gone.tex': 'changed on GitHub\n' });
		await pull(s);
		expect(s.server.db.select().from(files).all().find((f) => f.name === 'fig.png')!.size).toBe(2);
		expect(currentText(idOf(s, 'gone.tex'))).toBe('changed on GitHub\n');
		expect(getLink(s.pid)!.note).toBeNull();
	});
});

describe('the workflow’s PDF commits (US3 #7, SC-005)', () => {
	it('20 rounds of push + workflow commit: nothing pulled, no notes, no github versions, PDFs untouched', async () => {
		const s = await setup({ before: (pid) => createEntry(pid, { kind: 'text', name: 'chapter.tex', parentId: null }, user().id) });
		const before = tree(s);
		const pulls = () => s.g.requests.filter((r) => r.method === 'GET' && r.path.includes('/git/blobs/')).length;
		const blobReads = pulls();
		for (let i = 0; i < 20; i++) {
			await setText(s.main, `${DOC}round ${i}\n`, ctx(s));
			expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
			s.g.commitFiles(s.thesis, 'main', { 'main.pdf': `%PDF main ${i}`, 'chapter.pdf': `%PDF chapter ${i}`, 'build/main.log': `log ${i}` }, undefined, 'Render PDFs');
			expect((await pull(s)).result).toBe('noop');
			expect(getLink(s.pid)!.baseCommit).toBe(s.g.head(s.thesis, 'main'));
		}
		expect(tree(s)).toEqual(before);
		expect(githubVersions(s)).toHaveLength(0);
		expect(getLink(s.pid)!.note).toBeNull();
		expect(pulls()).toBe(blobReads); // zero files downloaded
		expect(fileOnGitHub(s, 'main.pdf')).toBe('%PDF main 19');
		expect(fileOnGitHub(s, 'chapter.pdf')).toBe('%PDF chapter 19');
		expect(Object.keys(readBase(getLink(s.pid)!))).not.toContain('main.pdf');
	});
});

describe('history (US3 #8)', () => {
	it('a pull records a github version with the commits; restoring an earlier version works', async () => {
		const s = await setup();
		const before = closeVersion(s.pid, 'edit') ?? s.server.db.select().from(versions).all().at(-1)!;
		const c1 = s.g.commitFiles(s.thesis, 'main', { 'main.tex': withPara(3, 'Four by Grace.') }, { name: 'Grace', email: 'grace@example.com' }, 'Grace edits four\n\nbody');
		const c2 = s.g.commitFiles(s.thesis, 'main', { 'appendix.tex': 'appendix\n' }, { name: 'Linus', email: 'linus@example.com' }, 'Add appendix');
		await pull(s);
		const [v] = githubVersions(s);
		expect(JSON.parse(v.source!)).toEqual({
			commits: [
				{ sha: c2, author: 'Linus', message: 'Add appendix' },
				{ sha: c1, author: 'Grace', message: 'Grace edits four' }
			],
			notes: []
		});
		expect(JSON.parse(v.authors)).toEqual([]); // a system edit
		expect(JSON.parse(v.changed).map((c: { path: string }) => c.path).sort()).toEqual(['appendix.tex', 'main.tex']);
		// a pull that changes nothing records nothing
		await pull(s);
		expect(githubVersions(s)).toHaveLength(1);

		await restoreVersion(s.pid, before.id, s.owner);
		expect(currentText(s.main)).toBe(DOC);
		expect(tree(s)['appendix.tex']).toBeUndefined();
		expect((await requestSync(s.pid, { kind: 'push', trigger: 'manual' })).result).toBe('pushed');
		expect(fileOnGitHub(s, 'main.tex')).toBe(DOC);
		expect(fileOnGitHub(s, 'appendix.tex')).toBeUndefined();
	});
});

describe('rewritten history (edge case, T036)', () => {
	it('the branch force-pushed to an unrelated commit → the link goes back to pending', async () => {
		const s = await setup();
		const orphan = s.g.commitFiles(s.thesis, 'orphan', { 'main.tex': 'rewritten\n' });
		s.thesis.refs.set('main', orphan);
		const r = await pull(s);
		expect(r).toMatchObject({ result: 'failed', error: REWRITTEN });
		expect(getLink(s.pid)).toMatchObject({ status: 'pending', baseCommit: null, baseFiles: null, error: REWRITTEN });
		expect(currentText(s.main)).toBe(DOC);
		// confirming again works from the new head
		await confirmLink(s.pid, 'merge');
		expect(getLink(s.pid)!.status).toBe('active');
		expect(s.g.commit(s.thesis, s.g.head(s.thesis, 'main')!)!.parents).toEqual([orphan]);
		expect(getServer().db.select().from(githubRuns).all().some((x) => x.result === 'failed' && x.error === REWRITTEN)).toBe(true);
	});
});
