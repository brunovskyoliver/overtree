<script lang="ts">
	import { EditorView } from '@codemirror/view';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { auth, onSignOut, watchSession } from '#lib/auth.svelte.ts';
	import Editor from '#lib/components/Editor.svelte';
	import HistoryView from '#lib/components/HistoryView.svelte';
	import Outline from '#lib/components/Outline.svelte';
	import ShareDialog from '#lib/components/ShareDialog.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import Workspace from '#lib/components/Workspace.svelte';
	import { CompileState } from '#lib/compile.svelte.ts';
	import { History } from '#lib/history.svelte.ts';
	import { Layout } from '#lib/layout.svelte.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { Project } from '#lib/project.svelte.ts';
	import { Session, type Peer } from '#lib/session.svelte.ts';
	import * as Y from 'yjs';
	import { PUBLIC_TEST_HOOKS } from '$app/env/public';

	// +layout.svelte keys this page on the id: another project gets a fresh Project, editor and sockets
	const project = new Project(page.params.id!);
	project.loadDetails();
	project.load();
	let share = $state<ShareDialog>();
	const history = new History(project.id);
	// live project events (research R8); a role change refetches what the role decides (FR-036)
	const session = new Session(project.id, {
		access: () => (project.loadDetails(), project.load(), share?.refresh()),
		tree: () => project.load(),
		// the main document lives in the files list
		project: () => (project.loadDetails(), project.load()),
		history: () => history.refresh()
	});
	// the others see who is here and in which file (research R8)
	$effect(() => session.present(auth.me, project.active));
	// a refetch that comes back 404 after the project was open: the access went (before the socket even says so)
	const ended = $derived(session.ended ?? (project.loadError === 404 && project.details ? 'removed' : null));
	$effect(() => {
		if (ended) session.destroy();
	});
	const outlined = $derived(!!project.files.find((f) => f.id === project.active)?.name.toLowerCase().endsWith('.tex'));

	let editor = $state<EditorHandle>();
	const compile = new CompileState(project.id, () => editor?.provider);
	compile.load();
	$effect(() => {
		compile.canConfigure = project.details?.permissions.canEdit !== false;
	});

	/** Open a file in a tab and hand its synced editor over; undefined when it isn't a text tab or the user
	 *  switched away meanwhile. */
	async function opened(fileId: string): Promise<EditorHandle | undefined> {
		project.openFile(fileId);
		await tick(); // the editor switches to the tab
		const h = editor;
		if (h?.fileId !== fileId) return;
		// a newly opened tab is empty until its first sync
		if (!h.provider.isSynced)
			await new Promise<void>((resolve) => {
				const done = () => (h.provider.off('synced', done), resolve());
				h.provider.on('synced', done);
			});
		return editor === h ? h : undefined;
	}

	/** A log entry: open its file in a tab and put the cursor on the line (past the end: the last line). */
	async function openAt(fileId: string, line: number) {
		const view = (await opened(fileId))?.view;
		if (!view) return;
		const at = view.state.doc.line(Math.min(line, view.state.doc.lines));
		view.dispatch({ selection: { anchor: at.from }, effects: EditorView.scrollIntoView(at.from, { y: 'center' }) });
		view.focus();
	}

	// Layout menu and the separate PDF window (008 research R12): its double-clicks open the source here
	const layout = new Layout(project.id, (fileId, line) => void openAt(fileId, line));
	layout.mirror(compile);
	onMount(() => () => layout.destroy());

	let workspace = $state<ReturnType<typeof Workspace>>();
	/** The editor's file and cursor line, for SyncTeX's "→". */
	function cursor() {
		if (!editor) return;
		const { state } = editor.view;
		return { fileId: editor.fileId, line: state.doc.lineAt(state.selection.main.head).number };
	}

	/** An avatar: open the file that user is in and scroll to their cursor (research R8). */
	async function jumpTo(peer: Peer) {
		if (!peer.fileId) return;
		const h = await opened(peer.fileId);
		if (!h) return;
		const aw = h.provider.awareness!;
		const head = () => [...aw.getStates().values()].find((s) => s.user?.id === peer.id && s.cursor?.head)?.cursor.head;
		// their state in this file can arrive just after the sync
		if (!head())
			await new Promise<void>((resolve) => {
				const done = () => (aw.off('change', check), clearTimeout(timer), resolve());
				const check = () => head() && done();
				const timer = setTimeout(done, 1000);
				aw.on('change', check);
			});
		const pos = head() && Y.createAbsolutePositionFromRelativePosition(head(), h.provider.document);
		if (!pos || editor !== h) return;
		h.view.dispatch({ effects: EditorView.scrollIntoView(pos.index, { y: 'center' }) });
		h.view.focus();
	}

	// signed out in another tab: leaving the page closes every provider (analyze M1)
	onMount(() => watchSession(() => location.assign(`/sign-in?redirect=${encodeURIComponent(location.pathname)}`)));
	onMount(() => onSignOut(() => session.destroy()));
	onMount(() => () => session.destroy());

	$effect(() => {
		if (editor && window.__overtree && (import.meta.env.DEV || PUBLIC_TEST_HOOKS)) window.__overtree.compile = compile;
	});
