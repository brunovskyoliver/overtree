<script lang="ts">
	import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus } from '@codemirror/autocomplete';
	import { defaultKeymap } from '@codemirror/commands';
	import { bracketMatching, foldGutter, foldKeymap, indentOnInput, StreamLanguage } from '@codemirror/language';
	import { stex } from '@codemirror/legacy-modes/mode/stex';
	import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
	import { Compartment, EditorState, Prec, type Extension, type StateEffect } from '@codemirror/state';
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
		rectangularSelection,
		type ViewUpdate
	} from '@codemirror/view';
	import { HocuspocusProvider } from '@hocuspocus/provider';
	import { onMount } from 'svelte';
	import { PUBLIC_TEST_HOOKS } from '$app/env/public';
	import { checkBlocked, getToken, onSignOut } from '#lib/auth.svelte.ts';
	import { yCollab, ySyncAnnotation, ySyncFacet, yUndoManagerKeymap } from 'y-codemirror.next';
	import * as Y from 'yjs';
	import { environments } from '#lib/completion/environments.ts';
	import { kindLabel, latexSource } from '#lib/completion/source.ts';
	import { Symbols } from '#lib/completion/symbols.svelte.ts';
	import { editorTheme } from '#lib/editor/theme.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { isLatexName } from '#lib/files.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import EditorTabs from './EditorTabs.svelte';
	import FilePreview from './FilePreview.svelte';
	import Toolbar from './Toolbar.svelte';

	// One EditorView; each open text file keeps its own EditorState, Yjs doc, provider and undo (research R9).
	let {
		project,
		editor = $bindable(),
		onLocalEdit,
		onCompile
	}: { project: Project; editor?: EditorHandle; onLocalEdit?: () => void; onCompile?: () => void } = $props();

	type Tab = {
		ytext: Y.Text;
		provider: HocuspocusProvider;
		undoManager: Y.UndoManager;
		state: EditorState;
		scroll?: StateEffect<unknown>;
	};

	const STATUS_TEXT = { connecting: 'Connecting…', connected: 'Saved', disconnected: 'Offline' };
	const testHooks = import.meta.env.DEV || PUBLIC_TEST_HOOKS;
	const tabs = new Map<string, Tab>(); // text tabs only; previews need no state
	let statuses = $state<Record<string, string>>({});
	let shown: string | null = null; // the tab whose state is in the view
	let handleFor: string | null = null; // the tab `editor` points at
	let host: HTMLDivElement;
	let view: EditorView | undefined;

	const activeFile = $derived(project.files.find((f) => f.id === project.active));
	const latex = $derived(!!activeFile && isLatexName(activeFile.name));

	const listeners = new Set<(u: ViewUpdate) => void>();
	const listen = (fn: (u: ViewUpdate) => void) => (listeners.add(fn), () => void listeners.delete(fn));

	// returning true makes CodeMirror preventDefault, so Mod-s doesn't open the browser's save dialog
	const compileKey = () => {
		onCompile?.();
		return true;
	};

	// svelte-ignore state_referenced_locally (the page is keyed on the project: `project` never changes here)
	const symbols = new Symbols(project.id);
	// LaTeX tabs get the stex mode plus \begin/\end support; completion checks the language itself
	const latexExtensions: Extension = [StreamLanguage.define(stex), environments];
	const plainText: Extension = [];
	const language = new Compartment();

	// the same for every tab
	const shared: Extension = [
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
		autocompletion({
			override: [latexSource(symbols)],
			icons: false,
			addToOptions: [{ position: 90, render: kindLabel }],
			activateOnTyping: true,
			activateOnTypingDelay: 0 // the source is synchronous; the default 100 ms would miss SC-005
		}),
		// above the snippet keymap's Tab: with the popup open, Tab accepts
		Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
		rectangularSelection(),
		crosshairCursor(),
		highlightActiveLine(),
		highlightSelectionMatches(),
		// before defaultKeymap, which binds Mod-Enter to insertBlankLine
		keymap.of([
			{ key: 'Mod-Enter', run: compileKey },
			{ key: 'Mod-s', run: compileKey }
		]),
		keymap.of([...yUndoManagerKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap, ...completionKeymap]),
		editorTheme,
		EditorView.lineWrapping,
		EditorView.updateListener.of((u) => {
			// remote Yjs changes carry ySyncAnnotation and don't count as the user's typing
			if (u.docChanged && !u.transactions.some((tr) => tr.annotation(ySyncAnnotation))) onLocalEdit?.();
			if (u.docChanged && shown) symbols.scan(shown, !!project.files.find((f) => f.id === shown)?.name.toLowerCase().endsWith('.bib'), u.state);
			if (completionStatus(u.state) && !completionStatus(u.startState)) symbols.freshen();
			for (const fn of listeners) fn(u);
		})
	];

	function createTab(id: string, name: string): Tab {
		const doc = new Y.Doc();
		const ytext = doc.getText('content');
		const undoManager = new Y.UndoManager(ytext);
		// ponytail: one WebSocket per tab (provider.connect/disconnect keep working); share a
		// HocuspocusProviderWebsocket if people keep dozens of tabs open
		const provider = new HocuspocusProvider({
			url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
			name: id,
			document: doc,
			token: getToken // a fresh session token on every (re)connect (research R3)
		});
		statuses[id] = STATUS_TEXT.connecting;
		provider.on('status', ({ status }: { status: keyof typeof STATUS_TEXT }) => (statuses[id] = STATUS_TEXT[status]));
		// refused after a kick (4403): a disabled account goes to /blocked (T025)
		provider.on('authenticationFailed', checkBlocked);
		const state = EditorState.create({
			doc: ytext.toString(),
			extensions: [shared, language.of(isLatexName(name) ? latexExtensions : plainText), yCollab(ytext, provider.awareness, { undoManager })]
		});
		return { ytext, provider, undoManager, state };
	}

	function destroyTab(id: string) {
		const tab = tabs.get(id)!;
		tabs.delete(id);
		delete statuses[id];
		symbols.forget(id);
		// unbind yCollab from the doc we're about to destroy
		if (shown === id) {
			view?.setState(EditorState.create());
			shown = null;
		}
		tab.provider.destroy();
		tab.undoManager.destroy();
		tab.ytext.doc!.destroy();
	}

	function show(id: string, tab: Tab) {
		const v = (view ??= new EditorView({ parent: host }));
		const old = shown && tabs.get(shown);
		if (old) {
			old.state = v.state;
			old.scroll = v.scrollSnapshot();
		}
		v.setState(tab.state);
		shown = id;
		// yCollab only follows the Yjs text while its state is in the view: catch up on what came in meanwhile
		const text = tab.ytext.toString();
		if (v.state.doc.toString() !== text)
			v.dispatch({
				changes: { from: 0, to: v.state.doc.length, insert: text },
				selection: { anchor: Math.min(v.state.selection.main.head, text.length) },
				annotations: ySyncAnnotation.of(v.state.facet(ySyncFacet))
			});
		if (tab.scroll) v.dispatch({ effects: tab.scroll });
		v.focus();
	}

	// tabs follow project.open; the view and the handle follow project.active
	$effect(() => {
		const textIds = project.open.filter((id) => project.files.some((f) => f.id === id && f.kind === 'text'));
		for (const id of [...tabs.keys()]) if (!textIds.includes(id)) destroyTab(id);
		for (const id of textIds) if (!tabs.has(id)) tabs.set(id, createTab(id, project.files.find((f) => f.id === id)!.name));

		const id = project.active;
		const tab = id ? tabs.get(id) : undefined;
		if (!id || !tab) {
			handleFor = null;
			editor = undefined;
			if (testHooks) delete window.__overtree;
			return;
		}
		if (shown !== id) show(id, tab);
		const v = view!;
		// a rename can change the language
		const wanted = latex ? latexExtensions : plainText;
		if (language.get(v.state) !== wanted) v.dispatch({ effects: language.reconfigure(wanted) });
		if (handleFor !== id) {
			handleFor = id;
			editor = { view: v, undoManager: tab.undoManager, provider: tab.provider, fileId: id, listen };
			if (testHooks) window.__overtree = editor;
		}
	});

	// project symbols follow tree operations and tab switches
	$effect(() => {
		void [project.files, project.active];
		symbols.refresh();
	});

	// signing out closes every provider of this tab right away, not only when the page unloads (US1 scenario 4)
	onMount(() => onSignOut(() => (editor = undefined, [...tabs.keys()].forEach(destroyTab))));

	onMount(() => () => {
		editor = undefined;
		if (testHooks) delete window.__overtree;
		for (const id of [...tabs.keys()]) destroyTab(id);
		view?.destroy();
	});
</script>

<section class="editor" aria-label="Editor">
	<EditorTabs {project} status={project.active ? statuses[project.active] : undefined} />
	{#if activeFile?.kind === 'text' && latex}<Toolbar {editor} />{/if}
	<div class="host" bind:this={host} hidden={activeFile?.kind !== 'text'}></div>
	{#if activeFile && activeFile.kind !== 'text'}
		{#key activeFile.id}<FilePreview file={activeFile} url={project.rawUrl(activeFile)} />{/key}
	{:else if !activeFile}
		<p class="hint">Open a file from the file tree.</p>
	{/if}
</section>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--bg-editor);
	}
	.host {
		flex: 1;
		min-height: 0;
	}
	.host[hidden] {
		display: none;
	}
	.host :global(.cm-editor) {
		height: 100%;
	}
	.hint {
		margin: auto;
		color: var(--text-muted);
	}
</style>
