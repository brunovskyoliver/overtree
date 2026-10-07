<script lang="ts">
	// pdf.mjs must run first: pdf_viewer.mjs reads globalThis.pdfjsLib
	import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist';
	import { EventBus, PDFViewer, type PDFPageView } from 'pdfjs-dist/web/pdf_viewer.mjs';
	import 'pdfjs-dist/web/pdf_viewer.css';
	import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
	import { onMount } from 'svelte';
	import type { SyncBox } from '#lib/synctex.ts';

	GlobalWorkerOptions.workerSrc = workerSrc;

	const FITS = ['page-width', 'page-fit'];

	let {
		url,
		dark = false,
		page = $bindable(0),
		pages = $bindable(0),
		scale = $bindable('page-width'),
		percent = $bindable(100),
		onsync,
		projectId
	}: {
		url: string;
		dark?: boolean;
		page?: number;
		pages?: number;
		scale?: string;
		percent?: number;
		/** double-click on a page: the point in PDF points from the page's top-left (reverse SyncTeX) */
		onsync?: (page: number, x: number, y: number) => void;
		/** remembers the position per project on this device (FR-025) */
		projectId?: string;
	} = $props();

	let container: HTMLDivElement;
	let viewer = $state<PDFViewer>();
	let shown: PDFDocumentLoadingTask | undefined; // destroy() lives on the loading task in pdf.js 6
	// Where the reader is (research R11): the page at the top edge of the pane, how far down it the edge is (0–1) and
	// the zoom. `keep` is restored when the next PDF is laid out; `pos` follows scrolling, also in localStorage.
	type Pos = { page: number; offset: number; scale: string };
	// svelte-ignore state_referenced_locally (PdfPane is under the project page, which is keyed on the project)
	const posKey = projectId && `overtree:pdfpos:${projectId}`;
	let keep: Pos = { page: 1, offset: 0, scale: 'page-width', ...stored() };
	let pos = keep;
	let trackNow = () => {};
	let restoring = true; // between a setDocument and its pagesinit the scroll position means nothing

	function stored(): Partial<Pos> | undefined {
		try {
			const p = posKey && JSON.parse(localStorage.getItem(posKey) ?? 'null');
			if (p && Number.isInteger(p.page) && typeof p.offset === 'number' && typeof p.scale === 'string') return p;
		} catch {
			// unreadable storage: from the top
		}
	}

	onMount(() => {
		const eventBus = new EventBus();
		const v = new PDFViewer({ container, eventBus });
		// a new PDF keeps the zoom, the page and the offset in it; past its end, the last page (FR-019, FR-025)
		eventBus.on('pagesinit', () => {
			v.currentScaleValue = keep.scale;
			const n = Math.min(Math.max(keep.page, 1), v.pagesCount);
			const view = v.getPageView(n - 1);
			if (n === keep.page && keep.offset > 0 && view) {
				const [, y0, , y1] = view.viewport.viewBox;
				v.scrollPageIntoView({ pageNumber: n, destArray: [null, { name: 'XYZ' }, null, y1 - keep.offset * (y1 - y0), null] });
			} else v.currentPageNumber = n;
			restoring = false;
			track();
			pages = v.pagesCount;
			page = v.currentPageNumber; // no pagechanging when the clamped page is the reset one
		});
		eventBus.on('pagechanging', (e: { pageNumber: number }) => (page = e.pageNumber));
		eventBus.on('scalechanging', (e: { scale: number }) => {
			scale = v.currentScaleValue;
			percent = Math.round(e.scale * 100);
			later();
		});

		const track = () => {
			clearTimeout(timer);
			timer = undefined;
			if (restoring || !v.pagesCount) return;
			const top = container.getBoundingClientRect().top;
			for (let i = 0; i < v.pagesCount; i++) {
				const div = v.getPageView(i)?.div;
				const r = div?.getBoundingClientRect();
				if (!div || !r || r.bottom <= top) continue;
				// in the gap above a page: its top
				const offset = Math.min(Math.max((top - r.top - div.clientTop) / div.clientHeight, 0), 1);
				pos = { page: i + 1, offset, scale: v.currentScaleValue };
				if (posKey) localStorage.setItem(posKey, JSON.stringify(pos));
				return;
			}
		};
		trackNow = track;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const later = () => (timer ??= setTimeout(track, 150));
		container.addEventListener('scroll', later, { passive: true });
		// a reload right after a scroll: save now
		addEventListener('pagehide', track);
		// fit modes follow the pane size
		const resize = new ResizeObserver(() => FITS.includes(v.currentScaleValue) && (v.currentScaleValue = v.currentScaleValue));
		resize.observe(container);

		// Trackpad pinch zooms around the fingers. Chromium and Firefox send it as a wheel event with ctrlKey,
		// Safari as gesture* events (scale relative to the gesture start). drawingDelay keeps re-rendering off
		// the hot path while the fingers move.
		// pdf.js rounds every step to 1 %: keep our own unrounded target so many tiny trackpad deltas still add up.
		// Its own `origin` anchoring drifts vertically (it re-scrolls to the page top first), so pin the spot
		// under the cursor ourselves: same fraction of the same page before and after the zoom.
		let wanted = 0;
		const pinch = (factor: number, x: number, y: number) => {
			if (!v.pagesCount) return;
			if (Math.abs(wanted - v.currentScale) > 0.01) wanted = v.currentScale; // zoomed some other way meanwhile
			wanted = Math.min(Math.max(wanted * factor, 0.1), 25);
			const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.page') ?? v.getPageView(v.currentPageNumber - 1)?.div;
			const before = el?.getBoundingClientRect();
			v.updateScale({ scaleFactor: wanted / v.currentScale, drawingDelay: 200 });
			if (!el || !before) return;
			const after = el.getBoundingClientRect();
			container.scrollLeft += after.left + ((x - before.left) / before.width) * after.width - x;
			container.scrollTop += after.top + ((y - before.top) / before.height) * after.height - y;
		};
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
		const onDblClick = (e: MouseEvent) => {
			const n = Number((e.target as Element).closest<HTMLElement>('.page')?.dataset.pageNumber);
			const view = n ? v.getPageView(n - 1) : undefined;
			if (onsync && view) onsync(n, ...pdfPoint(view, e.clientX, e.clientY));
		};
		container.addEventListener('dblclick', onDblClick);
		container.addEventListener('wheel', onWheel, { passive: false });
		container.addEventListener('gesturestart', onGestureStart);
		container.addEventListener('gesturechange', onGestureChange);
		viewer = v;
		return () => {
			container.removeEventListener('scroll', later);
			removeEventListener('pagehide', track);
			clearTimeout(timer);
			container.removeEventListener('dblclick', onDblClick);
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

	/** A point on screen → PDF points from the page's top-left (SyncTeX's frame; PDF space starts bottom-left). */
	function pdfPoint(view: PDFPageView, clientX: number, clientY: number): [number, number] {
		const r = view.div.getBoundingClientRect();
		const [x, y] = view.viewport.convertToPdfPoint(clientX - r.left - view.div.clientLeft, clientY - r.top - view.div.clientTop);
		const [x0, , , y1] = view.viewport.viewBox;
		return [x - x0, y1 - y];
	}

	/** Forward SyncTeX: scroll `boxes` (PDF points from the page's top-left) of page `n` to the middle of the pane and
	 *  highlight them for a second. */
	export function showBox(n: number, boxes: SyncBox[]) {
		const view = viewer?.getPageView(n - 1);
		if (!viewer || !view) return;
		const [x0, y0, x1, y1] = view.viewport.viewBox;
		const first = boxes[0];
		// XYZ takes PDF space (bottom-left origin); no zoom: keep the current one
		const dest = first && [null, { name: 'XYZ' }, x0 + Math.max(first.x - 20, 0), y1 - first.y - first.height / 2, null];
		viewer.scrollPageIntoView({ pageNumber: n, destArray: dest, center: dest ? 'vertical' : undefined });
		// in % of the page, so a zoom meanwhile doesn't misplace them
		const pct = (v: number, of: number) => `${(v / of) * 100}%`;
		for (const b of boxes) {
			const mark = document.createElement('div');
			mark.className = 'sync-highlight';
			Object.assign(mark.style, { left: pct(b.x, x1 - x0), top: pct(b.y, y1 - y0), width: pct(b.width, x1 - x0), height: pct(b.height, y1 - y0) });
			view.div.append(mark);
			setTimeout(() => mark.remove(), 1000);
		}
	}

	/** For "←": a point near the top of the visible part of the current page (a quarter down, mid-width so it is in
	 *  the text rather than a line's indent), in PDF points from the page's top-left. */
	export function visiblePoint(): { page: number; x: number; y: number } | undefined {
		const n = viewer?.currentPageNumber ?? 0;
		const view = viewer?.pagesCount ? viewer.getPageView(n - 1) : undefined;
		if (!view) return;
		const c = container.getBoundingClientRect();
		const r = view.div.getBoundingClientRect();
		const [left, top] = [Math.max(c.left, r.left), Math.max(c.top, r.top)];
		const [right, bottom] = [Math.min(c.right, r.right), Math.min(c.bottom, r.bottom)];
		if (right <= left || bottom <= top) return;
		const [x, y] = pdfPoint(view, (left + right) / 2, top + (bottom - top) / 4);
		return { page: n, x, y };
	}

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
				trackNow(); // a scroll in the last 150 ms
				keep = pos;
				restoring = true;
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
	:global(.sync-highlight) {
		position: absolute;
		z-index: 10;
		border-radius: 2px;
		background: rgb(255 196 0 / 35%);
		outline: 2px solid rgb(255 196 0 / 80%);
		pointer-events: none;
	}
	.dark :global(.page canvas) {
		filter: invert(1) hue-rotate(180deg);
	}
</style>
