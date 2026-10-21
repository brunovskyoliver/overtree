import { parseEntries, parseIdentifier, type Entry, type Field } from '../../references/bibtex.ts';
import { fail } from '../files.ts';
import { fetchText, refsConfig, statusError } from './fetch.ts';

// DOI and arXiv lookups (017 US1): doi.org content negotiation for BibTeX, the arXiv API's Atom feed turned into an
// entry here. Loaded unbundled by server.ts: no SvelteKit imports here.

/** The BibTeX entry doi.org has for `doi`. */
export async function lookupDoi(doi: string): Promise<Entry> {
	const path = doi.split('/').map(encodeURIComponent).join('/');
	const r = await fetchText('doi', `${refsConfig().doiUrl}/${path}`, { Accept: 'application/x-bibtex; charset=utf-8' });
	if (r.status === 404) fail(404, `No DOI ${doi} was found. Check it for typos.`);
	if (r.status === 406) fail(422, `The registry of ${doi} has no BibTeX for it.`);
	if (r.status !== 200) statusError('doi', r.status);
	const entry = parseEntries(r.text)[0];
	if (!entry) fail(422, `doi.org sent no BibTeX entry for ${doi}.`);
	// Crossref leaves the DOI out of some entries; it is what de-duplication goes by
	if (!entry.fields.some((f) => f.name === 'doi')) entry.fields.push({ name: 'doi', value: doi, bare: false });
	return entry;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) =>
	s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
			e[0] === '#' ? String.fromCodePoint(Number(e[1] === 'x' || e[1] === 'X' ? `0${e.slice(1)}` : e.slice(1))) : (ENTITIES[e] ?? m)
		);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A plain-text value safe inside braces in a .bib: a bare `&` or `%` would break the compile. */
const bibSafe = (s: string) => s.replace(/(?<!\\)([&%#])/g, '\\$1');

/** Text of the first `<tag>` (any namespace prefix kept as written) in `xml`, or ''. */
const tag = (xml: string, name: string) => unxml(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? '');
const attr = (xml: string, name: string, a: string) => unxml(new RegExp(`<${name}\\s[^>]*\\b${a}="([^"]*)"`).exec(xml)?.[1] ?? '');

/** The arXiv API's Atom answer for one id as an entry: `@article` when arXiv knows the published version (journal
 *  reference or DOI), else `@misc`, both with eprint, archivePrefix and primaryClass. Null when the feed has no
 *  such paper. */
export function arxivEntry(atom: string, requested: string): Entry | null {
	const entry = /<entry>([\s\S]*?)<\/entry>/.exec(atom)?.[1];
	if (!entry) return null;
	const idUrl = tag(entry, 'id');
	const title = oneLine(tag(entry, 'title'));
	// arXiv reports a bad id as an entry titled "Error" with an id under /api/errors
	if (!title || idUrl.includes('/api/errors')) return null;
	const id = /arxiv\.org\/abs\/(.+?)(v\d+)?$/.exec(idUrl)?.[1] ?? requested.replace(/v\d+$/, '');
	const authors = [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].map((m) => oneLine(tag(m[1], 'name'))).filter(Boolean);
	const year = /^\d{4}/.exec(tag(entry, 'published'))?.[0] ?? '';
	const journal = oneLine(tag(entry, 'arxiv:journal_ref'));
	const doi = oneLine(tag(entry, 'arxiv:doi'));
	const primary = attr(entry, 'arxiv:primary_category', 'term');
	const f = (name: string, value: string, bare = false): Field[] => (value ? [{ name, value, bare }] : []);
	return {
		type: journal || doi ? 'article' : 'misc',
		key: id,
		fields: [
			...f('title', bibSafe(title)),
			...f('author', bibSafe(authors.join(' and '))),
			...f('journal', bibSafe(journal)),
			...f('year', year, true),
			...f('eprint', id),
			...f('archiveprefix', 'arXiv'),
			...f('primaryclass', primary),
			...f('doi', doi),
			...f('url', `https://arxiv.org/abs/${id}`)
		]
	};
}

/** The entry for arXiv paper `id`. */
export async function lookupArxiv(id: string): Promise<Entry> {
	const r = await fetchText('arxiv', `${refsConfig().arxivUrl}?id_list=${encodeURIComponent(id)}&max_results=1`);
	if (r.status !== 200 && r.status !== 400) statusError('arxiv', r.status);
	const entry = r.status === 200 ? arxivEntry(r.text, id) : null;
	if (!entry) fail(404, `arXiv has no paper ${id}. Check the id for typos.`);
	return entry!;
}

/** The entry for whatever the user pasted: a DOI or an arXiv id or link. */
export async function lookup(input: string): Promise<{ entry: Entry; source: 'doi' | 'arxiv' }> {
	const id = parseIdentifier(input);
	if (!id) fail(400, 'Paste a DOI (10.xxxx/…, or a doi.org link) or an arXiv id or link.');
	return id!.kind === 'doi' ? { entry: await lookupDoi(id!.doi), source: 'doi' } : { entry: await lookupArxiv(id!.id), source: 'arxiv' };
}
