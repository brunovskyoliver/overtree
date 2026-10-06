<script lang="ts">
	import type { Snippet } from 'svelte';
	import { auth, signOut } from '#lib/auth.svelte.ts';
	import { Menu } from '#lib/menu.svelte.ts';
	import Avatar from './Avatar.svelte';

	// contracts/ui.md "Top bar": brand link left, project title centre, page controls and the account menu right.
	// `project`: the editor's title; the owner (onrename set) edits it in place, others see text.
	type ProjectTitle = { title: string; onrename?: (title: string) => Promise<string | null> }; // resolves to an error or null
	let { title, right, project }: { title?: Snippet; right?: Snippet; project?: ProjectTitle } = $props();

	let editing = $state(false);
	let value = $state('');
	let renameError = $state('');
	let saving = false;

	function startEdit() {
		value = project!.title;
		renameError = '';
		editing = true;
	}

	async function save() {
		if (!editing || saving) return;
		const t = value.trim();
		if (t === project!.title) return void (editing = false);
		if (!t || t.length > 120) return void (renameError = 'The title must be 1–120 characters.');
		saving = true;
		const err = await project!.onrename!(t);
		saving = false;
		if (err) renameError = err;
		else editing = false;
	}

	function onkey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			save();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			editing = false;
		}
	}

	function focusSelect(el: HTMLInputElement) {
		el.focus();
		el.select();
	}

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
	<div class="title">
		{#if project && editing}
			<input
				class="rename"
				type="text"
				maxlength="120"
				aria-label="Project title"
				aria-invalid={!!renameError}
				title={renameError || undefined}
				bind:value
				use:focusSelect
				oninput={() => (renameError = '')}
				onkeydown={onkey}
				onblur={save}
			/>
		{:else if project?.onrename}
			<button type="button" class="rename-toggle" aria-label="Rename project" title="Rename project" onclick={startEdit}>
				<span>{project.title}</span>
				<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
					><path d="M11.5 2.5l2 2L6 12H4v-2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg
				>
			</button>
		{:else if project}
			<span>{project.title}</span>
		{:else}
			{@render title?.()}
		{/if}
	</div>
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
		min-width: 0;
		max-width: 40vw;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rename-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		padding: 3px 8px;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.rename-toggle span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rename-toggle svg {
		flex: none;
		color: var(--text-muted);
		opacity: 0;
	}
	.rename-toggle:hover,
	.rename-toggle:focus-visible {
		background: var(--panel-raised);
	}
	.rename-toggle:hover svg,
	.rename-toggle:focus-visible svg {
		opacity: 1;
	}
	.rename {
		width: 320px;
		max-width: 40vw;
		padding: 3px 8px;
		border: 1px solid var(--focus);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
		text-align: center;
	}
	.rename[aria-invalid='true'] {
		border-color: #f28b82;
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
