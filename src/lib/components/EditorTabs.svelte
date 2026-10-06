<script lang="ts">
	import { fileType } from '#lib/files.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import FileIcon from './FileIcon.svelte';

	// Tab strip per contracts/ui.md; `status` is the active text tab's sync state.
	let { project, status }: { project: Project; status?: string } = $props();

	const tabs = $derived(project.open.flatMap((id) => project.files.filter((f) => f.id === id)));
</script>

<div class="strip">
	<div class="tabs" role="tablist" aria-label="Open files">
		{#each tabs as f (f.id)}
			{@const active = f.id === project.active}
			<div class="tab" class:active role="presentation">
				<button
					type="button"
					role="tab"
					class="name"
					aria-selected={active}
					onclick={() => project.openFile(f.id)}
					onauxclick={(e) => e.button === 1 && project.closeFile(f.id)}
					onmousedown={(e) => e.button === 1 && e.preventDefault()}
				>
					<FileIcon type={fileType(f)} />
					{f.name}
				</button>
				<button type="button" class="close" aria-label="Close {f.name}" title="Close" onclick={() => project.closeFile(f.id)}>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
				</button>
			</div>
		{/each}
	</div>
	{#if status}
		<span class="badge" class:offline={status === 'Offline'} role="status">{status}</span>
	{/if}
</div>

<style>
	.strip {
		display: flex;
		align-items: stretch;
		height: 34px;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}
	.tabs {
		display: flex;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: thin;
	}
	.tab {
		display: flex;
		flex: none;
		align-items: center;
		border-top: 2px solid transparent;
		border-right: 1px solid var(--border);
		color: var(--text-muted);
	}
	.tab.active {
		background: var(--panel);
		border-top-color: var(--accent-bright);
		color: var(--text);
	}
	button {
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 100%;
		padding: 0 4px 0 12px;
		white-space: nowrap;
	}
	.close {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		margin-right: 6px;
		padding: 0;
		border-radius: 4px;
	}
	.close:hover {
		background: rgb(255 255 255 / 0.1);
	}
	button:focus-visible {
		outline-offset: -2px;
	}
	.close svg {
		width: 10px;
		height: 10px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
	}
	.badge {
		flex: none;
		align-self: center;
		margin: 0 10px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.badge.offline {
		color: #f0b35a;
	}
</style>
