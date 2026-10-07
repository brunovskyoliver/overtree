<script lang="ts">
	import { Pane, PaneGroup, PaneResizer } from 'paneforge';
	import type { Snippet } from 'svelte';
	import type { CompileState } from '#lib/compile.svelte.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import { syncToCode, syncToPdf } from '#lib/synctex.ts';
	import FileTree from './FileTree.svelte';
	import PdfPane from './PdfPane.svelte';
	import SyncStrip from './SyncStrip.svelte';

	// children = editor, outline = body under the "File outline" header
	let {
		children,
		outline,
		compile,
		onopenat,
		project,
		activeId,
		onopen,
		cursor
	}: {
		children: Snippet;
		outline: Snippet;
		compile: CompileState;
		onopenat?: (fileId: string, line: number) => void;
		project: Project;
		activeId?: string | null;
		onopen?: (id: string) => void;
		/** the editor's file and line for "→" (SyncTeX); undefined when no text file is open */
		cursor?: () => { fileId: string; line: number } | undefined;
	} = $props();

	let sidebar = $state<Pane>();
	let pdf = $state<Pane>();
	let sidebarOpen = $state(true);
	let pdfOpen = $state(true);

	const toggle = (pane: Pane | undefined) => (pane?.isCollapsed() ? pane.expand() : pane?.collapse());

	// SyncTeX (research R10): against the last compile's PDF; no mapping (stale, edited since, not in the PDF) does nothing
	let pdfPane = $state<ReturnType<typeof PdfPane>>();
	const pdfId = $derived(compile.last?.pdfId);

	/** "→" and Ctrl/⌘+Alt+J: show the cursor's place in the PDF. */
	export async function forward() {
		const at = cursor?.();
		if (!pdfId || !at) return;
		if (pdf?.isCollapsed()) pdf.expand();
		const r = await syncToPdf(project.id, pdfId, at.fileId, at.line);
		if (r) pdfPane?.showBox(r.page, r.boxes);
	}

	/** Double-click on the PDF or "←": open the source of that spot. */
	async function reverse(page: number, x: number, y: number) {
		const r = pdfId && (await syncToCode(project.id, pdfId, page, x, y));
		if (r) onopenat?.(r.fileId, r.line);
	}

	function reverseVisible() {
		const p = pdfPane?.visiblePoint();
		if (p) void reverse(p.page, p.x, p.y);
	}
</script>

<!-- paneforge stores under `paneforge:<autoSaveId>`, collapsed panes included (FR-018) -->
<PaneGroup direction="horizontal" autoSaveId="overtree:layout:main" class="workspace">
	<Pane
		id="sidebar"
		bind:this={sidebar}
		defaultSize={20}
		minSize={12}
		collapsible
		collapsedSize={0}
		onCollapse={() => (sidebarOpen = false)}
		onExpand={() => (sidebarOpen = true)}
	>
		<!-- inert while collapsed so Tab skips the zero-width tree, divider and outline (FR-016) -->
		<PaneGroup direction="vertical" autoSaveId="overtree:layout:sidebar" class="sidebar" inert={!sidebarOpen}>
			<Pane id="tree" defaultSize={50} minSize={15}>
				<FileTree {project} {activeId} {onopen} />
			</Pane>
			<PaneResizer class="handle handle-h" aria-label="Resize file tree and outline" />
			<Pane id="outline" minSize={15}>
				<section class="outline-panel" aria-labelledby="file-outline-title">
					<h2 class="pane-header" id="file-outline-title">File outline</h2>
					{@render outline()}
				</section>
			</Pane>
		</PaneGroup>
	</Pane>
	<PaneResizer class="handle handle-v" aria-label="Resize sidebar" />
	<Pane id="editor" minSize={25} class="editor-pane">
		{@render children()}
		<button
			type="button"
			class="collapse left"
			aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
			aria-expanded={sidebarOpen}
			onclick={() => toggle(sidebar)}
		>
			<svg viewBox="0 0 8 12" aria-hidden="true"><path d={sidebarOpen ? 'M6 2 2 6l4 4' : 'm2 2 4 4-4 4'} /></svg>
		</button>
		<button
			type="button"
			class="collapse right"
			aria-label={pdfOpen ? 'Collapse PDF' : 'Expand PDF'}
			aria-expanded={pdfOpen}
			onclick={() => toggle(pdf)}
		>
			<svg viewBox="0 0 8 12" aria-hidden="true"><path d={pdfOpen ? 'm2 2 4 4-4 4' : 'M6 2 2 6l4 4'} /></svg>
		</button>
		<!-- on the editor's right rail, above the PDF collapse tab: in the pane, so it takes no width from the layout -->
		<div class="sync-rail"><SyncStrip enabled={!!pdfId} onforward={forward} onreverse={reverseVisible} /></div>
	</Pane>
	<PaneResizer class="handle handle-v" aria-label="Resize PDF" />
	<Pane
		id="pdf"
		bind:this={pdf}
		defaultSize={40}
		minSize={15}
		collapsible
		collapsedSize={0}
		onCollapse={() => (pdfOpen = false)}
		onExpand={() => (pdfOpen = true)}
	>
		<!-- inert while collapsed, like the sidebar -->
		<PdfPane bind:this={pdfPane} {compile} {onopenat} onsync={reverse} inert={!pdfOpen} />
	</Pane>
