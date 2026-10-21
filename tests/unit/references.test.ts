import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanBib } from '../../src/lib/completion/scan.ts';
import {
	baseKey,
	BibIndex,
	firstSurname,
	formatEntry,
	freeKey,
	identities,
	keyProblem,
	parseEntries,
	parseIdentifier,
	withKey
} from '../../src/lib/references/bibtex.ts';
import { createEntry, getMainFileId, getText, listFiles, setText } from '../../src/lib/server/files.ts';
import { allowedHosts } from '../../src/lib/server/references/fetch.ts';
import { arxivEntry, lookup } from '../../src/lib/server/references/lookup.ts';
import { addEntries, prepareEntries, referenceContext } from '../../src/lib/server/references/project.ts';
import { getServer } from '../../src/lib/server/collab.ts';
import { connectZotero, searchZotero, zoteroAccount } from '../../src/lib/server/references/zotero.ts';
import { memberships, zoteroAccounts } from '../../src/lib/server/schema.ts';
import * as refsRoute from '../../src/routes/api/projects/[pid]/references/+server.ts';
import * as lookupRoute from '../../src/routes/api/projects/[pid]/references/lookup/+server.ts';
import * as accountRoute from '../../src/routes/api/zotero/account/+server.ts';
import { fakeRefs, refsEnv, ZOTERO } from '../fake-refs/server.ts';
import { cleanup, connect, ev, hit, json, OWNER, project, start, user, waitFor } from './helpers.ts';

// 017 References: BibTeX keys, de-duplication, arXiv Atom → BibTeX, lookups against tests/fake-refs, the insert
// through Yjs and the Zotero connection.

const ENV_KEYS = ['DOI_URL', 'ARXIV_API_URL', 'ZOTERO_API_URL'];
afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
});

async function fake() {
	const f = fakeRefs();
	const { url, stop } = await f.start();
	cleanup.push(stop);
	Object.assign(process.env, refsEnv(url));
	return { f, url };
}

/** The FileError status and message of a rejected promise. */
async function rejection(p: Promise<unknown>) {
	try {
		await p;
	} catch (e) {
		return { status: (e as { status?: number }).status, message: (e as Error).message };
	}
	throw new Error('expected a rejection');
}

describe('BibTeX parsing and formatting', () => {
	it('reads braced, quoted and bare values, nested braces and Crossref one-liners', () => {
		const [e] = parseEntries(' @article{Smith_2021, title={Deep {L}earning}, author="Smith, Jane", year=2021, month=mar, DOI={10.1/x} }');
		expect(e).toEqual({
			type: 'article',
			key: 'Smith_2021',
			fields: [
				{ name: 'title', value: 'Deep {L}earning', bare: false },
				{ name: 'author', value: 'Smith, Jane', bare: false },
				{ name: 'year', value: '2021', bare: true },
				{ name: 'month', value: 'mar', bare: true },
				{ name: 'doi', value: '10.1/x', bare: false }
			]
		});
		expect(formatEntry(e)).toBe(
			'@article{Smith_2021,\n  title = {Deep {L}earning},\n  author = {Smith, Jane},\n  year = 2021,\n  month = mar,\n  doi = {10.1/x}\n}'
		);
	});

	it('skips @string, @comment, keyless entries and commented-out lines; formatted output scans back', () => {
		const text = '@string{j = "J"}\n@comment{x}\n% @book{gone, title={x}}\n@misc{ok, title={T}}\n@misc{, title={no key}}';
		const entries = parseEntries(text);
		expect(entries.map((e) => e.key)).toEqual(['ok']);
		expect(scanBib(formatEntry(entries[0]))).toEqual([{ key: 'ok', title: 'T' }]);
	});

	it('withKey swaps the key of a formatted entry', () => {
		expect(withKey('@article{old,\n  title = {T}\n}', 'new2020')).toBe('@article{new2020,\n  title = {T}\n}');
	});
});

