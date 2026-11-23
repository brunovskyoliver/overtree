<script lang="ts">
	import { tick } from 'svelte';
	import { blockedBy } from '#lib/auth.svelte.ts';
	import { absoluteTime, relativeTime } from '#lib/time.ts';
	import ConfirmDialog from './ConfirmDialog.svelte';

	// "Agent access" on the dashboard: personal access tokens for MCP clients (Claude Code, Codex) at /mcp. The token
	// text comes back once, from the create call; it lives only in `created` until the dialog closes.
	type TokenInfo = {
		id: string;
		name: string;
		prefix: string;
		project: { id: string; title: string } | null;
		createdAt: number;
		lastUsedAt: number | null;
	};
	let { projects }: { projects: { id: string; title: string }[] } = $props();
	const uid = $props.id();

	let dialog: HTMLDialogElement;
	let confirm: ConfirmDialog;
	let nameInput = $state<HTMLInputElement>();
	let tokenCopy = $state<HTMLButtonElement>();
	let tokens = $state<TokenInfo[] | null>(null);
	let name = $state('');
	let scope = $state(''); // '' for all projects
	let created = $state<{ token: string; info: TokenInfo } | null>(null);
	let error = $state('');
	let busy = $state(false);
	let copied = $state<string | null>(null);
	let now = $state(Date.now());

	const url = $derived(`${location.origin}/mcp`);
	const snippets = $derived.by(() => {
		if (!created) return [];
		const t = created.token;
		return [
			{ id: 'claude', label: 'Claude Code', hint: 'Run once in a terminal.', text: `claude mcp add --transport http --scope user overtree ${url} --header "Authorization: Bearer ${t}"` },
			{ id: 'codex', label: 'Codex', hint: 'Run once in a terminal.', text: `codex mcp add overtree --url ${url} --bearer-token-env-var OVERTREE_TOKEN` },
			{ id: 'codex-env', label: 'Codex token', hint: 'Codex reads the token from this variable. Add the line to your shell profile, e.g. ~/.zshrc.', text: `export OVERTREE_TOKEN=${t}` },
			{ id: 'codex-toml', label: 'Codex, by hand', hint: 'The same as the codex command, in ~/.codex/config.toml.', text: `[mcp_servers.overtree]\nurl = "${url}"\nbearer_token_env_var = "OVERTREE_TOKEN"` }
		];
	});

	/** Open the dialog; `projectId` preselects that project as the new token's scope. */
	export function open(projectId?: string) {
		name = '';
		scope = projectId ?? '';
		created = null;
		error = '';
		dialog.showModal();
		nameInput?.focus();
		load();
	}

	/** JSON from the API, or null after showing why it failed. */
	async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
		const res = await fetch(path, init).catch(() => undefined);
		if (await blockedBy(res)) return null;
		if (!res) return void (error = 'Network error, try again.'), null;
		if (!res.ok) return void (error = (await res.json().catch(() => null))?.message ?? `Request failed (${res.status}).`), null;
		return res.status === 204 ? ({} as T) : res.json();
	}

	async function load() {
		const r = await call<{ tokens: TokenInfo[] }>('/api/tokens');
		if (r) tokens = r.tokens;
		now = Date.now();
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		busy = true;
		const r = await call<{ token: string; info: TokenInfo }>('/api/tokens', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, projectId: scope || null })
		});
		busy = false;
		if (!r) return;
		created = r;
		name = '';
		await load();
		tokenCopy?.focus();
	}

	async function revoke(t: TokenInfo) {
		const ok = await confirm.ask({
			title: `Revoke “${t.name}”?`,
			body: 'Agents using this token lose access right away. This can’t be undone.',
			confirmLabel: 'Revoke',
			danger: true
		});
		if (!ok) return;
		error = '';
		busy = true;
		const done = await call(`/api/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
		busy = false;
		if (!done) return;
		if (created?.info.id === t.id) created = null;
		await load();
	}

	async function done() {
		created = null;
		await tick();
		nameInput?.focus();
	}

	async function copy(id: string, text: string) {
		await navigator.clipboard?.writeText(text).catch(() => {});
		copied = id;
		setTimeout(() => copied === id && (copied = null), 2000);
	}
</script>

<dialog bind:this={dialog} aria-labelledby="{uid}-title" aria-describedby="{uid}-about" onclose={() => (created = null)}>
	<div class="head">
		<h2 id="{uid}-title">Agent access</h2>
		<form method="dialog"><button class="close" aria-label="Close">×</button></form>
	</div>
	<p class="about" id="{uid}-about">
		Connect Claude Code or Codex to your projects over MCP. A token acts as you, with your own role in each project. A token
		for one project sees only that project.
	</p>

	{#if created}
		<section class="created" aria-labelledby="{uid}-created">
			<h3 id="{uid}-created">Token “{created.info.name}” created</h3>
			<p class="warn">Copy it now. You won’t see it again; if you lose it, revoke it and create another.</p>
			<div class="row">
				<input class="mono" type="text" readonly aria-label="New token" value={created.token} onfocus={(e) => e.currentTarget.select()} />
				<button type="button" class="primary" bind:this={tokenCopy} onclick={() => copy('token', created!.token)}>
					{copied === 'token' ? 'Copied' : 'Copy token'}
				</button>
			</div>
			{#each snippets as s (s.id)}
				<div class="snippet">
					<div class="snippet-head">
						<span class="label" id="{uid}-{s.id}">{s.label}</span>
						<button type="button" class="small" aria-label="Copy {s.label}" onclick={() => copy(s.id, s.text)}>{copied === s.id ? 'Copied' : 'Copy'}</button>
					</div>
					<pre aria-labelledby="{uid}-{s.id}">{s.text}</pre>
					<p class="hint">{s.hint}</p>
				</div>
			{/each}
			<div class="buttons"><button type="button" onclick={done}>Done</button></div>
		</section>
	{:else}
		<form class="new" onsubmit={create}>
			<div class="field">
				<label for="{uid}-name">Name</label>
				<input
					id="{uid}-name"
					type="text"
					maxlength="60"
					autocomplete="off"
					placeholder="Claude Code on my laptop"
					bind:value={name}
					bind:this={nameInput}
					oninput={() => (error = '')}
				/>
			</div>
			<div class="field">
				<label for="{uid}-scope">Projects</label>
				<select id="{uid}-scope" bind:value={scope}>
					<option value="">All my projects</option>
					{#each projects as p (p.id)}<option value={p.id}>{p.title}</option>{/each}
				</select>
			</div>
			<button type="submit" class="primary" disabled={busy || !name.trim()}>Create token</button>
		</form>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<h3 id="{uid}-list">Your tokens</h3>
	{#if tokens && !tokens.length}
		<p class="hint">No tokens yet.</p>
	{:else}
		<ul aria-labelledby="{uid}-list">
			{#each tokens ?? [] as t (t.id)}
				<li>
					<span class="who">
						<span class="name">{t.name}</span>
						<span class="meta">
							{t.project ? t.project.title : 'All projects'} · <span class="mono">{t.prefix}…</span> ·
							<span title={absoluteTime(t.createdAt)}>created {relativeTime(t.createdAt, now)}</span> ·
							{#if t.lastUsedAt}<span title={absoluteTime(t.lastUsedAt)}>used {relativeTime(t.lastUsedAt, now)}</span>{:else}never used{/if}
						</span>
					</span>
					<button type="button" aria-label="Revoke {t.name}" disabled={busy} onclick={() => revoke(t)}>Revoke</button>
				</li>
			{/each}
		</ul>
	{/if}
</dialog>

<ConfirmDialog bind:this={confirm} />

<style>
	dialog {
		width: 560px;
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 32px);
		padding: 16px 20px 20px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-dialog);
	}
	dialog::backdrop {
		background: var(--backdrop);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
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
	.created h3 {
		color: var(--text);
		text-transform: none;
		letter-spacing: 0;
		font-size: 14px;
	}
	.about,
	.hint,
	.meta {
		color: var(--text-muted);
	}
	.about {
		margin: 0 0 12px;
	}
	.hint {
		margin: 4px 0 0;
		font-size: 12px;
	}
	.warn {
		margin: 0 0 8px;
		padding: 6px 10px;
		border-radius: 4px;
		background: var(--warn-surface);
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
	.new {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 8px;
	}
	.field {
		display: flex;
		flex: 1 1 180px;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	label,
	.label {
		font-weight: 500;
	}
	input,
	select {
		height: 30px;
		min-width: 0;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	.mono,
	pre {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	button {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 15px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		white-space: nowrap;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--button-hover);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.primary {
		border-color: transparent;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}
	button.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	button.small {
		height: 24px;
		padding: 0 10px;
		font-size: 12px;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.row input {
		flex: 1;
	}
	.snippet {
		margin-top: 12px;
	}
	.snippet-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	pre {
		margin: 0;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		margin-top: 12px;
	}
	.error {
		margin: 8px 0 0;
		color: var(--error);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 4px 0;
		border-top: 1px solid var(--border);
	}
	li:first-child {
		border-top: 0;
	}
	.who {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}
	.name {
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.meta {
		font-size: 12px;
		overflow-wrap: anywhere;
	}
</style>
