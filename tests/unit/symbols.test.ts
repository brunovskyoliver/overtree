import { EditorState } from '@codemirror/state';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Symbols } from '../../src/lib/completion/symbols.svelte.ts';

const snapshot = (label: string) => ({ labels: [label], commands: [], environments: [], bibKeys: [], files: [] });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it('an older response cannot resurrect a label deleted from an open file', async () => {
	let finishOld!: (response: Response) => void;
	const fetch = vi.fn()
		.mockImplementationOnce(() => new Promise<Response>((resolve) => (finishOld = resolve)))
		.mockResolvedValueOnce(Response.json(snapshot('other-file')));
	vi.stubGlobal('fetch', fetch);
	const symbols = new Symbols('p');
	symbols.refresh();
	await vi.advanceTimersByTimeAsync(500);
	symbols.scan('open-file', false, EditorState.create({ doc: '' }));
	await vi.advanceTimersByTimeAsync(800);
	expect(symbols.labels).toEqual(['other-file']);
	finishOld(Response.json(snapshot('deleted-label')));
	await vi.advanceTimersByTimeAsync(0);
	expect(symbols.labels).toEqual(['other-file']);
	symbols.destroy();
});

it('leaving an editor cancels pending scans and requests', async () => {
	let signal!: AbortSignal;
	const fetch = vi.fn((_url: string, init: RequestInit) => {
		signal = init.signal!;
		return new Promise<Response>(() => {});
	});
	vi.stubGlobal('fetch', fetch);
	const symbols = new Symbols('p');
	symbols.refresh();
	await vi.advanceTimersByTimeAsync(500);
	symbols.scan('a', false, EditorState.create({ doc: '\\label{late}' }));
	symbols.refresh();
	symbols.destroy();
	await vi.advanceTimersByTimeAsync(1000);
	expect(signal.aborted).toBe(true);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(symbols.labels).toEqual([]);
});