describe('keys', () => {
	const entry = (fields: Record<string, string>) => ({ type: 'article', key: 'x', fields: Object.entries(fields).map(([name, value]) => ({ name, value, bare: false })) });

	it('authorYEARword from the first author, year and first significant title word', () => {
		expect(baseKey(entry({ author: 'Smith, Jane and Doe, John', title: 'Deep Learning for Typesetting', year: '2021' }))).toBe('smith2021deep');
		expect(baseKey(entry({ author: 'Jane Smith', title: 'The Art of Kerning', year: '2019' }))).toBe('smith2019art');
		expect(baseKey(entry({ author: 'M{\\"u}ller, J{\\"o}rg', title: 'On the {Kerning} of Ligatures', date: '2019-05-01' }))).toBe('muller2019kerning');
		expect(baseKey(entry({ author: '{World Health Organization}', title: 'A Report', year: '2020' }))).toBe('worldhealthorganization2020report');
		expect(baseKey(entry({ title: '$\\alpha$-Stable Processes' }))).toBe('anonstable');
		expect(baseKey(entry({ editor: 'Ångström, A.', title: 'Über Licht', year: '1850' }))).toBe('angstrom1850uber');
	});

	it('first surname handles "Last, First", "First Last" and braced organizations', () => {
		expect(firstSurname('Doe, John and Roe, Ann')).toBe('Doe');
		expect(firstSurname('Ludwig van Beethoven')).toBe('Beethoven');
		expect(firstSurname('{OpenAI} and Someone')).toBe('OpenAI');
	});

	it('a taken key gets a, b, … appended, case-insensitively', () => {
		expect(freeKey('smith2021deep', [])).toBe('smith2021deep');
		expect(freeKey('smith2021deep', ['Smith2021Deep'])).toBe('smith2021deepa');
		expect(freeKey('smith2021deep', ['smith2021deep', 'smith2021deepa'])).toBe('smith2021deepb');
	});

	it('refuses keys BibTeX can’t take', () => {
		expect(keyProblem('smith2021deep')).toBeNull();
		expect(keyProblem('a:b-c_d.e/f')).toBeNull();
		for (const bad of ['', 'a b', 'a,b', 'a{b', 'a%b', 'a#b', 'x'.repeat(101)]) expect(keyProblem(bad)).not.toBeNull();
	});
});

describe('identifiers and duplicates', () => {
	it('parses DOIs and arXiv ids in the forms people paste', () => {
		expect(parseIdentifier('10.1234/abc.def')).toEqual({ kind: 'doi', doi: '10.1234/abc.def' });
		expect(parseIdentifier(' https://doi.org/10.1234/ABC%2Fx ')).toEqual({ kind: 'doi', doi: '10.1234/ABC/x' });
		expect(parseIdentifier('doi:10.1000/182')).toEqual({ kind: 'doi', doi: '10.1000/182' });
		expect(parseIdentifier('https://dx.doi.org/10.1000/182.')).toEqual({ kind: 'doi', doi: '10.1000/182' });
		expect(parseIdentifier('2101.00001')).toEqual({ kind: 'arxiv', id: '2101.00001' });
		expect(parseIdentifier('arXiv:2101.00001v2')).toEqual({ kind: 'arxiv', id: '2101.00001v2' });
		expect(parseIdentifier('https://arxiv.org/abs/2101.00001')).toEqual({ kind: 'arxiv', id: '2101.00001' });
		expect(parseIdentifier('https://arxiv.org/pdf/2101.00001v1.pdf')).toEqual({ kind: 'arxiv', id: '2101.00001v1' });
		expect(parseIdentifier('hep-th/9901001')).toEqual({ kind: 'arxiv', id: 'hep-th/9901001' });
		expect(parseIdentifier('10.48550/arXiv.2101.00001')).toEqual({ kind: 'arxiv', id: '2101.00001' });
		for (const bad of ['', 'hello', 'https://example.com/10.1234/x', '11.1234/x']) expect(parseIdentifier(bad)).toBeNull();
	});

	it('finds the same work by DOI, arXiv eprint (any version) or link, whatever the key', () => {
		const index = new BibIndex();
		for (const e of parseEntries('@article{mine, doi={10.1234/DEEP.2021}}\n@misc{pre, eprint={2101.00001v1}, archivePrefix={arXiv}}'))
			index.add(e, 'refs.bib');
		const dup = (text: string) => index.duplicate(parseEntries(text)[0]);
		expect(dup('@article{other, doi={https://doi.org/10.1234/deep.2021}}')).toEqual({ key: 'mine', path: 'refs.bib' });
		expect(dup('@misc{x, eprint={2101.00001}}')).toEqual({ key: 'pre', path: 'refs.bib' });
		expect(dup('@misc{x, url={https://arxiv.org/abs/2101.00001v3}}')).toEqual({ key: 'pre', path: 'refs.bib' });
		expect(dup('@misc{x, doi={10.48550/arXiv.2101.00001}}')).toEqual({ key: 'pre', path: 'refs.bib' });
		expect(dup('@misc{x, doi={10.9999/other}}')).toBeNull();
		// no DOI or arXiv id: the same title (braces, case, accents aside) in the same year
		index.add(parseEntries('@book{knuth, title={The TeXbook}, year={1986}}')[0], 'refs.bib');
		expect(dup('@book{k, title={The {T}e{X}book}, year=1986}')).toEqual({ key: 'knuth', path: 'refs.bib' });
		expect(dup('@book{k, title={The TeXbook}, year=1984}')).toBeNull();
		expect(identities(parseEntries('@misc{x, eprint={1234.5678}, eprinttype={hal}}')[0])).toEqual([]);
	});

	it('prepare offers the existing key for a duplicate, else a free default key', () => {
		const index = new BibIndex();
		index.add(parseEntries('@article{smith2021deep, doi={10.9999/a}}')[0], 'refs.bib');
		const fresh = index.prepare(parseEntries('@article{K, author={Smith, J.}, title={Deep Nets}, year={2021}, doi={10.9999/b}}')[0]);
		expect(fresh).toMatchObject({ key: 'smith2021deepa', duplicate: null, title: 'Deep Nets', authors: 'Smith, J.', year: '2021' });
		expect(fresh.bibtex.startsWith('@article{smith2021deepa,\n')).toBe(true);
		expect(index.prepare(parseEntries('@article{K, doi={10.9999/A}}')[0])).toMatchObject({ key: 'smith2021deep', duplicate: { key: 'smith2021deep' } });
	});
});

