<script lang="ts">
	import { blockedBy } from '#lib/auth.svelte.ts';
	import { Menu } from '#lib/menu.svelte.ts';
	import type { Members, Person, Project } from '#lib/project.svelte.ts';
	import Avatar from './Avatar.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';

	// contracts/ui.md "Share dialog": the owner invites, changes roles, removes, withdraws invites, shares a link and
	// hands the project over; everyone else sees who has access. Every change goes to the server first, then the list
	// reloads (also on the `access` events of other changes: the page calls refresh()).
	let { project }: { project: Project } = $props();

	type Role = 'editor' | 'reader';

	const ROLES: [Role, string][] = [
		['editor', 'Editor'],
		['reader', 'Reader']
	];

	let dialog: HTMLDialogElement;
	let confirm: ConfirmDialog;
	let isOpen = $state(false);
	let list = $state<Members | null>(null);
	let email = $state('');
	let role = $state<Role>('editor');
	let error = $state('');
	let notice = $state('');
	let copied = $state(false);
	let busy = $state(false);

	const owner = $derived(project.details?.role === 'owner');
	const link = $derived(project.details?.link ?? null);
	const linkUrl = $derived(link ? `${location.origin}/share/${link.token}` : '');

	const m = new Menu();
	let menuFor = $state<string | null>(null);

	export function open() {
		error = '';
		notice = '';
		copied = false;
		dialog.showModal();
		isOpen = true;
		refresh();
	}

	/** Reload the list (no-op while closed). */
	export async function refresh() {
		if (!isOpen) return;
		const res = await fetch(project.api('/members')).catch(() => undefined);
		if (await blockedBy(res)) return;
		if (res?.ok) list = await res.json();
	}

	/** One sharing request; on success the list and the project details reload. Returns the JSON body or null. */
	async function call(path: string, method: string, body?: object) {
		busy = true;
		error = '';
		notice = '';
		const res = await fetch(project.api(path), {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body && JSON.stringify(body)
		}).catch(() => undefined);
		busy = false;
		if (await blockedBy(res)) return null;
		if (!res) return void (error = 'Network error, try again.'), null;
		if (!res.ok) return void (error = (await res.json().catch(() => null))?.message ?? `Request failed (${res.status}).`), null;
		const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
		await Promise.all([refresh(), project.loadDetails()]);
		return data ?? {};
	}

	async function invite(e: SubmitEvent) {
		e.preventDefault();
		if (!email.trim()) return void (error = 'Enter an email address.');
		const sent = email.trim();
		const res = await call('/members', 'POST', { email, role });
		if (!res) return;
		email = '';
		// a new invite to an email without an account: Clerk emails a sign-up link, or the owner passes the site on
		if (res.status === 'invited')
			notice = res.emailed ? `Invitation emailed to ${sent}.` : `Couldn't email ${sent}; send them the site link to sign up.`;
	}

	const setRole = (userId: string, r: Role) => call(`/members/${encodeURIComponent(userId)}`, 'PATCH', { role: r });
	const remove = (userId: string) => call(`/members/${encodeURIComponent(userId)}`, 'DELETE');
	const setInviteRole = (address: string, r: Role) => call('/members', 'POST', { email: address, role: r });
	const withdraw = (address: string) => call(`/invites/${encodeURIComponent(address)}`, 'DELETE');
	const putLink = (r: Role | null, regenerate = false) => call('/link', 'PUT', { role: r, regenerate });
	const dropOverride = (userId: string, fileId: string) => call('/overrides', 'PUT', { userId, fileId, role: null });

	async function resetLink() {
		const ok = await confirm.ask({
			title: 'Reset the share link?',
			body: 'The current link stops working and people who joined only through it lose access.',
			confirmLabel: 'Reset link',
			danger: true
		});
		if (ok) await putLink(link!.role, true);
	}

	async function copy() {
		await navigator.clipboard?.writeText(linkUrl).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function openMenu(e: MouseEvent, userId: string) {
		if (m.open && menuFor === userId) return void (m.open = false);
		menuFor = userId;
		m.toggle = e.currentTarget as HTMLElement;
		m.show();
	}

	async function makeOwner(p: Person) {
		m.open = false;
		const ok = await confirm.ask({
			title: `Make ${p.name} the owner?`,
			body: 'They get full control of the project, including sharing and deleting it. You become an editor.',
			confirmLabel: 'Make owner'
		});
		if (ok) await call('/transfer', 'POST', { userId: p.id });
	}
</script>

<svelte:window onpointerdown={m.onwindowpointerdown} />

{#snippet who(p: Person, note?: string)}
	<Avatar name={p.name} avatarUrl={p.avatarUrl} color={p.color} />
	<span class="who">
		<span class="name">{p.name}{#if note}<span class="note">{note}</span>{/if}</span>
		<span class="email">{p.email}</span>
	</span>
{/snippet}

<dialog bind:this={dialog} aria-labelledby="share-title" onclose={() => ((isOpen = false), (m.open = false))}>
	<div class="head">
		<h2 id="share-title">Share project</h2>
		<form method="dialog"><button class="close" aria-label="Close">×</button></form>
	</div>

	{#if owner}
		<form class="invite" onsubmit={invite}>
			<input type="email" aria-label="Email" placeholder="Email address" autocomplete="off" bind:value={email} oninput={() => (error = '')} />
			<select aria-label="Role" bind:value={role}>
				{#each ROLES as [value, label] (value)}<option {value}>{label}</option>{/each}
			</select>
			<button type="submit" class="primary" disabled={busy}>Invite</button>
		</form>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}

	<h3 id="people-title">People with access</h3>
	<ul class="people" aria-labelledby="people-title" bind:this={m.root}>
		{#if list?.owner}
			<li>
				{@render who(list.owner)}
				<span class="fixed">Owner</span>
			</li>
		{/if}
		{#each list?.members ?? [] as { user: u, role: r, via } (u.id)}
			{@const own = list?.overrides.filter((o) => o.userId === u.id) ?? []}
			<li>
				{@render who(u, via === 'link' ? 'via link' : undefined)}
				{#if owner}
					<select aria-label="Role for {u.email}" value={r} disabled={busy} onchange={(e) => setRole(u.id, e.currentTarget.value as Role)}>
						{#each ROLES as [value, label] (value)}<option {value}>{label}</option>{/each}
					</select>
					<button type="button" class="icon" aria-label="Remove {u.email}" title="Remove" disabled={busy} onclick={() => remove(u.id)}>
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
					</button>
					<span class="more">
						<button
							type="button"
							class="icon"
							aria-label="More for {u.email}"
							aria-haspopup="menu"
							aria-expanded={m.open && menuFor === u.id}
							onclick={(e) => openMenu(e, u.id)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true" class="dots"
								><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg
							>
						</button>
						{#if m.open && menuFor === u.id}
							<div class="menu" role="menu" aria-label="More for {u.email}" tabindex="-1" bind:this={m.menu} onkeydown={m.onmenukey}>
								<button type="button" role="menuitem" tabindex="-1" onclick={() => makeOwner(u)}>Make owner</button>
							</div>
						{/if}
					</span>
				{:else}
					<span class="fixed">{r === 'editor' ? 'Editor' : 'Reader'}</span>
				{/if}
				{#if own.length}
					<details class="overrides">
						<summary>File permissions ({own.length})</summary>
						<ul aria-label="File permissions for {u.email}">
							{#each own as o (o.fileId)}
								<li>
									<span class="path">{o.path}</span>
									<span class="fixed">{o.role === 'editor' ? 'Editor' : 'Reader'}</span>
									<button
										type="button"
										class="icon"
										aria-label="Remove permission on {o.path} for {u.email}"
										title="Remove"
										disabled={busy}
										onclick={() => dropOverride(u.id, o.fileId)}
									>
										<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
									</button>
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			</li>
		{/each}
		{#each list?.invites ?? [] as inv (inv.email)}
			<li>
				<Avatar name={inv.email} color="var(--handle)" />
				<span class="who"><span class="name">{inv.email} (invited)</span></span>
				<select aria-label="Role for {inv.email}" value={inv.role} disabled={busy} onchange={(e) => setInviteRole(inv.email, e.currentTarget.value as Role)}>
					{#each ROLES as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
				<button type="button" class="icon" aria-label="Withdraw invite {inv.email}" title="Withdraw invite" disabled={busy} onclick={() => withdraw(inv.email)}>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
				</button>
			</li>
		{/each}
	</ul>

	{#if owner}
		<section class="link" aria-labelledby="link-title">
			<h3 id="link-title">Link sharing</h3>
			<div class="row">
				<button
					type="button"
					role="switch"
					class="switch"
					aria-checked={!!link}
					aria-label="Anyone with the link"
					disabled={busy}
					onclick={() => putLink(link ? null : 'reader')}
				>
					<span class="knob"></span>
				</button>
				<span class="label" aria-hidden="true">Anyone with the link</span>
				{#if link}
					<select aria-label="Link role" value={link.role} disabled={busy} onchange={(e) => putLink(e.currentTarget.value as Role)}>
						{#each ROLES as [value, label] (value)}<option {value}>{label}</option>{/each}
					</select>
				{/if}
			</div>
			{#if link}
				<div class="row">
					<input class="url" type="text" readonly aria-label="Share link" value={linkUrl} onfocus={(e) => e.currentTarget.select()} />
					<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
					<button type="button" disabled={busy} onclick={resetLink}>Reset link</button>
				</div>
				<p class="hint">People need to sign in. Resetting makes the old link stop working.</p>
			{/if}
		</section>
	{/if}
</dialog>

<ConfirmDialog bind:this={confirm} />

<style>
	dialog {
		width: 520px;
		max-width: calc(100vw - 32px);
		padding: 16px 20px 20px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}
	h3 {
		margin: 16px 0 6px;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.close {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text-muted);
		font-size: 20px;
		line-height: 1;
	}
	.invite {
		display: flex;
		gap: 8px;
	}
	input,
	select {
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	.invite input {
		flex: 1;
		min-width: 0;
	}
	button {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 15px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: #3a4252;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.primary {
		border-color: transparent;
		background: var(--accent);
		font-weight: 600;
	}
	button.primary:hover:not(:disabled) {
		background: #367a39;
	}
	.error {
		margin: 8px 0 0;
		color: #f28b82;
	}
	.notice {
		margin: 8px 0 0;
		color: var(--text-muted);
	}
	.people {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.people li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 4px 0;
	}
	.overrides {
		flex: 1 0 100%;
		padding-left: 42px;
		color: var(--text-muted);
		font-size: 12px;
	}
	.overrides summary {
		cursor: pointer;
	}
	.overrides ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.overrides li {
		min-height: 30px;
		padding: 0;
	}
	.path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.who {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}
	.who > span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.email,
	.note,
	.fixed {
		color: var(--text-muted);
		font-size: 12px;
	}
	.note {
		margin-left: 6px;
	}
	.fixed {
		padding-right: 4px;
	}
	button.icon {
		display: grid;
		place-items: center;
		width: 28px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
	}
	.icon svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
	}
	.icon svg.dots {
		width: 18px;
		height: 18px;
		fill: currentColor;
		stroke: none;
	}
	.more {
		position: relative;
	}
	.menu {
		position: absolute;
		top: calc(100% + 2px);
		right: 0;
		z-index: 5;
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
		height: auto;
		padding: 5px 12px;
		border: 0;
		border-radius: 0;
		background: none;
		text-align: left;
	}
	.menu button:hover,
	.menu button:focus-visible {
		background: var(--panel-raised);
		outline: none;
	}
	.link .row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
	}
	.label {
		flex: 1;
	}
	.switch {
		position: relative;
		width: 36px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 10px;
		background: var(--handle);
	}
	.switch[aria-checked='true'] {
		background: var(--accent-bright);
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--text);
		transition: transform 0.15s;
	}
	.switch[aria-checked='true'] .knob {
		transform: translateX(16px);
	}
	.url {
		flex: 1;
		min-width: 0;
		color: var(--text-muted);
	}
	.hint {
		margin: 8px 0 0;
		color: var(--text-muted);
		font-size: 12px;
	}
</style>
