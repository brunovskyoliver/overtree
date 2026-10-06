<script lang="ts">
	import type { EditorHandle } from '#lib/editor/types.ts';

	let { editor }: { editor?: EditorHandle } = $props();

	function run(action: (h: EditorHandle) => unknown) {
		if (!editor) return;
		action(editor);
		editor.view.focus();
	}
</script>

<div class="toolbar" role="toolbar" aria-label="Formatting">
	<button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" onclick={() => run((h) => h.undoManager.undo())}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
	</button>
	<button
		type="button"
		aria-label="Redo"
		title="Redo (Ctrl/Cmd+Shift+Z)"
		onclick={() => run((h) => h.undoManager.redo())}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
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
	button:hover {
		background: var(--panel-raised);
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