describe('arXiv Atom → BibTeX', () => {
	const feed = (entry: string) => `<feed xmlns="http://www.w3.org/2005/Atom">${entry}</feed>`;

	it('makes @misc with eprint, archivePrefix and primaryClass; entities decoded, & escaped, whitespace folded', () => {
		const e = arxivEntry(
			feed(`<entry><id>http://arxiv.org/abs/2101.00001v2</id><published>2021-01-04T18:00:00Z</published>
			<title>Attention Is Mostly\n   What You Need &amp; More</title><author><name>Ada Lovelace</name></author><author><name>Alan Turing</name></author>
			<arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG" scheme="x"/></entry>`),
			'2101.00001'
		)!;
		expect(formatEntry(e)).toBe(
			[
				'@misc{2101.00001,',
				'  title = {Attention Is Mostly What You Need \\& More},',
				'  author = {Ada Lovelace and Alan Turing},',
				'  year = 2021,',
				'  eprint = {2101.00001},',
				'  archiveprefix = {arXiv},',
				'  primaryclass = {cs.LG},',
				'  url = {https://arxiv.org/abs/2101.00001}',
				'}'
			].join('\n')
		);
		expect(baseKey(e)).toBe('lovelace2021attention');
	});

	it('makes @article with journal and DOI when arXiv knows the published version', () => {
		const e = arxivEntry(
			feed(`<entry><id>http://arxiv.org/abs/2101.00002v1</id><published>2020-12-30T10:00:00Z</published><title>X</title>
			<author><name>Grace Hopper</name></author><arxiv:doi>10.1234/journal.5</arxiv:doi><arxiv:journal_ref>J. C. 5 (2021)</arxiv:journal_ref></entry>`),
			'2101.00002'
		)!;
		expect(e.type).toBe('article');
		expect(Object.fromEntries(e.fields.map((f) => [f.name, f.value]))).toMatchObject({ journal: 'J. C. 5 (2021)', doi: '10.1234/journal.5', year: '2020' });
	});

	it('is null for arXiv’s error entry and an empty feed', () => {
		expect(arxivEntry(feed('<entry><id>http://arxiv.org/api/errors#incorrect_id</id><title>Error</title></entry>'), 'x')).toBeNull();
		expect(arxivEntry(feed(''), 'x')).toBeNull();
	});
});

