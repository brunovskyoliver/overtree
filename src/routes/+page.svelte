<script lang="ts">
	import Editor from '#lib/components/Editor.svelte';
	import Outline from '#lib/components/Outline.svelte';
	import Workspace from '#lib/components/Workspace.svelte';
	import { CompileState } from '#lib/compile.svelte.ts';
	import type { EditorHandle } from '#lib/editor/types.ts';
	import { PUBLIC_TEST_HOOKS } from '$app/env/public';

	// ponytail: one project, feature 005 adds a projects table
	const PROJECT_NAME = 'Untitled project';

	let editor = $state<EditorHandle>();
	const compile = new CompileState(() => editor?.provider);
	compile.load();

	$effect(() => {
		if (editor && window.__overtree && (import.meta.env.DEV || PUBLIC_TEST_HOOKS)) window.__overtree.compile = compile;
	});
</script>

<div class="app">
	<header class="topbar">
		<span class="brand">Overtree</span>
		<span class="project">{PROJECT_NAME}</span>
	</header>
	<main>
		<Workspace {compile} {editor}>
			<Editor bind:editor onLocalEdit={() => compile.onLocalEdit()} onCompile={() => compile.compile()} />
			{#snippet outline()}
				<Outline {editor} />
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
	.topbar {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		height: 44px;
		padding: 0 14px;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		font-weight: 600;
	}
	.project {
		font-weight: 500;
	}
	main {
		flex: 1;
		min-height: 0;
	}
</style>
