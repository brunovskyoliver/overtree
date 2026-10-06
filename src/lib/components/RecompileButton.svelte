<script lang="ts">
	import type { CompileState } from '#lib/compile.svelte.ts';

	let { compile }: { compile: CompileState } = $props();

	const errors = $derived(compile.last?.entries.filter((e) => e.level === 'error').length ?? 0);
</script>

<button type="button" class="recompile" disabled={compile.compiling} aria-busy={compile.compiling} onclick={() => compile.compile()}>
	{compile.compiling ? 'Compiling…' : 'Recompile'}
	{#if errors}<span class="badge" role="img" aria-label="{errors} errors">{errors}</span>{/if}
</button>

<style>
	.recompile {
		height: 26px;
		padding: 0 14px;
		border: 0;
		border-radius: 13px;
		background: var(--accent);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.badge {
		display: inline-block;
		min-width: 18px;
		margin-left: 6px;
		padding: 0 5px;
		border-radius: 9px;
		background: #e05252;
		font-size: 12px;
		line-height: 18px;
		text-align: center;
	}
	.recompile:hover:not(:disabled) {
		background: #367a39;
	}
	.recompile:disabled {
		cursor: progress;
		opacity: 0.8;
	}
</style>
