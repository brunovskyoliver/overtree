<script lang="ts">
	import {
		acceptCompletion,
		autocompletion,
		closeBrackets,
		closeBracketsKeymap,
		closeCompletion,
		completionKeymap,
		completionStatus,
		selectedCompletion
	} from '@codemirror/autocomplete';
	import { defaultKeymap, indentWithTab } from '@codemirror/commands';
	import { bracketMatching, foldGutter, foldKeymap, indentOnInput, StreamLanguage } from '@codemirror/language';
	import { stex } from '@codemirror/legacy-modes/mode/stex';
	import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
	import { Compartment, EditorState, Prec, type Extension, type StateCommand, type StateEffect } from '@codemirror/state';
	import {
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
	import { clearDocument, IndexeddbPersistence } from 'y-indexeddb';
	import { onMount } from 'svelte';
	import { PUBLIC_TEST_HOOKS } from '$app/env/public';
	import { auth, checkBlocked, getToken, onSignOut } from '#lib/auth.svelte.ts';
	import { yCollab, ySyncAnnotation, ySyncFacet, yUndoManagerKeymap } from 'y-codemirror.next';
	import * as Y from 'yjs';
	import { environments } from '#lib/completion/environments.ts';
	import { kindLabel, latexSource } from '#lib/completion/source.ts';
	import { Symbols } from '#lib/completion/symbols.svelte.ts';
	import { bold, italic } from '#lib/editor/commands.ts';
	import { prefs } from '#lib/editor/prefs.svelte.ts';
	import { colorScheme, cursorLabels, editorTheme } from '#lib/editor/theme.ts';
	import { followRemoteTyping, newlineBelow } from '#lib/editor/follow.ts';
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
		/** this device's copy (research: offline edits survive a closed tab); none for files the user can't edit */
		persistence: IndexeddbPersistence | null;
		/** local edits the server hasn't acknowledged yet */
		dirty: boolean;
		/** the device copy had text when the tab opened */
		local: boolean;
		savingTimer?: ReturnType<typeof setTimeout>;
	};

	const STATUS_TEXT = { connecting: 'Connecting…', connected: 'Saved', disconnected: 'Offline' };
	const testHooks = import.meta.env.DEV || PUBLIC_TEST_HOOKS;
	const tabs = new Map<string, Tab>(); // text tabs only; previews need no state
	let statuses = $state<Record<string, string>>({});
	// "Saving…" once local edits have waited a moment for the server, so quick round trips don't flicker
	let saving = $state<Record<string, boolean>>({});
	const SAVING_MS = 600;
	// IndexedDB name of a file's device copy
	const DB = 'overtree:';
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

	// Mod-b / Mod-i: the toolbar's Bold and Italic, their own undo step like the buttons
	const format = (cmd: StateCommand) => (v: EditorView) => {
		if (v.state.readOnly) return false;
		const undo = shown ? tabs.get(shown)?.undoManager : undefined;
		undo?.stopCapturing();
		cmd(v);
		undo?.stopCapturing();
		return true;
	};

	// Enter on a command already typed out in full (`\maketitle`): accepting would change nothing, so the popup
	// closes and Enter goes on to make the new line. A snippet (`\begin{itemize}` → its `\end`) is still accepted, and
	// so is a name inside braces (`\begin{proof2|}`), where a line break is never what's meant.
	const enterPastTyped = (v: EditorView) => {
		const c = completionStatus(v.state) === 'active' && selectedCompletion(v.state);
		if (!c || !c.label.startsWith('\\') || (c.apply !== undefined && c.apply !== c.label)) return false;
		const head = v.state.selection.main.head;
		if (v.state.sliceDoc(head - c.label.length, head) === c.label) closeCompletion(v);
		return false;
	};

	// svelte-ignore state_referenced_locally (the page is keyed on the project: `project` never changes here)
	const symbols = new Symbols(project.id);
	// LaTeX tabs get the stex mode plus \begin/\end support; completion checks the language itself
	// straight quotes are almost never right in LaTeX (``…''), so only brackets pair up
	const stexLanguage = StreamLanguage.define(stex);
	const latexExtensions: Extension = [stexLanguage, stexLanguage.data.of({ closeBrackets: { brackets: ['(', '[', '{'] } }), environments];
	const plainText: Extension = [];
	const language = new Compartment();
	// readOnly only, not editable(false): readers keep a caret, keyboard selection and Mod-a inside the document
	const locked: Extension = EditorState.readOnly.of(true);
	const unlocked: Extension = [];
	const editable = new Compartment();
	const spellOn: Extension = EditorView.contentAttributes.of({ spellcheck: 'true' });
	const spellOff: Extension = [];
	const spelling = new Compartment();
	// CodeMirror's dark or light base styles, after the app theme (018)
	const schemes = { dark: colorScheme('dark'), light: colorScheme('light') };
	const scheme = new Compartment();
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
		// above autocompletion's own Enter (same precedence, earlier wins)
		Prec.highest(keymap.of([{ key: 'Enter', run: enterPastTyped }])),
		autocompletion({
			override: [latexSource(symbols)],
			icons: false,
			addToOptions: [{ position: 90, render: kindLabel }],
			activateOnTyping: true,
			activateOnTypingDelay: 0 // the source is synchronous; the default 100 ms would miss SC-005
		}),
		// above the snippet keymap's Tab: with the popup open, Tab accepts
		Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
		// no crosshairCursor(): it flips the pointer whenever Option is held, which Mac writers do for – — and accents
		rectangularSelection(),
		highlightActiveLine(),
		// whole words of 3+ letters only: selecting "a" or "the" mid-word shouldn't light up the whole page
		highlightSelectionMatches({ wholeWords: true, minSelectionLength: 3 }),
		// before defaultKeymap, which binds Mod-Enter to insertBlankLine and Enter to insertNewlineAndIndent
		keymap.of([
			{ key: 'Mod-Enter', run: compileKey },
			{ key: 'Enter', run: newlineBelow },
			{ key: 'Mod-s', run: compileKey },
			{ key: 'Mod-b', run: format(bold) },
			{ key: 'Mod-i', run: format(italic) },
			// not ⌘⌥→: it switches tabs in some browsers (research R10)
			{ key: 'Mod-Alt-j', run: () => (onSyncForward?.(), true) }
		]),
		keymap.of([...undoKeys, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap, ...completionKeymap]),
		// Tab indents (after completion and snippet fields took theirs); Escape then Tab still leaves the editor
		keymap.of([indentWithTab]),
		editorTheme,
		cursorLabels,
		followRemoteTyping,
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
		const canEdit = project.files.find((f) => f.id === id)?.canEdit !== false;
		const persistence = canEdit ? new IndexeddbPersistence(DB + id, doc) : null;
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
				spelling.of(prefs.spellcheck ? spellOn : spellOff),
				scheme.of(schemes[prefs.theme]),
				yCollab(ytext, provider.awareness, { undoManager })
			]
		});
		const tab: Tab = { ytext, provider, persistence, undoManager, state, dirty: false, local: false };
		doc.on('update', (_: Uint8Array, origin: unknown) => origin !== provider && origin !== persistence && setDirty(id, tab, true));
		provider.on('unsyncedChanges', ({ number }: { number: number }) => number === 0 && setDirty(id, tab, false));
		// back as a reader with edits the server never took (spec edge case 1): they are rejected, so the tab starts
		// over from the server's text. A device copy may hold such edits from an earlier visit: dropped quietly.
		provider.on('authenticated', ({ scope }: { scope: string }) => {
			if (scope === 'readonly' && (tab.dirty || tab.local) && tabs.get(id) === tab) rebuild(id, tab.dirty);
		});
		identify(provider);
		// the device copy first, so its edits go out with the first sync; a broken IndexedDB doesn't hold the file up
		if (!persistence) provider.attach();
		else
			Promise.race([persistence.whenSynced, new Promise((r) => setTimeout(r, 1500))]).then(() => {
				if (tabs.get(id) !== tab) return;
				tab.local = ytext.length > 0;
				// the socket may have connected meanwhile: no status event comes for that
				statuses[id] = STATUS_TEXT[session.socket.status as keyof typeof STATUS_TEXT] ?? STATUS_TEXT.connecting;
				provider.attach();
			});
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

	function setDirty(id: string, tab: Tab, dirty: boolean) {
		tab.dirty = dirty;
		clearTimeout(tab.savingTimer);
		if (dirty) tab.savingTimer = setTimeout(() => tabs.get(id) === tab && (saving[id] = true), SAVING_MS);
		else if (tabs.get(id) === tab) saving[id] = false;
	}

	/** Start the tab over from the server's text; `notify`: tell the user their edits were dropped. */
	async function rebuild(id: string, notify: boolean) {
		const name = project.files.find((f) => f.id === id)?.name ?? '';
		await destroyTab(id, true);
		if (tabs.has(id) || !project.open.includes(id)) return;
		tabs.set(id, createTab(id, name));
		handleFor = null;
		if (notify) lostEdits = true;
		rebuilt++;
	}

	/** Close the tab's document; `forget` also deletes its device copy (the file is gone, or its edits were refused). */
	function destroyTab(id: string, forget = false): Promise<unknown> {
		const tab = tabs.get(id)!;
		tabs.delete(id);
		clearTimeout(tab.savingTimer);
		delete statuses[id];
		delete saving[id];
		symbols.forget(id);
		// unbind yCollab from the doc we're about to destroy
		if (shown === id) {
			view?.setState(EditorState.create());
			shown = null;
		}
		tab.provider.destroy();
		tab.undoManager.destroy();
		const closed = tab.persistence?.destroy() ?? Promise.resolve();
		tab.ytext.doc!.destroy();
		return forget ? closed.then(() => clearDocument(DB + id)).catch(() => {}) : closed;
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
		for (const id of [...tabs.keys()]) if (!textIds.includes(id)) destroyTab(id, !project.files.some((f) => f.id === id));
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
		const spell = prefs.spellcheck ? spellOn : spellOff;
		if (spelling.get(v.state) !== spell) v.dispatch({ effects: spelling.reconfigure(spell) });
		const colors = schemes[prefs.theme];
		if (scheme.get(v.state) !== colors) v.dispatch({ effects: scheme.reconfigure(colors) });
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

	// the font size is a CSS variable on the host: CodeMirror has to measure its lines again
	$effect(() => {
		void prefs.fontSize;
		view?.requestMeasure();
	});

	// signing out closes every provider of this tab right away, not only when the page unloads (US1 scenario 4), and
	// deletes this device's copies so the next person on the machine doesn't inherit them
	// ponytail: copies of files closed earlier go through indexedDB.databases(), best effort before the page leaves
	onMount(() =>
		onSignOut(() => {
			editor = undefined;
			for (const id of [...tabs.keys()]) destroyTab(id, true);
			indexedDB.databases?.().then((dbs) => dbs.forEach((d) => d.name?.startsWith(DB) && clearDocument(d.name)));
		})
	);

	// unsent edits: the browser asks before the tab closes (the device copy has them too, but IndexedDB writes are
	// asynchronous and the copy only comes back on this device)
	function onbeforeunload(e: BeforeUnloadEvent) {
		if ([...tabs.values()].some((t) => t.dirty)) e.preventDefault();
	}

	onMount(() => () => {
		editor = undefined;
		if (testHooks) delete window.__overtree;
		for (const id of [...tabs.keys()]) destroyTab(id);
		view?.destroy();
	});
</script>

<svelte:window {onbeforeunload} />

<section class="editor" aria-label="Editor">
	<!-- offline: the top bar's "Offline, reconnecting…" replaces the per-tab badge -->
	<EditorTabs
		{project}
		status={project.active && !session.offline
			? statuses[project.active] === STATUS_TEXT.connected && saving[project.active]
				? 'Saving…'
				: statuses[project.active]
			: undefined}
	/>
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
	<div class="host" bind:this={host} hidden={activeFile?.kind !== 'text'} style:--editor-font-size="{prefs.fontSize}px"></div>
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
		background: var(--danger-surface);
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
