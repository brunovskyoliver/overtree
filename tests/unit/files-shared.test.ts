import { describe, expect, it } from 'vitest';
import { isLatexName, kindForName, pathOf, sortEntries, validateName, type FileEntry } from '../../src/lib/files.ts';

describe('validateName (FR-003)', () => {
	it.each([
		['', 'empty'],
		['a/b.tex', '/'],
		['a\\b.tex', '\\'],
		['a\u0007b.tex', 'control char'],
		['tab\there', 'tab'],
		['.', 'dot'],
		['..', 'dot dot'],
		['x'.repeat(256), '256 chars']
	])('refuses %j (%s)', (name) => {
		expect(validateName(name, [])).toEqual(expect.any(String));
	});

	it('accepts 255 chars, dots inside and spaces', () => {
		expect(validateName('x'.repeat(255), [])).toBeNull();
		expect(validateName('.latexmkrc', [])).toBeNull();
		expect(validateName('my notes v1.2.tex', [])).toBeNull();
	});

	it('refuses a sibling name case-insensitively', () => {
		expect(validateName('Main.TEX', ['main.tex'])).toBe('"Main.TEX" already exists here.');
		expect(validateName('main.tex', ['other.tex'])).toBeNull();
	});
});

describe('kinds', () => {
	it('maps extensions case-insensitively', () => {
		expect(kindForName('refs.BIB')).toBe('text');
		expect(kindForName('analysis.R')).toBe('text');
		expect(kindForName('logo.png')).toBe('binary');
		expect(kindForName('Makefile')).toBe('binary');
		expect(isLatexName('thesis.cls')).toBe(true);
		expect(isLatexName('notes.md')).toBe(false);
	});
});

const entry = (id: string, name: string, kind: FileEntry['kind'], parentId: string | null = null): FileEntry => ({
	id,
	name,
	kind,
	parentId,
	updatedAt: 0
});

describe('paths and order', () => {
	it('builds the path from the parent chain', () => {
		const files = [entry('c', 'chapters', 'folder'), entry('p', 'parts', 'folder', 'c'), entry('i', 'intro.tex', 'text', 'p')];
		expect(pathOf('i', files)).toBe('chapters/parts/intro.tex');
		expect(pathOf('c', files)).toBe('chapters');
	});

	it('sorts folders first, then names ignoring case', () => {
		const files = [entry('1', 'b.tex', 'text'), entry('2', 'Z', 'folder'), entry('3', 'A.tex', 'text'), entry('4', 'a', 'folder')];
		expect(files.sort(sortEntries).map((f) => f.name)).toEqual(['a', 'Z', 'A.tex', 'b.tex']);
	});
});
