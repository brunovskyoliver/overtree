<script lang="ts">
	import { DEFAULT_IGNORE, type GitHubRepoInfo } from '#lib/github-types.ts';
	import type { GitHub } from '#lib/github.svelte.ts';
	import ConfirmDialog from './ConfirmDialog.svelte';

	// 012 contracts/ui.md "Settings dialog": connect (step 1), pick a repository and branch (step 2), finish the first
	// sync (a short step 3 until US5 brings the preview) and the linked settings (step 4). The owner manages; other
	// members see where the project syncs to.
	let { github, email }: { github: GitHub; email: string } = $props();

	let dialog: HTMLDialogElement;
	let confirm: ConfirmDialog;
	let isOpen = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let reposError = $state('');

	// step 2
	let query = $state('');
	let picked = $state<{ installationId: number; repo: GitHubRepoInfo } | null>(null);
	let branchList = $state<string[]>([]);
	let branch = $state('');
	let branchesLoading = $state(false);

	// step 4
	let changing = $state(false);
	let patterns = $state('');
	let saved = $state(false);

	const status = $derived(github.status);
	const link = $derived(status?.link ?? null);
	const owner = $derived(!!status?.canManage);
	const account = $derived(github.account);
	const connected = $derived(account?.connected === true);
	const groups = $derived(
		(github.repos?.accounts ?? []).map((a) => ({
			...a,
			repos: a.repos.filter((r) => r.fullName.toLowerCase().includes(query.trim().toLowerCase()))
		}))
	);
	const anyRepo = $derived((github.repos?.accounts ?? []).some((a) => a.repos.length));

	const STATE_TEXT: Record<string, string> = {
		'in-sync': 'In sync',
		unpushed: 'Not pushed yet',
		syncing: 'Syncing…',
		failed: 'Sync failed',
		'needs-reconnect': 'Needs attention: reconnect GitHub',
		'needs-access': 'Needs attention: no access to the repository',
		'owner-changed': 'Needs attention: the new owner has to confirm the link',
		pending: 'Finish setup'
	};

	export async function open() {
		error = '';
		reposError = '';
		changing = false;
		saved = false;
		loaded = false;
		dialog.showModal();
		isOpen = true;
		await Promise.all([github.load(), github.loadAccount()]);
		loaded = true;
		resetPatterns(false);
		if (github.status?.canManage && !github.status.link && github.account?.connected) await refreshRepos();
	}

	/** Called on `github` events while open: the link may have changed under us. */
	export async function refresh() {
		if (!isOpen) return;
		await github.load();
	}

	function resetPatterns(defaults: boolean) {
		patterns = (defaults ? DEFAULT_IGNORE : (link?.ignore ?? DEFAULT_IGNORE)).join('\n');
		saved = false;
	}

	async function refreshRepos() {
		reposError = '';
		const r = await github.loadRepos();
		if (r.error) {
			reposError = r.error;
			if (r.reconnect) await github.loadAccount();
		}
	}

	async function pick(installationId: number, repo: GitHubRepoInfo) {
		picked = { installationId, repo };
		branch = repo.defaultBranch;
		branchList = [repo.defaultBranch];
		branchesLoading = true;
		const r = await github.branches(repo.fullName);
		branchesLoading = false;
		if (picked?.repo.id !== repo.id) return;
		if ('branches' in r) {
			branchList = r.branches.length ? r.branches : [r.defaultBranch];
			branch = branchList.includes(r.defaultBranch) ? r.defaultBranch : branchList[0];
		} else error = r.error ?? '';
	}

	/** Runs an action; its error (if any) shows in the dialog. */
	async function run(action: () => Promise<{ error: string | null; reconnect?: boolean }>) {
		error = '';
		const r = await action();
		if (r.error) {
			error = r.error;
			if (r.reconnect) await github.loadAccount();
		}
		return !r.error;
	}

	async function linkRepo() {
		if (!picked || !branch) return;
		if (await run(() => github.link(picked!.installationId, picked!.repo.id, branch))) {
			picked = null;
			resetPatterns(false);
		}
	}

	async function disconnect() {
		const ok = await confirm.ask({
			title: 'Disconnect GitHub?',
			body: 'Projects you linked stop syncing until you reconnect. Nothing on GitHub changes.',
			confirmLabel: 'Disconnect',
			danger: true
		});
		if (ok) await run(() => github.disconnect());
	}

	async function unlink() {
		const ok = await confirm.ask({
			title: `Unlink ${link?.repo}?`,
			body: 'Overtree stops syncing. Nothing on GitHub or in this project is deleted.',
			confirmLabel: 'Unlink',
			danger: true
		});
		if (ok && (await run(() => github.unlink())) && connected) await refreshRepos();
	}

	async function cancelSetup() {
		if ((await run(() => github.unlink())) && connected) await refreshRepos();
	}

	async function startChange() {
		if (!link) return;
		changing = true;
		branch = link.branch;
		branchList = [link.branch];
		const r = await github.branches(link.repo);
		if ('branches' in r && r.branches.length) branchList = r.branches.includes(link.branch) ? r.branches : [link.branch, ...r.branches];
		else if (!('branches' in r)) error = r.error ?? '';
	}

	async function saveBranch() {
		if (branch === link?.branch) return void (changing = false);
		if (await run(() => github.patch({ branch }))) changing = false;
	}

	async function savePatterns(e: SubmitEvent) {
		e.preventDefault();
		saved = false;
		const list = patterns.split('\n').map((p) => p.trim()).filter(Boolean);
		if (await run(() => github.patch({ ignore: list }))) {
			resetPatterns(false);
			saved = true;
		}
	}
