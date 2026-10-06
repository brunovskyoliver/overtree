<script lang="ts">
	import { EditorView } from '@codemirror/view';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { watchSession } from '#lib/auth.svelte.ts';
	import Editor from '#lib/components/Editor.svelte';
	import Outline from '#lib/components/Outline.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import Workspace from '#lib/components/Workspace.svelte';
	import { CompileState } from '#lib/compile.svelte.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { Project } from '#lib/project.svelte.ts';
	import { PUBLIC_TEST_HOOKS } from '$app/env/public';

	// +layout.svelte keys this page on the id: another project gets a fresh Project, editor and sockets
	const project = new Project(page.params.id!);
	project.loadDetails();
	project.load();
	const outlined = $derived(!!project.files.find((f) => f.id === project.active)?.name.toLowerCase().endsWith('.tex'));

	let editor = $state<EditorHandle>();
	const compile = new CompileState(project.id, () => editor?.provider);
	compile.load();

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

	$effect(() => {
		if (editor && window.__overtree && (import.meta.env.DEV || PUBLIC_TEST_HOOKS)) window.__overtree.compile = compile;
	});
</script>

<div class="app">
	<TopBar>
		{#snippet title()}{project.details?.title ?? ''}{/snippet}
	</TopBar>
	<main>
		<Workspace {compile} {project} onopenat={openAt} activeId={project.active} onopen={(id) => project.openFile(id)}>
			<Editor {project} bind:editor onLocalEdit={() => compile.onLocalEdit()} onCompile={() => compile.compile()} />
			{#snippet outline()}
				<Outline {editor} enabled={outlined} />
			{/snippet}
		</Workspace>
	</main>
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
</style>
