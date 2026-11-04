// Spell checking for English LaTeX files: the prose words (spelling/words.ts) against a Hunspell dictionary (nspell,
// US or British English from babel/polyglossia). A misspelt word gets a red wavy underline; its tooltip offers
// suggestions and "Add to dictionary" (kept per browser). Other languages keep the browser's own spell check;
// "Check spelling" in the editor settings switches both.
import { linter, type Diagnostic } from '@codemirror/lint';
import { Prec, type Extension, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import enAff from 'dictionary-en/index.aff?url';
import enDic from 'dictionary-en/index.dic?url';
import gbAff from 'dictionary-en-gb/index.aff?url';
import gbDic from 'dictionary-en-gb/index.dic?url';
import { LANG_NAMES, languageOf, proseWords, type Lang } from '../spelling/words.ts';
import { flash } from './flash.ts';
import { relint } from './lint.ts';
import { prefs } from './prefs.svelte.ts';

type Speller = { correct: (word: string) => boolean; suggest: (word: string) => string[] };

const DICTIONARIES: Record<Lang, [aff: string, dic: string]> = { en: [enAff, enDic], 'en-GB': [gbAff, gbDic] };
/** More would be noise, not help: a whole paragraph in another language. */
const MAX_MARKS = 1000;
const OWN_KEY = 'overtree:dictionary';

const loaded = new Map<Lang, Promise<Speller>>();
const text = (url: string) => fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${url}: ${r.status}`))));

/** The dictionary, fetched and loaded (about 40 ms) the first time it is needed. */
function dictionary(lang: Lang): Promise<Speller> {
	let d = loaded.get(lang);
	if (!d) {
		const [aff, dic] = DICTIONARIES[lang];
		loaded.set(lang, (d = Promise.all([import('nspell'), text(aff), text(dic)]).then(([{ default: nspell }, a, b]) => nspell(a, b))));
		d.catch(() => loaded.delete(lang)); // try again on the next run
	}
	return d;
}

/** Words the user added ("Add to dictionary"), in this browser. */
const own = new Set<string>(
	(() => {
		try {
			return JSON.parse(localStorage.getItem(OWN_KEY) ?? '[]') as string[];
		} catch {
			return []; // no storage (server, private mode): none
		}
	})()
);

/** The document's language: its preamble's, else the main document's (a chapter), else English; null: not English. */
function languageFor(doc: Text, main: () => string | undefined): Lang | null {
	const here = cachedLanguage(doc.sliceString(0, 20_000));
	if (here !== undefined) return here;
	const there = main();
	const lang = there === undefined ? undefined : cachedLanguage(there.slice(0, 20_000));
	return lang === undefined ? 'en' : lang;
}

let lastText = '';
let lastLang: Lang | null | undefined;
const cachedLanguage = (head: string) => (head === lastText ? lastLang : ((lastText = head), (lastLang = languageOf(head))));

async function check(view: EditorView, main: () => string | undefined): Promise<Diagnostic[]> {
	const lang = prefs.spellcheck ? languageFor(view.state.doc, main) : null;
	const spell = lang && (await dictionary(lang).catch(() => null));
	if (!lang || !spell) return []; // not English, switched off, or the dictionary didn't load: nothing marked
	return proseWords(view.state.doc.toString())
		.filter(({ word }) => !own.has(word) && !own.has(word.toLowerCase()) && !spell.correct(word))
		.slice(0, MAX_MARKS)
		.map(({ from, to, word }) => ({
			from,
			to,
			severity: 'hint',
			markClass: 'cm-spell',
			source: 'Spelling',
			message: `“${word}” isn’t in the ${LANG_NAMES[lang]} dictionary.`,
			renderMessage: (v) => tooltip(v, from, to, word, LANG_NAMES[lang], spell)
		}));
}

function tooltip(view: EditorView, from: number, to: number, word: string, dictionaryName: string, spell: Speller): Node {
	const box = document.createElement('div');
	box.className = 'cm-spell-message';
	box.appendChild(document.createElement('p')).textContent = `“${word}” isn’t in the ${dictionaryName} dictionary.`;
	const button = (label: string, run: () => void, cls = 'cm-spell-suggestion') => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = cls;
		b.textContent = label;
		b.onclick = run;
		return b;
	};
	const list = box.appendChild(document.createElement('div'));
	list.className = 'cm-spell-suggestions';
	const suggestions = spell.suggest(word).slice(0, 5);
	if (suggestions.length) list.append(...suggestions.map((s) => button(s, () => replace(view, from, to, word, s))));
	else list.textContent = 'No suggestions.';
	box.append(button('Add to dictionary', () => add(view, word), 'cm-spell-add'));
	return box;
}

/** The suggestion in place of the word, if it is still there; it blinks. */
function replace(view: EditorView, from: number, to: number, word: string, by: string) {
	if (view.state.readOnly || view.state.doc.sliceString(from, to) !== word) return;
	view.dispatch({ changes: { from, to, insert: by }, userEvent: 'spell' });
	flash(view, { from, to: from + by.length });
	view.focus();
}

function add(view: EditorView, word: string) {
	own.add(word);
	try {
		localStorage.setItem(OWN_KEY, JSON.stringify([...own]));
	} catch {
		// no storage: known for this page only
	}
	relint(view);
	view.focus();
}

/** For LaTeX files. `main`: the main document's text, for a file without a preamble (its language). */
export function spelling(main: () => string | undefined): Extension {
	return [
		linter((view) => check(view, main)), // not in the gutter: lint.ts
		// the browser's red underline too would mark every command; it stays for languages other than English
		Prec.highest(EditorView.contentAttributes.of((view) => (prefs.spellcheck && languageFor(view.state.doc, main) ? { spellcheck: 'false' } : null))),
		EditorView.baseTheme({
			'.cm-lintRange-hint.cm-spell': { textDecorationColor: 'var(--danger)', textDecorationStyle: 'wavy' },
			'.cm-diagnostic-hint:has(.cm-spell-message)': { borderLeftColor: 'var(--danger)' },
			'.cm-spell-message p': { margin: '0 0 6px' },
			'.cm-spell-suggestions': { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px', color: 'var(--text-muted)' },
			'.cm-spell-suggestion, .cm-spell-add': { padding: '2px 10px', border: '0', borderRadius: '4px', font: 'inherit', fontSize: '12px', cursor: 'pointer' },
			'.cm-spell-suggestion': { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
			'.cm-spell-add': { backgroundColor: 'transparent', color: 'var(--text-muted)', textDecoration: 'underline', padding: '0' }
		})
	];
}
