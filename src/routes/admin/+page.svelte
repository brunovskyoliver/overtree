<script lang="ts">
	import { auth, blockedBy } from '#lib/auth.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import { colorFor } from '#lib/presence.ts';
	import { absoluteTime, relativeTime } from '#lib/time.ts';

	// contracts/ui.md "Admin": Users / Projects / Settings tabs. Non-admins get "Not found" (the API says 403 anyway).
	type User = { id: string; email: string; name: string; avatarUrl: string | null; role: 'admin' | 'user'; disabled: boolean; lastSeenAt: number; projectCount: number };
	type Project = { id: string; title: string; owner: { id: string; name: string; email: string } | null; collaborators: number; updatedAt: number };
	type Tab = 'users' | 'projects' | 'settings';
	const TABS: [Tab, string][] = [
		['users', 'Users'],
		['projects', 'Projects'],
		['settings', 'Settings']
	];
	const LAST_ADMIN = 'The last admin can’t be removed or disabled.';

	let tab = $state<Tab>('users');
	let me = $state(auth.me);
	let loaded = $state(false);
	let users = $state<User[]>([]);
	let projects = $state<Project[]>([]);
	let query = $state('');
	let error = $state(''); // the last failed action, shown above the tables
	let busy = $state<string | null>(null); // id of the row whose action is running

	let signupMode = $state<'open' | 'invite'>('invite');
	let allowlistText = $state('');
	let settingsError = $state('');
	let saved = $state(false);
	let saving = $state(false);

	let confirm: ConfirmDialog;
	let tabButtons: HTMLButtonElement[] = [];

	const admin = $derived(me?.role === 'admin');
	const enabledAdmins = $derived(users.filter((u) => u.role === 'admin' && !u.disabled).length);
	const isLastAdmin = (u: User) => u.role === 'admin' && !u.disabled && enabledAdmins <= 1;
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.includes(q)) : users;
	});

	/** JSON from an admin route, or null after showing why it failed. */
	async function call<T>(url: string, init?: RequestInit, onError = (m: string) => (error = m)): Promise<T | null> {
		const res = await fetch(url, init && { ...init, headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
		if (await blockedBy(res)) return null;
		if (!res) return (onError('Network error, try again.'), null);
		if (!res.ok) return (onError((await res.json().catch(() => null))?.message ?? `Request failed (${res.status}).`), null);
		return res.status === 204 ? ({} as T) : res.json();
	}

	async function load() {
		me = auth.me ?? (await auth.loadMe());
		loaded = true;
		if (me?.role !== 'admin') return;
		const [u, p, s] = await Promise.all([
			call<{ users: User[] }>('/api/admin/users'),
			call<{ projects: Project[] }>('/api/admin/projects'),
			call<{ signupMode: 'open' | 'invite'; allowlist: string[] }>('/api/admin/settings')
		]);
		if (u) users = u.users;
		if (p) projects = p.projects;
		if (s) {
			signupMode = s.signupMode;
			allowlistText = s.allowlist.join('\n');
		}
	}
	load();

	async function patch(u: User, change: { role?: 'admin' | 'user'; disabled?: boolean }) {
		error = '';
		busy = u.id;
		const updated = await call<User>(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: 'PATCH', body: JSON.stringify(change) });
		busy = null;
		if (updated) users = users.map((x) => (x.id === u.id ? updated : x));
		// demoting yourself: this page is no longer yours
		if (updated && u.id === me?.id && updated.role !== 'admin') location.assign('/');
	}

	async function remove(p: Project) {
		const ok = await confirm.ask({
			title: `Delete “${p.title}”?`,
			body: 'Its files, history and compile output are removed for everyone. This can’t be undone.',
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return;
		error = '';
		busy = p.id;
		const done = await call(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
		busy = null;
		if (done) {
			projects = projects.filter((x) => x.id !== p.id);
			if (p.owner) users = users.map((u) => (u.id === p.owner!.id ? { ...u, projectCount: Math.max(0, u.projectCount - 1) } : u));
		}
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		settingsError = '';
		saved = false;
		saving = true;
		const allowlist = allowlistText.split('\n');
		const s = await call<{ signupMode: 'open' | 'invite'; allowlist: string[] }>(
			'/api/admin/settings',
			{ method: 'PUT', body: JSON.stringify({ signupMode, allowlist }) },
			(m) => (settingsError = m)
		);
		saving = false;
		if (!s) return;
		allowlistText = s.allowlist.join('\n');
		saved = true;
	}

	// ARIA tabs: arrow keys move between tabs and select them
	function ontabkey(e: KeyboardEvent, i: number) {
		const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
		if (to === undefined) return;
		e.preventDefault();
		const j = (to + TABS.length) % TABS.length;
		tab = TABS[j][0];
		tabButtons[j].focus();
	}
</script>

<svelte:head>
	<title>{admin ? 'Admin' : 'Not found'} · Overtree</title>
</svelte:head>

<div class="page">
	<TopBar>
		{#snippet title()}{admin ? 'Admin' : ''}{/snippet}
	</TopBar>

	{#if !loaded}
		<!-- loading /api/me -->
	{:else if !admin}
		<main class="notfound">
			<h1>Not found</h1>
			<a href="/">Back to dashboard</a>
		</main>
	{:else}
		<main>
			<div role="tablist" aria-label="Admin" class="tabs">
				{#each TABS as [id, label], i (id)}
					<button
						type="button"
						role="tab"
						id="tab-{id}"
						aria-controls="panel-{id}"
						aria-selected={tab === id}
						tabindex={tab === id ? 0 : -1}
						bind:this={tabButtons[i]}
						onclick={() => (tab = id)}
						onkeydown={(e) => ontabkey(e, i)}
					>
						{label}
						{#if id === 'users'}<span class="count">{users.length}</span>{/if}
						{#if id === 'projects'}<span class="count">{projects.length}</span>{/if}
					</button>
				{/each}
			</div>

			{#if error}<p class="error" role="alert">{error}</p>{/if}

			{#if tab === 'users'}
				<div id="panel-users" role="tabpanel" aria-labelledby="tab-users">
					<input class="search" type="text" placeholder="Search by name or email" aria-label="Search users" bind:value={query} />
					<table>
						<thead>
							<tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last seen</th><th class="num">Projects</th><th><span class="sr">Actions</span></th></tr>
						</thead>
						<tbody>
							{#each shown as u (u.id)}
								{@const last = isLastAdmin(u)}
								<tr class:off={u.disabled}>
									<td>
										<span class="who">
											<Avatar name={u.name} avatarUrl={u.avatarUrl} color={colorFor(u.id)} size={24} />
											{u.name}
											{#if u.id === me?.id}<span class="you">you</span>{/if}
										</span>
									</td>
									<td class="muted">{u.email}</td>
									<td><span class="badge" class:admin={u.role === 'admin'}>{u.role === 'admin' ? 'Admin' : 'User'}</span></td>
									<td><span class="status" class:disabled={u.disabled}>{u.disabled ? 'Disabled' : 'Active'}</span></td>
									<td class="muted" title={absoluteTime(u.lastSeenAt)}>{relativeTime(u.lastSeenAt)}</td>
									<td class="num">{u.projectCount}</td>
									<td class="actions">
										<!-- disabled buttons get no hover events: the tooltip sits on a wrapper -->
										<span title={last && u.role === 'admin' ? LAST_ADMIN : undefined}>
											<button type="button" disabled={busy === u.id || (u.role === 'admin' && last)} onclick={() => patch(u, { role: u.role === 'admin' ? 'user' : 'admin' })}>
												{u.role === 'admin' ? 'Remove admin' : 'Make admin'}
											</button>
										</span>
										<span title={last ? LAST_ADMIN : undefined}>
											<button type="button" class:danger={!u.disabled} disabled={busy === u.id || last} onclick={() => patch(u, { disabled: !u.disabled })}>
												{u.disabled ? 'Enable' : 'Disable'}
											</button>
										</span>
									</td>
								</tr>
							{:else}
								<tr><td colspan="7" class="empty">{query ? 'No users match.' : 'No users yet.'}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if tab === 'projects'}
				<div id="panel-projects" role="tabpanel" aria-labelledby="tab-projects">
					<p class="hint">Admins can delete any project but only open the ones they are invited to.</p>
					<table>
						<thead>
							<tr><th>Title</th><th>Owner</th><th class="num">Collaborators</th><th>Last modified</th><th><span class="sr">Actions</span></th></tr>
						</thead>
						<tbody>
							{#each projects as p (p.id)}
								<tr>
									<td class="title">{p.title}</td>
									<td>
										{#if p.owner}{p.owner.name} <span class="muted">{p.owner.email}</span>{:else}<span class="muted">No owner</span>{/if}
									</td>
									<td class="num">{p.collaborators}</td>
									<td class="muted" title={absoluteTime(p.updatedAt)}>{relativeTime(p.updatedAt)}</td>
									<td class="actions">
										<button type="button" class="danger" aria-label="Delete {p.title}" disabled={busy === p.id} onclick={() => remove(p)}>Delete</button>
									</td>
								</tr>
							{:else}
								<tr><td colspan="5" class="empty">No projects yet.</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
					<form class="settings" onsubmit={save} oninput={() => (saved = false)}>
						<div role="radiogroup" aria-labelledby="signup-label" class="field">
							<span id="signup-label" class="label">Sign-up</span>
							<label class="radio">
								<input type="radio" name="signup" value="open" bind:group={signupMode} />
								<span>Open to anyone<small>Anyone who signs in gets an account.</small></span>
							</label>
							<label class="radio">
								<input type="radio" name="signup" value="invite" bind:group={signupMode} />
								<span>Invite only<small>New people need an allowed email or a project invite. Existing users are unaffected.</small></span>
							</label>
						</div>
						<div class="field">
							<label class="label" for="allowlist">Allowed emails and domains</label>
							<textarea
								id="allowlist"
								rows="8"
								spellcheck="false"
								placeholder={'jane@example.org\n@example.org'}
								aria-describedby="allowlist-help"
								aria-invalid={!!settingsError}
								bind:value={allowlistText}
							></textarea>
							<small id="allowlist-help">One per line: a full email, or @domain for everyone at that domain.</small>
						</div>
						{#if settingsError}<p class="error" role="alert">{settingsError}</p>{/if}
						<div class="save">
							<button type="submit" class="primary" disabled={saving}>Save</button>
							{#if saved}<span role="status">Saved</span>{/if}
						</div>
					</form>
				</div>
			{/if}
		</main>
	{/if}
</div>

<ConfirmDialog bind:this={confirm} />

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}
	main {
		width: 100%;
		max-width: 1080px;
		margin: 0 auto;
		padding: 20px 24px 40px;
	}
	.notfound {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding-top: 20vh;
	}
	.notfound h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}
	a {
		color: var(--focus);
	}
	.tabs {
		display: flex;
		gap: 4px;
		margin-bottom: 16px;
		border-bottom: 1px solid var(--border);
	}
	[role='tab'] {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: -1px;
		padding: 8px 14px;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--text-muted);
		font: inherit;
		font-weight: 500;
		cursor: pointer;
	}
	[role='tab']:hover {
		color: var(--text);
	}
	[role='tab'][aria-selected='true'] {
		border-bottom-color: var(--accent-bright);
		color: var(--text);
	}
	.count {
		padding: 0 6px;
		border-radius: 8px;
		background: var(--panel-raised);
		color: var(--text-muted);
		font-size: 12px;
	}
	.search {
		width: 280px;
		margin-bottom: 12px;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		color: var(--text);
		font: inherit;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		overflow: hidden;
	}
	th,
	td {
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: middle;
	}
	th {
		background: var(--bg);
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	tbody tr:hover {
		background: rgb(255 255 255 / 0.02);
	}
	tr.off td:not(.actions) {
		opacity: 0.55;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: var(--text-muted);
	}
	.title {
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.you {
		color: var(--text-muted);
		font-size: 12px;
	}
	.badge,
	.status {
		padding: 1px 8px;
		border-radius: 9px;
		background: var(--panel-raised);
		font-size: 12px;
	}
	.badge.admin {
		background: var(--accent);
	}
	.status {
		background: none;
		color: var(--accent-bright);
	}
	.status.disabled {
		color: #f28b82;
	}
	.actions {
		text-align: right;
		white-space: nowrap;
	}
	.actions span {
		display: inline-block;
	}
	.empty {
		padding: 24px;
		color: var(--text-muted);
		text-align: center;
	}
	button:not([role='tab']) {
		padding: 4px 12px;
		border: 1px solid var(--border);
		border-radius: 13px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	button:not([role='tab']):hover:not(:disabled) {
		background: #3a4252;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	button.danger:hover:not(:disabled) {
		border-color: transparent;
		background: #b23b3b;
	}
	button.primary {
		border-color: transparent;
		background: var(--accent);
		font-weight: 600;
	}
	button.primary:hover:not(:disabled) {
		background: #367a39;
	}
	.hint {
		margin: 0 0 12px;
		color: var(--text-muted);
	}
	.error {
		margin: 0 0 12px;
		color: #f28b82;
	}
	.settings {
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 560px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.label {
		font-weight: 600;
	}
	.radio {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		cursor: pointer;
	}
	.radio:has(input:checked) {
		border-color: var(--accent-bright);
	}
	.radio input {
		margin-top: 3px;
		accent-color: var(--accent-bright);
	}
	.radio span {
		display: flex;
		flex-direction: column;
	}
	small {
		color: var(--text-muted);
		font-size: 12px;
	}
	textarea {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		color: var(--text);
		font: 13px/1.5 var(--font-mono);
		resize: vertical;
	}
	textarea[aria-invalid='true'] {
		border-color: #f28b82;
	}
	.save {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.save [role='status'] {
		color: var(--accent-bright);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
