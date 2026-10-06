<script lang="ts">
	import { page } from '$app/state';
	import { signOut } from '#lib/auth.svelte.ts';

	// contracts/ui.md "Other pages": hooks.server.ts sends disabled and not-allowed users here
	const disabled = $derived(page.url.searchParams.get('reason') === 'disabled');
</script>

<svelte:head>
	<title>Blocked · Overtree</title>
</svelte:head>

<main>
	<h1>{disabled ? 'Your account is disabled' : 'Your email isn’t allowed on this instance'}</h1>
	<p>{disabled ? 'Ask an admin of this instance to enable it again.' : 'Ask an admin of this instance to let your email in, then sign in again.'}</p>
	<button type="button" onclick={signOut}>Sign out</button>
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
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}
	p {
		margin: 0;
		color: var(--text-muted);
	}
	button {
		margin-top: 8px;
		padding: 5px 14px;
		border: 1px solid var(--border);
		border-radius: 13px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	button:hover {
		background: #3a4252;
	}
</style>
