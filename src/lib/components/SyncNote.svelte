<script lang="ts">
	// A short note next to the sync controls, e.g. "Recompile to sync" when the PDF can't be mapped (T052); gone after
	// a few seconds. Rendered only while shown: the editor's save indicator is the page's standing status region.
	const SHOW_MS = 4000;

	let text = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	export function show(message: string) {
		clearTimeout(timer);
		text = message;
		timer = setTimeout(() => (text = ''), SHOW_MS);
	}

	$effect(() => () => clearTimeout(timer));
</script>

{#if text}
	<p class="sync-note" role="status">{text}</p>
{/if}

<style>
	.sync-note {
		position: absolute;
		z-index: 20;
		margin: 0;
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel-raised);
		color: var(--text);
		font-size: 12px;
		white-space: nowrap;
		pointer-events: none;
	}
</style>
