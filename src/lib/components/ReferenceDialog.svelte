<script lang="ts">
	import { tick } from 'svelte';
	import { blockedBy } from '#lib/auth.svelte.ts';
	import { cite } from '#lib/editor/commands.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { isLatexName } from '#lib/files.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import type { AddResult, LookupResult, PreparedEntry, ReferenceContext, ZoteroAccountInfo, ZoteroItem } from '#lib/reference-types.ts';
	import { keyProblem, withKey } from '#lib/references/bibtex.ts';

	// "Add reference" (017 spec US1–US3): look up a DOI or arXiv id, or pick items from the user's Zotero library,
	// and append the entries to a .bib of the project; optionally cite them at the editor's cursor.
	let { project, editor, onadded }: { project: Project; editor?: EditorHandle; onadded?: (r: AddResult) => void } = $props();

	const uid = $props.id();
	let dialog: HTMLDialogElement;
	let idInput = $state<HTMLInputElement>();
	let tab = $state<'doi' | 'zotero'>('doi');
	let ctx = $state<ReferenceContext | null>(null);
	let target = $state(''); // path of the chosen .bib
	let citeToo = $state(true);
	let canCite = $state(false);
	let error = $state('');
	let busy = $state(false);

	// DOI / arXiv
	let input = $state('');
	let entry = $state<PreparedEntry | null>(null);
	let key = $state('');

	// Zotero
	let account = $state<ZoteroAccountInfo | null>(null);
	let zid = $state('');
	let zkey = $state('');
	let query = $state('');
	let items = $state<ZoteroItem[] | null>(null);
	let selected = $state<string[]>([]);

	const chosen = $derived(ctx?.targets.find((t) => t.path === target) ?? null);
	const keyError = $derived.by(() => {
		if (!entry || entry.duplicate) return null;
		const lower = key.toLowerCase();
		const taken = lower !== entry.key.toLowerCase() && ctx?.keys.some((k) => k.toLowerCase() === lower);
		return keyProblem(key) ?? (taken ? `“${key}” is already used in this project.` : null);
	});

	/** A JSON request; null on failure with `error` set to the server's message. */
	async function call<T>(url: string, init?: RequestInit): Promise<T | null> {
		const res = await fetch(url, init).catch(() => undefined);
		if (await blockedBy(res)) return null;
		if (!res) {
			error = 'Network error, try again.';
			return null;
		}
		if (!res.ok) {
			error = (await res.json().catch(() => null))?.message ?? `Request failed (${res.status}).`;
			return null;
		}
		return res.status === 204 ? ({} as T) : res.json();
	}
	const send = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

	export async function open(opts: { tab?: 'doi' | 'zotero' } = {}) {
		tab = opts.tab ?? 'doi';
		error = '';
		input = '';
		entry = null;
		items = null;
		selected = [];
		const name = project.files.find((f) => f.id === editor?.fileId)?.name ?? '';
		canCite = !!editor && !editor.view.state.readOnly && isLatexName(name);
		citeToo = canCite;
		dialog.showModal();
		await tick();
		if (tab === 'doi') idInput?.focus();
		ctx = await call<ReferenceContext>(project.api('/references'));
		target = ctx?.targets[0]?.path ?? '';
		if (tab === 'zotero') await showZotero();
	}

	function close() {
		dialog.close();
	}

	async function showTab(t: 'doi' | 'zotero') {
		tab = t;
		error = '';
		if (t === 'zotero' && !account) await showZotero();
	}

	/** Put `\cite{keys}` where the cursor is, as its own undo step (like the toolbar's insertions). */
	function citeAtCursor(keys: string[]) {
		const h = editor;
		if (!h || !keys.length) return;
		h.undoManager.stopCapturing();
		cite(keys)(h.view);
		h.undoManager.stopCapturing();
	}

	async function lookup(e: SubmitEvent) {
		e.preventDefault();
		if (!input.trim() || busy) return;
		busy = true;
		error = '';
		entry = null;
		const r = await call<LookupResult>(project.api(`/references/lookup?id=${encodeURIComponent(input.trim())}`));
		busy = false;
		if (!r) return;
		entry = r.entry;
		key = r.entry.key;
	}

	/** Append the entries to the chosen .bib; cite what was added (or found) when asked. */
	async function add(entries: string[]) {
		if (!chosen || busy) return;
		busy = true;
		error = '';
		const where = chosen.fileId ? { fileId: chosen.fileId } : { path: chosen.path };
		const r = await call<AddResult>(project.api('/references'), send('POST', { ...where, entries }));
		busy = false;
		if (!r) return;
		onadded?.(r);
		close();
		if (citeToo && canCite) citeAtCursor(r.keys);
		editor?.view.focus();
	}

	function citeExisting(existing: string) {
		close();
		citeAtCursor([existing]);
		editor?.view.focus();
	}

	async function showZotero() {
		account = await call<ZoteroAccountInfo>('/api/zotero/account');
		if (account?.connected) await search();
	}

	async function connect(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		const r = await call<ZoteroAccountInfo>('/api/zotero/account', send('PUT', { userId: zid, apiKey: zkey }));
		busy = false;
		if (!r) return;
		zkey = ''; // stored on the server now; the page doesn't keep it
		account = r;
		await search();
	}

	async function disconnect() {
		if (!(await call('/api/zotero/account', { method: 'DELETE' }))) return;
		account = { connected: false };
		items = null;
		selected = [];
	}

	async function search(e?: SubmitEvent) {
		e?.preventDefault();
		busy = true;
		error = '';
		const r = await call<{ items: ZoteroItem[] }>(project.api(`/references/zotero?q=${encodeURIComponent(query.trim())}`));
		busy = false;
		items = r?.items ?? items;
		selected = selected.filter((id) => items?.some((i) => i.id === id));
	}

	const addSelected = () => add((items ?? []).filter((i) => selected.includes(i.id)).map((i) => i.bibtex));
