<script lang="ts">
	import { Menu } from '#lib/menu.svelte.ts';

	// Row actions on the dashboard (contracts/ui.md "Dashboard"): Rename, Duplicate, Delete for the owner; Duplicate,
	// Leave for collaborators.
	type Action = 'rename' | 'duplicate' | 'delete' | 'leave';
	let { title, owner, disabled = false, onaction }: { title: string; owner: boolean; disabled?: boolean; onaction: (a: Action) => void } =
		$props();

	const m = new Menu();
	const items = $derived<[Action, string][]>(
		owner
			? [
					['rename', 'Rename'],
					['duplicate', 'Duplicate'],
					['delete', 'Delete']
				]
			: [
					['duplicate', 'Duplicate'],
					['leave', 'Leave']
				]
	);

	function pick(a: Action) {
		// rename focuses its input: don't hand focus back to the toggle
		if (a === 'rename') m.open = false;
		else m.close();
		onaction(a);
	}
</script>

<svelte:window onpointerdown={m.onwindowpointerdown} />

<div class="actions" bind:this={m.root}>
	<button
		type="button"
		class="toggle"
		aria-label="Actions for {title}"
		aria-haspopup="menu"
		aria-expanded={m.open}
		{disabled}
		bind:this={m.toggle}
		onclick={m.ontoggle}
		onkeydown={m.ontogglekey}
	>
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" /></svg>
	</button>
	{#if m.open}
		<div class="menu" role="menu" aria-label="Actions for {title}" tabindex="-1" bind:this={m.menu} onkeydown={m.onmenukey}>
			{#each items as [id, label] (id)}
				<button type="button" role="menuitem" tabindex="-1" class:danger={id === 'delete' || id === 'leave'} onclick={() => pick(id)}>{label}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.actions {
		position: relative;
		display: inline-block;
	}
	.toggle {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
	}
	.toggle svg {
		fill: currentColor;
	}
	.toggle:hover:not(:disabled),
	.toggle[aria-expanded='true'] {
		background: var(--panel-raised);
		color: var(--text);
	}
	.toggle:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.menu {
		position: absolute;
		top: calc(100% + 2px);
		right: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 150px;
		padding: 4px 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
	}
	.menu button {
		padding: 5px 12px;
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
	.menu button.danger {
		color: #f28b82;
	}
</style>
