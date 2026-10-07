<script lang="ts">
	import { LAYOUT_MODES, type Layout, type LayoutMode } from '#lib/layout.svelte.ts';
	import { Menu } from '#lib/menu.svelte.ts';

	// The top bar's Layout menu (contracts/ui.md "Top bar", research R12).
	let { layout }: { layout: Layout } = $props();
	const m = new Menu();

	function pick(mode: LayoutMode) {
		m.close();
		layout.set(mode);
	}
</script>

<svelte:window onpointerdown={m.onwindowpointerdown} />

<div class="wrap" bind:this={m.root}>
	<button
		type="button"
		class="toggle"
		aria-haspopup="menu"
		aria-expanded={m.open}
		bind:this={m.toggle}
		onclick={m.ontoggle}
		onkeydown={m.ontogglekey}
	>
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 3h12v10H2zM7 3v10" /></svg>
		Layout
	</button>
	{#if m.open}
		<div class="menu" role="menu" aria-label="Layout" tabindex="-1" bind:this={m.menu} onkeydown={m.onmenukey}>
			{#each LAYOUT_MODES as item (item.mode)}
				<button type="button" role="menuitemradio" tabindex="-1" aria-checked={layout.mode === item.mode} onclick={() => pick(item.mode)}>
					<span class="check" aria-hidden="true">{layout.mode === item.mode ? '✓' : ''}</span>
					{item.label}
				</button>
			{/each}
		</div>
	{/if}
	{#if layout.notice}
		<p class="notice" role="alert">
			{layout.notice}
			<button type="button" aria-label="Dismiss" onclick={() => layout.dismiss()}>×</button>
		</p>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 12px 0 10px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: none;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.toggle:hover,
	.toggle[aria-expanded='true'] {
		background: var(--panel-raised);
	}
	.toggle svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 220px;
		padding: 4px 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
	}
	.menu button {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px 5px 8px;
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.menu button:hover,
	.menu button:focus-visible {
		background: var(--panel-raised);
		outline: none;
	}
	.check {
		width: 14px;
		color: var(--accent-bright);
	}
	.notice {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 21;
		display: flex;
		align-items: center;
		gap: 8px;
		width: max-content;
		max-width: 320px;
		margin: 0;
		padding: 6px 8px 6px 12px;
		border-radius: 6px;
		background: #5a2a2a;
		color: var(--text);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
	}
	.notice button {
		padding: 0 4px;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 16px;
		cursor: pointer;
	}
</style>
