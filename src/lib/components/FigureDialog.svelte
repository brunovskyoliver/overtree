<script lang="ts">
	import type { FigureSpec } from '#lib/editor/commands.ts';
	import { latexPath, pickImages, refusedMessage, uploadFigures } from '#lib/editor/figures.ts';
	import { trapTab } from '#lib/focus.ts';
	import { GRAPHIC_EXTENSIONS, isGraphicName, labelFor } from '#lib/media.ts';
	import type { Project } from '#lib/project.svelte.ts';

	// Insert figure (015): pick a project image or upload one, then caption, label and width. A modal <dialog>:
	// focus stays inside, Escape and Cancel close it. `oninsert` gets the figure to put at the caret.
	let { project, oninsert }: { project: Project; oninsert: (figure: FigureSpec) => void } = $props();
	const uid = $props.id();

	let dialog: HTMLDialogElement;
	let picker: HTMLInputElement;
	let imageId = $state('');
	let caption = $state('');
	let label = $state('');
	let labelEdited = false; // a label the user typed survives picking another image
	let width = $state(0.8);
	let uploading = $state(false);
	let error = $state('');

	const images = $derived(
		project.files
			.filter((f) => f.kind === 'binary' && isGraphicName(f.name))
			.map((f) => ({ id: f.id, path: latexPath(project, f.id) }))
			.sort((a, b) => a.path.localeCompare(b.path))
	);
	const chosen = $derived(images.find((i) => i.id === imageId));

	export function open() {
		imageId = images[0]?.id ?? '';
		caption = '';
		labelEdited = false;
		label = chosen ? labelFor(chosen.path.split('/').at(-1)!) : '';
		width = 0.8;
		error = '';
		dialog.showModal();
	}

	function choose(id: string) {
		imageId = id;
		if (!labelEdited && chosen) label = labelFor(chosen.path.split('/').at(-1)!);
	}

	async function upload() {
		const { images: files, refused } = pickImages([...(picker.files ?? [])], false);
		picker.value = '';
		error = refused.length ? refusedMessage(refused) : '';
		if (!files.length) return;
		uploading = true;
		const { figures, errors } = await uploadFigures(project, files);
		uploading = false;
		if (errors.length) error = errors.join(' ');
		const added = figures[0] && images.find((i) => i.path === figures[0].path);
		if (added) choose(added.id);
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!chosen) return;
		const w = Math.min(1, Math.max(0.05, Number(width) || 0.8));
		const figure = { path: chosen.path, label: label.trim() || labelFor(chosen.path), caption: caption.trim(), width: Math.round(w * 100) / 100 };
		dialog.close(); // first: closing gives focus back to the toolbar button, inserting moves it to the text
		oninsert(figure);
	}
</script>

<dialog bind:this={dialog} aria-labelledby="{uid}-title" onkeydown={trapTab}>
	<form onsubmit={submit}>
		<h2 id="{uid}-title">Insert figure</h2>
		<div class="field">
			<label for="{uid}-image">Image</label>
			<div class="pick">
				<select id="{uid}-image" value={imageId} onchange={(e) => choose(e.currentTarget.value)} disabled={!images.length}>
					{#each images as i (i.id)}<option value={i.id}>{i.path}</option>{:else}<option value="">No images in the project yet</option>{/each}
				</select>
				<button type="button" onclick={() => picker.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload…'}</button>
				<input
					type="file"
					hidden
					aria-label="Upload an image"
					accept={GRAPHIC_EXTENSIONS.map((x) => `.${x}`).join(',')}
					bind:this={picker}
					onchange={upload}
				/>
			</div>
		</div>
		<div class="field">
			<label for="{uid}-caption">Caption</label>
			<input id="{uid}-caption" type="text" bind:value={caption} placeholder="Optional" />
		</div>
		<div class="row">
			<div class="field">
				<label for="{uid}-label">Label</label>
				<div class="label">
					<span aria-hidden="true">fig:</span>
					<input id="{uid}-label" type="text" bind:value={label} oninput={() => (labelEdited = true)} spellcheck="false" />
				</div>
			</div>
			<div class="field">
				<label for="{uid}-width">Width (× line width)</label>
				<input id="{uid}-width" type="number" min="0.05" max="1" step="0.05" bind:value={width} />
			</div>
		</div>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button type="button" onclick={() => dialog.close()}>Cancel</button>
			<button type="submit" class="primary" disabled={!chosen}>Insert</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		width: min(440px, calc(100vw - 32px));
		padding: 18px 20px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-dialog);
	}
	dialog::backdrop {
		background: var(--backdrop);
	}
	h2 {
		margin: 0 0 12px;
		font-size: 15px;
		font-weight: 600;
	}
	.field {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 10px;
		font-size: 13px;
	}
	.field > label {
		color: var(--text-muted);
	}
	.row {
		display: flex;
		gap: 12px;
	}
	.pick,
	.label {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.label span {
		color: var(--text-muted);
		font-family: var(--font-mono);
	}
	select,
	input {
		flex: 1;
		min-width: 0;
		padding: 5px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	.error {
		margin: 0 0 8px;
		color: var(--text);
		font-size: 13px;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 8px;
	}
	button {
		padding: 5px 14px;
		border: 1px solid var(--border);
		border-radius: 13px;
		background: var(--panel-raised);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.primary {
		border-color: transparent;
		background: var(--accent);
		font-weight: 600;
	}
</style>
