<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import PdfPane from '#lib/components/PdfPane.svelte';
	import { CompileState } from '#lib/compile.svelte.ts';
	import { mirrorCompile, pdfChannel } from '#lib/layout.svelte.ts';
	import { Project } from '#lib/project.svelte.ts';
	import { syncToCode, syncToPdf } from '#lib/synctex.ts';

	// The separate PDF window (008 research R12, contracts/ui.md "PDF window route"): its own compile state, kept in
	// step with the project page over the `overtree:pdf:<id>` channel; SyncTeX answers go back to the editor there.
	const project = new Project(page.params.id!);
	project.loadDetails();
	const compile = new CompileState(project.id, () => undefined);
	compile.load();
	$effect(() => {
		compile.canConfigure = project.details?.permissions.canEdit !== false;
	});

	let pane = $state<ReturnType<typeof PdfPane>>();
	const pdfId = $derived(compile.last?.pdfId);

	const channel = pdfChannel(project.id, 'pdf', (m) => {
		if (m.type === 'compiled') received(m.last);
		else if (m.type === 'forward') void forward(m.fileId, m.line);
		else if (m.type === 'hello') channel.post({ type: 'hello' }); // the project page reloaded and looks for us
		else if (m.type === 'bye') window.close(); // the project page left the separate-window layout
	});
	const received = mirrorCompile(compile, channel.post);

	async function forward(fileId: string, line: number) {
		const r = pdfId && (await syncToPdf(project.id, pdfId, fileId, line));
		if (r) pane?.showBox(r.page, r.boxes);
	}

	const openAt = (fileId: string, line: number) => channel.post({ type: 'open-at', fileId, line });

	async function reverse(n: number, x: number, y: number) {
		const r = pdfId && (await syncToCode(project.id, pdfId, n, x, y));
		if (r) openAt(r.fileId, r.line);
	}

	function reverseVisible() {
		const p = pane?.visiblePoint();
		if (p) void reverse(p.page, p.x, p.y);
	}

	onMount(() => {
		channel.post({ type: 'hello' });
		const bye = () => channel.post({ type: 'bye' });
		addEventListener('pagehide', bye);
		return () => (removeEventListener('pagehide', bye), channel.close());
	});
</script>

<svelte:head>
	<title>{project.details ? `${project.details.title} — PDF · Overtree` : 'Overtree'}</title>
</svelte:head>

{#if project.loadError === 404}
	<!-- contracts/ui.md "Other pages" (005): no project data, only the way back -->
	<main class="noaccess">
		<h1>You don’t have access to this project</h1>
		<p>Ask the owner to share it with you, or check the link.</p>
		<a href="/">Back to dashboard</a>
	</main>
{:else if project.details}
	<main class="window">
		<PdfPane bind:this={pane} {compile} projectId={project.id} onopenat={openAt} onsync={reverse}>
			{#snippet tools()}
				<button type="button" class="to-code" aria-label="Go to code location" title={pdfId ? 'Go to code location' : 'Compile first'} disabled={!pdfId} onclick={reverseVisible}>
					<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M10 6H2M5 3 2 6l3 3" /></svg>
				</button>
			{/snippet}
		</PdfPane>
	</main>
{/if}

<style>
	.window {
		height: 100vh;
	}
	.to-code {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.to-code:hover:not(:disabled) {
		background: var(--panel-raised);
	}
	.to-code:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.to-code svg {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.noaccess {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding-top: 20vh;
		text-align: center;
	}
	.noaccess h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}
	.noaccess p {
		margin: 0 0 8px;
		color: var(--text-muted);
	}
	.noaccess a {
		color: var(--focus);
	}
</style>
