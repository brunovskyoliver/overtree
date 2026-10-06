<script lang="ts">
	import { tick } from 'svelte';
	import type { CompileState } from '#lib/compile.svelte.ts';
	import type { Compiler } from '#lib/compile-types.ts';

	let { compile }: { compile: CompileState } = $props();

	const COMPILERS: [Compiler, string][] = [
		['pdflatex', 'pdfLaTeX'],
		['xelatex', 'XeLaTeX'],
		['lualatex', 'LuaLaTeX']
	];

	const errors = $derived(compile.last?.entries.filter((e) => e.level === 'error').length ?? 0);

	let open = $state(false);
	let root: HTMLDivElement;
	let toggle: HTMLButtonElement;
	let menu = $state<HTMLDivElement>();

	const items = () => [...menu!.querySelectorAll<HTMLElement>('[role^="menuitem"]')];

	async function show(focus: 'first' | 'last' = 'first') {
		open = true;
		await tick();
		items().at(focus === 'first' ? 0 : -1)!.focus();
	}

	function close() {
		open = false;
		toggle.focus();
	}

	// menu keyboard per research R12; Enter/Space are the buttons' own click
	function onmenukey(e: KeyboardEvent) {
		const list = items();
		const i = list.indexOf(document.activeElement as HTMLElement);
		const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
		if (to !== undefined) {
			e.preventDefault();
			list[(to + list.length) % list.length].focus();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			close();
		} else if (e.key === 'Tab') open = false;
	}

	function ontogglekey(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		show(e.key === 'ArrowDown' ? 'first' : 'last');
	}
</script>

<!-- ponytail: an outside click closes without moving focus, the click puts it where the user clicked -->
<svelte:window onpointerdown={(e) => open && !root.contains(e.target as Node) && (open = false)} />

<div class="split" bind:this={root}>
	<button type="button" class="recompile" disabled={compile.compiling} aria-busy={compile.compiling} onclick={() => compile.compile()}>
		{compile.compiling ? 'Compiling…' : 'Recompile'}
		{#if errors}<span class="badge" role="img" aria-label="{errors} {errors === 1 ? 'error' : 'errors'}">{errors}</span>{/if}
	</button>
	<button
		type="button"
		class="toggle"
		aria-label="Compile options"
		aria-haspopup="menu"
		aria-expanded={open}
		bind:this={toggle}
		onclick={() => (open ? (open = false) : show())}
		onkeydown={ontogglekey}
	>
		<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
	</button>
	{#if open}
		<div class="menu" role="menu" aria-label="Compile options" tabindex="-1" bind:this={menu} onkeydown={onmenukey}>
			<button
				type="button"
				role="menuitemcheckbox"
				tabindex="-1"
				aria-checked={compile.autoCompile}
				onclick={() => compile.setOption('autoCompile', !compile.autoCompile)}>Auto compile</button
			>
			<div role="group" aria-label="Compiler">
				<span class="heading" aria-hidden="true">Compiler</span>
				{#each COMPILERS as [value, label] (value)}
					<button
						type="button"
						role="menuitemradio"
						tabindex="-1"
						aria-checked={compile.compiler === value}
						onclick={() => compile.setCompiler(value)}>{label}</button
					>
				{/each}
			</div>
			<button
				type="button"
				role="menuitemcheckbox"
				tabindex="-1"
				aria-checked={compile.stopOnFirstError}
				onclick={() => compile.setOption('stopOnFirstError', !compile.stopOnFirstError)}>Stop on first error</button
			>
		</div>
	{/if}
</div>

<style>
	.split {
		position: relative;
		display: inline-flex;
		height: 26px;
	}
	.recompile,
	.toggle {
		border: 0;
		background: var(--accent);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.recompile {
		padding: 0 12px 0 14px;
		border-radius: 13px 0 0 13px;
		font-weight: 600;
	}
	.toggle {
		display: flex;
		align-items: center;
		padding: 0 9px 0 7px;
		border-left: 1px solid rgb(0 0 0 / 0.25);
		border-radius: 0 13px 13px 0;
	}
	.badge {
		display: inline-block;
		min-width: 18px;
		margin-left: 6px;
		padding: 0 5px;
		border-radius: 9px;
		background: #e05252;
		font-size: 12px;
		line-height: 18px;
		text-align: center;
	}
	.recompile:hover:not(:disabled),
	.toggle:hover,
	.toggle[aria-expanded='true'] {
		background: #367a39;
	}
	.recompile:disabled {
		cursor: progress;
		opacity: 0.8;
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		min-width: 200px;
		padding: 4px 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
	}
	.menu [role='group'] {
		display: flex;
		flex-direction: column;
		margin: 4px 0;
		padding: 4px 0;
		border-block: 1px solid var(--border);
	}
	.heading {
		padding: 2px 12px 2px 30px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.menu button {
		position: relative;
		padding: 5px 12px 5px 30px;
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.menu button:hover,
	.menu button:focus-visible {
		background: var(--panel-raised);
		outline: none;
	}
	.menu button[aria-checked='true']::before {
		content: '✓';
		position: absolute;
		left: 11px;
		color: var(--accent-bright);
	}
</style>