</script>

<svelte:head>
	<title>{project.details ? `${project.details.title} · Overtree` : 'Overtree'}</title>
</svelte:head>

<div class="app">
	<TopBar
		project={project.details && !ended
			? { title: project.details.title, onrename: project.details.role === 'owner' ? (t) => project.renameProject(t) : undefined }
			: undefined}
		onshare={project.details && !ended ? () => share?.open() : undefined}
		peers={ended ? [] : session.peers}
		onjump={jumpTo}
		offline={!ended && session.offline}
		history={project.details && !ended ? { on: history.open, toggle: () => history.toggle() } : undefined}
		layout={project.details && !ended ? layout : undefined}
	/>
	{#if ended}
		<!-- contracts/ui.md "Other pages": the project closed under the user (FR-036) -->
		<main class="noaccess">
			<h1>{ended === 'deleted' ? 'This project was deleted' : 'Your access was removed'}</h1>
			<p>{ended === 'deleted' ? 'Its files are gone.' : 'The owner no longer shares this project with you.'}</p>
			<a href="/">Back to dashboard</a>
		</main>
	{:else if project.loadError === 404}
		<!-- contracts/ui.md "Other pages": no project data, only the way back -->
		<main class="noaccess">
			<h1>You don’t have access to this project</h1>
			<p>Ask the owner to share it with you, or check the link.</p>
			<a href="/">Back to dashboard</a>
		</main>
	{:else}
		<main>
			<!-- the History view covers the workspace; the editor stays mounted (hidden, inert) so its providers stay
			     connected and the tabs come back as they were (008 research R13) -->
			{#if history.open}
				<div class="history-layer"><HistoryView {history} canEdit={project.details?.permissions.canEdit ?? false} /></div>
			{/if}
			<div class="work" class:hidden={history.open} inert={history.open}>
				<Workspace
					bind:this={workspace}
					{compile}
					{project}
					onopenat={openAt}
					{cursor}
					{layout}
					activeId={project.active}
					onopen={(id) => project.openFile(id)}
				>
					<Editor
						{project}
						{session}
						bind:editor
						onLocalEdit={() => compile.onLocalEdit()}
						onCompile={() => compile.compile()}
						onSyncForward={() => workspace?.forward()}
					/>
					{#snippet outline()}
						<Outline {editor} enabled={outlined} />
					{/snippet}
				</Workspace>
			</div>
		</main>
		<ShareDialog bind:this={share} {project} />
	{/if}
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	main {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	.work {
		height: 100%;
	}
	.hidden {
		visibility: hidden;
	}
	.history-layer {
		position: absolute;
		inset: 0;
		z-index: 10;
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
