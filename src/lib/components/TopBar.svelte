<script lang="ts">
	import type { Snippet } from 'svelte';
	import { auth, signOut } from '#lib/auth.svelte.ts';
	import { Menu } from '#lib/menu.svelte.ts';
	import Avatar from './Avatar.svelte';

	// contracts/ui.md "Top bar": brand link left, project title centre, page controls and the account menu right
	let { title, right }: { title?: Snippet; right?: Snippet } = $props();

	const m = new Menu();
	if (!auth.me) auth.loadMe();

	function go(href: string) {
		m.open = false;
		location.assign(href);
	}
</script>

<svelte:window onpointerdown={m.onwindowpointerdown} />

<header class="topbar">
	<a class="brand" href="/">Overtree</a>
	<div class="title">{@render title?.()}</div>
	<div class="right">
		{@render right?.()}
		<div class="account" bind:this={m.root}>
			<button
				type="button"
				class="toggle"
				aria-label="Account"
				aria-haspopup="menu"
				aria-expanded={m.open}
				disabled={!auth.me}
				bind:this={m.toggle}
				onclick={m.ontoggle}
				onkeydown={m.ontogglekey}
			>
				{#if auth.me}
					<Avatar name={auth.me.name} avatarUrl={auth.me.avatarUrl} color={auth.me.color} />
				{/if}
			</button>
			{#if m.open && auth.me}
				<div class="menu" role="menu" aria-label="Account" tabindex="-1" bind:this={m.menu} onkeydown={m.onmenukey}>
					<div class="who">
						<span class="name">{auth.me.name}</span>
						<span class="email">{auth.me.email}</span>
					</div>
					<button type="button" role="menuitem" tabindex="-1" onclick={() => go('/')}>Dashboard</button>
					{#if auth.me.role === 'admin'}
						<button type="button" role="menuitem" tabindex="-1" onclick={() => go('/admin')}>Admin</button>
					{/if}
					<button type="button" role="menuitem" tabindex="-1" onclick={() => ((m.open = false), signOut())}>Sign out</button>
				</div>
			{/if}
		</div>
	</div>
</header>

<style>
	.topbar {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		height: 44px;
		padding: 0 14px;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		justify-self: start;
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	.title {
		font-weight: 500;
	}
	.right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}
	.account {
		position: relative;
	}
	.toggle {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		cursor: pointer;
	}
	.toggle:hover:not(:disabled),
	.toggle[aria-expanded='true'] {
		background: var(--panel-raised);
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 200px;
		padding: 4px 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
	}
	.who {
		display: flex;
		flex-direction: column;
		padding: 6px 12px 8px;
		margin-bottom: 4px;
		border-bottom: 1px solid var(--border);
	}
	.name {
		font-weight: 600;
	}
	.email {
		color: var(--text-muted);
		font-size: 12px;
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
</style>
