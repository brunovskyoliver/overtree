import { describe, expect, it } from 'vitest';
import { createEntry, getMainFileId, getText, setText } from '../../src/lib/server/files.ts';
import { closeVersion, lastVersion, listVersions } from '../../src/lib/server/history.ts';
import { memberships, overrides, type MemberRole } from '../../src/lib/server/schema.ts';
import { buildRegExp, describe as describeMatch, expand, lineStarts, matches, MATCH_CAP, type SearchOptions } from '../../src/lib/search.ts';
import * as searchRoute from '../../src/routes/api/projects/[pid]/search/+server.ts';
import * as replaceRoute from '../../src/routes/api/projects/[pid]/search/replace/+server.ts';
import { connect, ev, hit, json, OWNER, project, start, user, waitFor, type Started } from './helpers.ts';

// Project search and replace (014): the shared matcher, the search and replace routes, per-file roles, Yjs edits
// with their author in history, live delivery to an open editor.

const B = 'b@test.local';
const R = 'r@test.local';
const opts = (query: string, o: Partial<SearchOptions> = {}): SearchOptions => ({ query, caseSensitive: false, wholeWord: false, regex: false, ...o });
const all = (text: string, o: SearchOptions) => [...matches(text, buildRegExp(o) as RegExp)].map((m) => m[0]);

describe('matcher', () => {
	it('literal, case, whole word, regex', () => {
		expect(all('Foo foo food', opts('foo'))).toEqual(['Foo', 'foo', 'foo']);
		expect(all('Foo foo food', opts('foo', { caseSensitive: true }))).toEqual(['foo', 'foo']);
		expect(all('Foo foo food', opts('foo', { wholeWord: true }))).toEqual(['Foo', 'foo']);
		expect(all('a.b axb', opts('a.b'))).toEqual(['a.b']);
		expect(all('a.b axb', opts('a.b', { regex: true }))).toEqual(['a.b', 'axb']);
		expect(all('\\section{x} \\sections', opts('\\section', { wholeWord: true }))).toEqual(['\\section']);
		expect(all('über überall', opts('über', { wholeWord: true }))).toEqual(['über']);
	});

	it('skips empty matches and reports an invalid regex', () => {
		expect(all('ab\ncd', opts('^', { regex: true }))).toEqual([]);
		expect(all('aab', opts('a*', { regex: true }))).toEqual(['aa']);
		const bad = buildRegExp(opts('(', { regex: true }));
		expect(bad).toHaveProperty('error');
		expect((bad as { error: string }).error).toMatch(/group/i);
		expect(buildRegExp(opts(''))).toHaveProperty('error');
	});

	it('expands $-patterns in regex mode only', () => {
		const re = buildRegExp(opts('(\\w+)@(?<host>\\w+)', { regex: true })) as RegExp;
		const m = [...matches('mail me@home now', re)][0];
		expect(expand('$2:$1 [$&] $<host> $$ $9', m, true)).toBe('home:me [me@home] home $ $9');
		expect(expand('$1', m, false)).toBe('$1');
		const re2 = buildRegExp(opts('(a)', { regex: true })) as RegExp;
		expect(expand('$12', [...matches('a', re2)][0], true)).toBe('a2');
	});

	it('describes a match with its line and an excerpt', () => {
		const text = 'first\n' + 'x'.repeat(100) + ' needle ' + 'y'.repeat(100) + '\nlast';
		const re = buildRegExp(opts('needle')) as RegExp;
		const d = describeMatch(text, [...matches(text, re)][0], lineStarts(text));
		expect(d.line).toBe(2);
		expect(text.slice(d.from, d.to)).toBe('needle');
		expect(d.match).toBe('needle');
		expect(d.before.startsWith('…')).toBe(true);
		expect(d.after.endsWith('…')).toBe(true);
		expect(d.before.length).toBeLessThan(30);
	});
});

function member(server: Started, pid: string, email: string, role: MemberRole) {
	server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
}

async function setup() {
	const server = await start();
	const pid = project();
	const main = getMainFileId(pid)!;
	const owner = user().id;
	const chapters = createEntry(pid, { kind: 'folder', name: 'chapters', parentId: null }, owner);
	const intro = createEntry(pid, { kind: 'text', name: 'intro.tex', parentId: chapters.id }, owner).id;
	const bib = createEntry(pid, { kind: 'text', name: 'refs.bib', parentId: null }, owner).id;
	await setText(main, 'Alpha beta.\n\\input{chapters/intro}\nalpha again\n', { userId: owner, projectId: pid });
	await setText(intro, 'Intro: alpha and ALPHA.\n', { userId: owner, projectId: pid });
	await setText(bib, '@book{alpha2020}\n', { userId: owner, projectId: pid });
	member(server, pid, B, 'editor');
	member(server, pid, R, 'reader');
	return { server, pid, main, intro, bib };
}

const search = async (pid: string, email: string, qs: string) => {
	const e = ev(email, { pid });
	e.url = new URL(`http://x/?${qs}`);
	return hit(searchRoute.GET, e);
};
const replace = (pid: string, email: string, body: object) => hit(replaceRoute.POST, ev(email, { pid }, json('POST', body)));

