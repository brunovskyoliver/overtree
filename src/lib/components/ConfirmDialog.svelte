<script lang="ts">
	// One modal for every confirmation (contracts/ui.md, Dialogs). Escape and Cancel both resolve false.
	type Options = { title: string; body?: string; confirmLabel: string; danger?: boolean };
	const uid = $props.id(); // several dialogs on one page (tree, Share dialog): ids must differ

	let dialog: HTMLDialogElement;
	let cancel: HTMLButtonElement;
	let opts = $state<Options>({ title: '', confirmLabel: '' });
	let resolve: ((ok: boolean) => void) | undefined;

	export function ask(options: Options): Promise<boolean> {
		opts = options;
		dialog.returnValue = '';
		dialog.showModal();
		cancel.focus();
		return new Promise((r) => (resolve = r));
	}

	function onclose() {
		resolve?.(dialog.returnValue === 'confirm');
		resolve = undefined;
	}
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="{uid}-title" aria-describedby={opts.body ? `${uid}-body` : undefined}>
	<form method="dialog">
		<h2 id="{uid}-title">{opts.title}</h2>
		{#if opts.body}<p id="{uid}-body">{opts.body}</p>{/if}
		<div class="buttons">
			<button value="cancel" bind:this={cancel}>Cancel</button>
			<button value="confirm" class:danger={opts.danger}>{opts.confirmLabel}</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		min-width: 320px;
		max-width: 440px;
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
	h2 {
		margin: 0 0 8px;
		font-size: 15px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	p {
		margin: 0 0 8px;
		color: var(--text-muted);
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
	button:hover {
		background: #3a4252;
	}
	button[value='confirm'] {
		border-color: transparent;
		background: var(--accent);
		font-weight: 600;
	}
	button.danger {
		background: #b23b3b;
	}
	button.danger:hover {
		background: #c64646;
	}
</style>
