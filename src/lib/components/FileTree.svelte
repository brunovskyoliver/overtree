<script lang="ts">
	import { tick } from 'svelte';
	import { fileType, validateName, type FileEntry } from '#lib/files.ts';
	import { Menu } from '#lib/menu.svelte.ts';
	import type { Project } from '#lib/project.svelte.ts';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import FileIcon from './FileIcon.svelte';

	// File tree per contracts/ui.md. `activeId` is the file shown in the editor; `onopen` opens a file in a tab.
	let { project, activeId, onopen }: { project: Project; activeId?: string | null; onopen?: (id: string) => void } = $props();

	type Editing = { id: string | null; kind: 'folder' | 'text'; parentId: string | null }; // id null = new entry

	const STORE = 'overtree:tree';
	const stored = () => {
		try {
			const ids = JSON.parse(localStorage.getItem(STORE) ?? '[]');
			return Array.isArray(ids) ? (ids as string[]) : [];
		} catch {
			return [];
		}
	};

	let expanded = $state<string[]>(stored());
	let selected = $state<string | null>(null);
	let editing = $state<Editing | null>(null);
	let draft = $state('');
	let serverError = $state<string | null>(null);
	let busy = false;
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let dragging = $state<string | null>(null);
	let dropTarget = $state<string | null | undefined>(); // null = root, undefined = no valid target
	let tree: HTMLUListElement;
	let confirm: ConfirmDialog;

	const m = new Menu();
	let menuFor = $state<FileEntry>();
	let menuAt = $state({ x: 0, y: 0 });

	const byId = (id: string | null | undefined) => project.files.find((f) => f.id === id);
	// nothing clicked yet: the editor's file counts as selected
	const sel = $derived(byId(selected) ?? byId(activeId));
	const tabStop = $derived(sel?.id ?? project.children(null)[0]?.id);

	const siblings = $derived(
		editing ? project.children(editing.parentId).flatMap((f) => (f.id === editing!.id ? [] : [f.name])) : []
	);
	const nameError = $derived(serverError ?? (editing && draft ? validateName(draft, siblings) : null));

	/** True if `id` is `ancestor` or lies inside it. */
	function within(id: string | null, ancestor: string) {
		for (let f = byId(id); f; f = byId(f.parentId)) if (f.id === ancestor) return true;
		return false;
	}

	const fileCount = (folderId: string) => project.files.filter((f) => f.kind !== 'folder' && f.id !== folderId && within(f.id, folderId)).length;

	function setExpanded(id: string, open: boolean) {
		expanded = open ? [...new Set([...expanded, id])] : expanded.filter((x) => x !== id);
		localStorage.setItem(STORE, JSON.stringify(expanded));
		// collapsing hides a selected descendant: the folder takes over selection and tab stop
		if (!open && sel && sel.id !== id && within(sel.id, id)) selected = id;
	}

	function focusRow(id: string) {
		selected = id;
		tick().then(() => tree.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
	}

	function flash(message: string) {
		notice = message;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = ''), 5000);
	}

	function activate(f: FileEntry) {
		selected = f.id;
		if (f.kind === 'folder') setExpanded(f.id, !expanded.includes(f.id));
		else onopen?.(f.id);
	}

	// --- inline name input -------------------------------------------------------------------------

	function startNew(kind: 'folder' | 'text', parentId = sel ? (sel.kind === 'folder' ? sel.id : sel.parentId) : null) {
		if (parentId) setExpanded(parentId, true);
		editing = { id: null, kind, parentId };
		draft = '';
		serverError = null;
	}

	function startRename(f: FileEntry) {
		editing = { id: f.id, kind: f.kind === 'folder' ? 'folder' : 'text', parentId: f.parentId };
		draft = f.name;
		serverError = null;
	}

	function cancel(refocus = true) {
		const id = editing?.id;
		editing = null;
		if (refocus && id) focusRow(id);
	}

	async function commit() {
		const e = editing;
		if (!e || busy) return;
		const name = draft;
		if (e.id && name === byId(e.id)?.name) return cancel();
		serverError = validateName(name, siblings);
		if (serverError) return;
		busy = true;
		serverError = e.id ? await project.rename(e.id, name) : await project.create(e.kind, name, e.parentId);
		busy = false;
		if (serverError) return;
		editing = null;
		const entry = e.id ? byId(e.id) : project.children(e.parentId).find((f) => f.name === name);
		if (!entry) return;
		if (!e.id && entry.kind === 'text') {
			selected = entry.id;
			onopen?.(entry.id);
		} else focusRow(entry.id);
	}

	function oninputkey(e: KeyboardEvent) {
		if (e.key === 'Enter') commit();
		else if (e.key === 'Escape') cancel();
		else return;
		e.preventDefault();
	}

	// blur commits; leaving an empty new-entry input just drops it
	const onblur = () => (editing && !editing.id && !draft ? cancel(false) : commit());

	function focusInput(input: HTMLInputElement) {
		input.focus();
		const dot = input.value.lastIndexOf('.');
		input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
	}

	// --- menu and delete ---------------------------------------------------------------------------

	function openMenu(f: FileEntry, x: number, y: number) {
		selected = f.id;
		menuFor = f;
		menuAt = { x, y };
		m.toggle = tree.querySelector<HTMLElement>(`[data-id="${f.id}"]`)!;
		m.show();
	}

	function menuAtRow(f: FileEntry) {
		const r = tree.querySelector(`[data-id="${f.id}"] > .row`)!.getBoundingClientRect();
		openMenu(f, r.left + 24, r.bottom);
	}

	function oncontextmenu(e: MouseEvent, f: FileEntry) {
		e.preventDefault();
		e.stopPropagation();
		// the ContextMenu key fires this without pointer coordinates
		if (e.clientX === 0 && e.clientY === 0) menuAtRow(f);
		else openMenu(f, e.clientX, e.clientY);
	}

	/** Runs a menu item: the menu closes first, `refocus` false when the action moves focus itself. */
	function item(action: () => void, refocus = false) {
		return () => {
			if (refocus) m.close();
			else m.open = false;
			action();
		};
	}

	async function remove(f: FileEntry) {
		const n = f.kind === 'folder' ? fileCount(f.id) : 0;
		const ok = await confirm.ask({
			title: `Delete "${f.name}"?`,
			body: f.kind === 'folder' ? `This folder contains ${n} ${n === 1 ? 'file' : 'files'}.` : undefined,
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return focusRow(f.id);
		const err = await project.remove(f.id);
		if (err) return flash(err);
		const next = f.parentId ?? project.children(null)[0]?.id;
		if (next) focusRow(next);
	}

	async function setMain(f: FileEntry) {
		const err = await project.setMain(f.id);
		if (err) flash(err);
	}

	// --- keyboard (contracts/ui.md) ----------------------------------------------------------------

	function onkeydown(e: KeyboardEvent) {
		const li = e.target as HTMLElement;
		if (li.getAttribute('role') !== 'treeitem') return; // the name input and buttons handle their own keys
		const f = byId(li.dataset.id)!;
		const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
		const i = items.indexOf(li);
		const open = expanded.includes(f.id);
		let to: number | undefined;
		switch (e.key) {
			case 'ArrowDown':
				to = i + 1;
				break;
			case 'ArrowUp':
				to = i - 1;
				break;
			case 'Home':
				to = 0;
				break;
			case 'End':
				to = items.length - 1;
				break;
			case 'ArrowRight':
				if (f.kind !== 'folder') break;
				if (!open) setExpanded(f.id, true);
				else if (project.children(f.id).length) to = i + 1;
				break;
			case 'ArrowLeft':
				if (f.kind === 'folder' && open) setExpanded(f.id, false);
				else if (f.parentId) focusRow(f.parentId);
				break;
			case 'Enter':
				activate(f);
				break;
			case 'F2':
				startRename(f);
				break;
			case 'Delete':
			case 'Backspace': // the Mac "delete" key
				remove(f);
				break;
			case 'F10':
				if (!e.shiftKey) return;
				menuAtRow(f);
				break;
			case 'ContextMenu':
				menuAtRow(f);
				break;
			default:
				return;
		}
		e.preventDefault();
		if (to !== undefined && items[to]) focusRow(items[to].dataset.id!);
	}

	// --- drag and drop -----------------------------------------------------------------------------

	/** Where a drop over `f` (null = empty area) would put the dragged entry; undefined when it can't go there. */
	function targetFor(f: FileEntry | null): string | null | undefined {
		const d = byId(dragging);
		const t = f === null ? null : f.kind === 'folder' ? f.id : f.parentId;
		if (!d || d.parentId === t || (t !== null && within(t, d.id))) return undefined;
		return t;
	}

	function ondragover(e: DragEvent, f: FileEntry | null) {
		e.stopPropagation();
		dropTarget = targetFor(f);
		if (dropTarget !== undefined) e.preventDefault();
	}

	async function ondrop(e: DragEvent) {
		e.preventDefault();
		const id = dragging;
		const target = dropTarget;
		dragging = null;
		dropTarget = undefined;
		if (!id || target === undefined) return;
		const err = await project.move(id, target);
		if (err) return flash(err);
		if (target) setExpanded(target, true);
		selected = id;
	}

	function ondragstart(e: DragEvent, f: FileEntry) {
		e.dataTransfer!.setData('application/x-overtree-id', f.id);
		e.dataTransfer!.effectAllowed = 'move';
		dragging = f.id;
	}

	const ondragend = () => {
		dragging = null;
		dropTarget = undefined;
	};
</script>

<svelte:window onpointerdown={m.onwindowpointerdown} />

{#snippet nameInput(label: string)}
	<input
		class="name-input"
		aria-label={label}
		aria-invalid={!!nameError}
		aria-describedby={nameError ? 'tree-name-error' : undefined}
		spellcheck="false"
		autocomplete="off"
		bind:value={draft}
		oninput={() => (serverError = null)}
		onkeydown={oninputkey}
		{onblur}
		{@attach focusInput}
	/>
{/snippet}

{#snippet errorLine()}
	{#if nameError}<p class="error" id="tree-name-error" role="alert">{nameError}</p>{/if}
{/snippet}

{#snippet rows(parentId: string | null, level: number)}
	{#if editing && editing.id === null && editing.parentId === parentId}
		<li role="none">
			<div class="row" style:--level={level}>
				<span class="chevron-slot"></span>
				<FileIcon type={editing.kind} />
				{@render nameInput(editing.kind === 'folder' ? 'New folder name' : 'New file name')}
			</div>
			{@render errorLine()}
		</li>
	{/if}
	{#each project.children(parentId) as f (f.id)}
		{@const folder = f.kind === 'folder'}
		{@const open = folder && expanded.includes(f.id)}
		{@const main = f.id === project.mainFileId}
		{@const renaming = editing?.id === f.id}
		<li
			role="treeitem"
			data-id={f.id}
			aria-level={level}
			aria-expanded={folder ? open : undefined}
			aria-selected={f.id === sel?.id}
			aria-label={main ? `${f.name}, main document` : f.name}
			tabindex={f.id === tabStop ? 0 : -1}
			oncontextmenu={(e) => oncontextmenu(e, f)}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (keys are on the tree) -->
			<div
				class="row"
				class:active={f.id === activeId}
				class:drop={dropTarget === f.id}
				style:--level={level}
				draggable={!renaming}
				ondragstart={(e) => ondragstart(e, f)}
				{ondragend}
				ondragover={(e) => ondragover(e, f)}
				onclick={(e) => !(e.target as HTMLElement).closest('input, button') && activate(f)}
			>
				{#if folder}
					<svg class="chevron" class:open viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
				{:else}
					<span class="chevron-slot"></span>
				{/if}
				<FileIcon type={fileType(f)} />
				{#if renaming}
					{@render nameInput(`New name for ${f.name}`)}
				{:else}
					<span class="name">{f.name}</span>
				{/if}
				{#if main}<span class="main" aria-hidden="true">main</span>{/if}
				<button
					type="button"
					class="kebab"
					tabindex="-1"
					aria-label="Actions for {f.name}"
					aria-haspopup="menu"
					aria-expanded={m.open && menuFor?.id === f.id}
					onclick={(e) => {
						const r = e.currentTarget.getBoundingClientRect();
						openMenu(f, r.left, r.bottom + 2);
					}}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
				</button>
			</div>
			{#if renaming}{@render errorLine()}{/if}
			{#if open}
				<ul role="group">{@render rows(f.id, level + 1)}</ul>
			{/if}
		</li>
	{/each}
{/snippet}

<section class="tree-panel" aria-labelledby="file-tree-title">
	<div class="header">
		<h2 class="pane-header" id="file-tree-title">File tree</h2>
		<button type="button" class="tool" aria-label="New file" title="New file" onclick={() => startNew('text')}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7zM14 3v4h4M12 11v6M9 14h6" /></svg>
		</button>
		<button type="button" class="tool" aria-label="New folder" title="New folder" onclick={() => startNew('folder')}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h6l2 2h10v11H3zM12 11v6M9 14h6" /></svg>
		</button>
	</div>
	{#if notice}<p class="error notice" role="alert">{notice}</p>{/if}
	<ul
		role="tree"
		aria-labelledby="file-tree-title"
		class:drop={dropTarget === null}
		bind:this={tree}
		{onkeydown}
		ondragover={(e) => ondragover(e, null)}
		ondragleave={(e) => !tree.contains(e.relatedTarget as Node) && (dropTarget = undefined)}
		{ondrop}
	>
		{@render rows(null, 1)}
	</ul>
</section>

{#if m.open && menuFor}
	{@const f = menuFor}
	<div
		class="menu"
		role="menu"
		aria-label="Actions for {f.name}"
		tabindex="-1"
		style:left="{menuAt.x}px"
		style:top="{menuAt.y}px"
		bind:this={m.menu}
		{@attach (el) => {
			m.root = el;
		}}
		onkeydown={m.onmenukey}
	>
		{#if f.kind === 'folder'}
			<button type="button" role="menuitem" tabindex="-1" onclick={item(() => startNew('text', f.id))}>New file here</button>
			<button type="button" role="menuitem" tabindex="-1" onclick={item(() => startNew('folder', f.id))}>New folder here</button>
		{/if}
		<button type="button" role="menuitem" tabindex="-1" onclick={item(() => startRename(f))}>Rename</button>
		{#if f.kind !== 'folder'}
			<a role="menuitem" tabindex="-1" href="/api/files/{f.id}/raw?download=1" download={f.name}
				onclick={() => setTimeout(m.close)}>Download</a
			>
		{/if}
		{#if f.kind === 'text' && f.name.toLowerCase().endsWith('.tex')}
			{#if f.id === project.mainFileId}
				<!-- aria-disabled, not disabled: stays reachable with the arrow keys (ARIA menu pattern) -->
				<button type="button" role="menuitem" tabindex="-1" aria-disabled="true">Set as main document (current)</button>
			{:else}
				<button type="button" role="menuitem" tabindex="-1" onclick={item(() => setMain(f), true)}>Set as main document</button>
			{/if}
		{/if}
		<button type="button" role="menuitem" tabindex="-1" class="danger" onclick={item(() => remove(f))}>Delete</button>
	</div>
{/if}

<ConfirmDialog bind:this={confirm} />

<style>
	.tree-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: auto;
	}
	.header {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 8px;
	}
	.header h2 {
		flex: 1;
	}
	.tool {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.tool:hover {
		background: var(--panel-raised);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	[role='tree'] {
		flex: 1;
		padding: 0 6px 12px;
		border-radius: 4px;
	}
	[role='tree'].drop {
		outline: 2px dashed var(--accent-bright);
		outline-offset: -3px;
	}
	/* the ring goes on the row: on the item it would wrap an open folder's children */
	li[role='treeitem']:focus-visible {
		outline: none;
	}
	li[role='treeitem']:focus-visible > .row {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 4px 0 calc(4px + (var(--level) - 1) * 16px);
		border-radius: 4px;
		font-weight: 500;
		cursor: default;
		user-select: none;
	}
	.row:hover,
	[aria-selected='true'] > .row {
		background: var(--panel-raised);
	}
	.row.active {
		background: var(--accent);
	}
	.row.drop {
		outline: 2px dashed var(--accent-bright);
		outline-offset: -2px;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.main {
		padding: 0 5px;
		border-radius: 8px;
		background: rgb(0 0 0 / 0.25);
		color: var(--text-muted);
		font-size: 11px;
		line-height: 16px;
	}
	.name-input {
		flex: 1;
		min-width: 0;
		height: 24px;
		padding: 0 6px;
		border: 1px solid var(--focus);
		border-radius: 3px;
		background: var(--bg-editor);
		color: var(--text);
		font: inherit;
	}
	.name-input[aria-invalid='true'] {
		border-color: #e05252;
	}
	.error {
		margin: 2px 4px 4px;
		padding: 4px 8px;
		border-radius: 4px;
		background: rgb(224 82 82 / 0.15);
		color: #f08a8a;
		font-size: 12px;
	}
	.notice {
		margin: 0 8px 6px;
	}
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
	.chevron,
	.chevron-slot {
		flex: none;
		width: 12px;
		height: 12px;
	}
	.chevron {
		transition: transform 0.1s;
	}
	.chevron.open {
		transform: rotate(90deg);
	}
	.kebab {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin-left: auto;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--text);
		opacity: 0;
		cursor: pointer;
	}
	.kebab svg {
		fill: currentColor;
		stroke: none;
	}
	.kebab:hover {
		background: rgb(255 255 255 / 0.1);
	}
	.row:hover .kebab,
	[aria-selected='true'] > .row .kebab,
	li:focus-visible > .row .kebab,
	.kebab[aria-expanded='true'] {
		opacity: 1;
	}
	.menu {
		position: fixed;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 190px;
		padding: 4px 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
	}
	.menu [role='menuitem'] {
		padding: 5px 14px;
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.menu [role='menuitem']:hover,
	.menu [role='menuitem']:focus-visible {
		background: var(--panel-raised);
		outline: none;
	}
	.menu .danger {
		color: #f08a8a;
	}
	.menu [aria-disabled='true'] {
		color: var(--text-muted);
		cursor: default;
	}
</style>
