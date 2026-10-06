<script lang="ts">
	import { openSearchPanel } from '@codemirror/search';
	import type { StateCommand } from '@codemirror/state';
	import { bold, figure, italic, link, section, table } from '#lib/editor/commands.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';

	// readOnly: the file can't be edited, every button that changes text is disabled (search stays)
	let { editor, readOnly = false }: { editor?: EditorHandle; readOnly?: boolean } = $props();

	function run(action: (h: EditorHandle) => unknown) {
		if (!editor) return;
		action(editor);
		editor.view.focus();
	}

	// stopCapturing on both sides: the insertion is its own undo step and the next typing starts a new one
	const insert = (cmd: StateCommand) =>
		run((h) => {
			h.undoManager.stopCapturing();
			cmd(h.view);
			h.undoManager.stopCapturing();
		});

	const insertions: { label: string; cmd: StateCommand; icon: string }[] = [
		{ label: 'Bold', cmd: bold, icon: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z' },
		{ label: 'Italic', cmd: italic, icon: 'M10 5h8M6 19h8M14 5l-4 14' },
		{ label: 'Section', cmd: section, icon: 'M5 5v14M13 5v14M5 12h8M17 10l2-1.5V19' },
		{
			label: 'Link',
			cmd: link,
			icon: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'
		},
		{ label: 'Figure', cmd: figure, icon: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01' },
		{ label: 'Table', cmd: table, icon: 'M4 5h16v14H4zM4 10h16M4 14.5h16M10 5v14' }
	];
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
	{#each insertions as { label, cmd, icon } (label)}
		<button type="button" aria-label={label} title={label} disabled={readOnly} onclick={() => insert(cmd)}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon} /></svg>
		</button>
	{/each}
	<button
		type="button"
		class="search"
		aria-label="Search"
		title="Search (Ctrl/Cmd+F)"
		onclick={() => editor && openSearchPanel(editor.view)}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20" /></svg>
	</button>
</div>

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
	.search {
		margin-left: auto;
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
