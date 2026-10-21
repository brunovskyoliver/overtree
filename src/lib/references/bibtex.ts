// BibTeX entries for "Add reference" (017): parsing, the default key, de-duplication and identifier input.
// Shared by the browser (key edits in the preview) and the server (lookups, inserts). Plain erasable TypeScript:
// server.ts loads it unbundled.
import { delimited } from '../completion/scan.ts';

/** `bare`: written without braces (a number, a month macro like `jan`). */
export type Field = { name: string; value: string; bare: boolean };
export type Entry = { type: string; key: string; fields: Field[] };

const SPECIAL = /^(string|comment|preamble)$/i;

/** The value starting at `at` in `body`: braced, quoted or bare up to the next comma; `end` is after it. */
function value(body: string, at: number): { value: string; bare: boolean; end: number } {
	if (body[at] === '{' || body[at] === '"') {
		const d = delimited(body, at);
		return { value: d.value, bare: false, end: d.end };
	}
	const comma = body.indexOf(',', at);
	const end = comma < 0 ? body.length : comma;
	return { value: body.slice(at, end).trim(), bare: true, end };
}

/** Every regular entry of a BibTeX text (`@string`, `@comment`, `@preamble` and keyless ones skipped). */
export function parseEntries(text: string): Entry[] {
	// ponytail: only whole-line `%` comments, like scanBib
	const src = text.replace(/^[ \t]*%.*$/gm, '');
	const out: Entry[] = [];
	const AT = /@(\w+)\s*\{/g;
	for (let m; (m = AT.exec(src)); ) {
		const { value: body, end } = delimited(src, m.index + m[0].length - 1);
		AT.lastIndex = end;
		const head = /^\s*([^,\s{}]+)\s*,/.exec(body);
		if (SPECIAL.test(m[1]) || !head) continue;
		const fields: Field[] = [];
		let i = head[0].length;
		while (i < body.length) {
			const f = /^[\s,]*([\w:.+-]+)\s*=\s*/.exec(body.slice(i));
			if (!f) break;
			const v = value(body, i + f[0].length);
			fields.push({ name: f[1].toLowerCase(), value: v.value, bare: v.bare });
			i = v.end;
		}
		out.push({ type: m[1].toLowerCase(), key: head[1], fields });
	}
	return out;
}

export const field = (e: Entry, name: string) => e.fields.find((f) => f.name === name)?.value ?? '';

/** The entry as written into a `.bib`: one field per line, values in braces unless bare. */
export function formatEntry(e: Entry): string {
	const fields = e.fields.map((f) => `  ${f.name} = ${f.bare ? f.value : `{${f.value}}`}`);
	return `@${e.type}{${e.key},\n${fields.join(',\n')}\n}`;
}

/** A BibTeX text whose first entry has `key` instead of its own. */
export const withKey = (bibtex: string, key: string) => bibtex.replace(/^(\s*@\w+\s*\{\s*)[^,\s{}]*/, `$1${key}`);

/** What is wrong with a citation key, or null. BibTeX and biber choke on these characters. */
export function keyProblem(key: string): string | null {
	if (!key) return 'The key must not be empty.';
	if (key.length > 100) return 'The key must be at most 100 characters.';
	if (/[\s,{}"#%'()=\\~]/.test(key)) return 'The key must not contain spaces or , { } " # % \' ( ) = \\ ~';
	return null;
}

// --- the default key: authorYEARword ------------------------------------------------------------------------------

const STOP = new Set(
	'a an the on of in for and to with from by at is are as or via using toward towards about into its their your our we do does how what why when'.split(
		' '
	)
);

/** Lower-case ASCII letters and digits of a LaTeX-ish string: accents folded, commands and braces dropped. */
export const plain = (s: string) =>
	s
		.replace(/\\[a-zA-Z]+\s*|\\./g, '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');

/** The surname of the first author: `Smith, John`, `John Smith`, `{OpenAI}` (an organization, kept whole). */
export function firstSurname(authors: string): string {
	const first = authors.split(/\s+and\s+/i)[0]?.trim() ?? '';
	if (/^\{.*\}$/s.test(first) && delimited(first, 0).end === first.length) return first.slice(1, -1);
	if (first.includes(',')) return first.slice(0, first.indexOf(','));
	return first.match(/\{[^{}]*\}|\S+/g)?.at(-1) ?? '';
}

export const yearOf = (e: Entry) => /\d{4}/.exec(field(e, 'year') || field(e, 'date'))?.[0] ?? '';

/** `smith2021deep`: first author's surname, year, first significant title word. */
export function baseKey(e: Entry): string {
	const name = plain(firstSurname(field(e, 'author') || field(e, 'editor')));
	const words = field(e, 'title')
		.replace(/\$[^$]*\$/g, ' ')
		.split(/[\s\-–—/:]+/)
		.map(plain)
		.filter(Boolean);
	const word = words.find((w) => !STOP.has(w)) ?? '';
	return (name || 'anon') + yearOf(e) + word;
}

/** `base`, or with a, b, … z, then 2, 3, … appended until no key in `taken` matches (case-insensitively, like
 *  BibTeX). */
export function freeKey(base: string, taken: Iterable<string>): string {
	const used = new Set([...taken].map((k) => k.toLowerCase()));
	if (!used.has(base.toLowerCase())) return base;
	for (const c of 'abcdefghijklmnopqrstuvwxyz') if (!used.has(`${base}${c}`.toLowerCase())) return base + c;
	for (let n = 2; ; n++) if (!used.has(`${base}${n}`.toLowerCase())) return `${base}${n}`;
}

/** Title, authors and year for lists and previews, braces and extra spaces gone. */
export function summary(e: Entry) {
	const tidy = (s: string) => s.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
	return { title: tidy(field(e, 'title')), authors: tidy(field(e, 'author') || field(e, 'editor')), year: yearOf(e) };
}

// --- identifiers -------------------------------------------------------------------------------------------------

export type Identifier = { kind: 'doi'; doi: string } | { kind: 'arxiv'; id: string };

const DOI = /^(?:doi:\s*|https?:\/\/(?:dx\.|www\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i;
const ARXIV_ID = String.raw`(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?`;
const ARXIV = new RegExp(String.raw`^(?:arxiv:\s*|https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/)?${ARXIV_ID}(?:\.pdf)?\/?$`, 'i');
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;

const decode = (s: string) => {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
};

/** A DOI (`10.1234/x`, `doi:…`, a doi.org link) or an arXiv id (`2101.00001`, `arXiv:…`, an arxiv.org link) in what
 *  the user pasted, or null. arXiv's own DOIs (`10.48550/arXiv.…`) count as arXiv ids. */
export function parseIdentifier(input: string): Identifier | null {
	const s = input.trim();
	const arxiv = ARXIV.exec(s);
	if (arxiv) return { kind: 'arxiv', id: arxiv[1] + (arxiv[2] ?? '') };
	const doi = DOI.exec(s);
	if (!doi) return null;
	const d = decode(doi[1]).replace(/[.,;]+$/, '');
	const a = ARXIV_DOI.exec(d);
	return a && ARXIV.test(a[1]) ? { kind: 'arxiv', id: a[1] } : { kind: 'doi', doi: d };
}

/** What makes two entries the same work: `doi:<doi>` and `arxiv:<id without version>`, lower case, from the doi,
 *  eprint and url fields; for works without either (books, Zotero items without a DOI) the title in plain letters
 *  with the year. */
export function identities(e: Entry): string[] {
	const out = new Set<string>();
	const add = (id: Identifier | null) => {
		if (id?.kind === 'doi') out.add(`doi:${id.doi.toLowerCase()}`);
		if (id?.kind === 'arxiv') out.add(`arxiv:${id.id.replace(/v\d+$/, '').toLowerCase()}`);
	};
	add(parseIdentifier(field(e, 'doi')));
	const prefix = (field(e, 'archiveprefix') || field(e, 'eprinttype')).toLowerCase();
	const eprint = field(e, 'eprint');
	if (eprint && (prefix === 'arxiv' || !prefix)) add(parseIdentifier(`arXiv:${eprint}`));
	for (const url of field(e, 'url').split(/\s+/)) if (url) add(parseIdentifier(url));
	// ponytail: an exact title and year; "Title: subtitle" against "Title" or a typo slips through
	const title = plain(field(e, 'title'));
	if (title.length >= 8) out.add(`title:${title}:${yearOf(e)}`);
	return [...out];
}

/** Keys and identities of the entries already in a project, to find duplicates. */
export class BibIndex {
	readonly keys = new Map<string, string>(); // lower-case key → path of its file
	readonly ids = new Map<string, { key: string; path: string }>();

	add(e: Entry, path: string) {
		this.keys.set(e.key.toLowerCase(), path);
		for (const id of identities(e)) if (!this.ids.has(id)) this.ids.set(id, { key: e.key, path });
	}

	/** The existing entry for the same work, or null. */
	duplicate(e: Entry) {
		for (const id of identities(e)) {
			const hit = this.ids.get(id);
			if (hit) return hit;
		}
		return null;
	}

	/** `e` under its default key (made free), or the existing key when the work is already there. */
	prepare(e: Entry) {
		const duplicate = this.duplicate(e);
		const key = duplicate?.key ?? freeKey(baseKey(e), this.keys.keys());
		return { bibtex: formatEntry({ ...e, key }), key, ...summary(e), duplicate };
	}
}
