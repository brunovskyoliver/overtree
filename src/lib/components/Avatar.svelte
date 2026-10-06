<script lang="ts">
	import { initials } from '#lib/presence.ts';

	// A user's picture, or their initials on their color (research R9). Decorative: the button around it is named.
	let { name, avatarUrl = null, color, size = 28 }: { name: string; avatarUrl?: string | null; color: string; size?: number } = $props();
	let failed = $state(false);
</script>

<span class="avatar" style:width="{size}px" style:height="{size}px" style:background={color} style:font-size="{Math.round(size * 0.42)}px" aria-hidden="true">
	{#if avatarUrl && !failed}
		<img src={avatarUrl} alt="" referrerpolicy="no-referrer" onerror={() => (failed = true)} />
	{:else}
		{initials(name)}
	{/if}
</span>

<style>
	.avatar {
		display: inline-grid;
		flex: none;
		place-items: center;
		overflow: hidden;
		border-radius: 50%;
		color: #1b1e26;
		font-weight: 600;
		line-height: 1;
		user-select: none;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
