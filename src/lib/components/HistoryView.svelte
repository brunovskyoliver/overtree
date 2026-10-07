<script lang="ts">
	import type { History } from '#lib/history.svelte.ts';
	import HistoryDiff from './HistoryDiff.svelte';
	import HistoryTimeline from './HistoryTimeline.svelte';

	// contracts/ui.md "History view": changed files | diff | timeline over the editor and PDF (research R13). The
	// editor stays mounted underneath (its providers stay connected); Escape leaves history.
	let { history, canEdit }: { history: History; canEdit: boolean } = $props();
	let diff = $state<HistoryDiff>();
	let section = $state<HTMLElement>();

	$effect(() => {
		section?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		// a dialog of its own (later: restore, label) handles Escape first
		if ((e.target as HTMLElement).closest('dialog')) return;
		e.preventDefault();
		history.close();
	}
</script>

<svelte:window {onkeydown} />

<section class="history" aria-label="History" bind:this={section}>
	<HistoryDiff bind:this={diff} {history} {canEdit} />
	<HistoryTimeline {history} {canEdit} onopen={() => diff?.focus()} />
</section>

<style>
	.history {
		display: grid;
		grid-template-columns: minmax(160px, 220px) minmax(0, 1fr) 300px;
		height: 100%;
		min-height: 0;
	}
</style>
