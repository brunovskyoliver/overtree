<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { PUBLIC_CLERK_PUBLISHABLE_KEY, PUBLIC_TEST_HOOKS } from '$app/env/public';
	import { auth, loadClerk, safeRedirect, testSignIn } from '#lib/auth.svelte.ts';

	// contracts/ui.md "Other pages": Clerk's sign-in widget on the app background (research R1); with test hooks
	// also a test-only form that sets the bypass cookie (research R4)
	const redirect = safeRedirect(page.url.searchParams.get('redirect'));
	let widget = $state<HTMLDivElement>();
	let error = $state('');
	let email = $state('');

	// theme tokens from app.css, read when the widget mounts (Clerk wants literal colors)
	// ponytail: a system light/dark switch while this page is open recolors the page, not the widget; reload fixes it
	function appearance() {
		const css = getComputedStyle(document.documentElement);
		const token = (name: string) => css.getPropertyValue(name).trim();
		return {
			variables: {
				colorPrimary: token('--accent'),
				colorPrimaryForeground: token('--on-accent'),
				colorBackground: token('--panel'),
				colorForeground: token('--text'),
				colorMutedForeground: token('--text-muted'),
				colorInput: token('--bg-editor'),
				colorInputForeground: token('--text'),
				colorBorder: token('--border'),
				colorRing: token('--focus'),
				fontFamily: token('--font-ui'),
				borderRadius: '6px'
			}
		};
	}

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
					appearance: { ...(document.documentElement.dataset.theme === 'light' ? {} : { theme: dark }), ...appearance() }
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
		color: var(--error);
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
		color: var(--on-accent);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
</style>
