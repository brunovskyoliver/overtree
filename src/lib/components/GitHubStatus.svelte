<script lang="ts">
	import { tick } from 'svelte';
	import type { GitHubRun, GitHubState, MergeNoteReason } from '#lib/github-types.ts';
	import type { GitHub } from '#lib/github.svelte.ts';
	import { absoluteTime, relativeTime } from '#lib/time.ts';

	// 012 contracts/ui.md "Top bar indicator" (US4, FR-025, FR-026): for a linked project everyone sees the state and
	// opens a popover with the details; editors and the owner push or pull on demand, the owner gets the fix-it
	// actions and the settings. An unlinked project shows the owner a muted "GitHub" button opening the settings.
	let { github, onsettings }: { github: GitHub; onsettings: (opts?: { changeBranch?: boolean }) => void } = $props();

	const STATE_TEXT: Record<GitHubState, string> = {
		'in-sync': 'In sync',
		unpushed: 'Not pushed yet',
		syncing: 'Syncing…',
		failed: 'Sync failed',
		'needs-reconnect': 'Needs attention',
		'needs-access': 'Needs attention',
		'owner-changed': 'Needs attention',
		pending: 'Finish setup'
	};
	const NOTE_TEXT: Record<MergeNoteReason, string> = {
		overlap: 'overlapping edits in',
		'kept-deleted': 'kept, though deleted on GitHub:',
		'kept-binary': 'kept your version of',
		'skipped-name': 'skipped (file name not allowed):',
		'skipped-size': 'skipped (too large):'
	};
	const TRIGGER_TEXT: Record<string, string> = {
		'session-end': 'after a session',
		'long-session': 'during a long session',
		open: 'on open',
		periodic: 'periodic',
		manual: 'manual',
		startup: 'at startup',
		retry: 'retry',
		link: 'first sync'
	};

	const status = $derived(github.status);
	const link = $derived(status?.link ?? null);
	const owner = $derived(!!status?.canManage);

	let open = $state(false);
	let root = $state<HTMLElement>();
	let toggle = $state<HTMLButtonElement>();
	let panel = $state<HTMLElement>();
	let title = $state('');
	let error = $state('');
	let message = $state('');
	let now = $state(Date.now());

	// relative times stay fresh while the popover is open
	$effect(() => {
		if (!open) return;
		now = Date.now();
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '');
	const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

	async function show() {
		open = true;
		error = '';
		message = '';
		if (owner) void github.loadAccount(); // "Grant access" needs the install URL
		await tick();
		(panel?.querySelector<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), summary') ?? panel)?.focus();
	}

	function close(refocus = true) {
		open = false;
		if (refocus) toggle?.focus();
	}

	function onkey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		close();
	}

	// focus leaving the popover (Tab past the end) closes it
	function onfocusout(e: FocusEvent) {
		if (open && e.relatedTarget instanceof Node && !root?.contains(e.relatedTarget)) open = false;
	}

	function onwindowpointerdown(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}

	function settings(opts?: { changeBranch?: boolean }) {
		close(false);
		onsettings(opts);
	}

	async function act(fn: () => Promise<{ error: string | null; done?: boolean; outcome?: { result: string; commit?: string } }>, kind: 'push' | 'pull') {
		error = '';
		message = '';
		const r = await fn();
		if (r.error) return void (error = r.error);
		if (r.done === false) return void (message = 'Still running; the status updates when it’s done.');
		const o = r.outcome;
		if (o?.result === 'pushed') message = `Pushed ${short(o.commit)}.`;
		else if (o?.result === 'pulled') message = `Pulled ${short(o.commit)}.`;
		else message = kind === 'push' ? 'Nothing to push.' : 'Nothing new on GitHub.';
		if (kind === 'push') title = '';
	}

	const push = (e: SubmitEvent) => {
		e.preventDefault();
		return act(() => github.push(title.trim() || undefined), 'push');
	};

	async function simple(fn: () => Promise<{ error: string | null }>) {
		error = '';
		message = '';
		const r = await fn();
		if (r.error) error = r.error;
	}

	function runText(r: GitHubRun) {
		const what = r.kind === 'push' ? 'Push' : r.kind === 'pull' ? 'Pull' : 'Import';
		const outcome =
			r.result === 'failed'
				? 'failed'
				: r.result === 'noop'
					? 'nothing to do'
					: `${r.result === 'pushed' ? 'pushed' : 'pulled'} ${short(r.commit)}`;
		return `${what} (${TRIGGER_TEXT[r.trigger] ?? r.trigger}): ${outcome}`;
	}
