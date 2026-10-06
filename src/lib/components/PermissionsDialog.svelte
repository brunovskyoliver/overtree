<script lang="ts">
	import type { FileEntry } from '#lib/files.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import Avatar from './Avatar.svelte';

	// contracts/ui.md "Permissions…": the owner sets each named collaborator's role on one file or folder (US6).
	// Every change goes to the server at once; link-only users get the link role everywhere, so they aren't listed.
	let { project }: { project: Project } = $props();

	type Choice = '' | 'editor' | 'reader'; // '' = no override

	let dialog: HTMLDialogElement;
	let file = $state<FileEntry | null>(null);
	let error = $state('');
	let busy = $state(false);

	const people = $derived(project.members?.members.filter((m) => m.via === 'invite') ?? []);
	const path = $derived(file ? project.path(file.id) : '');
	const label = (r: string) => (r === 'editor' ? 'Editor' : 'Reader');
	const current = (userId: string): Choice =>
		project.members?.overrides.find((o) => o.userId === userId && o.fileId === file?.id)?.role ?? '';

	export function open(f: FileEntry) {
		file = f;
		error = '';
		dialog.showModal();
		project.loadMembers();
	}

	async function set(userId: string, choice: Choice) {
		busy = true;
		error = (await project.setOverride(userId, file!.id, choice || null)) ?? '';
		busy = false;
	}
</script>

<dialog bind:this={dialog} aria-labelledby="permissions-title">
	<div class="head">
		<h2 id="permissions-title">Permissions for {path}</h2>
		<form method="dialog"><button class="close" aria-label="Close">×</button></form>
	</div>
	<p class="hint">Applies to {file?.kind === 'folder' ? 'this folder and everything inside it' : 'this file'}. The most specific rule wins.</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<ul>
		{#each people as { user: u, role } (u.id)}
			<li>
				<Avatar name={u.name} avatarUrl={u.avatarUrl} color={u.color} />
				<span class="who"><span>{u.name}</span><span class="email">{u.email}</span></span>
				<select
					aria-label="Permission for {u.email}"
					value={current(u.id)}
					disabled={busy}
					onchange={(e) => set(u.id, e.currentTarget.value as Choice)}
				>
					<option value="">Project role ({label(role)})</option>
					<option value="editor">Editor</option>
					<option value="reader">Reader</option>
				</select>
			</li>
		{/each}
	</ul>
</dialog>

<style>
	dialog {
		width: 460px;
		max-width: calc(100vw - 32px);
		padding: 16px 20px 20px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.close {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text-muted);
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
	}
	.hint,
	.email {
		color: var(--text-muted);
		font-size: 12px;
	}
	.hint {
		margin: 6px 0 10px;
	}
	.error {
		margin: 0 0 8px;
		color: #f28b82;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
	}
	.who {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}
	.who > span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	select {
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
</style>
