<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<!-- the editor page holds per-project state: navigating to another project remounts it -->
{#key page.params.id}
	{@render children()}
{/key}
