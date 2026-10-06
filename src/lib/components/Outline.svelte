<script lang="ts">
	import { StateEffect } from '@codemirror/state';
	import { EditorView } from '@codemirror/view';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { parseOutline, type OutlineEntry } from '#lib/outline.ts';

	let { editor }: { editor?: EditorHandle } = $props();

	let entries = $state<OutlineEntry[]>([]);
	let cursorLine = $state(1);
	// entry with the greatest line <= cursor line
	const current = $derived(entries.findLastIndex((e) => e.line <= cursorLine));

	$effect(() => {
		const view = editor?.view;
		if (!view) return;
		const lineOf = () => view.state.doc.lineAt(view.state.selection.main.head).number;
		entries = parseOutline(view.state.doc.toString());
		cursorLine = lineOf();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let alive = true;
		// ponytail: appended listener can't be removed, `alive` mutes it; the view outlives the outline anyway
		view.dispatch({
			effects: StateEffect.appendConfig.of(
				EditorView.updateListener.of((u) => {
					if (!alive) return;
					if (u.docChanged) {
						clearTimeout(timer);
						timer = setTimeout(() => (entries = parseOutline(view.state.doc.toString())), 200);
					}
					if (u.docChanged || u.selectionSet) cursorLine = lineOf();
				})
			)
		});
		return () => {
			alive = false;
			clearTimeout(timer);
		};
	});

	function jump(entry: OutlineEntry) {
		const view = editor?.view;
		if (!view) return;
		// the list can be up to 200 ms behind the document
		const line = view.state.doc.line(Math.min(entry.line, view.state.doc.lines));
		view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
		view.focus();
	}
</script>

<nav aria-label="File outline">
	{#if entries.length}
		<ul>
			{#each entries as entry, i (i)}
				<li>
					<button
						type="button"
						style:padding-left="{entry.level * 14}px"
						aria-current={i === current ? 'location' : undefined}
						onclick={() => jump(entry)}>{entry.title}</button
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p>No sections yet</p>
	{/if}
</nav>

<style>
	ul {
		margin: 0;
		padding: 0 6px 6px;
		list-style: none;
	}
	button {
		display: block;
		width: 100%;
		height: 30px;
		padding-right: 8px;
		overflow: hidden;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		font: inherit;
		font-weight: 500;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}
	button:hover {
		background: var(--panel-raised);
	}
	button[aria-current='location'] {
		background: var(--accent);
	}
	button:focus-visible {
		outline-offset: -2px;
	}
	p {
		margin: 4px 16px;
		color: var(--text-muted);
	}
</style>
