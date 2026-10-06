<script lang="ts">
	import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
	import { defaultKeymap } from '@codemirror/commands';
	import { bracketMatching, foldGutter, foldKeymap, indentOnInput, StreamLanguage } from '@codemirror/language';
	import { stex } from '@codemirror/legacy-modes/mode/stex';
	import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
	import { EditorState } from '@codemirror/state';
	import {
		crosshairCursor,
		drawSelection,
		dropCursor,
		EditorView,
		highlightActiveLine,
		highlightActiveLineGutter,
		highlightSpecialChars,
		keymap,
		lineNumbers,
		rectangularSelection
	} from '@codemirror/view';
	import { HocuspocusProvider } from '@hocuspocus/provider';
	import { onMount } from 'svelte';
	import { PUBLIC_TEST_HOOKS } from '$app/env/public';
	import { yCollab, ySyncAnnotation, yUndoManagerKeymap } from 'y-codemirror.next';
	import * as Y from 'yjs';
	import { editorTheme } from '#lib/editor/theme.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import Toolbar from './Toolbar.svelte';

	let {
		editor = $bindable(),
		onLocalEdit,
		onCompile
	}: { editor?: EditorHandle; onLocalEdit?: () => void; onCompile?: () => void } = $props();

	// returning true makes CodeMirror preventDefault, so Mod-s doesn't open the browser's save dialog
	const compileKey = () => {
		onCompile?.();
		return true;
	};

	const STATUS_TEXT = { connecting: 'Connecting…', connected: 'Saved', disconnected: 'Offline' };
	let status = $state(STATUS_TEXT.connecting);
	let host: HTMLDivElement;

	onMount(() => {
		const doc = new Y.Doc();
		const ytext = doc.getText('content');
		const undoManager = new Y.UndoManager(ytext);
		const provider = new HocuspocusProvider({
			url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
			name: 'main.tex',
			document: doc
		});
		provider.on('status', ({ status: s }: { status: keyof typeof STATUS_TEXT }) => (status = STATUS_TEXT[s]));

		const view = new EditorView({
			parent: host,
			doc: ytext.toString(),
			extensions: [
				// codemirror's basicSetup minus history(): Y.UndoManager owns undo/redo
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightSpecialChars(),
				foldGutter(),
				drawSelection(),
				dropCursor(),
				EditorState.allowMultipleSelections.of(true),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				autocompletion(),
				rectangularSelection(),
				crosshairCursor(),
				highlightActiveLine(),
				highlightSelectionMatches(),
				// before defaultKeymap, which binds Mod-Enter to insertBlankLine
				keymap.of([
					{ key: 'Mod-Enter', run: compileKey },
					{ key: 'Mod-s', run: compileKey }
				]),
				keymap.of([
					...yUndoManagerKeymap,
					...closeBracketsKeymap,
					...defaultKeymap,
					...searchKeymap,
					...foldKeymap,
					...completionKeymap
				]),
				StreamLanguage.define(stex),
				editorTheme,
				EditorView.lineWrapping,
				yCollab(ytext, provider.awareness, { undoManager }),
				// remote Yjs changes carry ySyncAnnotation and don't count as the user's typing
				EditorView.updateListener.of((u) => {
					if (u.docChanged && !u.transactions.some((tr) => tr.annotation(ySyncAnnotation))) onLocalEdit?.();
				})
			]
		});
		view.focus();

		editor = { view, undoManager, provider };
		if (import.meta.env.DEV || PUBLIC_TEST_HOOKS) window.__overtree = editor;

		return () => {
			editor = undefined;
			delete window.__overtree;
			view.destroy();
			provider.destroy();
			undoManager.destroy();
			doc.destroy();
		};
	});
</script>

<section class="editor" aria-label="Editor">
	<div class="tabs">
		<div class="tab" aria-current="page">main.tex</div>
		<span class="badge" class:offline={status === STATUS_TEXT.disconnected} role="status">{status}</span>
	</div>
	<Toolbar {editor} />
	<div class="host" bind:this={host}></div>
</section>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--bg-editor);
	}
	.tabs {
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		height: 34px;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}
	.tab {
		display: flex;
		align-items: center;
		padding: 0 14px;
		background: var(--panel);
		border-top: 2px solid var(--accent-bright);
	}
	.badge {
		align-self: center;
		margin-right: 10px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.badge.offline {
		color: #f0b35a;
	}
	.host {
		flex: 1;
		min-height: 0;
	}
	.host :global(.cm-editor) {
		height: 100%;
	}
</style>
