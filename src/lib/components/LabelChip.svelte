<script lang="ts">
	import type { Label } from '#lib/history-types.ts';
	import { Menu } from '#lib/menu.svelte.ts';

	// A label on a timeline version (contracts/ui.md "Timeline"): plain for everyone, a menu button with Rename and
	// Delete when `label.canEdit` (its author or the owner, research R6). `tabbable`: a Tab stop (the selected version's
	// chips only, so Tab leaves the timeline instead of walking every label).
	let {
		label,
		tabbable = true,
		onrename,
		ondelete
	}: { label: Label; tabbable?: boolean; onrename: (l: Label) => void; ondelete: (l: Label) => void } = $props();
	const m = new Menu();

	function pick(action: (l: Label) => void) {
		m.close();
		action(label);
	}
</script>

<svelte:window onpointerdown={m.onwindowpointerdown} />

{#if label.canEdit}
	<!-- inside a listbox option: clicks and keys stay with the menu (Escape with the menu closed leaves history) -->
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<span class="wrap" bind:this={m.root} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
		<button
			type="button"
			class="chip"
			title="{label.name} · {label.user.name}"
			aria-label="Label {label.name}"
			aria-haspopup="menu"
			aria-expanded={m.open}
			tabindex={tabbable ? 0 : -1}
			bind:this={m.toggle}
			onclick={m.ontoggle}
			onkeydown={m.ontogglekey}>{label.name}</button
		>
		{#if m.open}
			<div class="menu" role="menu" aria-label="Label {label.name}" tabindex="-1" bind:this={m.menu} onkeydown={m.onmenukey}>
				<button type="button" role="menuitem" tabindex="-1" onclick={() => pick(onrename)}>Rename…</button>
				<button type="button" role="menuitem" tabindex="-1" class="danger" onclick={() => pick(ondelete)}>Delete</button>
			</div>
		{/if}
	</span>
{:else}
	<span class="chip" title="{label.name} · {label.user.name}">{label.name}</span>
{/if}

<style>
	.wrap {
		position: relative;
		display: inline-flex;
		max-width: 100%;
	}
	.chip {
		max-width: 100%;
		padding: 1px 8px;
		overflow: hidden;
		border: 0;
		border-radius: 10px;
		background: #2a3b55;
		color: #8ab4f8;
		font: inherit;
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	button.chip {
		cursor: pointer;
	}
	button.chip:hover,
	button.chip[aria-expanded='true'] {
		background: #34496a;
	}
	.menu {
		position: absolute;
		top: calc(100% + 2px);
		left: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 120px;
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
		font-size: 13px;
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