describe('lookups against the fake services', () => {
	it('DOI: content negotiation, Crossref one-liner parsed, the agency redirect followed', async () => {
		const { f } = await fake();
		const { entry, source } = await lookup('https://doi.org/10.1234/deep.2021');
		expect(source).toBe('doi');
		expect(baseKey(entry)).toBe('smith2021deep');
		expect(f.requests.at(-1)!.headers.accept).toContain('application/x-bibtex');
		const agency = await lookup('10.1234/agency');
		expect(baseKey(agency.entry)).toBe('muller2019kerning');
		expect(f.requests.map((r) => r.path)).toContain('/doi-agency/10.1234/agency');
	});

	it('DOI errors: not found, rate limited, a redirect off the allowlist, too large, nothing listening', async () => {
		const { f } = await fake();
		expect(await rejection(lookup('10.1234/missing'))).toMatchObject({ status: 404, message: expect.stringContaining('No DOI 10.1234/missing') });
		expect(await rejection(lookup('10.1234/limited'))).toMatchObject({ status: 429, message: expect.stringContaining('rate-limiting') });
		const before = f.requests.length;
		expect(await rejection(lookup('10.1234/evil'))).toMatchObject({ status: 502, message: expect.stringContaining('169.254.169.254') });
		expect(f.requests.length).toBe(before + 1); // the metadata address itself was never requested
		expect(await rejection(lookup('10.1234/huge'))).toMatchObject({ status: 502, message: expect.stringContaining('more data') });
		expect(await rejection(lookup('not an id'))).toMatchObject({ status: 400 });
		process.env.DOI_URL = 'http://127.0.0.1:1/doi';
		expect(await rejection(lookup('10.1234/deep.2021'))).toMatchObject({ status: 502, message: expect.stringContaining('Couldn’t reach doi.org') });
	});

	it('only the configured hosts and the DOI agencies are allowed', async () => {
		await fake();
		expect([...allowedHosts('doi')]).toContain('data.crossref.org');
		expect([...allowedHosts('arxiv')]).toHaveLength(1);
		delete process.env.DOI_URL;
		expect(allowedHosts('doi').has('doi.org')).toBe(true);
	});

	it('arXiv: an entry by id or link, not found, rate limited', async () => {
		await fake();
		const { entry, source } = await lookup('https://arxiv.org/abs/2101.00001v2');
		expect(source).toBe('arxiv');
		expect(entry).toMatchObject({ type: 'misc', key: '2101.00001' });
		expect(await rejection(lookup('2101.00003'))).toMatchObject({ status: 404 });
		expect(await rejection(lookup('2101.99999'))).toMatchObject({ status: 429 });
	});
});