</PaneGroup>

<style>
	:global(.workspace) {
		height: 100%;
	}
	:global(.sidebar) {
		background: var(--bg-editor);
	}
	.outline-panel {
		height: 100%;
		overflow: auto;
	}
	:global(.editor-pane) {
		position: relative;
	}

	/* drag handles: gray bar with grip dots, like the reference */
	:global(.handle) {
		--grip-v: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='13' fill='%239fa7b6'%3E%3Ccircle cx='1.5' cy='1.5' r='1.2'/%3E%3Ccircle cx='1.5' cy='6.5' r='1.2'/%3E%3Ccircle cx='1.5' cy='11.5' r='1.2'/%3E%3C/svg%3E");
		--grip-h: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='3' fill='%239fa7b6'%3E%3Ccircle cx='1.5' cy='1.5' r='1.2'/%3E%3Ccircle cx='6.5' cy='1.5' r='1.2'/%3E%3Ccircle cx='11.5' cy='1.5' r='1.2'/%3E%3Ccircle cx='16.5' cy='1.5' r='1.2'/%3E%3C/svg%3E");
		flex: none;
		background-color: var(--handle);
		background-repeat: no-repeat;
	}
	:global(.handle-v) {
		width: 7px;
		/* 3-dot grips at 1/4 and 3/4 of the height */
		background-image: var(--grip-v), var(--grip-v);
		background-position:
			center 25%,
			center 75%;
	}
	:global(.handle-h) {
		height: 6px;
		background-image: var(--grip-h);
		background-position: center;
	}
	:global(.handle[data-active]),
	:global(.handle:hover) {
		background-color: #5a6375;
	}

	.collapse {
		position: absolute;
		top: 50%;
		z-index: 5;
		display: grid;
		place-items: center;
		width: 10px;
		height: 30px;
		margin-top: -15px;
		padding: 0;
		border: 0;
		background: var(--handle);
		color: var(--text);
		cursor: pointer;
	}
	/* rails so the tabs never cover line numbers (left, 10px) or the scrollbar (right, 20px with the sync strip) */
	:global(.editor-pane .cm-gutters) {
		padding-left: 10px;
	}
	:global(.editor-pane .cm-scroller) {
		margin-right: 20px;
	}
	.sync-rail {
		position: absolute;
		top: 50%;
		right: 0;
		z-index: 5;
		margin-top: -82px;
	}
	.collapse:hover {
		background: #5a6375;
	}
	.collapse.left {
		left: 0;
		border-radius: 0 4px 4px 0;
	}
	.collapse.right {
		right: 0;
		border-radius: 4px 0 0 4px;
	}
	.collapse:focus-visible {
		outline-offset: -2px;
	}
	svg {
		width: 6px;
		height: 10px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
