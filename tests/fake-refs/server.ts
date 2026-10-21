// Fake doi.org, arXiv API and Zotero Web API for tests (017 plan.md "Tests"), one origin with a path prefix each:
// DOI_URL=<url>/doi, ARXIV_API_URL=<url>/arxiv, ZOTERO_API_URL=<url>/zotero. Seeded with fixed data; the special
// DOIs exercise redirects, a redirect off the allowlist, an oversized answer and rate limiting.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const ZOTERO = { userId: '12345', username: 'zuser', key: 'ZoteroKey0123456789abcdE', noLibraryKey: 'NoLibraryKey000000000000' };

export const DOIS: Record<string, string> = {
	// Crossref's style: one line, a leading space, bare month, the DOI in upper case
	'10.1234/deep.2021':
		' @article{Smith_2021, title={Deep Learning for Typesetting}, volume={12}, ISSN={1234-5678}, url={http://dx.doi.org/10.1234/deep.2021}, DOI={10.1234/deep.2021}, number={3}, journal={Journal of Typesetting}, publisher={Example Press}, author={Smith, Jane and Doe, John}, year={2021}, month=mar, pages={1–10} }',
	'10.1234/agency':
		'@inproceedings{M_ller_2019,\n  title={On the Kerning of Ligatures},\n  author={M{\\"u}ller, J{\\"o}rg},\n  booktitle={Proc. TypeCon},\n  year={2019},\n  doi={10.1234/agency}\n}'
};

