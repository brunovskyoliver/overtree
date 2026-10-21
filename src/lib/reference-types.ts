// Shapes of the references API (017 plan.md "Routes"), shared by the server and the browser.

/** A `.bib` the entries can go into; `fileId` null: created on the first insert (`path` is where). */
export type BibTarget = { fileId: string | null; path: string; loaded: boolean };

/** `GET /api/projects/:pid/references`: where entries can go (the first is the default) and the keys in use. */
export type ReferenceContext = { targets: BibTarget[]; keys: string[] };

/** One entry ready to insert: formatted BibTeX under a free key, or the key it already has in the project. */
export type PreparedEntry = {
	bibtex: string;
	key: string;
	title: string;
	authors: string;
	year: string;
	duplicate: { key: string; path: string } | null;
};

/** `GET /api/projects/:pid/references/lookup?id=`. */
export type LookupResult = { entry: PreparedEntry; source: 'doi' | 'arxiv' };

/** `GET /api/projects/:pid/references/zotero?q=`: one search hit; `id` is Zotero's item key. */
export type ZoteroItem = PreparedEntry & { id: string; itemType: string };

/** `GET /api/zotero/account`: never the API key. */
export type ZoteroAccountInfo = { connected: false } | { connected: true; userId: string; username: string };

/** `POST /api/projects/:pid/references`: the key of each entry in order (an existing one for duplicates). */
export type AddResult = { fileId: string; path: string; keys: string[]; added: number };
