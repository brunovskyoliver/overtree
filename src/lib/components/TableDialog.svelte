<script lang="ts">
	import { tick } from 'svelte';
	import { trapTab } from '#lib/focus.ts';

	// Insert table (015): a rows × columns grid like Word's, up to 10 × 10. Hover or arrow keys size the table,
	// click or Enter inserts it. A modal <dialog>: focus stays inside, Escape closes it.
	let { oninsert }: { oninsert: (rows: number, cols: number) => void } = $props();
	const uid = $props.id();
	const MAX = 10;

	let dialog: HTMLDialogElement;
	let grid: HTMLDivElement;
	let rows = $state(1);
	let cols = $state(1);

	export async function open() {
		rows = 2;
		cols = 2;
		dialog.showModal();
		await tick();
		focusCell();
	}

	function focusCell() {
		grid.querySelector<HTMLButtonElement>(`[data-cell="${rows}-${cols}"]`)?.focus();
	}

	function pick(r: number, c: number) {
		dialog.close();
		oninsert(r, c);
	}

	function onkeydown(e: KeyboardEvent) {
		const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
		const m = moves[e.key];
		if (!m) return;
		e.preventDefault();
		rows = Math.min(MAX, Math.max(1, rows + m[0]));
		cols = Math.min(MAX, Math.max(1, cols + m[1]));
		focusCell();
	}

	const size = (r: number, c: number) => `${r} ${r === 1 ? 'row' : 'rows'} × ${c} ${c === 1 ? 'column' : 'columns'}`;
</script>

<dialog bind:this={dialog} aria-labelledby="{uid}-title" onkeydown={trapTab}>
	<h2 id="{uid}-title">Insert table</h2>
	<!-- one tab stop: the cell of the current size; arrows grow and shrink it -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (arrow keys from its buttons bubble up here) -->
	<div class="grid" role="group" aria-label="Table size" bind:this={grid} {onkeydown}>
		{#each { length: MAX }, r}
			{#each { length: MAX }, c}
				<button
					type="button"
					data-cell="{r + 1}-{c + 1}"
					class:on={r < rows && c < cols}
					tabindex={r + 1 === rows && c + 1 === cols ? 0 : -1}
					aria-label={size(r + 1, c + 1)}
					onpointerenter={() => ((rows = r + 1), (cols = c + 1))}
					onclick={() => pick(r + 1, c + 1)}
				></button>
			{/each}
		{/each}
	</div>
	<p class="size" aria-live="polite">{size(rows, cols)}</p>
	<p class="hint">The first row is the header. Uses booktabs rules; the package is added to the main document if it's missing.</p>
	<div class="buttons">
		<button type="button" class="cancel" onclick={() => dialog.close()}>Cancel</button>
	</div>
</dialog>

<style>
	dialog {
		padding: 18px 20px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	h2 {
		margin: 0 0 12px;
		font-size: 15px;
		font-weight: 600;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(10, 20px);
		gap: 3px;
	}
	.grid button {
		width: 20px;
		height: 20px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 2px;
		background: var(--bg-editor);
		cursor: pointer;
	}
	.grid button.on {
		border-color: var(--accent-bright);
		background: var(--accent);
	}
	.size {
		margin: 10px 0 4px;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	.hint {
		max-width: 230px;
		margin: 0;
		color: var(--text-muted);
		font-size: 12px;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		margin-top: 12px;
	}
	.cancel {
		padding: 5px 14px;
		border: 1px solid var(--border);
		border-radius: 13px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
</style>
