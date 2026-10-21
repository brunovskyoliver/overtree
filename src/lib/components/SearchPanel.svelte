<script lang="ts">
	import { blockedBy } from '#lib/auth.svelte.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import { buildRegExp, MATCH_CAP, type SearchFile, type SearchMatch, type SearchOptions, type SearchResult } from '#lib/search.ts';
	import ConfirmDialog from './ConfirmDialog.svelte';

	// Project search and replace (014, contracts in plan.md D2): the sidebar's Search view. Searches as you type
	// (debounced), again after the user's own edits and replacements and on tree changes; collaborators' edits show
	// on the next run (Refresh).
	let {
		project,
		onmatch,
		onclose
	}: {
		project: Project;
		/** open the file and select the match nearest `from` (the text may have moved since the search) */
		onmatch: (fileId: string, from: number, options: SearchOptions) => void;
		onclose: () => void;
	} = $props();

	const READ_ONLY = 'Read only: you can view this file but not edit it.';
	const DEBOUNCE_MS = 250;

	let query = $state('');
	let replacement = $state('');
	let caseSensitive = $state(false);
	let wholeWord = $state(false);
	let regex = $state(false);
	let result = $state<SearchResult | null>(null);
	/** the options `result` was found with: replacing acts on what the list shows, not on a query still being typed */
	let shown: SearchOptions | null = null;
	let serverError = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let replaceError = $state<string | null>(null);
	let busy = $state(false);
	let input: HTMLInputElement;
	let list = $state<HTMLElement>();
	let confirm: ConfirmDialog;

	const options = $derived<SearchOptions>({ query, caseSensitive, wholeWord, regex });
	// an invalid regex is caught here, before any request
	const regexError = $derived.by(() => {
		if (!query) return null;
		const re = buildRegExp(options);
		return re instanceof RegExp ? null : re.error;
	});
	const error = $derived(regexError ?? serverError);
	const editable = $derived(result?.files.filter((f) => f.canEdit) ?? []);
	const editableCount = $derived(editable.reduce((n, f) => n + f.matches.length, 0));
	const readOnlyFiles = $derived(result?.files.filter((f) => !f.canEdit) ?? []);
	const readOnlyCount = $derived(readOnlyFiles.reduce((n, f) => n + f.matches.length, 0));

	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
	const params = (o: SearchOptions) =>
		new URLSearchParams({ q: o.query, ...(o.caseSensitive && { case: '1' }), ...(o.wholeWord && { word: '1' }), ...(o.regex && { regex: '1' }) });

	let seq = 0; // a slower, older response must not overwrite a newer one
	async function run() {
		const o = $state.snapshot(options);
		const mine = ++seq;
		if (!o.query || regexError) {
			result = null;
			serverError = null;
			return;
		}
		const res = await fetch(project.api(`/search?${params(o)}`)).catch(() => undefined);
		if (mine !== seq || (await blockedBy(res))) return;
		if (!res?.ok) {
			serverError = res ? ((await res.json().catch(() => null))?.message ?? `Search failed (${res.status}).`) : 'Network error, try again.';
			return;
		}
		const body: SearchResult = await res.json();
		if (mine !== seq) return;
		serverError = null;
		result = body;
		shown = o;
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	const later = (ms = DEBOUNCE_MS) => (clearTimeout(timer), (timer = setTimeout(run, ms)));
	$effect(() => () => clearTimeout(timer));

	// as you type; a changed query drops the last replace's note
	$effect(() => {
		void [query, caseSensitive, wholeWord, regex];
		notice = replaceError = null;
		later();
	});

	// tree changes (rename, delete, upload: `project.files` is replaced on each load)
	// svelte-ignore state_referenced_locally (the page is keyed on the project: `project` never changes here)
	let lastFiles = project.files;
	$effect(() => {
		if (project.files === lastFiles) return;
		lastFiles = project.files;
		if (query) later();
	});

	/** The user's own typing changed a document: search again once they pause. */
	export function stale() {
		if (query) later(800);
	}

	/** Focus the query field, its text selected (Ctrl/⌘+Shift+F again). */
	export function focus() {
		input.focus();
		input.select();
	}

	async function replace(scope: { fileId?: string; at?: number }) {
		const o = shown;
		if (!o) return;
		busy = true;
		replaceError = null;
		const body = { q: o.query, case: o.caseSensitive, word: o.wholeWord, regex: o.regex, replacement, ...scope };
		const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
		const res = await fetch(project.api('/search/replace'), init).catch(() => undefined);
		busy = false;
		if (await blockedBy(res)) return;
		if (!res?.ok) {
			const message = res ? ((await res.json().catch(() => null))?.message ?? `Replace failed (${res.status}).`) : 'Network error, try again.';
			await run(); // a stale match: show the current ones
			notice = null;
			replaceError = message;
			return;
		}
		const r: { replaced: number; files: number; skipped: number } = await res.json();
		await run();
		notice =
			`Replaced ${plural(r.replaced, 'match', 'matches')}` +
			(scope.fileId ? '.' : ` in ${plural(r.files, 'file')}.`) +
			(r.skipped ? ` Skipped ${plural(r.skipped, 'match', 'matches')} in read-only files.` : '');
	}

	async function replaceAll() {
		// counts for the query as typed now, not a result from before the last keystroke
		clearTimeout(timer);
		await run();
		if (!editableCount) return;
		const more = result?.truncated ? 'at least ' : '';
		const ok = await confirm.ask({
			title: 'Replace in all files?',
			body:
				`Replace ${more}${plural(editableCount, 'match', 'matches')} in ${plural(editable.length, 'file')} with “${replacement}”.` +
				(readOnlyCount ? ` ${plural(readOnlyCount, 'match', 'matches')} in ${plural(readOnlyFiles.length, 'read-only file')} won’t change.` : '') +
				' The change is one version in History, where it can be restored.',
			confirmLabel: 'Replace all'
		});
		if (ok) await replace({});
	}

	// --- keyboard: ↓/↑ move between results, Enter opens one, Escape goes back to the file tree ---------------

	const rows = () => [...(list?.querySelectorAll<HTMLButtonElement>('button.match') ?? [])];

	function onlistkey(e: KeyboardEvent) {
		const all = rows();
		const i = all.indexOf(document.activeElement as HTMLButtonElement);
		if (i < 0) return;
		if (e.key === 'ArrowDown') all[Math.min(i + 1, all.length - 1)].focus();
		else if (e.key === 'ArrowUp') (i === 0 ? input : all[i - 1]).focus();
		else if (e.key === 'Home') all[0].focus();
		else if (e.key === 'End') all.at(-1)!.focus();
		else return;
		e.preventDefault();
	}

	function onquerykey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			clearTimeout(timer);
			void run();
		} else if (e.key === 'ArrowDown') rows()[0]?.focus();
		else return;
		e.preventDefault();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		e.preventDefault();
		onclose();
	}

	const open = (f: SearchFile, m: SearchMatch) => shown && onmatch(f.fileId, m.from, shown);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape anywhere in the view goes back to the tree) -->
