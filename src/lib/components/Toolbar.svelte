<script lang="ts">
	import { openSearchPanel } from '@codemirror/search';
	import type { StateCommand } from '@codemirror/state';
	import { bold, figuresCommand, italic, link, section, symbolCommand, tableCommand, type FigureSpec } from '#lib/editor/commands.ts';
	import { insertStep } from '#lib/editor/figures.ts';
	import { APPEARANCES, FONT_SIZES, prefs, type Appearance } from '#lib/editor/prefs.svelte.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { wordCount } from '#lib/editor/words.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import FigureDialog from './FigureDialog.svelte';
	import SymbolPalette from './SymbolPalette.svelte';
	import TableDialog from './TableDialog.svelte';

	// readOnly: the file can't be edited, every button that changes text is disabled (search stays).
	// palette: the symbol palette is open (Editor.svelte toggles it with Ctrl/Cmd+Shift+Y too)
	// onreference: opens "Add reference" (017); unset for people who can't edit the project
	let {
		editor,
		project,
		readOnly = false,
		palette = $bindable(false),
		onreference
	}: { editor?: EditorHandle; project: Project; readOnly?: boolean; palette?: boolean; onreference?: () => void } = $props();

	function run(action: (h: EditorHandle) => unknown) {
		if (!editor) return;
		action(editor);
		editor.view.focus();
	}

	// stopCapturing on both sides: the insertion is its own undo step and the next typing starts a new one
	const insert = (cmd: StateCommand) => run((h) => insertStep(h, cmd));

	let figureDialog: FigureDialog;
	let tableDialog: TableDialog;

	function insertFigure(figure: FigureSpec) {
		insert(figuresCommand([figure]));
		void project.addPackages(['graphicx']);
	}

	function insertTable(rows: number, cols: number) {
		insert(tableCommand(rows, cols));
		void project.addPackages(['booktabs']);
	}

	/** A palette symbol at the caret; `keep`: focus stays in the palette (keyboard use). */
	function insertSymbol(cmd: string, keep: boolean) {
		if (!editor || readOnly) return;
		insertStep(editor, symbolCommand(cmd));
		if (!keep) editor.view.focus();
	}

	function closePalette() {
		palette = false;
		editor?.view.focus();
	}

	const insertions: { label: string; cmd: StateCommand; icon: string; key?: string }[] = [
		{ label: 'Bold', key: 'B', cmd: bold, icon: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z' },
		{ label: 'Italic', key: 'I', cmd: italic, icon: 'M10 5h8M6 19h8M14 5l-4 14' },
		{ label: 'Section', cmd: section, icon: 'M5 5v14M13 5v14M5 12h8M17 10l2-1.5V19' },
		{
			label: 'Link',
			cmd: link,
			icon: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'
		}
	];

	// words in the open file, counted again a moment after typing stops
	const WORDS_MS = 300;
	let words = $state(0);
	$effect(() => {
		const h = editor;
		if (!h) return;
		words = wordCount(h.view.state.doc.toString());
		let timer: ReturnType<typeof setTimeout> | undefined;
		const stop = h.listen((u) => {
			if (!u.docChanged) return;
			clearTimeout(timer);
			timer = setTimeout(() => (words = wordCount(u.view.state.doc.toString())), WORDS_MS);
		});
		return () => (clearTimeout(timer), stop());
	});

	// the settings popover opens under its button (a native popover sits in the top layer, positioned by hand)
	let settingsButton: HTMLButtonElement;
	let settings: HTMLDivElement;
	function place(e: ToggleEvent) {
		if (e.newState !== 'open') return;
		const r = settingsButton.getBoundingClientRect();
		settings.style.top = `${r.bottom + 4}px`;
		settings.style.left = `${Math.max(8, r.right - settings.offsetWidth)}px`;
	}
</script>

<div class="toolbar" role="toolbar" aria-label="Formatting">
	<button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={readOnly} onclick={() => run((h) => h.undoManager.undo())}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
	</button>
	<button
		type="button"
		aria-label="Redo"
		title="Redo (Ctrl/Cmd+Shift+Z)"
		disabled={readOnly}
		onclick={() => run((h) => h.undoManager.redo())}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
	</button>
	<span class="separator" aria-hidden="true"></span>
	{#each insertions as { label, cmd, icon, key } (label)}
		<button type="button" aria-label={label} title={key ? `${label} (Ctrl/Cmd+${key})` : label} disabled={readOnly} onclick={() => insert(cmd)}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon} /></svg>
		</button>
	{/each}
	<button type="button" aria-label="Insert figure" title="Insert figure" aria-haspopup="dialog" disabled={readOnly} onclick={() => figureDialog.open()}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01" /></svg>
	</button>
	<button type="button" aria-label="Insert table" title="Insert table" aria-haspopup="dialog" disabled={readOnly} onclick={() => tableDialog.open()}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 10h16M4 14.5h16M10 5v14" /></svg>
	</button>
	<button
		type="button"
		aria-label="Symbols"
		title="Symbols (Ctrl/Cmd+Shift+Y)"
		aria-pressed={palette && !readOnly}
		disabled={readOnly}
		onclick={() => (palette ? closePalette() : (palette = true))}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h4.5v-2.2A6.5 6.5 0 1 1 14.5 16.8V19H19" /></svg>
	</button>
	<button type="button" aria-label="Add reference" title="Add reference (DOI, arXiv, Zotero)" disabled={readOnly || !onreference} onclick={onreference}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H17v14H7.5A2.5 2.5 0 0 0 5 19.5zM5 19.5A2.5 2.5 0 0 0 7.5 22H17M11 7v6M8 10h6" /></svg>
	</button>
	<span class="words" aria-live="off">{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
	<button
		type="button"
		class="search"
		aria-label="Search"
		title="Search (Ctrl/Cmd+F)"
		onclick={() => editor && openSearchPanel(editor.view)}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20" /></svg>
	</button>
	<button type="button" aria-label="Editor settings" title="Editor settings" popovertarget="editor-settings" bind:this={settingsButton}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 9 6l5 12M5.7 14h6.6M15 18l3-7.5 3 7.5M15.9 16h4.2" /></svg>
	</button>
	<div id="editor-settings" class="settings" popover role="group" aria-label="Editor settings" bind:this={settings} ontoggle={place}>
		<div class="row">
			<span id="font-size-label">Font size</span>
			<div class="stepper" role="group" aria-labelledby="font-size-label">
				<button type="button" aria-label="Smaller text" disabled={prefs.fontSize <= FONT_SIZES.min} onclick={() => prefs.setFontSize(prefs.fontSize - 1)}>−</button>
				<output aria-live="polite">{prefs.fontSize}px</output>
				<button type="button" aria-label="Larger text" disabled={prefs.fontSize >= FONT_SIZES.max} onclick={() => prefs.setFontSize(prefs.fontSize + 1)}>+</button>
			</div>
		</div>
		<label class="row">
			Check spelling
			<input type="checkbox" checked={prefs.spellcheck} onchange={(e) => prefs.setSpellcheck(e.currentTarget.checked)} />
		</label>
		<label class="row">
			Appearance
			<select value={prefs.appearance} onchange={(e) => prefs.setAppearance(e.currentTarget.value as Appearance)}>
				{#each APPEARANCES as a (a.value)}<option value={a.value}>{a.label}</option>{/each}
			</select>
		</label>
		<label class="row" title="Mark unmatched \begin/\end, braces and $ while you type">
			Code check
			<input type="checkbox" checked={prefs.codeCheck} onchange={(e) => prefs.setCodeCheck(e.currentTarget.checked)} />
		</label>
	</div>
</div>
{#if palette && !readOnly}<SymbolPalette oninsert={insertSymbol} onclose={closePalette} />{/if}
<FigureDialog {project} oninsert={insertFigure} bind:this={figureDialog} />
<TableDialog oninsert={insertTable} bind:this={tableDialog} />

<style>
	.toolbar {
		display: flex;
		gap: 2px;
		padding: 4px 8px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
	}
	button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.separator {
		width: 1px;
		margin: 4px 6px;
		background: var(--border);
	}
	.words {
		align-self: center;
		margin-left: auto;
		padding: 0 8px;
		color: var(--text-muted);
		font-size: 12px;
		white-space: nowrap;
	}
	.settings {
		position: fixed;
		inset: auto;
		margin: 0;
		width: 220px;
		padding: 6px 12px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-menu);
		font-size: 13px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 32px;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.stepper button {
		width: 24px;
		height: 24px;
		border: 1px solid var(--border);
		font-size: 15px;
	}
	select {
		height: 24px;
		padding: 0 4px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	output {
		min-width: 36px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	button:hover:not(:disabled) {
		background: var(--panel-raised);
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
