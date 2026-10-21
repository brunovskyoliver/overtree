<script lang="ts">
	import type { LogEntry } from '#lib/compile-types.ts';

	// onopenat: open a project file in a tab with the cursor on that line
	let {
		entries,
		logUrl,
		onopenat,
		onclose
	}: { entries: LogEntry[]; logUrl: string; onopenat?: (fileId: string, line: number) => void; onclose: () => void } = $props();

	const sections = $derived(
		(
			[
				['error', 'Errors'],
				['warning', 'Warnings'],
				['typesetting', 'Typesetting'],
				['chktex', 'ChkTeX']
			] as const
		).map(([level, title]) => ({ level, title, items: entries.filter((e) => e.level === level) }))
	);
	// one level or all of them (016); ChkTeX's filter only when it reported something
	let filter = $state<LogEntry['level'] | 'all'>('all');
	const filters = $derived(sections.filter((s) => s.level !== 'chktex' || s.items.length));
	const shown = $derived(sections.filter((s) => filter === 'all' || s.level === filter));

	let raw = $state<string>();

	function jump(entry: LogEntry) {
		onopenat?.(entry.fileId!, entry.line!);
		onclose();
	}

	async function loadRaw(e: Event) {
		if (!(e.currentTarget as HTMLDetailsElement).open) return;
		const res = await fetch(logUrl);
		raw = res.ok ? await res.text() : 'No log for the last compile.';
	}
</script>

<!-- `code` in hint texts as <code> -->
{#snippet rich(text: string)}
	{#each text.split('`') as part, i (i)}{#if i % 2}<code>{part}</code>{:else}{part}{/if}{/each}
{/snippet}

<section class="logs" aria-label="Logs">
	<div class="filters" role="group" aria-label="Show">
		<button type="button" aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
		{#each filters as s (s.level)}
			<button type="button" class={s.level} aria-pressed={filter === s.level} onclick={() => (filter = s.level)}
				>{s.title} <span class="count">{s.items.length}</span></button
			>
		{/each}
	</div>
	{#each shown as s (s.level)}
		{#if s.items.length}
			<section aria-labelledby="logs-{s.level}">
				<h3 id="logs-{s.level}">{s.title}</h3>
				<ul>
					{#each s.items as entry, i (i)}
						<li class={entry.level}>
							{#if entry.fileId && entry.line}
								<button type="button" onclick={() => jump(entry)}>
									<span class="where">{entry.file}:{entry.line}</span>
									<span class="msg">{entry.message}</span>
								</button>
							{:else}
								<div class="item">
									{#if entry.file || entry.line}<span class="where">{entry.file ?? ''}{entry.line ? `:${entry.line}` : ''}</span>{/if}
									<span class="msg">{entry.message}</span>
								</div>
							{/if}
							{#if entry.hint}
								<!-- errors show their hint right away, the rest on demand -->
								<details class="hint" open={entry.level === 'error'}>
									<summary>Hint</summary>
									<p>{@render rich(entry.hint.explanation)}</p>
									{#if entry.hint.fix}<p class="fix">{@render rich(entry.hint.fix)}</p>{/if}
								</details>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}
	<details ontoggle={loadRaw}>
		<summary>Raw log</summary>
		<pre>{raw ?? 'Loading…'}</pre>
	</details>
</section>

<style>
	.logs {
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: auto;
		padding: 8px 12px;
		background: var(--bg-editor);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 8px;
	}
	.filters button {
		width: auto;
		padding: 2px 10px;
		border: 1px solid var(--border);
		border-radius: 12px;
		color: var(--text-muted);
		font-size: 12px;
	}
	.filters button[aria-pressed='true'] {
		border-color: var(--stripe, var(--text-muted));
		background: var(--panel-raised);
		color: var(--text);
	}
	.count {
		font-variant-numeric: tabular-nums;
	}
	h3 {
		margin: 12px 0 6px;
		font-size: 13px;
		font-weight: 600;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		margin-bottom: 4px;
		border-left: 4px solid var(--stripe);
		border-radius: 4px;
		background: var(--panel);
	}
	.error {
		--stripe: var(--error);
	}
	.warning {
		--stripe: var(--warning);
	}
	.typesetting {
		--stripe: var(--text-muted);
	}
	.chktex {
		--stripe: var(--info);
	}
	.hint {
		margin: 0;
		padding: 0 10px 6px;
		font-size: 13px;
	}
	.hint summary {
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 400;
	}
	.hint p {
		margin: 4px 0 0;
		overflow-wrap: anywhere;
	}
	.hint .fix {
		color: var(--text-muted);
	}
	code {
		padding: 0 3px;
		border-radius: 3px;
		background: var(--bg);
		font: 12px var(--font-mono);
	}
	button,
	.item {
		display: block;
		width: 100%;
		padding: 6px 10px;
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
	}
	button {
		cursor: pointer;
	}
	button:hover {
		background: var(--panel-raised);
	}
	button:focus-visible {
		outline-offset: -2px;
	}
	.where {
		display: block;
		color: var(--text-muted);
		font: 12px var(--font-mono);
	}
	.msg {
		overflow-wrap: anywhere;
	}
	details {
		margin-top: 12px;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
	}
	pre {
		margin: 6px 0 0;
		padding: 8px;
		overflow: auto;
		background: var(--bg);
		font: 12px/1.4 var(--font-mono);
		white-space: pre-wrap;
	}
</style>
