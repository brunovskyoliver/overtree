<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { History } from '#lib/history.svelte.ts';
	import type { FileDiff, Segment, UserRef } from '#lib/history-types.ts';
	import { lightColor } from '#lib/presence.ts';
	import Avatar from './Avatar.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import LabelDialog from './LabelDialog.svelte';

	// contracts/ui.md "Changed files" + "Diff": the selected version against the current state or the version
	// before it. Insertions on the author's color at 20 %, deletions struck through in it (research R13); unchanged
	// runs keep 3 lines of context around changes, the rest behind "Show N unchanged lines".
	// `canEdit`: the project role allows restoring (per-file rights come with each file's `canRestore`)
	let { history, canEdit }: { history: History; canEdit: boolean } = $props();
	let confirm = $state<ConfirmDialog>();
	let namer = $state<LabelDialog>();
	const CONTEXT = 3;
	const NEUTRAL = '#9aa1ad'; // changes without a known author

	let region = $state<HTMLElement>();
	/** Focus the diff (Enter in the timeline). */
	export const focus = () => region?.focus();

	const diff = $derived(history.diff);
	const users = $derived(new Map<string, UserRef>(diff?.users.map((u) => [u.id, u]) ?? []));
	const colorOf = (id: string | null) => (id && users.get(id)?.color) || NEUTRAL;
	const nameOf = (id: string | null) => (id && users.get(id)?.name) || 'Unknown author';
	const expanded = new SvelteSet<string>();
	$effect(() => {
		void history.diff;
		expanded.clear();
	});

	const dateTime = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const KIND = { baseline: 'Start of history', edit: 'Edits', compile: 'Compile point', restore: 'Restore', github: 'Merged from GitHub' };
	const fileAnchor = (f: FileDiff) => `diff-${f.id}`;

	type Piece = (Segment & { t: Segment['op'] }) | { t: 'fold'; key: string; text: string; lines: number };
	const lineCount = (s: string) => s.split('\n').length - (s.endsWith('\n') ? 1 : 0);

	/** Segments with long unchanged runs folded, keeping CONTEXT lines next to each change. */
	function pieces(f: FileDiff): Piece[] {
		const segs = f.segments ?? [];
		const out: Piece[] = [];
		segs.forEach((s, i) => {
			const key = `${f.id}:${i}`;
			if (s.op !== '=' || expanded.has(key)) return void out.push({ t: s.op, ...s });
			const parts = s.text.split('\n');
			// the first part ends the line of the change before, the last starts the line of the change after
			const head = i === 0 ? 0 : CONTEXT + 1;
			const tail = i === segs.length - 1 ? 0 : CONTEXT + 1;
			const hidden = parts.length - head - tail;
			if (hidden <= 2) return void out.push({ t: '=', ...s });
			const lines = (from: number, to: number) => parts.slice(from, to).map((p) => `${p}\n`).join('');
			if (head) out.push({ t: '=', op: '=', text: lines(0, head), userId: null });
			const folded = tail ? lines(head, parts.length - tail) : parts.slice(head).join('\n');
			out.push({ t: 'fold', key, text: folded, lines: lineCount(folded) });
			if (tail) out.push({ t: '=', op: '=', text: parts.slice(parts.length - tail).join('\n'), userId: null });
		});
		return out;
	}

	function size(n: number | null) {
		if (n === null) return '—';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(1)} MB`;
	}

	function binaryNote(f: FileDiff) {
		const s = f.size!;
		if (f.change === 'added') return `Binary file added (${size(s.new)})`;
		if (f.change === 'deleted') return `Binary file deleted (${size(s.old)})`;
		if (s.old === s.new && f.change === 'renamed') return `Binary file moved (${size(s.new)})`;
		return `Binary file changed (${size(s.old)} → ${size(s.new)})`;
	}

	const legend = $derived(
		diff
			? [
					...new Set(diff.files.flatMap((f) => f.segments?.filter((s) => s.op !== '=').map((s) => s.userId) ?? []))
				].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
			: []
	);

	async function restoreProject() {
		if (!diff) return;
		const ok = await confirm?.ask({
			title: `Restore the whole project to ${dateTime(diff.version.createdAt)}?`,
			body: 'Changes after it stay in history.',
			confirmLabel: 'Restore project'
		});
		if (ok) await history.restore();
	}

	function labelVersion() {
		if (!diff) return;
		const { id, createdAt } = diff.version;
		namer?.ask({
			title: `Label the version of ${dateTime(createdAt)}`,
			confirmLabel: 'Add label',
			save: (name) => history.addLabel(name, id)
		});
	}

	function jump(f: FileDiff) {
		const el = document.getElementById(fileAnchor(f));
		el?.scrollIntoView({ block: 'start' });
		el?.focus({ preventScroll: true });
	}
</script>

<nav class="files" aria-label="Changed files">
	<h2>Changed files</h2>
	{#if diff}
		<ul>
			{#each diff.files as f (f.id)}
				<li>
					<button type="button" title={f.path} onclick={() => jump(f)}>
						<span class="name">{f.path}</span>
						<span class="badge {f.change}">{f.change}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</nav>

<section class="diff" aria-label="Diff" tabindex="-1" bind:this={region}>
	<header>
		<div class="title">
			{#if diff}
				<h2>{dateTime(diff.version.createdAt)}</h2>
				<span class="kind">{KIND[diff.version.kind]}</span>
			{/if}
		</div>
		<div class="toggle" role="group" aria-label="Compare">
			<button type="button" aria-pressed={history.compare === 'current'} onclick={() => history.setCompare('current')}>Compare with current</button>
			<button type="button" aria-pressed={history.compare === 'previous'} onclick={() => history.setCompare('previous')}>Changes in this version</button>
		</div>
		{#if diff}
			<div class="actions">
				<a class="action" href={history.zipUrl(diff.version.id)} download>Download zip</a>
				{#if canEdit}
					<button type="button" class="action" onclick={labelVersion}>Label…</button>
					<button type="button" class="action" disabled={history.restoring} onclick={restoreProject}>Restore project</button>
				{/if}
			</div>
		{/if}
	</header>
	{#if history.restoreNote}
		{@const note = history.restoreNote}
		<div class="restore-note" class:error={!note.ok} role={note.ok ? 'status' : 'alert'}>
			<p>{note.text}</p>
			{#if note.skipped.length}
				<p>Skipped (read-only for you):</p>
				<ul aria-label="Skipped files">
					{#each note.skipped as path (path)}<li>{path}</li>{/each}
				</ul>
			{/if}
			<button type="button" class="dismiss" aria-label="Dismiss" onclick={() => (history.restoreNote = null)}>×</button>
		</div>
	{/if}
	{#if legend.length}
		<ul class="legend" aria-label="Authors">
			{#each legend as id (id)}
				{@const u = id ? users.get(id) : undefined}
				<li>
					<span class="swatch" aria-hidden="true" style:background={colorOf(id)}></span>
					{#if u}<Avatar name={u.name} avatarUrl={u.avatarUrl} color={u.color} size={18} />{/if}
					{nameOf(id)}
				</li>
			{/each}
		</ul>
	{/if}
	<div class="body" aria-busy={history.diffLoading}>
		{#if history.diffError}
			<p class="note error" role="alert">{history.diffError}</p>
		{:else if !diff}
			<p class="note">{history.diffLoading ? 'Loading…' : 'Select a version.'}</p>
		{:else if !diff.files.length}
			<p class="note">{history.compare === 'current' ? 'No differences from the current state.' : 'No file changes in this version.'}</p>
		{:else}
			{#each diff.files as f (f.id)}
				<article class="file" id={fileAnchor(f)} aria-label={f.path} tabindex="-1">
					<header class="file-head">
						<span class="path">{f.path}</span>
						{#if f.oldPath}<span class="from">renamed from {f.oldPath}</span>{/if}
						<span class="badge {f.change}">{f.change}</span>
						{#if f.canRestore}
							<button type="button" class="action" disabled={history.restoring} onclick={() => history.restore(f.id)}>Restore this file</button>
						{/if}
					</header>
					{#if f.kind === 'binary'}
						<p class="binary">{binaryNote(f)}</p>
					{:else}
						<pre class="code">{#each pieces(f) as p, i (i)}{#if p.t === '+'}<ins
										data-user={p.userId ?? ''}
										title={nameOf(p.userId)}
										style:background={lightColor(colorOf(p.userId))}
										style:--c={colorOf(p.userId)}>{p.text}</ins
									>{:else if p.t === '-'}<del data-user={p.userId ?? ''} title={nameOf(p.userId)} style:color={colorOf(p.userId)}>{p.text}</del
									>{:else if p.t === 'fold'}<button type="button" class="fold" onclick={() => expanded.add(p.key)}
										>Show {p.lines} unchanged {p.lines === 1 ? 'line' : 'lines'}</button
									>{:else}{p.text}{/if}{/each}</pre>
					{/if}
				</article>
			{/each}
		{/if}
	</div>
</section>

<ConfirmDialog bind:this={confirm} />
<LabelDialog bind:this={namer} />

<style>
	.files {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: auto;
		background: var(--panel);
		border-right: 1px solid var(--border);
	}
	h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	.files h2 {
		display: flex;
		align-items: center;
		flex: none;
		height: 38px;
		padding: 0 12px;
		border-bottom: 1px solid var(--border);
	}
	.files ul {
		margin: 0;
		padding: 4px 0;
		list-style: none;
	}
	.files button {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 5px 12px;
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}
	.files button:hover {
		background: var(--panel-raised);
	}
	.files button:focus-visible {
		outline-offset: -2px;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl; /* the file name stays visible in long paths */
		text-align: left;
	}
	.badge {
		flex: none;
		padding: 0 6px;
		border-radius: 8px;
		font-size: 11px;
		line-height: 16px;
	}
	.badge.added {
		background: #23402a;
		color: #81c995;
	}
	.badge.deleted {
		background: #4a2a2a;
		color: #f28b82;
	}
	.badge.edited {
		background: #2a3b55;
		color: #8ab4f8;
	}
	.badge.renamed {
		background: #44391f;
		color: #fbbc04;
	}
	.diff {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--bg-editor);
	}
	.diff:focus-visible {
		outline-offset: -2px;
	}
	.diff > header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 38px;
		padding: 4px 12px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.kind {
		color: var(--text-muted);
		font-size: 12px;
	}
	.toggle {
		display: flex;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 14px;
	}
	.toggle button {
		height: 26px;
		padding: 0 12px;
		border: 0;
		background: none;
		color: var(--text-muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.toggle button + button {
		border-left: 1px solid var(--border);
	}
	.toggle button:hover {
		color: var(--text);
	}
	.toggle button[aria-pressed='true'] {
		background: var(--accent);
		color: var(--text);
		font-weight: 600;
	}
	.toggle button:focus-visible {
		outline-offset: -2px;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.action {
		display: inline-flex;
		align-items: center;
		height: 26px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 13px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		font-size: 13px;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.action:hover:not(:disabled) {
		background: #3a4252;
	}
	.action:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.restore-note {
		position: relative;
		padding: 6px 36px 6px 12px;
		border-bottom: 1px solid var(--border);
		background: #23402a;
		font-size: 13px;
	}
	.restore-note.error {
		background: #4a2a2a;
		color: #f28b82;
	}
	.restore-note p {
		margin: 2px 0;
	}
	.restore-note ul {
		margin: 2px 0;
		padding-left: 18px;
		font-family: var(--font-mono);
	}
	.dismiss {
		position: absolute;
		top: 4px;
		right: 8px;
		border: 0;
		background: none;
		color: inherit;
		font-size: 16px;
		cursor: pointer;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 0;
		padding: 6px 12px;
		border-bottom: 1px solid var(--border);
		list-style: none;
		color: var(--text-muted);
		font-size: 12px;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 12px;
	}
	.note {
		margin: 8px 0;
		color: var(--text-muted);
	}
	.error {
		color: #f28b82;
	}
	.file {
		margin-bottom: 16px;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.file:focus-visible {
		outline-offset: -2px;
	}
	.file-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
	}
	.path {
		font-family: var(--font-mono);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.from {
		color: var(--text-muted);
		font-size: 12px;
	}
	.file-head .badge {
		margin-left: auto;
	}
	.binary {
		margin: 0;
		padding: 10px;
		color: var(--text-muted);
	}
	.code {
		margin: 0;
		padding: 8px 10px;
		overflow-x: auto;
		font: 13px/1.5 var(--font-mono);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		tab-size: 4;
	}
	ins {
		border-bottom: 1px solid var(--c);
		color: var(--text);
		text-decoration: none;
	}
	del {
		text-decoration: line-through;
		text-decoration-thickness: 1.5px;
	}
	.fold {
		display: block;
		width: 100%;
		margin: 2px 0;
		padding: 2px 8px;
		border: 0;
		border-radius: 3px;
		background: var(--panel);
		color: var(--text-muted);
		font: 12px var(--font-ui);
		text-align: left;
		cursor: pointer;
	}
	.fold:hover {
		background: var(--panel-raised);
		color: var(--text);
	}
</style>
