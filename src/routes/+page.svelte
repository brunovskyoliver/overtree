<script lang="ts">
	import { goto } from '$app/navigation';
	import { blockedBy } from '#lib/auth.svelte.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import ProjectActions from '#lib/components/ProjectActions.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import { Menu } from '#lib/menu.svelte.ts';
	import { absoluteTime, relativeTime } from '#lib/time.ts';

	// contracts/ui.md "Dashboard": the user's own and shared projects, create (templates, zip), rename, duplicate,
	// delete, leave, search.
	type Role = 'owner' | 'editor' | 'reader';
	type Item = { id: string; title: string; owner: { id: string; name: string } | null; role: Role; updatedAt: number };
	type Template = 'blank' | 'article' | 'report' | 'beamer' | 'letter';
	const TEMPLATES: [Template, string][] = [
		['blank', 'Blank project'],
		['article', 'Article'],
		['report', 'Report'],
		['beamer', 'Beamer presentation'],
		['letter', 'Letter']
	];
	const ROLE: Record<Role, string> = { owner: 'Owner', editor: 'Editor', reader: 'Reader' };

	let projects = $state<Item[]>([]);
	let loaded = $state(false);
	let query = $state('');
	let error = $state('');
	let busy = $state<string | null>(null); // id of the row whose action is running
	let now = $state(Date.now());

	// rename in place
	let renaming = $state<string | null>(null);
	let renameValue = $state('');

	// "New project" dialog
	let dialog: HTMLDialogElement;
	let titleInput = $state<HTMLInputElement>();
	let template = $state<Template>('blank');
	let newTitle = $state('');
	let createError = $state('');
	let creating = $state(false);

	let zipInput: HTMLInputElement;
	let confirm: ConfirmDialog;
	const newMenu = new Menu();

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? projects.filter((p) => p.title.toLowerCase().includes(q)) : projects;
	});
	const validTitle = (t: string) => t.trim().length >= 1 && t.trim().length <= 120;

	/** JSON from the API, or null after showing why it failed. */
	async function call<T>(url: string, init?: RequestInit, onError = (m: string) => (error = m)): Promise<T | null> {
		const res = await fetch(url, init).catch(() => undefined);
		if (await blockedBy(res)) return null;
		if (!res) return (onError('Network error, try again.'), null);
		if (!res.ok) return (onError((await res.json().catch(() => null))?.message ?? `Request failed (${res.status}).`), null);
		return res.status === 204 ? ({} as T) : res.json();
	}
	const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

	async function load() {
		const r = await call<{ projects: Item[] }>('/api/projects');
		if (r) projects = r.projects;
		now = Date.now();
		loaded = true;
	}
	load();
	// relative times stay fresh while the page is open
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	function startNew(t: Template) {
		newMenu.open = false;
		template = t;
		newTitle = '';
		createError = '';
		dialog.showModal();
		titleInput?.focus();
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (!validTitle(newTitle)) return void (createError = 'The title must be 1–120 characters.');
		creating = true;
		const r = await call<{ id: string }>('/api/projects', jsonInit('POST', { title: newTitle, template }), (m) => (createError = m));
		creating = false;
		if (!r) return;
		dialog.close();
		goto(`/project/${r.id}`);
	}

	function pickZip() {
		newMenu.open = false;
		zipInput.click();
	}

	async function upload() {
		const file = zipInput.files?.[0];
		zipInput.value = '';
		if (!file) return;
		error = '';
		busy = 'upload';
		const form = new FormData();
		form.set('file', file);
		const r = await call<{ id: string }>('/api/projects/import', { method: 'POST', body: form });
		busy = null;
		if (r) goto(`/project/${r.id}`);
	}

	function startRename(p: Item) {
		renaming = p.id;
		renameValue = p.title;
	}

	async function commitRename(p: Item) {
		if (renaming !== p.id) return; // Escape got there first
		renaming = null;
		const title = renameValue.trim();
		if (title === p.title) return;
		if (!validTitle(title)) return void (error = 'The title must be 1–120 characters.');
		error = '';
		busy = p.id;
		const r = await call<{ title: string }>(`/api/projects/${p.id}`, jsonInit('PATCH', { title }));
		busy = null;
		if (r) await load();
	}

	function onrenamekey(e: KeyboardEvent, p: Item) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename(p);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			renaming = null;
		}
	}

	async function action(p: Item, a: 'rename' | 'duplicate' | 'delete' | 'leave') {
		if (a === 'rename') return startRename(p);
		error = '';
		if (a === 'delete') {
			const ok = await confirm.ask({
				title: `Delete “${p.title}”?`,
				body: 'Its files, history and compile output are removed for everyone. This can’t be undone.',
				confirmLabel: 'Delete',
				danger: true
			});
			if (!ok) return;
		}
		if (a === 'leave') {
			const ok = await confirm.ask({
				title: `Leave “${p.title}”?`,
				body: 'You lose access until the owner shares it with you again.',
				confirmLabel: 'Leave',
				danger: true
			});
			if (!ok) return;
		}
		busy = p.id;
		const url = `/api/projects/${p.id}${a === 'delete' ? '' : `/${a}`}`;
		const done = await call(url, { method: a === 'delete' ? 'DELETE' : 'POST' });
		busy = null;
		if (done) await load();
	}

	function autofocus(el: HTMLInputElement) {
		el.focus();
		el.select();
	}
