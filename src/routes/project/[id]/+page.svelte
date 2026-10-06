<script lang="ts">
	import { EditorView } from '@codemirror/view';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { onSignOut, watchSession } from '#lib/auth.svelte.ts';
	import Editor from '#lib/components/Editor.svelte';
	import Outline from '#lib/components/Outline.svelte';
	import ShareDialog from '#lib/components/ShareDialog.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import Workspace from '#lib/components/Workspace.svelte';
	import { CompileState } from '#lib/compile.svelte.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { Project } from '#lib/project.svelte.ts';
	import { Session } from '#lib/session.svelte.ts';
	import { PUBLIC_TEST_HOOKS } from '$app/env/public';

	// +layout.svelte keys this page on the id: another project gets a fresh Project, editor and sockets
	const project = new Project(page.params.id!);
	project.loadDetails();
	project.load();
	let share = $state<ShareDialog>();
	// live project events (research R8); a role change refetches what the role decides (FR-036)
	const session = new Session(project.id, {
		access: () => (project.loadDetails(), project.load(), share?.refresh()),
		tree: () => project.load(),
		project: () => project.loadDetails()
	});
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

	/** A log entry: open its file in a tab and put the cursor on the line (past the end: the last line). */
	async function openAt(fileId: string, line: number) {
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
		if (editor !== h) return; // switched away meanwhile
		const { view } = h;
		const at = view.state.doc.line(Math.min(line, view.state.doc.lines));
		view.dispatch({ selection: { anchor: at.from }, effects: EditorView.scrollIntoView(at.from, { y: 'center' }) });
		view.focus();
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
			<Workspace {compile} {project} onopenat={openAt} activeId={project.active} onopen={(id) => project.openFile(id)}>
				<Editor {project} {session} bind:editor onLocalEdit={() => compile.onLocalEdit()} onCompile={() => compile.compile()} />
				{#snippet outline()}
					<Outline {editor} enabled={outlined} />
				{/snippet}
			</Workspace>
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
		flex: 1;
		min-height: 0;
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