</script>

<svelte:window onpointerdown={onwindowpointerdown} />

{#snippet mark()}
	<svg class="mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
		><path
			d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
		/></svg
	>
{/snippet}

{#if status && !link && owner}
	<!-- unlinked: only the owner, a way into the settings -->
	<button type="button" id="github-open" class="pill muted" aria-haspopup="dialog" onclick={() => onsettings()}>
		{@render mark()}
		GitHub
	</button>
{:else if link}
	<div class="wrap" bind:this={root} onkeydown={onkey} {onfocusout} role="presentation">
		<button
			type="button"
			id="github-status"
			class="pill"
			data-state={link.state}
			aria-label="GitHub: {link.repo}, {STATE_TEXT[link.state]}"
			aria-haspopup="dialog"
			aria-expanded={open}
			aria-controls="github-popover"
			bind:this={toggle}
			onclick={() => (open ? close() : show())}
		>
			{@render mark()}
			{#if link.state === 'syncing'}
				<span class="spinner" aria-hidden="true"></span>
			{:else}
				<span class="dot {link.state}" aria-hidden="true"></span>
			{/if}
			<span class="text">{STATE_TEXT[link.state]}</span>
		</button>
		{#if open}
			<div id="github-popover" class="popover" role="dialog" aria-label="GitHub sync" tabindex="-1" bind:this={panel}>
				<p class="repo">
					{@render mark()}
					<a href={link.url} target="_blank" rel="noopener noreferrer">{link.repo}</a>
					<span class="muted">on</span>
					<strong>{link.branch}</strong>
				</p>
				<p class="state">
					{#if link.state === 'syncing'}<span class="spinner" aria-hidden="true"></span>{:else}<span class="dot {link.state}" aria-hidden="true"></span>{/if}
					{STATE_TEXT[link.state]}
				</p>
				{#if link.lastCommit}
					<p class="muted">
						Last synced <time datetime={new Date(link.lastCommit.at).toISOString()} title={absoluteTime(link.lastCommit.at)}
							>{relativeTime(link.lastCommit.at, now)}</time
						>
						·
						<a href={link.lastCommit.url} target="_blank" rel="noopener noreferrer" class="sha">{short(link.lastCommit.sha)}</a>
					</p>
				{:else}
					<p class="muted">Not synced yet.</p>
				{/if}

				{#if link.error}
					<p class="error">{link.error}</p>
				{/if}
				{#if link.state === 'failed' && link.nextAttemptAt}
					<p class="muted">Retrying at {clock(link.nextAttemptAt)}.</p>
				{/if}

				{#if owner}
					{#if link.state === 'needs-reconnect'}
						<div class="buttons">
							<button type="button" disabled={github.busy} onclick={() => simple(() => github.patch({ recheck: true }))}>Check again</button>
							<a class="button primary" href={github.connectUrl}>Reconnect GitHub</a>
						</div>
					{:else if link.state === 'needs-access' && link.branchMissing}
						<div class="buttons">
							<button type="button" onclick={() => settings({ changeBranch: true })}>Choose branch</button>
							<button type="button" class="primary" disabled={github.busy} onclick={() => simple(() => github.createBranch())}>Create branch</button>
						</div>
					{:else if link.state === 'needs-access'}
						<div class="buttons">
							<button type="button" onclick={() => settings({ changeBranch: true })}>Choose branch</button>
							<button type="button" id="github-recheck" disabled={github.busy} onclick={() => simple(() => github.patch({ recheck: true }))}>Check again</button>
							{#if github.account}
								<a class="button primary" href={github.account.installUrl} target="_blank" rel="noopener noreferrer">Grant access</a>
							{/if}
						</div>
					{:else if link.state === 'owner-changed'}
						<div class="buttons">
							{#if github.account && !github.account.connected}
								<a class="button" href={github.connectUrl}>Connect GitHub</a>
							{/if}
							<button type="button" class="primary" disabled={github.busy} onclick={() => simple(() => github.patch({ confirmOwner: true }))}>Take over link</button>
						</div>
					{:else if link.state === 'pending'}
						<div class="buttons"><button type="button" class="primary" onclick={() => settings()}>Finish setup</button></div>
					{/if}
				{/if}

				{#if link.note}
					<div class="note">
						<p>From the sync on {absoluteTime(link.note.at)}:</p>
						<ul>
							{#each link.note.files as f (f.path)}
								<li>{NOTE_TEXT[f.reason]} <code>{f.path}</code></li>
							{/each}
						</ul>
						{#if owner}
							<button type="button" class="link-button" disabled={github.busy} onclick={() => simple(() => github.patch({ dismissNote: true }))}>Dismiss</button>
						{/if}
					</div>
				{/if}

				{#if status?.canSync}
					<form class="sync" onsubmit={push}>
						<input
							type="text"
							maxlength="72"
							placeholder="Commit title (optional)"
							aria-label="Commit title (optional)"
							bind:value={title}
							disabled={github.busy}
						/>
						<div class="buttons">
							<button type="button" disabled={github.busy} onclick={() => act(() => github.pull(), 'pull')}>Pull now</button>
							<button type="submit" class="primary" disabled={github.busy}>Push now</button>
						</div>
					</form>
				{/if}
				{#if message}<p class="muted" role="status">{message}</p>{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}

				{#if status?.runs?.length}
					<details>
						<summary>Recent syncs</summary>
						<ul class="runs">
							{#each status.runs as r, i (i)}
								<li class:failed={r.result === 'failed'}>
									<span>{runText(r)}{r.user ? ` · ${r.user.name}` : ''}</span>
									<time class="muted" datetime={new Date(r.at).toISOString()} title={absoluteTime(r.at)}>{relativeTime(r.at, now)}</time>
									{#if r.error}<span class="run-error">{r.error}</span>{/if}
								</li>
							{/each}
						</ul>
					</details>
				{/if}

				{#if owner}
					<div class="footer"><button type="button" class="link-button" onclick={() => settings()}>Settings…</button></div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		position: relative;
	}
	.pill {
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
		white-space: nowrap;
		cursor: pointer;
	}
	.pill.muted {
		color: var(--text-muted);
	}
	.pill:hover,
	.pill[aria-expanded='true'] {
		background: var(--panel-raised);
		color: var(--text);
	}
	.mark {
		flex: none;
		fill: currentColor;
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #8a8a8a;
	}
	.dot.in-sync {
		background: #4caf50;
	}
	.dot.unpushed {
		background: #e0a526;
	}
	.dot.failed,
	.dot.needs-reconnect,
	.dot.needs-access,
	.dot.owner-changed {
		background: #f28b82;
	}
	.spinner {
		flex: none;
		width: 10px;
		height: 10px;
		border: 2px solid var(--text-muted);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 3s;
		}
	}
	.popover {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 340px;
		max-width: calc(100vw - 24px);
		max-height: calc(100vh - 70px);
		overflow-y: auto;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
		font-size: 13px;
	}
	.popover:focus {
		outline: none;
	}
	.popover p {
		margin: 0;
	}
	.repo {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-size: 14px;
	}
	.repo a {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	a {
		color: var(--accent-bright, #8ab4f8);
	}
	.sha {
		font-family: var(--mono, monospace);
	}
	.muted {
		color: var(--text-muted);
	}
	.error {
		color: #f28b82;
	}
	.note {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel-raised);
	}
	.note ul,
	.runs {
		margin: 4px 0 0;
		padding-left: 18px;
	}
	.note code {
		font-size: 12px;
	}
	.sync {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 8px;
		border-top: 1px solid var(--border);
	}
	.sync input {
		padding: 5px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	.sync input:focus {
		border-color: var(--focus);
		outline: none;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.buttons button,
	.button {
		padding: 4px 12px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: none;
		color: var(--text);
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.buttons .primary {
		border-color: var(--accent);
		background: var(--accent);
	}
	.buttons button:hover:not(:disabled),
	.button:hover {
		filter: brightness(1.15);
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.link-button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent-bright, #8ab4f8);
		font: inherit;
		cursor: pointer;
	}
	.link-button:hover {
		text-decoration: underline;
	}
	details summary {
		color: var(--text-muted);
		cursor: pointer;
	}
	.runs li {
		margin: 4px 0;
	}
	.runs li span {
		margin-right: 6px;
	}
	.runs li.failed > span:first-child {
		color: #f28b82;
	}
	.run-error {
		display: block;
		color: var(--text-muted);
		font-size: 12px;
	}
	.footer {
		display: flex;
		justify-content: flex-end;
		padding-top: 6px;
		border-top: 1px solid var(--border);
	}
</style>
