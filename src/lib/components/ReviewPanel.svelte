<script lang="ts">
	import { EditorView } from '@codemirror/view';
	import { trackedChanges } from '#lib/editor/track.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { absoluteTime, relativeTime } from '#lib/time.ts';
	import { acceptChanges, rejectChanges, type Resolved } from '#lib/track-changes.ts';

	// 013 US2: the open file's suggestions in text order with Accept / Reject (owner and editors of the file), a
	// click goes to the change. Follows the editor's track plugin (src/lib/editor/track.ts) on every view update.
	let { editor, canReview, onclose }: { editor?: EditorHandle; canReview: boolean; onclose: () => void } = $props();
	const SNIPPET = 80;

	type Item = Resolved & { snippet: string };
	let items = $state<Item[]>([]);
	let now = $state(Date.now());

	$effect(() => {
		const h = editor;
		if (!h) return void (items = []);
		const read = (view: EditorView) =>
			(items = trackedChanges(view).map((r) => ({
				...r,
				snippet: (r.change.kind === 'insert' ? view.state.sliceDoc(r.from, r.to) : r.change.text).slice(0, SNIPPET)
			})));
		read(h.view);
		return h.listen((u) => read(u.view));
	});
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	function go(r: Item) {
		const view = editor?.view;
		if (!view) return;
		view.dispatch({ selection: { anchor: r.from, head: r.to }, effects: EditorView.scrollIntoView(r.from, { y: 'center' }) });
		view.focus();
	}

	const doc = () => editor!.provider.document;
	const accept = (ids: string[]) => editor && acceptChanges(doc(), ids);
	const reject = (ids: string[]) => editor && rejectChanges(doc().getText('content'), ids);
</script>

<aside class="review" aria-labelledby="review-title">
	<header>
		<h2 id="review-title">Review</h2>
		<span class="count">{items.length} {items.length === 1 ? 'change' : 'changes'}</span>
		<button type="button" class="close" aria-label="Close review" title="Close review" onclick={onclose}>×</button>
	</header>
	{#if canReview && items.length}
		<div class="all">
			<button type="button" onclick={() => accept(items.map((i) => i.id))}>Accept all</button>
			<button type="button" onclick={() => reject(items.map((i) => i.id))}>Reject all</button>
		</div>
	{/if}
	{#if items.length}
		<ul aria-label="Changes">
			{#each items as item (item.id)}
				{@const c = item.change}
				<li style:--tc-color={c.author.color} data-kind={c.kind}>
					<button type="button" class="jump" onclick={() => go(item)}>
						<span class="who">
							<span class="dot" aria-hidden="true"></span>
							<strong>{c.author.name}</strong>
							<time datetime={new Date(c.at).toISOString()} title={absoluteTime(c.at)}>{relativeTime(c.at, now)}</time>
						</span>
						<span class="what"
							>{c.kind === 'insert' ? 'Inserted' : 'Deleted'}
							<q class={c.kind}>{item.snippet}{item.snippet.length === SNIPPET ? '…' : ''}</q></span
						>
					</button>
					{#if canReview}
						<span class="actions">
							<button type="button" aria-label="Accept" title="Accept" onclick={() => accept([item.id])}>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
							</button>
							<button type="button" aria-label="Reject" title="Reject" onclick={() => reject([item.id])}>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
							</button>
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">No changes in this file.</p>
	{/if}
</aside>

<style>
	.review {
		display: flex;
		flex-direction: column;
		width: 260px;
		min-height: 0;
		/* clear of the editor pane's right rail (PDF collapse tab, SyncTeX arrows: Workspace.svelte) */
		margin-right: 20px;
		border-left: 1px solid var(--border);
		background: var(--panel);
		font-size: 13px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 4px 0 12px;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		margin: 0;
		font-size: 14px;
	}
	.count {
		color: var(--text-muted);
	}
	button {
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.close {
		margin-left: auto;
		width: 28px;
		height: 28px;
		font-size: 18px;
		line-height: 1;
	}
	.all {
		display: flex;
		gap: 6px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
	}
	.all button {
		flex: 1;
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel-raised);
	}
	ul {
		flex: 1;
		margin: 0;
		padding: 0;
		overflow: auto;
		list-style: none;
	}
	li {
		display: flex;
		align-items: flex-start;
		border-bottom: 1px solid var(--border);
		border-left: 3px solid var(--tc-color);
	}
	.jump {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		padding: 8px 6px 8px 9px;
		text-align: left;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--tc-color);
	}
	time {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 12px;
		white-space: nowrap;
	}
	.what {
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	q {
		color: var(--text);
		font-family: var(--font-mono);
		white-space: pre-wrap;
	}
	q.delete {
		text-decoration: line-through;
	}
	.actions {
		display: flex;
		flex-direction: column;
		padding: 4px;
	}
	.actions button {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 4px;
	}
	button:hover {
		background: var(--panel-raised);
	}
	.empty {
		margin: 16px 12px;
		color: var(--text-muted);
	}
	svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
