<script lang="ts">
	// pdf.mjs must run first: pdf_viewer.mjs reads globalThis.pdfjsLib
	import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist';
	import { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
	import 'pdfjs-dist/web/pdf_viewer.css';
	import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
	import { onMount } from 'svelte';

	GlobalWorkerOptions.workerSrc = workerSrc;

	const FITS = ['page-width', 'page-fit'];

	let {
		url,
		dark = false,
		page = $bindable(0),
		pages = $bindable(0),
		scale = $bindable('page-width'),
		percent = $bindable(100)
	}: { url: string; dark?: boolean; page?: number; pages?: number; scale?: string; percent?: number } = $props();

	let container: HTMLDivElement;
	let viewer = $state<PDFViewer>();
	let shown: PDFDocumentLoadingTask | undefined; // destroy() lives on the loading task in pdf.js 6
	let keep = { page: 1, scale: 'page-width' }; // position to restore when the next PDF is laid out

	onMount(() => {
		const eventBus = new EventBus();
		const v = new PDFViewer({ container, eventBus });
		// a new PDF keeps the zoom and the page, clamped to its length (FR-019)
		eventBus.on('pagesinit', () => {
			v.currentScaleValue = keep.scale;
			v.currentPageNumber = Math.min(Math.max(keep.page, 1), v.pagesCount);
			pages = v.pagesCount;
			page = v.currentPageNumber; // no pagechanging when the clamped page is the reset one
		});
		eventBus.on('pagechanging', (e: { pageNumber: number }) => (page = e.pageNumber));
		eventBus.on('scalechanging', (e: { scale: number }) => {
			scale = v.currentScaleValue;
			percent = Math.round(e.scale * 100);
		});
		// fit modes follow the pane size
		const resize = new ResizeObserver(() => FITS.includes(v.currentScaleValue) && (v.currentScaleValue = v.currentScaleValue));
		resize.observe(container);

		// Trackpad pinch zooms around the fingers. Chromium and Firefox send it as a wheel event with ctrlKey,
		// Safari as gesture* events (scale relative to the gesture start). drawingDelay keeps re-rendering off
		// the hot path while the fingers move.
		const pinch = (factor: number, x: number, y: number) =>
			v.pagesCount && v.updateScale({ scaleFactor: factor, origin: [x, y], drawingDelay: 200 });
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey) return;
			e.preventDefault(); // otherwise the browser zooms the whole page
			const dy = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
			pinch(Math.exp(-dy / 100), e.clientX, e.clientY);
		};
		type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
		let last = 1;
		const onGestureStart = (e: Event) => {
			e.preventDefault();
			last = 1;
		};
		const onGestureChange = (e: Event) => {
			const g = e as GestureEvent;
			e.preventDefault();
			pinch(g.scale / last, g.clientX, g.clientY);
			last = g.scale;
		};
		container.addEventListener('wheel', onWheel, { passive: false });
		container.addEventListener('gesturestart', onGestureStart);
		container.addEventListener('gesturechange', onGestureChange);
		viewer = v;
		return () => {
			container.removeEventListener('wheel', onWheel);
			container.removeEventListener('gesturestart', onGestureStart);
			container.removeEventListener('gesturechange', onGestureChange);
			resize.disconnect();
			viewer = undefined;
			void shown?.destroy();
		};
	});

	export const goTo = (n: number) => viewer && (viewer.currentPageNumber = n);
	export const zoom = (step: 1 | -1) => (step > 0 ? viewer?.increaseScale() : viewer?.decreaseScale());
	export const setScale = (value: string) => viewer && (viewer.currentScaleValue = value);

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
				keep = { page, scale };
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

<div class="viewer" class:dark>
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
	.dark :global(.page canvas) {
		filter: invert(1) hue-rotate(180deg);
	}
</style>
