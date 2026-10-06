<script lang="ts">
	import type { CompileState } from '#lib/compile.svelte.ts';
	import PdfViewer from './PdfViewer.svelte';
	import RecompileButton from './RecompileButton.svelte';

	let { compile, inert = false }: { compile: CompileState; inert?: boolean } = $props();

	const failed = $derived(compile.last && compile.last.status !== 'success' ? compile.last : undefined);
</script>

<section class="pdf" aria-label="PDF preview" {inert}>
	<div class="bar">
		<RecompileButton {compile} />
	</div>
	{#if failed}
		<p class="banner" role="alert">
			{failed.message}
			{#if compile.pdfUrl}Compile failed, showing the previous PDF.{/if}
		</p>
	{/if}
	{#if compile.pdfUrl}
		<PdfViewer url={compile.pdfUrl} />
	{:else}
		<p class="empty">Click Recompile or press Ctrl/⌘+Enter to see your PDF.</p>
	{/if}
</section>

<style>
	.pdf {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--pdf);
	}
	.bar {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 8px;
		border-bottom: 1px solid var(--border);
	}
	.banner {
		flex: none;
		margin: 0;
		padding: 6px 12px;
		background: #5a2a2a;
		color: var(--text);
	}
	.empty {
		margin: auto;
		padding: 0 16px;
		text-align: center;
		color: var(--text-muted);
	}
</style>