describe('the project side', () => {
	const MAIN = '\\documentclass{article}\n\\begin{document}\nx\n\\bibliographystyle{plain}\n\\bibliography{refs,missing}\n\\end{document}\n';

	it('targets: loaded .bib first, then a loaded one to create, then the others; references.bib when there are none', async () => {
		await start();
		const pid = project();
		const me = user().id;
		expect((await referenceContext(pid, me)).targets).toEqual([{ fileId: null, path: 'references.bib', loaded: false }]);
		await setText(getMainFileId(pid)!, MAIN, { userId: me, projectId: pid });
		const refs = createEntry(pid, { kind: 'text', name: 'refs.bib', parentId: null }, me);
		const other = createEntry(pid, { kind: 'text', name: 'other.bib', parentId: null }, me);
		await setText(other.id, '@misc{taken, title={T}}', { userId: me, projectId: pid });
		expect(await referenceContext(pid, me)).toEqual({
			targets: [
				{ fileId: refs.id, path: 'refs.bib', loaded: true },
				{ fileId: null, path: 'missing.bib', loaded: true },
				{ fileId: other.id, path: 'other.bib', loaded: false }
			],
			keys: ['taken']
		});
	});

	it('appends through Yjs: live in an open editor, attributed in history, existing text kept', async () => {
		const { url } = await start();
		const pid = project();
		const me = user().id;
		const refs = createEntry(pid, { kind: 'text', name: 'refs.bib', parentId: null }, me);
		await setText(refs.id, '@misc{old, title={Old}}', { userId: me, projectId: pid });
		const editor = await connect(url, refs.id);
		const [prepared] = await prepareEntries(pid, parseEntries('@article{K, author={Smith, J.}, title={Deep}, year={2021}}'));
		const r = await addEntries(pid, me, { fileId: refs.id }, [prepared.bibtex]);
		expect(r).toEqual({ fileId: refs.id, path: 'refs.bib', keys: ['smith2021deep'], added: 1 });
		const want = '@misc{old, title={Old}}\n\n@article{smith2021deep,\n  author = {Smith, J.},\n  title = {Deep},\n  year = {2021}\n}\n';
		await waitFor(() => editor.text.toString() === want);
		expect(await getText(refs.id)).toBe(want);
	});

	it('skips works already in the project, renames clashing keys, creates the offered new file', async () => {
		await start();
		const pid = project();
		const me = user().id;
		await setText(getMainFileId(pid)!, MAIN, { userId: me, projectId: pid });
		const r = await addEntries(pid, me, { path: 'missing.bib' }, [
			'@article{smith2021deep, doi={10.9999/a}, title={A}}',
			'@article{smith2021deep, doi={10.9999/b}, title={B}}',
			'@article{again, doi={10.9999/A}}'
		]);
		expect(r.keys).toEqual(['smith2021deep', 'smith2021deepa', 'smith2021deep']);
		expect(r.added).toBe(2);
		const created = listFiles(pid).find((f) => f.name === 'missing.bib')!;
		expect(r.fileId).toBe(created.id);
		expect(parseEntries(await getText(created.id)).map((e) => e.key)).toEqual(['smith2021deep', 'smith2021deepa']);
		// all duplicates: nothing written
		expect(await addEntries(pid, me, { fileId: created.id }, ['@misc{z, doi={10.9999/b}}'])).toMatchObject({ keys: ['smith2021deepa'], added: 0 });
	});

	it('refuses bad input, unknown targets and paths it didn’t offer', async () => {
		await start();
		const pid = project();
		const me = user().id;
		const main = getMainFileId(pid)!;
		const s = async (target: object, entries: unknown) => (await rejection(addEntries(pid, me, target, entries))).status;
		expect(await s({ path: 'references.bib' }, [])).toBe(400);
		expect(await s({ path: 'references.bib' }, ['not bibtex'])).toBe(400);
		expect(await s({ path: 'references.bib' }, ['@misc{a, x={1}}\n@misc{b, x={2}}'])).toBe(400);
		expect(await s({ path: 'references.bib' }, ['@misc{a b, x={1}}'])).toBe(400);
		expect(await s({ path: '../etc/evil.bib' }, ['@misc{a, x={1}}'])).toBe(400);
		expect(await s({ fileId: main }, ['@misc{a, x={1}}'])).toBe(404); // main.tex is no .bib
		expect(await s({ fileId: 'nope' }, ['@misc{a, x={1}}'])).toBe(404);
	});

	it('routes: readers can’t look up or insert, editors can', async () => {
		const { db } = await start();
		await fake();
		const pid = project();
		user('reader@test.local');
		db.insert(memberships).values({ projectId: pid, userId: user('reader@test.local').id, role: 'reader', viaLink: false, createdAt: Date.now() }).run();
		const lookupEv = (email: string) => ({ ...ev(email, { pid }), url: new URL('http://x/?id=10.1234/deep.2021') });
		expect((await hit(lookupRoute.GET, lookupEv('reader@test.local'))).status).toBe(403);
		expect((await hit(refsRoute.GET, ev('reader@test.local', { pid }))).status).toBe(403);
		const post = (email: string) => ev(email, { pid }, json('POST', { path: 'references.bib', entries: ['@misc{a, title={A}}'] }));
		expect((await hit(refsRoute.POST, post('reader@test.local'))).status).toBe(403);
		const found = await hit(lookupRoute.GET, lookupEv(OWNER));
		expect(found).toMatchObject({ status: 200, body: { source: 'doi', entry: { key: 'smith2021deep', duplicate: null } } });
		expect(await hit(refsRoute.POST, post(OWNER))).toMatchObject({ status: 200, body: { keys: ['a'], added: 1, path: 'references.bib' } });
	});
});

