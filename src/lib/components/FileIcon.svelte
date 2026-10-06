<script lang="ts">
	import type { FileType } from '#lib/files.ts';

	let { type }: { type: FileType } = $props();
</script>

<svg viewBox="0 0 24 24" aria-hidden="true">
	{#if type === 'folder'}
		<path d="M3 6h6l2 2h10v11H3z" />
	{:else if type === 'image'}
		<path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4" /><circle cx="15.5" cy="9" r="1.5" />
	{:else}
		<path d="M14 3H6v18h12V7zM14 3v4h4" />
		{#if type === 'text'}<path d="M9 12h6M9 16h6" />{:else if type === 'pdf'}<path d="M8 13h8v5H8z" />{/if}
	{/if}
</svg>

<style>
	svg {
		flex: none;
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
