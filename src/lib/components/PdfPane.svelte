<script lang="ts">
	import type { CompileState } from '#lib/compile.svelte.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import LogsPanel from './LogsPanel.svelte';
	import PdfViewer from './PdfViewer.svelte';
	import RecompileButton from './RecompileButton.svelte';

	let { compile, editor, inert = false }: { compile: CompileState; editor?: EditorHandle; inert?: boolean } = $props();

	let logsOpen = $state(false);

	const failed = $derived(compile.last && compile.last.status !== 'success' ? compile.last : undefined);
</script>

<section class="pdf" aria-label="PDF preview" {inert}>
	<div class="bar">
		<RecompileButton {compile} />
		<button type="button" class="logs-toggle" aria-pressed={logsOpen} onclick={() => (logsOpen = !logsOpen)}>Logs</button>
	</div>
	{#if failed}
		<p class="banner" role="alert">
			{failed.message}
			{#if compile.pdfUrl}Compile failed, showing the previous PDF.{/if}
			{#if !logsOpen}<button type="button" onclick={() => (logsOpen = true)}>See logs</button>{/if}
		</p>
	{/if}
	<div class="body">
		{#if logsOpen}
			{#key compile.last?.id}
				<LogsPanel entries={compile.last?.entries ?? []} {editor} onclose={() => (logsOpen = false)} />
			{/key}
		{/if}
		<!-- stays mounted (and laid out, so pdf.js can measure) under the logs: closing them shows the PDF at once -->
		<div class="view" class:covered={logsOpen} inert={logsOpen}>
			{#if compile.pdfUrl}
				<PdfViewer url={compile.pdfUrl} />
			{:else}
				<p class="empty">Click Recompile or press Ctrl/⌘+Enter to see your PDF.</p>
			{/if}
		</div>
	</div>
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
	.logs-toggle {
		height: 26px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: none;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.logs-toggle:hover,
	.logs-toggle[aria-pressed='true'] {
		background: var(--panel-raised);
	}
	.banner button {
		margin-left: 6px;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.body,
	.view {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.covered {
		visibility: hidden;
	}
	.empty {
		margin: auto;
		padding: 0 16px;
		text-align: center;
		color: var(--text-muted);
	}
</style>
