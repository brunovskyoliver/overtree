<script lang="ts">
	import { goto } from '$app/navigation';

	// ponytail: temporary until the dashboard (US2, T030): open the most recent project, or offer a blank one
	let empty = $state(false);
	let error = $state('');

	async function start() {
		const res = await fetch('/api/projects');
		if (!res.ok) return void (error = `Could not load your projects (${res.status}).`);
		const { projects }: { projects: { id: string }[] } = await res.json();
		if (projects.length) goto(`/project/${projects[0].id}`, { replaceState: true });
		else empty = true;
	}

	async function create() {
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'Untitled project' })
		});
		if (!res.ok) return void (error = `Could not create a project (${res.status}).`);
		goto(`/project/${(await res.json()).id}`);
	}

	start();
</script>

<main>
	{#if error}<p role="alert">{error}</p>{/if}
	{#if empty}
		<h1>No projects yet</h1>
		<button type="button" onclick={create}>New project</button>
	{/if}
</main>

<style>
	main {
		display: grid;
		place-content: center;
		gap: 12px;
		height: 100vh;
		text-align: center;
	}
	h1 {
		font-size: 18px;
		font-weight: 500;
	}
	button {
		padding: 6px 14px;
		color: var(--text);
		background: var(--accent);
		border: 0;
		border-radius: 4px;
		font: inherit;
	}
</style>
