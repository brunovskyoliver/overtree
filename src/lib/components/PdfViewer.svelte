<script lang="ts">
	// pdf.mjs must run first: pdf_viewer.mjs reads globalThis.pdfjsLib
	import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist';
	import { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
	import 'pdfjs-dist/web/pdf_viewer.css';
	import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
	import { onMount } from 'svelte';

	GlobalWorkerOptions.workerSrc = workerSrc;

	let { url }: { url: string } = $props();

	let container: HTMLDivElement;
	let viewer = $state<PDFViewer>();
	let shown: PDFDocumentLoadingTask | undefined; // destroy() lives on the loading task in pdf.js 6

	onMount(() => {
		const eventBus = new EventBus();
		const v = new PDFViewer({ container, eventBus });
		eventBus.on('pagesinit', () => (v.currentScaleValue = 'page-width'));
		viewer = v;
		return () => {
			viewer = undefined;
			void shown?.destroy();
		};
	});

	// Parse the new PDF before swapping, so the old pages stay visible until then (SC-007).
	$effect(() => {
		const v = viewer;
		if (!v) return;
		let stale = false;
		const task = getDocument({ url });
		task.promise.then(
			(doc) => {
				if (stale) return void task.destroy();
				const old = shown;
				shown = task;
				v.setDocument(doc);
				void old?.destroy();
			},
			() => {} // a broken/missing PDF keeps the old one
		);
		return () => {
			stale = true;
			if (shown !== task) void task.destroy();
		};
	});
</script>

<div class="viewer">
	<div class="container" bind:this={container} data-testid="pdf-viewer">
		<div class="pdfViewer"></div>
	</div>
</div>

<style>
	.viewer {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	/* PDFViewer requires an absolutely positioned scroll container */
	.container {
		position: absolute;
		inset: 0;
		overflow: auto;
	}
</style>