</script>

<dialog bind:this={dialog} aria-labelledby="{uid}-title" class="refs">
	<div class="head">
		<h2 id="{uid}-title">Add reference</h2>
		<button type="button" class="close" aria-label="Close" onclick={close}>×</button>
	</div>

	<div class="tabs" role="tablist" aria-label="Source">
		<button type="button" role="tab" aria-selected={tab === 'doi'} aria-controls="{uid}-doi" onclick={() => showTab('doi')}>DOI or arXiv</button>
		<button type="button" role="tab" aria-selected={tab === 'zotero'} aria-controls="{uid}-zotero" onclick={() => showTab('zotero')}>Zotero</button>
	</div>

	{#if tab === 'doi'}
		<div id="{uid}-doi" role="tabpanel">
			<form class="row" onsubmit={lookup}>
				<label class="grow">
					<span class="label">DOI or arXiv ID</span>
					<input bind:this={idInput} bind:value={input} placeholder="10.1145/3290605.3300857 or 2101.00001" autocomplete="off" spellcheck="false" />
				</label>
				<button type="submit" class="primary" disabled={busy || !input.trim()}>Look up</button>
			</form>
			{#if entry}
				{#if entry.duplicate}
					<p class="note" role="status">
						Already in <strong>{entry.duplicate.path}</strong> as <code>{entry.duplicate.key}</code>.
					</p>
					<div class="buttons">
						{#if canCite}<button type="button" class="primary" onclick={() => citeExisting(entry!.duplicate!.key)}>Cite {entry.duplicate.key}</button>{/if}
					</div>
				{:else}
					<label class="key">
						<span class="label">Key</span>
						<input bind:value={key} aria-invalid={!!keyError} aria-describedby="{uid}-key-error" spellcheck="false" autocomplete="off" />
					</label>
					{#if keyError}<p class="error" id="{uid}-key-error">{keyError}</p>{/if}
					<pre class="preview" aria-label="BibTeX entry">{withKey(entry.bibtex, key)}</pre>
				{/if}
			{/if}
		</div>
	{:else}
		<div id="{uid}-zotero" role="tabpanel">
			{#if account && !account.connected}
				<p>
					Connect your Zotero library with your user ID and a private API key from
					<a href="https://www.zotero.org/settings/keys" target="_blank" rel="noreferrer">zotero.org/settings/keys</a>. Read-only
					library access is enough. Overtree stores the key encrypted and only uses it to search your library.
				</p>
				<form class="connect" onsubmit={connect}>
					<label><span class="label">User ID</span><input bind:value={zid} inputmode="numeric" autocomplete="off" /></label>
					<label><span class="label">API key</span><input bind:value={zkey} type="password" autocomplete="off" /></label>
					<div class="buttons"><button type="submit" class="primary" disabled={busy || !zid.trim() || !zkey.trim()}>Connect Zotero</button></div>
				</form>
			{:else if account?.connected}
				<p class="connected">
					<span>Connected as <strong>{account.username}</strong></span>
					<button type="button" class="link-button" onclick={disconnect}>Disconnect</button>
				</p>
				<form class="row" onsubmit={search}>
					<input class="grow" bind:value={query} type="search" placeholder="Search title, author or year" aria-label="Search your Zotero library" />
					<button type="submit" disabled={busy}>Search</button>
				</form>
				{#if items}
					{#if items.length}
						<ul class="items" aria-label="Zotero items">
							{#each items as item (item.id)}
								<li>
									<label>
										<input type="checkbox" value={item.id} bind:group={selected} />
										<span class="item">
											<span class="title">{item.title || 'Untitled'}</span>
											<span class="muted">{[item.authors, item.year].filter(Boolean).join(' · ')}</span>
											{#if item.duplicate}
												<span class="muted">Already in {item.duplicate.path} as <code>{item.duplicate.key}</code></span>
											{:else}
												<code class="muted">{item.key}</code>
											{/if}
										</span>
									</label>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="muted">No items match.</p>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if ctx && ((tab === 'doi' && entry && !entry.duplicate) || (tab === 'zotero' && account?.connected))}
		<div class="footer">
			{#if ctx.targets.length}
				<label class="row">
					<span>Add to</span>
					<select bind:value={target} class="grow">
						{#each ctx.targets as t (t.path)}
							<option value={t.path}>{t.path}{t.fileId ? '' : ' (new file)'}</option>
						{/each}
					</select>
				</label>
				{#if chosen && !chosen.loaded}
					<p class="hint">The main document doesn’t load {chosen.path}: add <code>\bibliography</code> or <code>\addbibresource</code> for it to cite from it.</p>
				{/if}
			{:else}
				<p class="error">There is no .bib file here you can edit.</p>
			{/if}
			<div class="buttons">
				{#if canCite}
					<label class="cite"><input type="checkbox" bind:checked={citeToo} /> Also insert <code>\cite</code> at the cursor</label>
				{/if}
				{#if tab === 'doi'}
					<button type="button" class="primary" disabled={busy || !!keyError || !chosen} onclick={() => add([withKey(entry!.bibtex, key)])}>Add to {chosen?.path ?? '.bib'}</button>
				{:else}
					<button type="button" class="primary" disabled={busy || !selected.length || !chosen} onclick={addSelected}>
						Add {selected.length || ''} {selected.length === 1 ? 'reference' : 'references'}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: 560px;
		max-width: calc(100vw - 32px);
		padding: 20px 24px 24px;
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
	code,
	pre {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.muted,
	.hint {
		color: var(--text-muted);
	}
	.hint {
		font-size: 12px;
	}
	.error {
		color: var(--error-text);
	}
	.close {
		justify-content: center;
		width: 28px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--text-muted);
		font-size: 20px;
	}
	.tabs {
		display: flex;
		gap: 4px;
		margin-bottom: 12px;
		border-bottom: 1px solid var(--border);
	}
	.tabs button {
		height: 32px;
		border: 0;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		background: none;
		color: var(--text-muted);
	}
	.tabs button[aria-selected='true'] {
		border-bottom-color: var(--accent-bright);
		color: var(--text);
	}
	.label {
		display: block;
		margin-bottom: 4px;
		color: var(--text-muted);
		font-size: 12px;
	}
	input:not([type='checkbox']),
	select {
		width: 100%;
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	input[aria-invalid='true'] {
		border-color: var(--error-text);
	}
	.row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}
	label.row {
		align-items: center;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.key {
		display: block;
		margin-top: 12px;
	}
	.key input {
		font-family: var(--font-mono);
	}
	.preview {
		max-height: 220px;
		margin: 8px 0 0;
		padding: 8px 10px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.connect {
		display: grid;
		gap: 8px;
	}
	.connected {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.items {
		max-height: 280px;
		margin: 8px 0 0;
		padding: 4px 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 6px;
		list-style: none;
	}
	.items label {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 6px 10px;
		cursor: pointer;
	}
	.items label:hover {
		background: var(--panel-raised);
	}
	.items input {
		margin-top: 3px;
		accent-color: var(--accent-bright);
	}
	.item {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-size: 13px;
	}
	.item .muted {
		font-size: 12px;
	}
	.footer {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.buttons {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}
	.cite {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-right: auto;
		font-size: 13px;
	}
	button {
		display: inline-flex;
		align-items: center;
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
	.primary {
		border-color: transparent;
		background: var(--accent);
		font-weight: 600;
	}
	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.link-button {
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
</style>
