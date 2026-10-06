<script lang="ts">
	import type { CompileState } from '#lib/compile.svelte.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import LogsPanel from './LogsPanel.svelte';
	import PdfToolbar from './PdfToolbar.svelte';
	import PdfViewer from './PdfViewer.svelte';
	import RecompileButton from './RecompileButton.svelte';

	let { compile, editor, inert = false }: { compile: CompileState; editor?: EditorHandle; inert?: boolean } = $props();

	const PDF_KEY = 'overtree:pdf';

	let logsOpen = $state(false);
	let viewer = $state<ReturnType<typeof PdfViewer>>();
	let page = $state(0);
	let pages = $state(0);
	let scale = $state('page-width');
	let percent = $state(100);
	let dark = $state(false);
	try {
		dark = JSON.parse(localStorage.getItem(PDF_KEY) ?? '{}').dark === true;
	} catch {
		// unreadable storage: default
	}
	$effect(() => localStorage.setItem(PDF_KEY, JSON.stringify({ dark })));

	const failed = $derived(compile.last && compile.last.status !== 'success' ? compile.last : undefined);
</script>

<section class="pdf" aria-label="PDF preview" {inert}>
	<div class="bar">
		<RecompileButton {compile} />
		<button
			type="button"
			class="logs-toggle"
			aria-label="Logs"
			title="Logs"
			aria-pressed={logsOpen}
			onclick={() => (logsOpen = !logsOpen)}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L12.5 4.5V14.5H4ZM9.5 1.5v3h3M6 8h4.5M6 10.5h4.5" /></svg>
		</button>
		<a
			class="download"
			href={compile.pdfUrl && `${compile.pdfUrl}&download=1`}
			download="main.pdf"
			aria-label="Download PDF"
			aria-disabled={!compile.pdfUrl}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m-4-4 4 4 4-4M3 13h10" /></svg>
		</a>
		<PdfToolbar {viewer} {page} {pages} {scale} {percent} bind:dark />
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
				<PdfViewer url={compile.pdfUrl} {dark} bind:this={viewer} bind:page bind:pages bind:scale bind:percent />
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
		display: flex;
		align-items: center;
		height: 26px;
		padding: 0 6px;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.logs-toggle:hover,
	.logs-toggle[aria-pressed='true'] {
		background: var(--panel-raised);
	}
	.download {
		display: flex;
		align-items: center;
		height: 26px;
		padding: 0 6px;
		border-radius: 4px;
		color: var(--text);
	}
	.download:hover {
		background: var(--panel-raised);
	}
	.download[aria-disabled='true'] {
		opacity: 0.4;
		pointer-events: none;
	}
	.logs-toggle svg,
	.download svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
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
