<script lang="ts">
	import type { CompileState } from '#lib/compile.svelte.ts';

	let { compile }: { compile: CompileState } = $props();
</script>

<button type="button" class="recompile" disabled={compile.compiling} aria-busy={compile.compiling} onclick={() => compile.compile()}>
	{compile.compiling ? 'Compiling…' : 'Recompile'}
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
	.recompile:hover:not(:disabled) {
		background: #367a39;
	}
	.recompile:disabled {
		cursor: progress;
		opacity: 0.8;
	}
</style>
