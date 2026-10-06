<script lang="ts">
	import { EditorView } from '@codemirror/view';
	import type { LogEntry } from '#lib/compile-types.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';

	let { entries, editor, onclose }: { entries: LogEntry[]; editor?: EditorHandle; onclose: () => void } = $props();

	const sections = $derived(
		(
			[
				['error', 'Errors'],
				['warning', 'Warnings'],
				['typesetting', 'Typesetting']
			] as const
		).map(([level, title]) => ({ level, title, items: entries.filter((e) => e.level === level) }))
	);

	let raw = $state<string>();

	// same as the outline's jump(): a line past the end goes to the last line
	function jump(n: number) {
		const view = editor?.view;
		if (!view) return;
		const line = view.state.doc.line(Math.min(n, view.state.doc.lines));
		view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
		view.focus();
		onclose();
	}

	async function loadRaw(e: Event) {
		if (!(e.currentTarget as HTMLDetailsElement).open) return;
		const res = await fetch('/api/compile/output.log');
		raw = res.ok ? await res.text() : 'No log for the last compile.';
	}
</script>

<section class="logs" aria-label="Logs">
	<p class="counts">
		{#each sections as s (s.level)}<span class={s.level}>{s.items.length} {s.title.toLowerCase()}</span>{/each}
	</p>
	{#each sections as s (s.level)}
		{#if s.items.length}
			<section aria-labelledby="logs-{s.level}">
				<h3 id="logs-{s.level}">{s.title}</h3>
				<ul>
					{#each s.items as entry, i (i)}
						<li class={entry.level}>
							{#if entry.file === 'main.tex' && entry.line}
								<button type="button" onclick={() => jump(entry.line!)}>
									<span class="where">{entry.file}:{entry.line}</span>
									<span class="msg">{entry.message}</span>
								</button>
							{:else}
								<div class="item">
									{#if entry.file || entry.line}<span class="where">{entry.file ?? ''}{entry.line ? `:${entry.line}` : ''}</span>{/if}
									<span class="msg">{entry.message}</span>
								</div>
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
	.counts {
		display: flex;
		gap: 12px;
		margin: 0 0 8px;
		color: var(--text-muted);
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
		--stripe: #e05252;
	}
	.warning {
		--stripe: #e0a030;
	}
	.typesetting {
		--stripe: var(--text-muted);
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