<section class="search-panel" aria-labelledby="search-title" {onkeydown}>
	<div class="header">
		<h2 class="pane-header" id="search-title">Search</h2>
		<button type="button" class="tool" aria-label="Search again" title="Search again" disabled={!query || !!regexError} onclick={run}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>
		</button>
		<button type="button" class="tool" aria-label="Close search" title="Back to the file tree (Escape)" onclick={onclose}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</div>

	<div class="fields">
		<div class="field">
			<input
				bind:this={input}
				bind:value={query}
				type="search"
				placeholder="Search in project"
				aria-label="Search in project"
				aria-invalid={!!regexError}
				aria-describedby={error ? 'search-error' : undefined}
				spellcheck="false"
				autocomplete="off"
				onkeydown={onquerykey}
			/>
			<div class="toggles">
				<button type="button" class="toggle" aria-pressed={caseSensitive} aria-label="Match case" title="Match case" onclick={() => (caseSensitive = !caseSensitive)}>Aa</button>
				<button type="button" class="toggle word" aria-pressed={wholeWord} aria-label="Whole word" title="Whole word" onclick={() => (wholeWord = !wholeWord)}>ab</button>
				<button type="button" class="toggle" aria-pressed={regex} aria-label="Regular expression" title="Regular expression" onclick={() => (regex = !regex)}>.*</button>
			</div>
		</div>
		{#if error}<p class="error" id="search-error" role="alert">{error}</p>{/if}
		<div class="field">
			<input bind:value={replacement} type="text" placeholder="Replace with" aria-label="Replace with" spellcheck="false" autocomplete="off" />
			<button
				type="button"
				class="replace-all"
				disabled={busy || !editableCount}
				title={readOnlyCount && !editableCount ? READ_ONLY : 'Replace every match in every file you can edit'}
				onclick={replaceAll}>Replace all</button
			>
		</div>
		{#if regex}<p class="hint">Use $1, $2… or $&lt;name&gt; for groups, $&amp; for the whole match.</p>{/if}
	</div>

	{#if result && !error}
		<p class="summary" role="status">
			{#if result.total}
				{plural(result.total, 'match', 'matches')} in {plural(result.files.length, 'file')}{#if result.truncated}
					· showing the first {MATCH_CAP}; refine the search to see the rest{/if}
			{:else}
				No matches
			{/if}
		</p>
	{/if}
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	{#if replaceError}<p class="error replace-error" role="alert">{replaceError}</p>{/if}

	{#if result?.files.length && !error}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions (arrow keys move between the result buttons) -->
		<ul class="results" aria-label="Search results" bind:this={list} onkeydown={onlistkey}>
			{#each result.files as f (f.fileId)}
				<li class="file" aria-label={f.path}>
					<div class="file-head">
						<span class="path" title={f.path}>{f.path}</span>
						{#if !f.canEdit}<span class="ro" title={READ_ONLY}>read only</span>{/if}
						<span class="count">{f.matches.length}</span>
						<button
							type="button"
							class="tool small"
							aria-label="Replace all in {f.path}"
							title={f.canEdit ? `Replace all in ${f.path}` : READ_ONLY}
							disabled={busy || !f.canEdit}
							onclick={() => replace({ fileId: f.fileId })}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11l-3-3M20 17H9l3 3" /></svg>
						</button>
					</div>
					<ul>
						{#each f.matches as m (m.from)}
							<li class="hit">
								<button type="button" class="match" aria-label="{f.path} line {m.line}: {m.before}{m.match}{m.after}" onclick={() => open(f, m)}>
									<span class="line">{m.line}</span>
									<span class="text">{m.before}<mark>{m.match}</mark>{m.after}</span>
								</button>
								<button
									type="button"
									class="tool small one"
									aria-label="Replace match on line {m.line} of {f.path}"
									title={f.canEdit ? 'Replace this match' : READ_ONLY}
									disabled={busy || !f.canEdit}
									onclick={() => replace({ fileId: f.fileId, at: m.from })}
								>
									<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14l-4-4M18 12l-4 4" /></svg>
								</button>
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<ConfirmDialog bind:this={confirm} />

<style>
	.search-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.header {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 8px;
	}
	.header h2 {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.tool {
		flex: none;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.tool.small {
		width: 22px;
		height: 22px;
	}
	.tool:hover:not(:disabled) {
		background: var(--panel-raised);
	}
	.tool:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.tool svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 0 8px 6px;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel);
	}
	.field:focus-within {
		border-color: var(--focus);
	}
	input {
		flex: 1;
		min-width: 0;
		padding: 5px 6px;
		border: 0;
		background: none;
		color: var(--text);
		font: 13px var(--font-mono);
	}
	input:focus-visible {
		outline: none; /* the field's border shows focus */
	}
	input[aria-invalid='true'] {
		color: var(--error-alt);
	}
	.toggles {
		display: flex;
		gap: 1px;
		padding-right: 3px;
	}
	.toggle {
		min-width: 22px;
		height: 20px;
		padding: 0 3px;
		border: 1px solid transparent;
		border-radius: 3px;
		background: none;
		color: var(--text-muted);
		font: 12px var(--font-mono);
		cursor: pointer;
	}
	.toggle.word {
		text-decoration: underline;
	}
	.toggle:hover {
		background: var(--panel-raised);
	}
	.toggle[aria-pressed='true'] {
		border-color: var(--focus);
		color: var(--text);
	}
	.replace-all {
		flex: none;
		margin: 2px;
		padding: 2px 8px;
		border: 0;
		border-radius: 3px;
		background: var(--panel-raised);
		color: var(--text);
		font: 12px var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
	}
	.replace-all:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.error,
	.hint,
	.summary,
	.notice {
		margin: 0;
		font-size: 12px;
	}
	.error {
		padding: 4px 8px;
		border-radius: 4px;
		background: var(--danger-tint);
		color: var(--error-alt);
	}
	.replace-error {
		margin: 0 8px 6px;
	}
	.hint,
	.summary,
	.notice {
		color: var(--text-muted);
	}
	.summary,
	.notice {
		padding: 0 12px 6px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.results {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0 4px 12px;
	}
	.file-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 4px 2px 8px;
		font-size: 12px;
		font-weight: 600;
	}
	.path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl; /* a long path keeps its file name in view */
		text-align: left;
	}
	.ro {
		flex: none;
		color: var(--text-muted);
		font-weight: 400;
	}
	.count {
		flex: none;
		min-width: 18px;
		padding: 0 5px;
		border-radius: 8px;
		background: var(--panel-raised);
		font-weight: 400;
		text-align: center;
	}
	.hit {
		display: flex;
		align-items: center;
	}
	.match {
		display: flex;
		flex: 1;
		gap: 6px;
		min-width: 0;
		padding: 2px 4px 2px 12px;
		border: 0;
		border-radius: 3px;
		background: none;
		color: var(--text);
		font: 12px/1.5 var(--font-mono);
		text-align: left;
		cursor: pointer;
	}
	.match:hover,
	.match:focus-visible {
		background: var(--panel-raised);
	}
	.match:focus-visible {
		outline-offset: -2px;
	}
	.line {
		flex: none;
		min-width: 2.5ch;
		color: var(--text-muted);
		text-align: right;
	}
	.text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: pre;
	}
	mark {
		border-radius: 2px;
		background: var(--project-search-match);
		color: inherit;
	}
	/* the per-match replace button shows on hover and focus, so rows stay readable in a narrow sidebar */
	.one {
		opacity: 0;
	}
	.hit:hover .one,
	.hit:focus-within .one {
		opacity: 1;
	}
	.hit:hover .one:disabled,
	.hit:focus-within .one:disabled {
		opacity: 0.4;
	}
</style>
