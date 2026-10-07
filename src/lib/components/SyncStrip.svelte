<script lang="ts">
	// The narrow strip between the editor and the PDF (contracts/ui.md "Sync strip", research R10).
	// no `onreverse`: only "→" (the PDF is in its own window, which has "←")
	let { enabled, onforward, onreverse }: { enabled: boolean; onforward: () => void; onreverse?: () => void } = $props();
</script>

<div class="sync">
	<button
		type="button"
		aria-label="Go to PDF location"
		title={enabled ? 'Go to PDF location (Ctrl/⌘+Alt+J)' : 'Compile first'}
		aria-keyshortcuts="Control+Alt+J Meta+Alt+J"
		disabled={!enabled}
		onclick={onforward}
	>
		<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8M7 3l3 3-3 3" /></svg>
	</button>
	{#if onreverse}
		<button type="button" aria-label="Go to code location" title={enabled ? 'Go to code location' : 'Compile first'} disabled={!enabled} onclick={onreverse}>
			<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M10 6H2M5 3 2 6l3 3" /></svg>
		</button>
	{/if}
</div>

<style>
	.sync {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 20px;
		padding: 4px 0;
		border-radius: 4px 0 0 4px;
		background: var(--handle);
	}
	button {
		display: grid;
		place-items: center;
		width: 18px;
		height: 24px;
		margin: 0 auto;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--panel-raised);
	}
	button:focus-visible {
		outline-offset: -2px;
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	svg {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
