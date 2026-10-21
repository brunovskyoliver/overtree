<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { CATEGORIES, searchSymbols, type Sym } from '#lib/editor/symbols.ts';

	// Symbol palette (015): categories, search by name or command, a grid of glyphs with the command as tooltip.
	// Arrow keys move through the grid (one tab stop), Enter inserts and keeps focus here; a click inserts and
	// hands focus back to the text. Escape closes. `oninsert` gets the command; `keep` says focus stays here.
	let { oninsert, onclose }: { oninsert: (cmd: string, keep: boolean) => void; onclose: () => void } = $props();
	const uid = $props.id();

	let query = $state('');
	let category = $state(CATEGORIES[0].name);
	let current = $state(0); // the grid's tab stop
	let search: HTMLInputElement;
	let grid: HTMLDivElement;

	const shown: Sym[] = $derived(query.trim() ? searchSymbols(query) : CATEGORIES.find((c) => c.name === category)!.symbols);
	$effect(() => {
		void shown;
		current = 0;
	});

	onMount(() => search.focus());

	const cell = (i: number) => grid.querySelectorAll<HTMLButtonElement>('button')[i];

	async function move(to: number) {
		current = Math.max(0, Math.min(shown.length - 1, to));
		await tick();
		cell(current)?.focus();
	}

	function ongridkey(e: KeyboardEvent) {
		const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
		const to = { ArrowLeft: current - 1, ArrowRight: current + 1, ArrowUp: current - cols, ArrowDown: current + cols, Home: 0, End: shown.length - 1 }[e.key];
		if (to === undefined) return;
		e.preventDefault();
		if (e.key === 'ArrowUp' && current < cols) search.focus();
		else move(to);
	}

	function onsearchkey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' && shown.length) {
			e.preventDefault();
			move(0);
		} else if (e.key === 'Enter' && shown.length) {
			e.preventDefault();
			oninsert(shown[0].cmd, true);
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		onclose();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape anywhere inside closes the panel) -->
<section class="palette" aria-label="Symbol palette" {onkeydown}>
	<div class="head">
		<input
			type="search"
			placeholder="Search symbols"
			aria-label="Search symbols"
			aria-controls="{uid}-grid"
			bind:value={query}
			bind:this={search}
			onkeydown={onsearchkey}
		/>
		<div class="tabs" role="tablist" aria-label="Symbol categories">
			{#each CATEGORIES as c (c.name)}
				<button
					type="button"
					role="tab"
					aria-selected={!query.trim() && category === c.name}
					aria-controls="{uid}-grid"
					onclick={() => ((category = c.name), (query = ''))}>{c.name}</button
				>
			{/each}
		</div>
		<button type="button" class="close" aria-label="Close symbol palette" title="Close (Escape)" onclick={onclose}>×</button>
	</div>
	<div id="{uid}-grid" class="grid" role="tabpanel" tabindex="-1" aria-label={query.trim() ? 'Search results' : category} bind:this={grid} onkeydown={ongridkey}>
		{#each shown as s, i (s.cmd)}
			<button
				type="button"
				tabindex={i === current ? 0 : -1}
				title="{s.cmd} ({s.name})"
				aria-label="{s.name} {s.cmd}"
				onfocus={() => (current = i)}
				onclick={(e) => oninsert(s.cmd, e.detail === 0)}>{s.glyph}</button
			>
		{:else}
			<p class="none">No symbol matches “{query}”.</p>
		{/each}
	</div>
</section>

<style>
	.palette {
		border-bottom: 1px solid var(--border);
		background: var(--panel);
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px 4px;
	}
	input {
		width: 160px;
		padding: 3px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}
	.tabs button,
	.close {
		padding: 3px 8px;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text-muted);
		font: inherit;
		cursor: pointer;
	}
	.tabs button[aria-selected='true'] {
		background: var(--panel-raised);
		color: var(--text);
	}
	.close {
		margin-left: auto;
		font-size: 16px;
	}
	.tabs button:hover,
	.close:hover {
		color: var(--text);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, 34px);
		gap: 2px;
		max-height: 120px;
		overflow-y: auto;
		padding: 2px 8px 8px;
	}
	.grid button {
		height: 30px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: 16px var(--font-ui);
		cursor: pointer;
	}
	.grid button:hover {
		border-color: var(--border);
		background: var(--panel-raised);
	}
	.none {
		grid-column: 1 / -1;
		margin: 4px 0;
		color: var(--text-muted);
	}
</style>