describe('Zotero', () => {
	beforeEach(async () => {
		await start();
		await fake();
	});

	it('connects with a valid key, stores it sealed and never returns it', async () => {
		const me = user().id;
		expect(zoteroAccount(me)).toEqual({ connected: false });
		const res = await hit(accountRoute.PUT, ev(OWNER, {}, json('PUT', { userId: ZOTERO.userId, apiKey: ZOTERO.key })));
		expect(res).toEqual({ status: 200, body: { connected: true, userId: ZOTERO.userId, username: ZOTERO.username } });
		const row = getServer().db.select().from(zoteroAccounts).where(eq(zoteroAccounts.userId, me)).get()!;
		expect(row.apiKey.includes(Buffer.from(ZOTERO.key))).toBe(false);
		expect(JSON.stringify((await hit(accountRoute.GET, ev(OWNER, {}))).body)).not.toContain(ZOTERO.key);
	});

	it('refuses a wrong key, another user’s key and a key without library access', async () => {
		const me = user().id;
		const c = (userId: string, apiKey: string) => rejection(connectZotero(me, { userId, apiKey }));
		expect(await c(ZOTERO.userId, 'WrongKey0000000000000000')).toMatchObject({ status: 400, message: expect.stringContaining('doesn’t accept') });
		expect(await c('999', ZOTERO.key)).toMatchObject({ status: 400, message: expect.stringContaining('another Zotero user') });
		expect(await c(ZOTERO.userId, ZOTERO.noLibraryKey)).toMatchObject({ status: 400, message: expect.stringContaining('library') });
		expect(await c('abc', ZOTERO.key)).toMatchObject({ status: 400 });
		expect(zoteroAccount(me)).toEqual({ connected: false });
	});

	it('searches with the key in a header, never in the URL; notes left out; duplicates marked', async () => {
		const { f } = await fake();
		const me = user().id;
		const pid = project();
		await connectZotero(me, { userId: ZOTERO.userId, apiKey: ZOTERO.key });
		const all = await searchZotero(me, '');
		expect(all.map((h) => h.id)).toEqual(['AAAA1111', 'BBBB2222', 'CCCC3333']);
		const search = f.requests.at(-1)!;
		expect(search.path).toContain('/zotero/users/12345/items/top?');
		expect(search.path).toContain('include=data%2Cbibtex');
		expect(search.path).not.toContain(ZOTERO.key);
		expect(search.headers['zotero-api-key']).toBe(ZOTERO.key);
		expect((await searchZotero(me, 'knuth')).map((h) => h.id)).toEqual(['BBBB2222']);
		await addEntries(pid, me, { path: 'references.bib' }, ['@article{mine, doi={10.1234/deep.2021}}']);
		const prepared = await prepareEntries(pid, all.map((h) => h.entry));
		expect(prepared.map((p) => [p.key, p.duplicate?.key ?? null])).toEqual([
			['fruchterman1991graph', null],
			['knuth1986texbook', null],
			['mine', 'mine']
		]);
	});

	it('a revoked key is reported; disconnect deletes the key', async () => {
		const { f } = await fake();
		const me = user().id;
		await connectZotero(me, { userId: ZOTERO.userId, apiKey: ZOTERO.key });
		f.state.revoked = true;
		expect(await rejection(searchZotero(me, ''))).toMatchObject({ status: 409, message: expect.stringContaining('revoked') });
		expect((await hit(accountRoute.DELETE, ev(OWNER, {}))).status).toBe(204);
		expect(getServer().db.select().from(zoteroAccounts).all()).toEqual([]);
		expect(await rejection(searchZotero(me, ''))).toMatchObject({ status: 409, message: expect.stringContaining('Connect') });
	});

	it('seals with a random secret kept in the data dir, the same after a restart', async () => {
		const { dataDir } = getServer();
		await connectZotero(user().id, { userId: ZOTERO.userId, apiKey: ZOTERO.key });
		expect(readdirSync(dataDir)).toContain('secret.key');
		expect(readFileSync(join(dataDir, 'secret.key')).length).toBe(32);
		await start(dataDir); // a restart reopens the same directory
		expect((await searchZotero(user().id, 'knuth')).map((h) => h.id)).toEqual(['BBBB2222']);
	});
});
