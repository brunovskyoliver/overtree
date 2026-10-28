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
	import type { Diagnostic } from '@codemirror/lint';
	import { Compartment, EditorState, Prec, Text, type Extension, type StateCommand, type StateEffect } from '@codemirror/state';
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
	import { addReferenceSource, kindLabel, latexSource } from '#lib/completion/source.ts';
	import { Symbols } from '#lib/completion/symbols.svelte.ts';
	import type { CompileResult, LogEntry } from '#lib/compile-types.ts';
	import { bold, figuresCommand, italic } from '#lib/editor/commands.ts';
	import { insertStep, latexPath, pickImages, refusedMessage, uploadFigures } from '#lib/editor/figures.ts';
	import { codeCheckDiagnostics, entryDiagnostic, entryRange, latexLint, relint } from '#lib/editor/lint.ts';
	import { prefs } from '#lib/editor/prefs.svelte.ts';
	import { referenceFor, usesBiblatex } from '#lib/media.ts';
	import { colorScheme, cursorLabels, editorTheme } from '#lib/editor/theme.ts';
	import { followRemoteTyping, newlineBelow } from '#lib/editor/follow.ts';
	import { trackChanges } from '#lib/editor/track.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { isLatexName } from '#lib/files.ts';
	import { lightColor } from '#lib/presence.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import type { Session } from '#lib/session.svelte.ts';
	import { changesOf, keepAnchors } from '#lib/track-changes.ts';
	import EditorTabs from './EditorTabs.svelte';
	import FilePreview from './FilePreview.svelte';
	import ReviewPanel from './ReviewPanel.svelte';
	import ReferenceDialog from './ReferenceDialog.svelte';
	import Toolbar from './Toolbar.svelte';

	// One EditorView; each open text file keeps its own EditorState, Yjs doc, provider and undo (research R9).
	let {
		project,
		session,
		editor = $bindable(),
		compiled,
		onLocalEdit,
		onCompile,
		onSyncForward,
		review = false,
		onreviewclose
	}: {
		project: Project;
		session: Session;
		editor?: EditorHandle;
		/** the shown compile result: its entries become markers in their files (016) */
		compiled?: CompileResult | null;
		onLocalEdit?: () => void;
		onCompile?: () => void;
		/** Ctrl/⌘+Alt+J: show the cursor's place in the PDF (SyncTeX) */
		onSyncForward?: () => void;
		/** the review panel (013) is open */
		review?: boolean;
		onreviewclose?: () => void;
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
	// "Add reference" (017) writes into the project's .bib files: editors and the owner only
	let references = $state<ReferenceDialog>();
	const canReference = $derived(!readOnly && project.details?.permissions.canEdit !== false);

	// Compile markers (016): each entry of the last compile anchored in its file's Yjs text, so markers move with
	// everyone's edits until the next compile replaces them. Built per file on first use after a compile.
	type Anchors = { compile: string; marks: { entry: LogEntry; start: Y.RelativePosition; end: Y.RelativePosition }[] };
	const anchors = new Map<string, Anchors>();

	function compileDiagnostics(id: string): Diagnostic[] {
		const tab = tabs.get(id);
		const result = compiled;
		if (!tab || !result) return [];
		let a = anchors.get(id);
		if (a?.compile !== result.id) {
			const entries = result.entries.filter((e) => e.fileId === id && e.line);
			// before the first sync the lines aren't known yet: built on the run after it
			if (entries.length && !tab.provider.isSynced) return [];
			const doc = Text.of(tab.ytext.toString().split('\n'));
			a = {
				compile: result.id,
				marks: entries.map((entry) => {
					const { from, to } = entryRange(doc, entry);
					return { entry, start: Y.createRelativePositionFromTypeIndex(tab.ytext, from), end: Y.createRelativePositionFromTypeIndex(tab.ytext, to, -1) };
				})
			};
			anchors.set(id, a);
		}
		const ydoc = tab.ytext.doc!;
		const length = tab.ytext.length;
		const at = (rel: Y.RelativePosition) => Math.min(Y.createAbsolutePositionFromRelativePosition(rel, ydoc)?.index ?? 0, length);
		return a.marks.map(({ entry, start, end }) => {
			const from = at(start);
			return entryDiagnostic(entry, from, Math.max(from, at(end)));
		});
	}

	/** Everything the shown document's markers come from: the code check (a .tex with it on) and the last compile. */
	function diagnostics(v: EditorView): Diagnostic[] {
		const id = shown;
		if (!id) return [];
		const name = project.files.find((f) => f.id === id)?.name.toLowerCase() ?? '';
		const check = prefs.codeCheck && name.endsWith('.tex') ? codeCheckDiagnostics(v.state.doc.toString()) : [];
		return [...check, ...compileDiagnostics(id)];
	}

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

	// --- images and project files into the text (feature 015) ------------------------------------

	let palette = $state(false); // the symbol palette under the toolbar
	let insertError = $state('');

	/** Upload `images` into figures/ and put a figure block for each at `pos` (kept through edits meanwhile, as a
	 *  Yjs position). ponytail: if the user switched tabs during the upload, the files stay uploaded and nothing is
	 *  inserted; the upgrade is writing the block into that tab's Y.Text. */
	async function insertFigures(images: File[], refused: string[], pos: number) {
		const h = editor;
		if (!h) return;
		const ytext = h.provider.document.getText('content');
		const anchor = Y.createRelativePositionFromTypeIndex(ytext, pos);
		insertError = refused.length ? refusedMessage(refused) : '';
		if (!images.length) return;
		const { figures, errors } = await uploadFigures(project, images);
		if (errors.length) insertError = [insertError, ...errors].filter(Boolean).join(' ');
		if (!figures.length) return;
		void project.addPackages(['graphicx']);
		const now = editor;
		if (!now || now.provider !== h.provider || now.view.state.readOnly) return;
		const at = Y.createAbsolutePositionFromRelativePosition(anchor, ytext.doc!)?.index ?? now.view.state.selection.main.head;
		now.view.dispatch({ selection: { anchor: Math.min(at, now.view.state.doc.length) } });
		insertStep(now, figuresCommand(figures));
		now.view.focus();
	}

	// a clipboard holding only images (a screenshot, "Copy image"): figures. With text too (Word, Excel put a picture
	// of the selection next to it) the text is pasted as usual.
	function onpaste(e: ClipboardEvent, v: EditorView) {
		const data = e.clipboardData;
		if (v.state.readOnly || !data?.files.length || data.getData('text/plain')) return false;
		const { images, refused } = pickImages([...data.files], true);
		if (!images.length && !refused.length) return false;
		e.preventDefault();
		insertFigures(images, refused, v.state.selection.main.head);
		return true;
	}

	const TREE_TYPE = 'application/x-overtree-id'; // set by FileTree.svelte's drag
	const ondragover = (e: DragEvent, v: EditorView) => {
		const types = e.dataTransfer?.types ?? [];
		if (!v.state.readOnly && (types.includes(TREE_TYPE) || types.includes('Files'))) e.preventDefault();
		return false; // dropCursor still shows where it lands
	};

	// a project file from the tree: a reference to it; images from the desktop: figures. Other desktop files keep
	// CodeMirror's own drop (their text is inserted).
	function ondrop(e: DragEvent, v: EditorView) {
		const data = e.dataTransfer;
		if (v.state.readOnly || !data) return false;
		const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
		const id = data.getData(TREE_TYPE);
		if (id) {
			e.preventDefault();
			const f = project.files.find((x) => x.id === id);
			// ponytail: biblatex is looked for in the open file only (usually the main document); the upgrade is the
			// main document's text from the server
			const ref = f && f.kind !== 'folder' ? referenceFor(latexPath(project, id), usesBiblatex(v.state.doc.toString())) : null;
			if (!ref || !editor) return true;
			insertStep(editor, ({ state, dispatch }) => {
				dispatch(state.update({ changes: { from: pos, insert: ref }, selection: { anchor: pos + ref.length }, userEvent: 'input.drop' }));
				return true;
			});
			if (ref.startsWith('\\includegraphics')) void project.addPackages(['graphicx']);
			v.focus();
			return true;
		}
		const { images, refused } = pickImages([...data.files], false);
		if (!images.length && !refused.length) return false;
		e.preventDefault();
		insertFigures(images, refused, pos);
		return true;
	}

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
		EditorView.contentAttributes.of({ 'aria-label': 'Source editor', tabindex: '0' }),
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
			override: [latexSource(symbols), addReferenceSource(() => references?.open())],
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
			{ key: 'Mod-Alt-j', run: () => (onSyncForward?.(), true) },
			{ key: 'Mod-Shift-y', run: (v) => (!v.state.readOnly && latex && (palette = !palette), true) }
		]),
		EditorView.domEventHandlers({ paste: onpaste, dragover: ondragover, drop: ondrop }),
		keymap.of([...undoKeys, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap, ...completionKeymap]),
		// Tab indents (after completion and snippet fields took theirs); Escape then Tab still leaves the editor
		keymap.of([indentWithTab]),
		editorTheme,
		cursorLabels,
		followRemoteTyping,
		EditorView.lineWrapping,
		latexLint(diagnostics),
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
		// the suggestions too (013): undoing a tracked edit takes its record back with it
		const undoManager = new Y.UndoManager([ytext, changesOf(doc)]);
		keepAnchors(undoManager, ytext);
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
				yCollab(ytext, provider.awareness, { undoManager }),
				// after yCollab: records an edit once its sync plugin has written it to ytext
				trackChanges(ytext, () => (project.details?.trackChanges && auth.me && canEdit ? { id: auth.me.id, name: auth.me.name, color: auth.me.color } : null))
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
		anchors.delete(id);
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
		relint(v);
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

	// a new compile result or the code check switched: the markers again (a tab synced later gets its own run
	// with its first changes)
	$effect(() => {
		void [compiled?.id, prefs.codeCheck];
		if (view) relint(view);
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
		symbols.destroy();
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
	{#if insertError}
		<p class="notice lost" role="alert">
			{insertError}
			<button type="button" aria-label="Dismiss" onclick={() => (insertError = '')}>×</button>
		</p>
	{/if}
	{#if activeFile?.kind === 'text' && latex}<Toolbar {editor} {readOnly} {project} bind:palette onreference={canReference ? () => references?.open() : undefined} />{/if}
	<div class="body" hidden={activeFile?.kind !== 'text'}>
		<div class="host" bind:this={host} style:--editor-font-size="{prefs.fontSize}px"></div>
		{#if review && activeFile?.kind === 'text'}
			<ReviewPanel {editor} canReview={!readOnly && project.details?.permissions.canEdit !== false} onclose={() => onreviewclose?.()} />
		{/if}
	</div>
	{#if activeFile && activeFile.kind !== 'text'}
		{#key activeFile.id}<FilePreview file={activeFile} url={project.rawUrl(activeFile)} />{/key}
	{:else if !activeFile}
		<p class="hint">Open a file from the file tree.</p>
	{/if}
	<!-- new keys reach \cite completion at once: the server's copy of the .bib counts, also when a tab of it is
	     open in the background (its live scan only runs while it is shown) -->
	<ReferenceDialog bind:this={references} {project} {editor} onadded={(r) => (symbols.forget(r.fileId), symbols.refresh())} />
</section>

<style>
	.editor {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--bg-editor);
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.body[hidden] {
		display: none;
	}
	.host {
		flex: 1;
		min-width: 0;
		min-height: 0;
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
	@container (max-width: 520px) {
		.body { flex-direction: column; }
	}
</style>
