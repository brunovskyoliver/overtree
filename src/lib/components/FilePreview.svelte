<script lang="ts">
	import { fileType, type FileEntry } from '#lib/files.ts';
	import PdfToolbar from './PdfToolbar.svelte';
	import PdfViewer from './PdfViewer.svelte';

	// Preview of a binary file per contracts/ui.md and research R14.
	let { file }: { file: FileEntry } = $props();

	// updatedAt busts the cache: a replaced upload keeps the id (T034)
	const url = $derived(`/api/files/${file.id}/raw?v=${file.updatedAt}`);
	const type = $derived(fileType(file));

	let viewer = $state<ReturnType<typeof PdfViewer>>();
	let page = $state(0);
	let pages = $state(0);
	let scale = $state('page-width');
	let percent = $state(100);
	let dark = $state(false);
</script>

<section class="preview" aria-label="Preview of {file.name}">
	<div class="bar">
		<span class="name">{file.name}</span>
		{#if type === 'pdf'}<PdfToolbar {viewer} {page} {pages} {scale} {percent} bind:dark />{/if}
		<a class="download" href="{url}&download" download={file.name}>Download</a>
	</div>
	{#if type === 'image'}
		<div class="image"><img src={url} alt={file.name} /></div>
	{:else if type === 'pdf'}
		<div class="pdf"><PdfViewer {url} {dark} bind:this={viewer} bind:page bind:pages bind:scale bind:percent /></div>
	{:else}
		<p class="none">No preview for this file type.</p>
	{/if}
</section>

<style>
	.preview {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 10px 0 14px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.download {
		padding: 3px 10px;
		border-radius: 4px;
		background: var(--accent);
		color: var(--text);
		text-decoration: none;
	}
	.download:hover {
		background: var(--accent-bright);
	}
	.image {
		display: grid;
		flex: 1;
		min-height: 0;
		place-items: center;
		padding: 16px;
	}
	img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.pdf {
		display: flex;
		flex: 1;
		min-height: 0;
		background: var(--pdf);
	}
	.none {
		margin: auto;
		color: var(--text-muted);
	}
</style>
