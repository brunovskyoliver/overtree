<script lang="ts">
	// Name a version or rename its label (US5, contracts/ui.md "History view"). `save` returns null when done, else
	// the message to show; the dialog stays open until it succeeds or is cancelled. Escape cancels.
	type Options = { title: string; value?: string; confirmLabel: string; save: (name: string) => Promise<string | null> };
	const uid = $props.id();
	const MAX = 100;

	let dialog: HTMLDialogElement;
	let input = $state<HTMLInputElement>();
	let opts = $state<Options>({ title: '', confirmLabel: '', save: async () => null });
	let name = $state('');
	let error = $state('');
	let saving = $state(false);
	let resolve: ((saved: boolean) => void) | undefined;

	const valid = $derived(name.trim().length > 0 && name.trim().length <= MAX);

	export function ask(options: Options): Promise<boolean> {
		opts = options;
		name = options.value ?? '';
		error = '';
		dialog.showModal();
		input?.select();
		return new Promise((r) => (resolve = r));
	}

	async function onsubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!valid || saving) return;
		saving = true;
		const message = await opts.save(name.trim());
		saving = false;
		if (message) {
			error = message;
			return;
		}
		resolve?.(true);
		resolve = undefined;
		dialog.close();
	}

	function onclose() {
		resolve?.(false);
		resolve = undefined;
	}
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="{uid}-title">
	<form {onsubmit}>
		<h2 id="{uid}-title">{opts.title}</h2>
		<label for="{uid}-name">Label</label>
		<input
			id="{uid}-name"
			type="text"
			maxlength={MAX}
			autocomplete="off"
			aria-invalid={!!error}
			bind:value={name}
			bind:this={input}
			oninput={() => (error = '')}
		/>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button type="button" onclick={() => dialog.close()}>Cancel</button>
			<button type="submit" class="primary" disabled={saving || !valid}>{opts.confirmLabel}</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		width: 360px;
		padding: 18px 20px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	form {
		display: flex;
		flex-direction: column;
	}
	h2 {
		margin: 0 0 12px;
		font-size: 15px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	label {
		margin-bottom: 6px;
		font-weight: 500;
	}
	input {
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	input[aria-invalid='true'] {
		border-color: #f28b82;
	}
	.error {
		margin: 8px 0 0;
		color: #f28b82;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 16px;
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
	button:hover:not(:disabled) {
		background: #3a4252;
	}
	button.primary {
		border-color: transparent;
		background: var(--accent);
		font-weight: 600;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
