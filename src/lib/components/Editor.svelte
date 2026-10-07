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
	import { auth, checkBlocked, getToken, onSignOut } from '#lib/auth.svelte.ts';
	import { yCollab, ySyncAnnotation, ySyncFacet, yUndoManagerKeymap } from 'y-codemirror.next';
	import * as Y from 'yjs';
	import { environments } from '#lib/completion/environments.ts';
	import { kindLabel, latexSource } from '#lib/completion/source.ts';
	import { Symbols } from '#lib/completion/symbols.svelte.ts';
	import { cursorLabels, editorTheme } from '#lib/editor/theme.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { isLatexName } from '#lib/files.ts';
	import { lightColor } from '#lib/presence.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import type { Session } from '#lib/session.svelte.ts';
	import EditorTabs from './EditorTabs.svelte';
	import FilePreview from './FilePreview.svelte';
	import Toolbar from './Toolbar.svelte';

	// One EditorView; each open text file keeps its own EditorState, Yjs doc, provider and undo (research R9).
	let {
		project,
		session,
		editor = $bindable(),
		onLocalEdit,
		onCompile,
		onSyncForward
	}: {
		project: Project;
		session: Session;
		editor?: EditorHandle;
		onLocalEdit?: () => void;
		onCompile?: () => void;
		/** Ctrl/⌘+Alt+J: show the cursor's place in the PDF (SyncTeX) */
		onSyncForward?: () => void;
	} = $props();

	type Tab = {
		ytext: Y.Text;
		provider: HocuspocusProvider;
		undoManager: Y.UndoManager;
		state: EditorState;
		scroll?: StateEffect<unknown>;
		/** local edits the server hasn't acknowledged yet */
		dirty: boolean;
	};

	const STATUS_TEXT = { connecting: 'Connecting…', connected: 'Saved', disconnected: 'Offline' };
	const testHooks = import.meta.env.DEV || PUBLIC_TEST_HOOKS;
	const tabs = new Map<string, Tab>(); // text tabs only; previews need no state
	let statuses = $state<Record<string, string>>({});
	let shown: string | null = null; // the tab whose state is in the view
	let handleFor: string | null = null; // the tab `editor` points at
	let host: HTMLDivElement;
	let view: EditorView | undefined;
	let rebuilt = $state(0); // bumped when a tab is rebuilt from the server: the view effect runs again
	let lostEdits = $state(false);

	const activeFile = $derived(project.files.find((f) => f.id === project.active));
	const latex = $derived(!!activeFile && isLatexName(activeFile.name));
	// per-file edit right from the API (research R10); the server refuses edits anyway (R7)
	const readOnly = $derived(activeFile?.canEdit === false);

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
	const locked: Extension = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
	const unlocked: Extension = [];
	const editable = new Compartment();
	// Y.UndoManager changes the Yjs text directly, past CodeMirror's readOnly: no undo in a read-only file
	const undoKeys = yUndoManagerKeymap.map((b) => ({ ...b, run: (v: EditorView) => v.state.readOnly || b.run!(v) }));

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
			{ key: 'Mod-s', run: compileKey },
			// not ⌘⌥→: it switches tabs in some browsers (research R10)
			{ key: 'Mod-Alt-j', run: () => (onSyncForward?.(), true) }
		]),
		keymap.of([...undoKeys, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap, ...completionKeymap]),
		editorTheme,
		cursorLabels,
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
		// every document of the tab shares the session's socket (research R8)
		const provider = new HocuspocusProvider({
			websocketProvider: session.socket,
			name: id,
			document: doc,
			token: getToken // a fresh session token on every (re)connect (research R3)
		});
		statuses[id] = STATUS_TEXT[session.socket.status as keyof typeof STATUS_TEXT] ?? STATUS_TEXT.connecting;
		provider.on('status', ({ status }: { status: keyof typeof STATUS_TEXT }) => (statuses[id] = STATUS_TEXT[status]));
		// refused after a kick (4403): a disabled account goes to /blocked (T025)
		provider.on('authenticationFailed', checkBlocked);
		const state = EditorState.create({
			doc: ytext.toString(),
			extensions: [
				shared,
				language.of(isLatexName(name) ? latexExtensions : plainText),
				editable.of(unlocked),
				yCollab(ytext, provider.awareness, { undoManager })
			]
		});
		const tab: Tab = { ytext, provider, undoManager, state, dirty: false };
		doc.on('update', (_: Uint8Array, origin: unknown) => origin !== provider && (tab.dirty = true));
		provider.on('unsyncedChanges', ({ number }: { number: number }) => number === 0 && (tab.dirty = false));
		// back as a reader with edits the server never took (spec edge case 1): they are rejected, so the tab starts
		// over from the server's text
		provider.on('authenticated', ({ scope }: { scope: string }) => {
			if (scope === 'readonly' && tab.dirty && tabs.get(id) === tab) rebuild(id);
		});
		identify(provider);
		provider.attach();
		return tab;
	}

	/** Name and color on this tab's cursor for the others (research R8). */
	function identify(provider: HocuspocusProvider, me = auth.me) {
		if (me) provider.awareness!.setLocalStateField('user', { id: me.id, name: me.name, color: me.color, colorLight: lightColor(me.color) });
	}
	// tabs opened before /api/me answered
	$effect(() => {
		const me = auth.me;
		for (const tab of tabs.values()) identify(tab.provider, me);
	});

	function rebuild(id: string) {
		const name = project.files.find((f) => f.id === id)?.name ?? '';
		destroyTab(id);
		tabs.set(id, createTab(id, name));
		handleFor = null;
		lostEdits = true;
		rebuilt++;
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

		void rebuilt;
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
		const lock = readOnly ? locked : unlocked;
		if (editable.get(v.state) !== lock) v.dispatch({ effects: editable.reconfigure(lock) });
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
	<!-- offline: the top bar's "Offline, reconnecting…" replaces the per-tab badge -->
	<EditorTabs {project} status={project.active && !session.offline ? statuses[project.active] : undefined} />
	{#if lostEdits}
		<p class="notice lost" role="alert">
			Your changes could not be saved: you no longer have edit access
			<button type="button" aria-label="Dismiss" onclick={() => (lostEdits = false)}>×</button>
		</p>
	{/if}
	{#if activeFile && readOnly}
		<p class="notice">Read only: you can view and compile but not edit.</p>
	{/if}
	{#if activeFile?.kind === 'text' && latex}<Toolbar {editor} {readOnly} />{/if}
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
	.notice {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 5px 12px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
		color: var(--text-muted);
		font-size: 13px;
	}
	.notice.lost {
		background: #4a2a2a;
		color: var(--text);
	}
	.notice button {
		margin-left: auto;
		padding: 0 6px;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 16px;
		cursor: pointer;
	}
	.hint {
		margin: auto;
		color: var(--text-muted);
	}
</style>
