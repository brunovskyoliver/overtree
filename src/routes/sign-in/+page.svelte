<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { PUBLIC_CLERK_PUBLISHABLE_KEY, PUBLIC_TEST_HOOKS } from '$app/env/public';
	import { auth, loadClerk, safeRedirect, testSignIn } from '#lib/auth.svelte.ts';

	// contracts/ui.md "Other pages": Clerk's sign-in widget on the dark background (research R1); with test hooks
	// also a test-only form that sets the bypass cookie (research R4)
	const redirect = safeRedirect(page.url.searchParams.get('redirect'));
	let widget = $state<HTMLDivElement>();
	let error = $state('');
	let email = $state('');

	// theme tokens from app.css; Clerk wants literal colors
	const appearance = {
		variables: {
			colorPrimary: '#2f6a31',
			colorPrimaryForeground: '#e6e8ec',
			colorBackground: '#262b36',
			colorForeground: '#e6e8ec',
			colorMutedForeground: '#9aa1ad',
			colorInput: '#1e2230',
			colorInputForeground: '#e6e8ec',
			colorBorder: '#3a404d',
			colorRing: '#7cb8ff',
			fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
			borderRadius: '6px'
		}
	};

	onMount(() => {
		let el: HTMLDivElement | undefined;
		let stopped = false;
		(async () => {
			// already signed in (e.g. the back button): straight on
			if (await auth.loadMe()) return void location.replace(redirect);
			if (!PUBLIC_CLERK_PUBLISHABLE_KEY || stopped) return;
			try {
				const [clerk, { dark }] = await Promise.all([loadClerk(), import('@clerk/ui/themes')]);
				if (stopped || !widget) return;
				el = widget;
				clerk.mountSignIn(el, {
					routing: 'hash',
					withSignUp: true,
					forceRedirectUrl: redirect,
					signUpForceRedirectUrl: redirect,
					appearance: { theme: dark, ...appearance }
				});
			} catch (e) {
				error = `Sign-in could not load: ${(e as Error).message}`;
			}
		})();
		return () => {
			stopped = true;
			if (el) loadClerk().then((c) => c.unmountSignIn(el!));
		};
	});

	function onTestSignIn(e: SubmitEvent) {
		e.preventDefault();
		if (!email.trim()) return;
		testSignIn(email);
		location.assign(redirect);
	}
</script>

<svelte:head>
	<title>Sign in · Overtree</title>
</svelte:head>

<main>
	<h1>Overtree</h1>
	{#if error}<p role="alert">{error}</p>{/if}
	<div class="widget" bind:this={widget}></div>
	{#if PUBLIC_TEST_HOOKS}
		<form class="test" aria-label="Test sign-in" onsubmit={onTestSignIn}>
			<input type="email" aria-label="Test email" placeholder="email@test.local" required bind:value={email} />
			<button type="submit">Test sign-in</button>
		</form>
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		min-height: 100vh;
		padding: 12vh 16px 32px;
		background: var(--bg);
	}
	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	p[role='alert'] {
		margin: 0;
		color: #f28b82;
	}
	.test {
		display: flex;
		gap: 8px;
		padding: 10px 12px;
		border: 1px dashed var(--border);
		border-radius: 6px;
	}
	input {
		width: 220px;
		height: 28px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	button {
		padding: 0 14px;
		border: 0;
		border-radius: 13px;
		background: var(--accent);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
</style>
