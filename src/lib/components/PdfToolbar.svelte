<script lang="ts">
	import { Menu } from '#lib/menu.svelte.ts';
	import type PdfViewer from './PdfViewer.svelte';

	let {
		viewer,
		page,
		pages,
		scale,
		percent,
		dark = $bindable()
	}: { viewer?: ReturnType<typeof PdfViewer>; page: number; pages: number; scale: string; percent: number; dark: boolean } = $props();

	const ZOOMS: [string, string][] = [
		['page-width', 'Fit width'],
		['page-fit', 'Fit page'],
		...[50, 75, 100, 125, 150, 200, 400].map((p): [string, string] => [String(p / 100), `${p}%`])
	];

	const off = $derived(!viewer || !pages);
	const m = new Menu();

	function onpagekey(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (e.key !== 'Enter') return;
		const n = Number(e.currentTarget.value);
		if (Number.isInteger(n) && n >= 1 && n <= pages) viewer!.goTo(n);
		else e.currentTarget.value = String(page);
	}

	function pick(value: string) {
		viewer!.setScale(value);
		m.close();
	}
</script>

<svelte:window onpointerdown={m.onwindowpointerdown} />

<div class="tools">
	<button type="button" aria-label="Dark pages" aria-pressed={dark} disabled={off} onclick={() => (dark = !dark)}>
		<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 2a6 6 0 0 1 0 12z" class="fill" /></svg>
	</button>
	<button type="button" aria-label="Previous page" disabled={off || page <= 1} onclick={() => viewer!.goTo(page - 1)}>
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
	</button>
	<button type="button" aria-label="Next page" disabled={off || page >= pages} onclick={() => viewer!.goTo(page + 1)}>
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
	</button>
	<input
		type="text"
		inputmode="numeric"
		aria-label="Page number"
		value={off ? '' : page}
		disabled={off}
		onkeydown={onpagekey}
		onblur={(e) => (e.currentTarget.value = off ? '' : String(page))}
	/>
	<span class="count">/ {off ? '–' : pages}</span>
	<button type="button" aria-label="Zoom out" disabled={off} onclick={() => viewer!.zoom(-1)}>
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
	</button>
	<button type="button" aria-label="Zoom in" disabled={off} onclick={() => viewer!.zoom(1)}>
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg>
	</button>
	<div class="zoom" bind:this={m.root}>
		<button
			type="button"
			class="level"
			aria-label="Zoom level {percent}%"
			aria-haspopup="menu"
			aria-expanded={m.open}
			disabled={off}
			bind:this={m.toggle}
			onclick={m.ontoggle}
			onkeydown={m.ontogglekey}
		>
			{percent}%
			<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
		</button>
		{#if m.open}
			<div class="menu" role="menu" aria-label="Zoom" tabindex="-1" bind:this={m.menu} onkeydown={m.onmenukey}>
				{#each ZOOMS as [value, label] (value)}
					<button type="button" role="menuitemradio" tabindex="-1" aria-checked={scale === value} onclick={() => pick(value)}>{label}</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-left: auto;
	}
	button {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 26px;
		padding: 0 6px;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	button:hover:not(:disabled),
	button[aria-pressed='true'],
	button[aria-expanded='true'] {
		background: var(--panel-raised);
	}
	button:disabled {
		cursor: default;
		opacity: 0.4;
	}
	svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.level svg {
		width: 10px;
		height: 6px;
	}
	.fill {
		fill: currentColor;
	}
	input {
		width: 34px;
		height: 22px;
		margin-left: 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel);
		color: var(--text);
		font: inherit;
		text-align: center;
	}
	.count {
		margin: 0 8px 0 4px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.zoom {
		position: relative;
	}
	.level {
		min-width: 64px;
		justify-content: flex-end;
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		min-width: 140px;
		padding: 4px 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
	}
	.menu button {
		position: relative;
		height: auto;
		padding: 5px 12px 5px 30px;
		border-radius: 0;
	}
	.menu button:focus-visible {
		background: var(--panel-raised);
		outline: none;
	}
	.menu button[aria-checked='true']::before {
		content: '✓';
		position: absolute;
		left: 11px;
		color: var(--accent-bright);
	}
</style>