describe('search route', () => {
	it('refuses a backtracking regex and still serves the next search', async () => {
		const { pid, main } = await setup();
		await setText(main, `${'a'.repeat(26)}!`, { userId: user().id, projectId: pid });
		const result = await search(pid, OWNER, new URLSearchParams({ q: '(a+)+$', regex: '1' }).toString());
		expect(result.status).toBe(400);
		const next = await search(pid, OWNER, 'q=!');
		expect(next.status).toBe(200);
		expect(next.body.total).toBe(1);
	});

	it('a regex timeout during replacement leaves the file untouched', async () => {
		const { pid, main } = await setup();
		const before = `${'a'.repeat(26)}!`;
		await setText(main, before, { userId: user().id, projectId: pid });
		const result = await replace(pid, OWNER, { q: '(a+)+$', regex: true, replacement: 'changed', fileId: main });
		expect(result.status).toBe(400);
		expect(await getText(main)).toBe(before);
	});

	it('finds matches in every text file, grouped by path, with per-file edit rights', async () => {
		const { server, pid, intro, main } = await setup();
		server.db.insert(overrides).values({ projectId: pid, userId: user(B).id, fileId: intro, role: 'reader' }).run();
		const r = await search(pid, B, 'q=alpha');
		expect(r.status).toBe(200);
		expect(r.body.files.map((f: { path: string }) => f.path)).toEqual(['chapters/intro.tex', 'main.tex', 'refs.bib']);
		expect(r.body.total).toBe(5);
		expect(r.body.truncated).toBe(false);
		const [i, m] = r.body.files;
		expect(i.canEdit).toBe(false); // the override
		expect(m.canEdit).toBe(true);
		expect(m.fileId).toBe(main);
		expect(m.matches.map((x: { line: number }) => x.line)).toEqual([1, 3]);

		const reader = await search(pid, R, 'q=alpha&case=1&word=1');
		expect(reader.body.files.flatMap((f: { matches: { match: string }[] }) => f.matches.map((x) => x.match))).toEqual(['alpha', 'alpha']);
		expect(reader.body.files.every((f: { canEdit: boolean }) => !f.canEdit)).toBe(true);
	});

	it('400 with the reason for an invalid regex; caps the matches', async () => {
		const { pid, main } = await setup();
		const bad = await search(pid, OWNER, 'q=(&regex=1');
		expect(bad.status).toBe(400);
		await setText(main, 'a '.repeat(MATCH_CAP + 10), { userId: user().id, projectId: pid });
		const r = await search(pid, OWNER, 'q=a&word=1');
		expect(r.body.total).toBe(MATCH_CAP);
		expect(r.body.truncated).toBe(true);
	});

	it('reads the live text of an open document', async () => {
		const { server, pid, intro } = await setup();
		const c = await connect(server.url, intro, B);
		c.text.insert(0, 'zeta ');
		await waitFor(() => !!server.hocuspocus.documents.get(intro)?.getText('content').toString().startsWith('zeta'));
		expect((await search(pid, OWNER, 'q=zeta')).body.total).toBe(1);
	});
});

describe('replace route', () => {
	it('one match, then all in a file; a stale match is a 409', async () => {
		const { pid, main } = await setup();
		const found = (await search(pid, OWNER, 'q=alpha')).body.files.find((f: { fileId: string }) => f.fileId === main);
		const second = found.matches[1].from;
		expect((await replace(pid, OWNER, { q: 'alpha', replacement: 'gamma', fileId: main, at: second })).body).toEqual({ replaced: 1, files: 1, skipped: 0 });
		expect(await getText(main)).toBe('Alpha beta.\n\\input{chapters/intro}\ngamma again\n');
		expect((await replace(pid, OWNER, { q: 'alpha', replacement: 'x', fileId: main, at: second })).status).toBe(409);
		expect((await replace(pid, OWNER, { q: 'a(\\w)', regex: true, replacement: '<$1>', fileId: main })).body.replaced).toBe(5);
		expect(await getText(main)).toBe('<l>pha beta.\n\\input{ch<p>ters/intro}\ng<m>ma <g><i>n\n');
	});

	it('project-wide: editable files only, read-only matches counted, one version attributed to the user, live in an open editor', async () => {
		const { server, pid, main, intro, bib } = await setup();
		server.db.insert(overrides).values({ projectId: pid, userId: user(B).id, fileId: bib, role: 'reader' }).run();
		closeVersion(pid, 'edit');
		const before = lastVersion(pid)!.id;
		const watcher = await connect(server.url, intro, OWNER);

		const r = await replace(pid, B, { q: 'alpha', replacement: 'omega' });
		expect(r.body).toEqual({ replaced: 4, files: 2, skipped: 1 });
		expect(await getText(main)).toBe('omega beta.\n\\input{chapters/intro}\nomega again\n');
		expect(await getText(bib)).toBe('@book{alpha2020}\n');
		await waitFor(() => watcher.text.toString() === 'Intro: omega and omega.\n');

		const v = lastVersion(pid)!;
		expect(v.id).toBeGreaterThan(before);
		const info = listVersions(pid, user(B).id).versions[0];
		expect(info.authors.map((a) => a.id)).toEqual([user(B).id]);
		expect(info.changed.map((c) => c.path).sort()).toEqual(['chapters/intro.tex', 'main.tex']);
	});

	it('reader: 403 on a file, nothing replaced project-wide; bad input is a 400', async () => {
		const { pid, main } = await setup();
		expect((await replace(pid, R, { q: 'alpha', replacement: 'x', fileId: main })).status).toBe(403);
		expect((await replace(pid, R, { q: 'alpha', replacement: 'x' })).body).toEqual({ replaced: 0, files: 0, skipped: 5 });
		expect((await replace(pid, OWNER, { q: '(', regex: true, replacement: 'x' })).status).toBe(400);
		expect((await replace(pid, OWNER, { q: 'alpha' })).status).toBe(400);
		expect((await replace(pid, OWNER, { q: 'alpha', replacement: 'x', at: 3 })).status).toBe(400);
	});
});
