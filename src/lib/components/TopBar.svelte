<script lang="ts">
	import type { Snippet } from 'svelte';
	import { auth, signOut } from '#lib/auth.svelte.ts';
	import type { Layout } from '#lib/layout.svelte.ts';
	import { Menu } from '#lib/menu.svelte.ts';
	import type { Peer } from '#lib/session.svelte.ts';
	import Avatar from './Avatar.svelte';
	import LayoutMenu from './LayoutMenu.svelte';

	// contracts/ui.md "Top bar": brand link left, project title centre, page controls and the account menu right.
	// `project`: the editor's title; the owner (onrename set) edits it in place, others see text.
	type ProjectTitle = { title: string; onrename?: (title: string) => Promise<string | null> }; // resolves to an error or null
	// `onshare`: the green "Share" button (editor page) opening the Share dialog
	// `peers`: the others in the project (avatars, `onjump` goes to their cursor); `offline`: the socket dropped
	// `history`: the History toggle (008 contracts/ui.md), pressed while the History view is on
	// `layout`: the Layout menu (008 research R12)
	// `github`: the GitHub button opening the GitHub sync dialog (012 contracts/ui.md; the page decides who sees it)
	let {
		title,
		right,
		project,
		onshare,
		peers = [],
		onjump,
		offline = false,
		history,
		layout,
		github
	}: {
		title?: Snippet;
		right?: Snippet;
		project?: ProjectTitle;
		onshare?: () => void;
		peers?: Peer[];
		onjump?: (peer: Peer) => void;
		offline?: boolean;
		history?: { on: boolean; toggle: () => void };
		layout?: Layout;
		github?: { open: () => void; linked: boolean };
	} = $props();
	const MAX_PEERS = 5;

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
	const more = new Menu();
	if (!auth.me) auth.loadMe();

	function jump(peer: Peer) {
		more.open = false;
		onjump?.(peer);
	}

	function go(href: string) {
		m.open = false;
		location.assign(href);
	}
</script>

<svelte:window onpointerdown={(e) => (m.onwindowpointerdown(e), more.onwindowpointerdown(e))} />

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
		{#if peers.length}
			<div class="peers" bind:this={more.root}>
				{#each peers.slice(0, MAX_PEERS) as peer (peer.id)}
					<button type="button" class="peer" style:--ring={peer.color} aria-label="{peer.name} (go to cursor)" title={peer.name} onclick={() => jump(peer)}>
						<Avatar name={peer.name} avatarUrl={peer.avatarUrl} color={peer.color} />
					</button>
				{/each}
				{#if peers.length > MAX_PEERS}
					<button
						type="button"
						class="more"
						aria-label="{peers.length - MAX_PEERS} more"
						aria-haspopup="menu"
						aria-expanded={more.open}
						bind:this={more.toggle}
						onclick={more.ontoggle}
						onkeydown={more.ontogglekey}>+{peers.length - MAX_PEERS}</button
					>
					{#if more.open}
						<div class="menu" role="menu" aria-label="More people" tabindex="-1" bind:this={more.menu} onkeydown={more.onmenukey}>
							{#each peers.slice(MAX_PEERS) as peer (peer.id)}
								<button type="button" role="menuitem" tabindex="-1" class="row" aria-label="{peer.name} (go to cursor)" onclick={() => jump(peer)}>
									<Avatar name={peer.name} avatarUrl={peer.avatarUrl} color={peer.color} size={20} />
									{peer.name}
								</button>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/if}
		{#if offline}
			<span class="offline" role="status">Offline, reconnecting…</span>
		{/if}
		{#if layout}
			<LayoutMenu {layout} />
		{/if}
		{#if github}
			<button type="button" id="github-open" class="github" class:linked={github.linked} aria-haspopup="dialog" onclick={github.open}>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
					><path
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
					/></svg
				>
				GitHub
			</button>
		{/if}
		{#if history}
			<button type="button" id="history-toggle" class="history" aria-pressed={history.on} onclick={history.toggle}>
				<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" /></svg>
				History
			</button>
		{/if}
		{#if onshare}
			<button type="button" class="share" onclick={onshare}>
				<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
					><path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M19 8v6M16 11h6" /></svg
				>
				Share
			</button>
		{/if}
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
	.peers {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		margin-right: 4px;
	}
	.peer,
	.more {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 2px solid var(--ring, var(--border));
		border-radius: 50%;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	.more {
		background: var(--panel-raised);
	}
	.peer:hover,
	.more:hover {
		filter: brightness(1.15);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.offline {
		padding: 3px 10px;
		border-radius: 12px;
		background: #4a2a2a;
		color: var(--text);
		font-size: 12px;
		white-space: nowrap;
	}
	.github {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 12px 0 10px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: none;
		color: var(--text-muted);
		font: inherit;
		cursor: pointer;
	}
	.github.linked {
		color: var(--text);
	}
	.github:hover {
		background: var(--panel-raised);
		color: var(--text);
	}
	.github svg {
		fill: currentColor;
	}
	.history {
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
	.history:hover {
		background: var(--panel-raised);
	}
	.history[aria-pressed='true'] {
		border-color: var(--accent-bright);
		background: var(--panel-raised);
	}
	.history svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.share {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 14px 0 12px;
		border: 0;
		border-radius: 14px;
		background: var(--accent);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.share:hover {
		background: #367a39;
	}
	.share svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
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