</script>

{#snippet lock()}
	<svg class="lock" viewBox="0 0 16 16" width="12" height="12" role="img" aria-label="Private"
		><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v7h-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg
	>
{/snippet}

{#snippet connection()}
	{#if account?.connected}
		<p class="connected">
			{#if account.avatarUrl}<img src={account.avatarUrl} alt="" width="20" height="20" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />{/if}
			Connected as <strong>@{account.login}</strong>
			<span aria-hidden="true">·</span>
			<button type="button" class="link-button" disabled={github.busy} onclick={disconnect}>Disconnect</button>
		</p>
	{/if}
{/snippet}

<dialog bind:this={dialog} aria-labelledby="github-title" onclose={() => ((isOpen = false), (picked = null), (query = ''))}>
	<div class="head">
		<h2 id="github-title">GitHub sync</h2>
		<form method="dialog"><button class="close" aria-label="Close">×</button></form>
	</div>

	{#if !loaded}
		<p class="muted" role="status">Loading…</p>
	{:else if !owner}
		<!-- members: where the project syncs to, nothing to change -->
		{#if link}
			<p>
				This project syncs with <a href={link.url} target="_blank" rel="noopener noreferrer">{link.repo}</a> on <strong>{link.branch}</strong>.
			</p>
			<p class="muted">{STATE_TEXT[link.state]} · linked by {link.linkedBy.name}</p>
		{:else}
			<p class="muted">This project isn’t linked to a GitHub repository.</p>
		{/if}
	{:else if !link}
		{#if !connected}
			<!-- step 1 -->
			<p>Connect a GitHub account to sync this project with a repository. You stay signed in to Overtree as {email}.</p>
			<div class="buttons">
				<a class="button primary" href={github.connectUrl}>Connect GitHub</a>
			</div>
		{:else}
			<!-- step 2 -->
			{@render connection()}
			{#if anyRepo}
				<input class="search" type="search" placeholder="Search repositories" aria-label="Search repositories" bind:value={query} />
				<div class="repos">
					{#each groups as g (g.installationId)}
						{#if g.repos.length}
							<fieldset>
								<legend>
									<img src={g.avatarUrl} alt="" width="16" height="16" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
									{g.login}
								</legend>
								{#each g.repos as r (r.id)}
									<label class="repo" class:selected={picked?.repo.id === r.id}>
										<input type="radio" name="github-repo" value={r.id} checked={picked?.repo.id === r.id} onchange={() => pick(g.installationId, r)} />
										<span class="name">{r.fullName}</span>
										{#if r.private}{@render lock()}{/if}
									</label>
								{/each}
							</fieldset>
						{/if}
					{/each}
					{#if !groups.some((g) => g.repos.length)}<p class="muted">No repository matches “{query}”.</p>{/if}
				</div>
				<p class="hint">
					Missing a repository? <a href={account?.installUrl} target="_blank" rel="noopener noreferrer">Grant access</a> on GitHub, then
					<button type="button" class="link-button" onclick={refreshRepos}>refresh the list</button>.
				</p>
				<div class="row">
					<label for="github-branch">Branch</label>
					<select id="github-branch" bind:value={branch} disabled={!picked || branchesLoading}>
						{#each branchList as b (b)}<option value={b}>{b}</option>{/each}
					</select>
					<span class="grow"></span>
					<button type="button" class="primary" disabled={!picked || !branch || github.busy} onclick={linkRepo}>Link repository</button>
				</div>
			{:else if github.repos}
				<p>No repositories yet. Install Overtree on your account or an organization.</p>
				<div class="buttons">
					<button type="button" onclick={refreshRepos}>Refresh list</button>
					<a class="button primary" href={account?.installUrl} target="_blank" rel="noopener noreferrer">Grant access</a>
				</div>
			{:else if !reposError}
				<p class="muted" role="status">Loading repositories…</p>
			{/if}
			{#if reposError}<p class="error" role="alert">{reposError}</p>{/if}
		{/if}
	{:else}
		{@render connection()}
		{#if !connected}
			<p class="warn">
				Your GitHub account isn’t connected, so this link can’t sync. <a href={github.connectUrl}>Reconnect GitHub</a>
			</p>
		{/if}
		{#if link.state === 'pending'}
			<!-- step 3, short until US5's preview -->
			<p>
				Linked to <a href={link.url} target="_blank" rel="noopener noreferrer">{link.repo}</a> on <strong>{link.branch}</strong>. Nothing has
				synced yet.
			</p>
			<p class="muted">
				Sync now merges both sides: where a file exists in both, this project’s version goes to GitHub; files only on GitHub are added to
				this project. Files matching the “not pulled” patterns stay on GitHub only.
			</p>
			{#if link.error}<p class="error" role="alert">{link.error}</p>{/if}
			<div class="buttons">
				<button type="button" disabled={github.busy} onclick={cancelSetup}>Cancel</button>
				<button type="button" class="primary" disabled={github.busy || !connected} onclick={() => run(() => github.confirm('merge'))}>Sync now</button>
			</div>
		{:else}
			<!-- step 4 -->
			<div class="row">
				<span class="grow">
					<a href={link.url} target="_blank" rel="noopener noreferrer">{link.repo}</a> on
					{#if changing}
						<select aria-label="Branch" bind:value={branch} disabled={github.busy}>
							{#each branchList as b (b)}<option value={b}>{b}</option>{/each}
						</select>
					{:else}
						<strong>{link.branch}</strong>
					{/if}
				</span>
				{#if changing}
					<button type="button" onclick={() => (changing = false)}>Cancel</button>
					<button type="button" class="primary" disabled={github.busy} onclick={saveBranch}>Save</button>
				{:else}
					<button type="button" disabled={!connected} onclick={startChange}>Change…</button>
					<button type="button" class="danger" disabled={github.busy} onclick={unlink}>Unlink</button>
				{/if}
			</div>
			<p class="muted">{STATE_TEXT[link.state]}</p>
			{#if link.error}<p class="error">{link.error}</p>{/if}
			<form class="patterns" onsubmit={savePatterns}>
				<label for="github-ignore">Not pulled from GitHub</label>
				<textarea id="github-ignore" rows="7" spellcheck="false" aria-describedby="github-ignore-hint" bind:value={patterns} oninput={() => (saved = false)}
				></textarea>
				<p class="hint" id="github-ignore-hint">
					One pattern per line. Matching files are neither pulled into this project nor pushed. <code>&lt;compile-output-pdf&gt;</code> is a PDF with
					a <code>.tex</code> of the same name beside it.
				</p>
				<div class="buttons">
					{#if saved}<span class="muted" role="status">Saved</span>{/if}
					<button type="button" onclick={() => resetPatterns(true)}>Reset to defaults</button>
					<button type="submit" class="primary" disabled={github.busy}>Save patterns</button>
				</div>
			</form>
		{/if}
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</dialog>

<ConfirmDialog bind:this={confirm} />

<style>
	dialog {
		width: 540px;
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
		margin-bottom: 8px;
	}
	h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}
	p {
		margin: 8px 0;
		line-height: 1.45;
	}
	a {
		color: var(--focus);
	}
	.muted,
	.hint {
		color: var(--text-muted);
	}
	.hint {
		font-size: 12px;
	}
	.error {
		color: #f28b82;
	}
	.warn {
		color: #f0c36d;
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
	.connected {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.connected img,
	legend img {
		border-radius: 50%;
	}
	input,
	select,
	textarea {
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	input.search,
	select {
		height: 30px;
		padding: 0 8px;
	}
	.search {
		width: 100%;
		box-sizing: border-box;
		margin: 4px 0 8px;
	}
	.repos {
		max-height: 260px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 0;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px 2px;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}
	.repo {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 10px;
		cursor: pointer;
	}
	.repo:hover,
	.repo.selected {
		background: var(--panel-raised);
	}
	.repo:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.repo .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repo input {
		margin: 0;
		accent-color: var(--accent-bright);
	}
	.lock {
		flex: none;
		color: var(--text-muted);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.buttons {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}
	button,
	.button {
		display: inline-flex;
		align-items: center;
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 15px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		text-decoration: none;
		cursor: pointer;
		box-sizing: border-box;
	}
	button:hover:not(:disabled),
	.button:hover {
		background: #3a4252;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.primary {
		border-color: transparent;
		background: var(--accent);
		font-weight: 600;
	}
	.primary:hover:not(:disabled) {
		background: #367a39;
	}
	button.danger {
		color: #f28b82;
	}
	.link-button {
		display: inline;
		height: auto;
		padding: 0;
		border: 0;
		background: none;
		color: var(--focus);
		text-decoration: underline;
	}
	.link-button:hover:not(:disabled) {
		background: none;
	}
	.patterns {
		margin-top: 16px;
	}
	.patterns label {
		display: block;
		margin-bottom: 6px;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 6px 8px;
		font-family: var(--font-mono);
		font-size: 12px;
		resize: vertical;
	}
	code {
		font-family: var(--font-mono);
	}
	:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
</style>
