<script lang="ts">
	import { tick } from 'svelte';
	import type { History } from '#lib/history.svelte.ts';
	import type { VersionInfo } from '#lib/history-types.ts';
	import Avatar from './Avatar.svelte';

	// contracts/ui.md "Timeline": versions newest first in day groups, listbox keyboard (↑/↓ select, Enter opens the
	// diff), the next page when the end scrolls into view. `onopen`: Enter moves focus to the diff.
	let { history, onopen }: { history: History; onopen?: () => void } = $props();
	const SHOWN_FILES = 3;
	const MAX_AVATARS = 4;

	let list = $state<HTMLElement>();
	let end = $state<HTMLElement>();

	const dayKey = (ts: number) => new Date(ts).toDateString();
	function dayName(ts: number) {
		const d = new Date(ts);
		const today = new Date();
		const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
		if (d.toDateString() === today.toDateString()) return 'Today';
		if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
		return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
	}
	const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	const dateTime = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);

	const days = $derived.by(() => {
		const out: { key: string; name: string; versions: VersionInfo[] }[] = [];
		for (const v of history.versions) {
			const key = dayKey(v.createdAt);
			if (out.at(-1)?.key !== key) out.push({ key, name: dayName(v.createdAt), versions: [] });
			out.at(-1)!.versions.push(v);
		}
		return out;
	});

	const optionId = (id: number) => `version-${id}`;

	async function onkeydown(e: KeyboardEvent) {
		const ids = history.versions.map((v) => v.id);
		if (!ids.length) return;
		const i = history.selected === null ? -1 : ids.indexOf(history.selected);
		const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: ids.length - 1 }[e.key];
		if (to !== undefined) {
			e.preventDefault();
			const next = ids[Math.max(0, Math.min(ids.length - 1, to))];
			history.select(next);
			await tick();
			list?.querySelector(`#${optionId(next)}`)?.scrollIntoView({ block: 'nearest' });
			if (e.key === 'ArrowDown' && to >= ids.length - 1) history.more();
		} else if (e.key === 'Enter' && history.selected !== null) {
			e.preventDefault();
			onopen?.();
		}
	}

	// the next page once the end of the list is in view
	$effect(() => {
		if (!end || !list) return;
		const io = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && history.more(), { root: list.parentElement });
		io.observe(end);
		return () => io.disconnect();
	});

	function summary(v: VersionInfo) {
		const names = v.changed.map((c) => base(c.path));
		return { shown: names.slice(0, SHOWN_FILES), more: Math.max(0, names.length - SHOWN_FILES) };
	}
</script>

<section class="timeline" aria-labelledby="history-versions-title">
	<header>
		<h2 id="history-versions-title">Versions</h2>
		<label class="filter">
			<input type="checkbox" checked={history.labelsOnly} onchange={(e) => history.setLabelsOnly(e.currentTarget.checked)} />
			Labels only
		</label>
	</header>
	<div class="scroll">
		{#if history.error}
			<p class="note error" role="alert">{history.error}</p>
		{/if}
		<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
		<ol
			class="versions"
			role="listbox"
			aria-label="Versions"
			tabindex="0"
			aria-activedescendant={history.selected !== null ? optionId(history.selected) : undefined}
			bind:this={list}
			{onkeydown}
		>
			{#each days as day (day.key)}
				<li role="group" aria-labelledby="day-{day.key.replaceAll(' ', '-')}">
					<div class="day" id="day-{day.key.replaceAll(' ', '-')}">{day.name}</div>
					<ol role="none">
						{#each day.versions as v (v.id)}
							{@const files = summary(v)}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<li
								role="option"
								id={optionId(v.id)}
								class="version"
								aria-selected={history.selected === v.id}
								onclick={() => (history.select(v.id), list?.focus())}
							>
								<div class="line">
									<time datetime={new Date(v.createdAt).toISOString()} title={dateTime(v.createdAt)}>{time(v.createdAt)}</time>
									{#if v.kind === 'compile'}
										<svg class="icon" viewBox="0 0 16 16" width="13" height="13" role="img" aria-label="Compiled"
											><title>Compiled</title><path d="M4 2.5v11l9-5.5z" /></svg
										>
									{/if}
									<span class="authors">
										{#each v.authors.slice(0, MAX_AVATARS) as a (a.id)}
											<span class="author" title={a.name}><Avatar name={a.name} avatarUrl={a.avatarUrl} color={a.color} size={20} /></span>
										{/each}
										{#if v.authors.length > MAX_AVATARS}<span class="more-authors">+{v.authors.length - MAX_AVATARS}</span>{/if}
										<span class="sr">{v.authors.length ? `By ${v.authors.map((a) => a.name).join(', ')}` : ''}</span>
									</span>
								</div>
								{#if v.kind === 'baseline' && !v.authors.length}
									<div class="detail">Start of history</div>
								{/if}
								{#if v.restoredFrom}
									<div class="detail restore">Restored from {dateTime(v.restoredFrom.createdAt)}</div>
								{/if}
								{#if files.shown.length}
									<div class="detail files">
										{files.shown.join(', ')}{#if files.more}<span class="muted"> and {files.more} more</span>{/if}
									</div>
								{/if}
								{#if v.labels.length}
									<div class="labels">
										{#each v.labels as l (l.id)}
											<span class="chip" title="{l.name} · {l.user.name}">{l.name}</span>
										{/each}
									</div>
								{/if}
							</li>
						{/each}
					</ol>
				</li>
			{/each}
		</ol>
		{#if !history.loading && !history.error && !history.versions.length}
			<p class="note">{history.labelsOnly ? 'No labeled versions.' : 'No versions yet.'}</p>
		{/if}
		{#if history.loading}
			<p class="note" role="status">Loading…</p>
		{/if}
		<div class="end" bind:this={end}></div>
	</div>
</section>

<style>
	.timeline {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--panel);
		border-left: 1px solid var(--border);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 38px;
		padding: 0 12px;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	.filter {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-size: 12px;
		cursor: pointer;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.versions:focus-visible {
		outline-offset: -2px;
	}
	.day {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 8px 12px 4px;
		background: var(--panel);
		color: var(--text-muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.version {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin: 0 6px;
		padding: 7px 8px;
		border-left: 3px solid transparent;
		border-radius: 4px;
		cursor: pointer;
	}
	.version:hover {
		background: var(--panel-raised);
	}
	.version[aria-selected='true'] {
		border-left-color: var(--accent-bright);
		background: var(--panel-raised);
	}
	.versions:focus-visible .version[aria-selected='true'] {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 22px;
	}
	time {
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}
	.icon {
		flex: none;
		fill: var(--accent-bright);
	}
	.authors {
		display: flex;
		align-items: center;
		margin-left: auto;
	}
	.author {
		display: inline-flex;
		margin-left: -4px;
		border: 2px solid var(--panel);
		border-radius: 50%;
	}
	.version:hover .author,
	.version[aria-selected='true'] .author {
		border-color: var(--panel-raised);
	}
	.more-authors {
		margin-left: 4px;
		color: var(--text-muted);
		font-size: 11px;
	}
	.detail {
		overflow: hidden;
		color: var(--text-muted);
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.files {
		color: var(--text);
	}
	.muted {
		color: var(--text-muted);
	}
	.restore {
		color: #fbbc04;
	}
	.labels {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		max-width: 100%;
		padding: 1px 8px;
		overflow: hidden;
		border-radius: 10px;
		background: #2a3b55;
		color: #8ab4f8;
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.note {
		margin: 12px;
		color: var(--text-muted);
		font-size: 13px;
	}
	.error {
		color: #f28b82;
	}
	.end {
		height: 1px;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