</script>

<svelte:head>
	<title>Projects · Overtree</title>
</svelte:head>

<svelte:window onpointerdown={newMenu.onwindowpointerdown} />

{#snippet newButton()}
	<div class="new" bind:this={newMenu.root}>
		<button
			type="button"
			class="primary"
			aria-haspopup="menu"
			aria-expanded={newMenu.open}
			disabled={busy === 'upload'}
			bind:this={newMenu.toggle}
			onclick={newMenu.ontoggle}
			onkeydown={newMenu.ontogglekey}
		>
			New project
			<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
		</button>
		{#if newMenu.open}
			<div class="menu" role="menu" aria-label="New project" tabindex="-1" bind:this={newMenu.menu} onkeydown={newMenu.onmenukey}>
				{#each TEMPLATES as [id, label] (id)}
					<button type="button" role="menuitem" tabindex="-1" onclick={() => startNew(id)}>{label}</button>
				{/each}
				<hr />
				<button type="button" role="menuitem" tabindex="-1" onclick={pickZip}>Upload zip</button>
			</div>
		{/if}
	</div>
{/snippet}

<div class="page">
	<TopBar />

	<main>
		<div class="head">
			<h1>Projects</h1>
			<input class="search" type="text" placeholder="Search projects" aria-label="Search projects" bind:value={query} />
			{#if projects.length}{@render newButton()}{/if}
		</div>

		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if busy === 'upload'}<p class="muted" role="status">Uploading…</p>{/if}

		{#if !loaded}
			<!-- loading -->
		{:else if !projects.length}
			<div class="empty-state">
				<h2>No projects yet</h2>
				<p class="muted">Start from a blank document or a template, or upload a zip.</p>
				{@render newButton()}
			</div>
		{:else}
			<table>
				<thead>
					<tr><th>Title</th><th>Owner</th><th>Your role</th><th>Last modified</th><th><span class="sr">Actions</span></th></tr>
				</thead>
				<tbody>
					{#each shown as p (p.id)}
						<tr>
							<td class="title">
								{#if renaming === p.id}
									<input
										class="rename"
										type="text"
										maxlength="120"
										aria-label="New title for {p.title}"
										bind:value={renameValue}
										use:autofocus
										onkeydown={(e) => onrenamekey(e, p)}
										onblur={() => commitRename(p)}
									/>
								{:else}
									<a href="/project/{p.id}">{p.title}</a>
								{/if}
							</td>
							<td class="muted">{p.owner?.name ?? 'No owner'}</td>
							<td><span class="badge" class:owner={p.role === 'owner'}>{ROLE[p.role]}</span></td>
							<td class="muted" title={absoluteTime(p.updatedAt)}>{relativeTime(p.updatedAt, now)}</td>
							<td class="actions">
								<ProjectActions title={p.title} owner={p.role === 'owner'} disabled={busy === p.id} onaction={(a) => action(p, a)} />
							</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="empty">No projects match “{query.trim()}”.</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</main>
</div>

<input type="file" accept=".zip,application/zip" hidden bind:this={zipInput} onchange={upload} />

<dialog bind:this={dialog} aria-labelledby="new-title">
	<form onsubmit={create}>
		<h2 id="new-title">New project</h2>
		<p class="muted">{TEMPLATES.find(([id]) => id === template)?.[1]}</p>
		<label for="project-title">Project title</label>
		<input
			id="project-title"
			type="text"
			maxlength="120"
			autocomplete="off"
			aria-invalid={!!createError}
			bind:value={newTitle}
			bind:this={titleInput}
			oninput={() => (createError = '')}
		/>
		{#if createError}<p class="error" role="alert">{createError}</p>{/if}
		<div class="buttons">
			<button type="button" onclick={() => dialog.close()}>Cancel</button>
			<button type="submit" class="primary" disabled={creating || !validTitle(newTitle)}>Create</button>
		</div>
	</form>
</dialog>

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
		padding: 24px 24px 40px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
	}
	h1 {
		flex: 1;
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}
	.search {
		width: 280px;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		color: var(--text);
		font: inherit;
	}
	.new {
		position: relative;
	}
	.new .menu {
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
		text-align: left;
	}
	.menu button {
		padding: 5px 12px;
		border: 0;
		border-radius: 0;
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
	hr {
		width: 100%;
		margin: 4px 0;
		border: 0;
		border-top: 1px solid var(--border);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
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
	thead th:first-child {
		border-top-left-radius: 8px;
	}
	thead th:last-child {
		border-top-right-radius: 8px;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	tbody tr:hover {
		background: rgb(255 255 255 / 0.02);
	}
	.title {
		width: 45%;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.title a {
		color: var(--text);
		text-decoration: none;
	}
	.title a:hover {
		color: var(--focus);
		text-decoration: underline;
	}
	.rename {
		width: 100%;
		padding: 3px 6px;
		border: 1px solid var(--focus);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	.badge {
		padding: 1px 8px;
		border-radius: 9px;
		background: var(--panel-raised);
		font-size: 12px;
	}
	.badge.owner {
		background: var(--accent);
	}
	.actions {
		width: 1%;
		text-align: right;
		white-space: nowrap;
	}
	.muted {
		color: var(--text-muted);
	}
	.empty {
		padding: 24px;
		color: var(--text-muted);
		text-align: center;
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 64px 24px;
		border: 1px dashed var(--border);
		border-radius: 8px;
		text-align: center;
	}
	.empty-state h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
	}
	.empty-state p {
		margin: 0 0 8px;
	}
	.error {
		margin: 0 0 12px;
		color: #f28b82;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 5px 14px;
		border: 1px solid var(--border);
		border-radius: 13px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	button.primary {
		border-color: transparent;
		background: var(--accent);
		font-weight: 600;
	}
	button.primary:hover:not(:disabled) {
		background: #367a39;
	}
	dialog {
		width: 400px;
		padding: 18px 20px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	dialog h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	dialog p.muted {
		margin: 2px 0 14px;
	}
	dialog form {
		display: flex;
		flex-direction: column;
	}
	label {
		margin-bottom: 6px;
		font-weight: 500;
	}
	dialog input {
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	dialog input[aria-invalid='true'] {
		border-color: #f28b82;
	}
	dialog .error {
		margin: 8px 0 0;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 16px;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
