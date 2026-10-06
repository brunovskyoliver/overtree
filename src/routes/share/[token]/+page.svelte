<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const signIn = $derived(`/sign-in?redirect=${encodeURIComponent(page.url.pathname)}`);
</script>

<svelte:head>
	<title>{data.project ? `${data.project.title} · Overtree` : 'Overtree'}</title>
</svelte:head>

<main>
	<span class="brand">Overtree</span>
	{#if data.project}
		<h1>{data.project.title}</h1>
		<p>Sign in to open this project</p>
		<a class="button" href={signIn}>Sign in</a>
	{:else}
		<h1>This link is no longer valid</h1>
		<p>Ask the project owner for a new link.</p>
		<a href="/">Go to your projects</a>
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		min-height: 100vh;
		padding: 20vh 16px 32px;
		text-align: center;
	}
	.brand {
		color: var(--text-muted);
		font-weight: 600;
	}
	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	p {
		margin: 0;
		color: var(--text-muted);
	}
	a {
		color: var(--focus);
	}
	.button {
		margin-top: 8px;
		padding: 6px 18px;
		border-radius: 14px;
		background: var(--accent);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
</style>
