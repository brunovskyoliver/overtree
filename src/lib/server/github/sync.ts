// Sync scheduling (012 research R5, R12). PHASE 3 STUB: `requestSync` only records the request and answers `noop`;
// Phase 4 (T026) replaces this file with the per-project queue (one running run, one collapsed follow-up, push wins
// over pull), presence-driven session-end and long-session pushes, periodic pulls, retries and `startSync`.
// Note for Phase 4/5: confirming a link (`confirmLink(pid, 'merge')`) sets `base_commit` to GitHub's head but keeps
// GitHub-only files out of the base map, then requests a `pull` and a `push` with trigger `link`. That first pull
// must diff the head tree against the base map even though head equals `base_commit`, or those files never arrive.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

export type SyncKind = 'push' | 'pull';
export type SyncTrigger = 'session-end' | 'long-session' | 'open' | 'periodic' | 'manual' | 'startup' | 'retry' | 'link';
export type SyncRequest = {
	kind: SyncKind;
	trigger: SyncTrigger;
	title?: string;
	userId?: string;
};
export type SyncResult = {
	result: 'pushed' | 'pulled' | 'noop' | 'failed';
	commit?: string;
	error?: string;
};

// shared by server.ts' copy and the bundled routes' copy (see history.ts)
const shared = (globalThis.__overtreeGitHub ??= {
	refreshing: new Map(),
	sync: new Map()
});
const requests = shared.sync as Map<string, SyncRequest[]>;

/** Asks for a sync run of project `pid`. Stub: remembers the request (the last few per project, for tests) and
 *  resolves `noop` right away. */
export async function requestSync(pid: string, req: SyncRequest): Promise<SyncResult> {
	const list = requests.get(pid) ?? [];
	list.push(req);
	requests.set(pid, list.slice(-10));
	return { result: 'noop' };
}

/** The requests recorded for `pid` (stub inspection for tests; Phase 4 drops it). */
export const requestedSyncs = (pid: string): SyncRequest[] => requests.get(pid) ?? [];

/** Whether a run is in progress for `pid` (the `syncing` display state). Stub: never. */
export const isSyncing = (_pid: string): boolean => false;
