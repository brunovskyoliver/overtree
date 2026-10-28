import { expect, it } from 'vitest';
import { safeRedirect } from '../../src/lib/auth.svelte.ts';

it.each(['https://elsewhere.example', '//elsewhere.example', '/\\elsewhere.example', '/\t/elsewhere.example', '/\n/elsewhere.example', '/\r/elsewhere.example'])('sign-in refuses an external or browser-normalized redirect: %j', (target) => {
	expect(safeRedirect(target)).toBe('/');
	expect(new URL(safeRedirect(target), 'https://overtree.example').origin).toBe('https://overtree.example');
});

it('preserves a project path, query and fragment', () => {
	expect(safeRedirect('/project/one?file=intro.tex#section-2')).toBe('/project/one?file=intro.tex#section-2');
});