const ATOM = (entry: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">\n<title type="html">ArXiv Query</title>\n${entry}\n</feed>\n`;

export const ARXIV: Record<string, string> = {
	'2101.00001': `<entry>
    <id>http://arxiv.org/abs/2101.00001v2</id>
    <updated>2021-02-01T00:00:00Z</updated>
    <published>2021-01-04T18:00:00Z</published>
    <title>Attention Is Mostly
      What You Need &amp; More</title>
    <summary>An abstract.</summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>`,
	'2101.00002': `<entry>
    <id>http://arxiv.org/abs/2101.00002v1</id>
    <published>2020-12-30T10:00:00Z</published>
    <title>Published Elsewhere</title>
    <author><name>Grace Hopper</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1234/journal.5</arxiv:doi>
    <arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">J. Compilers 5 (2021) 1-20</arxiv:journal_ref>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.PL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>`
};

const ARXIV_ERROR = `<entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format_for_9999.99999</id>
    <title>Error</title>
    <summary>incorrect id format for 9999.99999</summary>
  </entry>`;

type Item = { key: string; itemType: string; title: string; creators: string; year: string; bibtex: string };
export const ITEMS: Item[] = [
	{
		key: 'AAAA1111',
		itemType: 'journalArticle',
		title: 'Graph Drawing by Force-directed Placement',
		creators: 'Fruchterman and Reingold',
		year: '1991',
		bibtex:
			'\n@article{fruchterman_graph_1991,\n\ttitle = {Graph drawing by force-directed placement},\n\tvolume = {21},\n\tdoi = {10.1002/spe.4380211102},\n\tjournal = {Software: Practice and Experience},\n\tauthor = {Fruchterman, Thomas M. J. and Reingold, Edward M.},\n\tyear = {1991},\n\tpages = {1129--1164},\n}\n'
	},
	{
		key: 'BBBB2222',
		itemType: 'book',
		title: 'The TeXbook',
		creators: 'Knuth',
		year: '1986',
		bibtex: '\n@book{knuth_texbook_1986,\n\ttitle = {The {TeXbook}},\n\tpublisher = {Addison-Wesley},\n\tauthor = {Knuth, Donald E.},\n\tyear = {1986},\n}\n'
	},
	{
		key: 'CCCC3333',
		itemType: 'journalArticle',
		title: 'Deep Learning for Typesetting',
		creators: 'Smith and Doe',
		year: '2021',
		bibtex:
			'\n@article{smith_deep_2021,\n\ttitle = {Deep {Learning} for {Typesetting}},\n\tdoi = {10.1234/deep.2021},\n\tjournal = {Journal of Typesetting},\n\tauthor = {Smith, Jane and Doe, John},\n\tyear = {2021},\n}\n'
	},
	{ key: 'DDDD4444', itemType: 'note', title: 'A note', creators: '', year: '', bibtex: '' }
];

export type FakeRefsRequest = { path: string; headers: IncomingMessage['headers'] };

/** A fresh fake; `start(port)` (0: any) resolves to `{ url, stop }`. */
export function fakeRefs() {
	let url = '';
	const requests: FakeRefsRequest[] = [];
	const state = { revoked: false }; // as if the user deleted the key on zotero.org

	const send = (res: ServerResponse, status: number, body = '', headers: Record<string, string> = {}) => {
		res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
		res.end(body);
	};

	function doi(req: IncomingMessage, res: ServerResponse, doi: string) {
		if (!(req.headers.accept ?? '').includes('application/x-bibtex')) return send(res, 406);
		if (doi === '10.1234/agency') return send(res, 302, '', { location: `${url}/doi-agency/${doi}` });
		if (doi === '10.1234/evil') return send(res, 302, '', { location: 'http://169.254.169.254/latest/meta-data' });
		if (doi === '10.1234/huge') return send(res, 200, `@misc{x, note={${'x'.repeat(3 * 1024 * 1024)}}}`);
		if (doi === '10.1234/limited') return send(res, 429, 'Too many requests');
		const bib = DOIS[doi.toLowerCase()]; // DOIs are case-insensitive, doi.org too
		return bib ? send(res, 200, bib, { 'content-type': 'application/x-bibtex; charset=utf-8' }) : send(res, 404, 'DOI Not Found');
	}

	function zotero(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams) {
		const key = req.headers['zotero-api-key'];
		const json = (status: number, body: unknown) => send(res, status, JSON.stringify(body), { 'content-type': 'application/json' });
		if (path === '/keys/current') {
			if (key === ZOTERO.key) return json(200, { key, userID: Number(ZOTERO.userId), username: ZOTERO.username, access: { user: { library: true, files: true } } });
			if (key === ZOTERO.noLibraryKey) return json(200, { key, userID: Number(ZOTERO.userId), username: ZOTERO.username, access: { user: {} } });
			return send(res, 403, 'Invalid key');
		}
		const m = /^\/users\/(\d+)\/items\/top$/.exec(path);
		if (!m) return send(res, 404, 'Not found');
		if (key !== ZOTERO.key || state.revoked) return send(res, 403, 'Forbidden');
		if (m[1] !== ZOTERO.userId) return send(res, 404, 'Not found');
		const q = (query.get('q') ?? '').toLowerCase();
		const hits = ITEMS.filter((i) => !q || `${i.title} ${i.creators} ${i.year}`.toLowerCase().includes(q));
		const withBib = (query.get('include') ?? '').includes('bibtex');
		return json(
			200,
			hits.slice(0, Number(query.get('limit') ?? 25)).map((i) => ({
				key: i.key,
				version: 1,
				meta: { creatorSummary: i.creators, parsedDate: i.year },
				data: { key: i.key, itemType: i.itemType, title: i.title },
				...(withBib && { bibtex: i.bibtex })
			}))
		);
	}

	const server = createServer((req, res) => {
		const u = new URL(req.url ?? '/', 'http://x');
		requests.push({ path: `${u.pathname}${u.search}`, headers: req.headers });
		if (u.pathname === '/') return send(res, 200, 'fake refs');
		if (u.pathname.startsWith('/doi/')) return doi(req, res, decodeURIComponent(u.pathname.slice('/doi/'.length)));
		if (u.pathname.startsWith('/doi-agency/')) {
			const bib = DOIS[decodeURIComponent(u.pathname.slice('/doi-agency/'.length))];
			return bib ? send(res, 200, bib) : send(res, 404);
		}
		if (u.pathname === '/arxiv') {
			const id = (u.searchParams.get('id_list') ?? '').replace(/v\d+$/, '');
			if (id === '2101.99999') return send(res, 503, 'Rate exceeded');
			return send(res, 200, ATOM(ARXIV[id] ?? ARXIV_ERROR), { 'content-type': 'application/atom+xml' });
		}
		if (u.pathname.startsWith('/zotero/')) return zotero(req, res, u.pathname.slice('/zotero'.length), u.searchParams);
		send(res, 404);
	});

	return {
		requests,
		state,
		async start(port = 0) {
			await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
			url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			return {
				url,
				stop: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r())))
			};
		}
	};
}

/** The env that points Overtree at a fake on `url`. */
export const refsEnv = (url: string) => ({ DOI_URL: `${url}/doi`, ARXIV_API_URL: `${url}/arxiv`, ZOTERO_API_URL: `${url}/zotero` });
