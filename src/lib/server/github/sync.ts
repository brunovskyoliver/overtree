import { and, eq, gt, inArray, isNotNull, lte } from 'drizzle-orm';
import { broadcast } from '../access.ts';
import { getServer } from '../collab.ts';
import type { Db } from '../db.ts';
import { flushHistory } from '../history.ts';
import { githubLinks, githubRuns, historyLog, versions, type GitHubRunTrigger } from '../schema.ts';
import { checkAccess, type Link } from './accounts.ts';
import { GitHubError } from './api.ts';
import { githubConfig } from './config.ts';
import { pull } from './pull.ts';
import { push } from './push.ts';

// Sync scheduling (012 research R5, R7, R12; FR-011, FR-016, FR-022–024): one run at a time per project with one
// collapsed follow-up (push wins over pull, a custom title is kept), presence-driven pulls on open and pushes at the
// end of a session (after a grace period), pushes during long sessions, periodic pulls, retries with backoff and a
// sweep at startup. "Unpushed" is derived from stored data, so nothing here needs to survive a restart.
// ponytail: one scheduler per process; several app replicas would each sync (upgrade: a lease row per link).
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

export type SyncKind = 'push' | 'pull';
export type SyncTrigger = GitHubRunTrigger;
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

type Pending = { req: SyncRequest; waiters: ((r: SyncResult) => void)[] };
type Queue = { next: Pending | null };
type Session = { count: number; endAt: number | null };

const CHECK_MS = 3600_000; // re-check the linker's access before a run when the last check is older (research R2)
const STARTUP_GAP_MS = 2000;
const MAX_BACKOFF_MIN = 60;

// shared by server.ts' copy and the bundled routes' copy (see history.ts): the queues serialize runs across both
const shared: NonNullable<typeof globalThis.__overtreeGitHub> = (globalThis.__overtreeGitHub ??= { refreshing: new Map(), sync: new Map() });
const queues = shared.sync as Map<string, Queue>; // a project with a run in progress has an entry
const sessions = (shared.sessions ??= new Map()) as Map<string, Session>; // projects open in some browser

const db = () => getServer().db;
const changed = (pid: string) => broadcast(pid, { type: 'github' });
const getLink = (pid: string): Link | null => db().select().from(githubLinks).where(eq(githubLinks.projectId, pid)).get() ?? null;
const setLink = (pid: string, set: Partial<Link>) =>
	db()
		.update(githubLinks)
		.set({ ...set, updatedAt: Date.now() })
		.where(eq(githubLinks.projectId, pid))
		.run();
const syncable = (link: Link | null): link is Link => !!link && (link.status === 'active' || link.status === 'failing');
const serverOpen = () => !!globalThis.__overtreeServer?.db.$client.open;

/** Edits by people (not pulls, which log as the system) since GitHub last got the project, or a pull result that
 *  differs from GitHub's head (research R7, data-model "Derived values"). */
export function hasUnpushed(link: Pick<Link, 'projectId' | 'watermark' | 'pendingPush'>): boolean {
	if (link.pendingPush) return true;
	flushHistory();
	return !!db()
		.select({ id: historyLog.id })
		.from(historyLog)
		.where(and(eq(historyLog.projectId, link.projectId), gt(historyLog.id, link.watermark), isNotNull(historyLog.userId)))
		.limit(1)
		.get();
}

/** Whether a run is in progress for `pid` (the `syncing` display state). */
export const isSyncing = (pid: string): boolean => queues.has(pid);

/** One request covering both: push wins over pull (a push pulls first); the latest custom title and requester are
 *  kept (FR-022). */
function merge(a: SyncRequest, b: SyncRequest): SyncRequest {
	const kind = a.kind === 'push' || b.kind === 'push' ? 'push' : 'pull';
	const trigger = kind === 'push' && b.kind !== 'push' ? a.trigger : b.trigger;
	return { kind, trigger, title: b.title ?? a.title, userId: b.userId ?? a.userId };
}

/** Asks for a sync run of project `pid`; resolves with the result of the run that covered the request. With a run in
 *  progress the request joins the one collapsed follow-up run. */
export function requestSync(pid: string, req: SyncRequest): Promise<SyncResult> {
	return new Promise((resolve) => {
		const queue = queues.get(pid);
		if (queue) {
			if (queue.next) {
				queue.next.req = merge(queue.next.req, req);
				queue.next.waiters.push(resolve);
			} else queue.next = { req, waiters: [resolve] };
			return;
		}
		const q: Queue = { next: null };
		queues.set(pid, q);
		void drain(pid, q, { req, waiters: [resolve] });
	});
}

async function drain(pid: string, q: Queue, first: Pending) {
	let cur: Pending | null = first;
	try {
		while (cur) {
			const result = await run(pid, cur.req);
			for (const w of cur.waiters) w(result);
			cur = q.next;
			q.next = null;
		}
	} catch (e) {
		console.error('GitHub sync failed', e);
		for (const p of [cur, q.next]) for (const w of p?.waiters ?? []) w({ result: 'failed', error: 'The sync stopped.' });
	} finally {
		queues.delete(pid);
		if (serverOpen()) changed(pid); // no longer `syncing`
	}
}

const backoffMin = (failCount: number) => Math.min(MAX_BACKOFF_MIN, 2 ** (failCount - 1));

/** The run log row (US4); noop periodic pulls are not stored (data-model github_runs). */
function record(pid: string, req: SyncRequest, startedAt: number, r: SyncResult) {
	if (req.kind === 'pull' && r.result === 'noop' && req.trigger === 'periodic') return;
	db()
		.insert(githubRuns)
		.values({
			projectId: pid,
			kind: req.kind,
			trigger: req.trigger,
			userId: req.userId ?? null,
			result: r.result,
			commit: r.commit ?? null,
			error: r.error ?? null,
			startedAt,
			finishedAt: Date.now()
		})
		.run();
}

const ACCESS_MESSAGES = {
	'needs-access': 'GitHub refused access to the linked repository: it may have been removed, or the App or the person who linked it lost access.',
	'needs-reconnect': 'The GitHub connection of the person who linked this project stopped working. They need to reconnect GitHub.'
};

/** One run: the access check when due, then the push or pull; the outcome moves the link's status (research R12):
 *  success → `active`; `retry`/`conflict` → `failing` with backoff 1, 2, 4 … 60 min; `needs-*` → that status, no
 *  automatic retry. Links that aren't `active`/`failing` are left alone (`noop`). */
async function run(pid: string, req: SyncRequest): Promise<SyncResult> {
	if (!githubConfig() || !serverOpen()) return { result: 'noop' };
	let link = getLink(pid);
	if (!syncable(link)) return { result: 'noop' };
	const startedAt = Date.now();
	changed(pid); // `syncing`
	let result: SyncResult;
	try {
		if (!link.lastCheckAt || startedAt - link.lastCheckAt >= CHECK_MS) {
			const access = await checkAccess(link);
			if (access !== 'ok') throw new GitHubError(access === 'needs-access' ? 403 : 401, access, ACCESS_MESSAGES[access]);
			link = getLink(pid);
			if (!syncable(link)) return { result: 'noop' };
		}
		result = req.kind === 'push' ? await push(pid, { title: req.title, trigger: req.trigger, userId: req.userId }) : await pull(link);
		const after = getLink(pid);
		if (!after) return result; // unlinked meanwhile
		// an ownership transfer meanwhile (`owner-changed`) stays until the new owner takes the link over (FR-027)
		if (syncable(after)) setLink(pid, { status: 'active', failCount: 0, nextAttemptAt: null, error: null });
	} catch (e) {
		if (!serverOpen() || !getLink(pid)) return { result: 'failed', error: 'The sync stopped.' };
		// a pull found the branch history rewritten and set the link back to `pending` (T036), or the project changed
		// owner meanwhile: the link stays as it is
		const after = getLink(pid)!;
		if (after.status === 'pending' || after.status === 'owner-changed') {
			result = { result: 'failed', error: after.error ?? 'The link needs to be confirmed again.' };
			record(pid, req, startedAt, result);
			return result;
		}
		if (!(e instanceof GitHubError)) console.error('GitHub sync failed', e);
		const err = e instanceof GitHubError ? e : new GitHubError(0, 'retry', 'Overtree could not sync with GitHub; it retries.');
		if (err.reason === 'retry' || err.reason === 'conflict') {
			const failCount = (getLink(pid)?.failCount ?? 0) + 1;
			setLink(pid, { status: 'failing', failCount, nextAttemptAt: Date.now() + backoffMin(failCount) * 60_000, error: err.message });
		} else setLink(pid, { status: err.reason, nextAttemptAt: null, error: err.message });
		result = { result: 'failed', error: err.message };
	}
	record(pid, req, startedAt, result);
	return result;
}

// --- scheduling (research R5) --------------------------------------------------------------------------------------

/** Fire and forget: the run records its own outcome. */
const later = (pid: string, req: SyncRequest) => void requestSync(pid, req);

/** The number of people (editors and readers) with project `pid` open is now `count` (collab.ts, presence document).
 *  Opening (0 → 1) pulls; the last one leaving starts the grace period before the session-end push; coming back
 *  before it ends cancels it (US2 #1–2, US3 #2). */
export function presence(pid: string, count: number) {
	const c = githubConfig();
	if (!c || !serverOpen()) return;
	const prev = sessions.get(pid);
	if (count > 0) {
		sessions.set(pid, { count, endAt: null });
		if (!prev?.count && getLink(pid)?.status === 'active') later(pid, { kind: 'pull', trigger: 'open' });
		return;
	}
	if (prev?.count) sessions.set(pid, { count: 0, endAt: Date.now() + c.graceMs });
}

const versionSince = (pid: string, at: number) =>
	!!db()
		.select({ id: versions.id })
		.from(versions)
		.where(and(eq(versions.projectId, pid), gt(versions.createdAt, at)))
		.limit(1)
		.get();

/** One scheduler step: due session ends push (when something is unpushed); open projects push once a long session
 *  has unpushed changes and a closed version, else pull periodically; failing links retry when their time comes. */
export function tick(now = Date.now()) {
	const c = githubConfig();
	if (!c) return;
	const busy = (pid: string) => queues.has(pid);
	const handled = new Set<string>();
	const pids = [...sessions.keys()];
	const links = new Map(
		(pids.length ? db().select().from(githubLinks).where(inArray(githubLinks.projectId, pids)).all() : []).map((l) => [l.projectId, l])
	);
	for (const [pid, s] of sessions) {
		const link = links.get(pid);
		if (s.count === 0) {
			if (s.endAt === null || s.endAt > now) continue;
			sessions.delete(pid);
			if (link?.status === 'active' && hasUnpushed(link)) {
				later(pid, { kind: 'push', trigger: 'session-end' });
				handled.add(pid);
			}
			continue;
		}
		if (link?.status !== 'active' || busy(pid)) continue;
		const lastPush = link.lastPushAt ?? 0;
		if (now - lastPush >= c.longMs && hasUnpushed(link) && versionSince(pid, lastPush)) {
			later(pid, { kind: 'push', trigger: 'long-session' });
			handled.add(pid);
		} else if (now - (link.lastPullAt ?? 0) >= c.pullMs) {
			later(pid, { kind: 'pull', trigger: 'periodic' });
			handled.add(pid);
		}
	}
	const due = db()
		.select()
		.from(githubLinks)
		.where(and(eq(githubLinks.status, 'failing'), lte(githubLinks.nextAttemptAt, now)))
		.all();
	for (const link of due) {
		if (handled.has(link.projectId) || busy(link.projectId)) continue;
		// a push pulls first, so it covers both directions; without local changes a pull is enough
		later(link.projectId, { kind: hasUnpushed(link) ? 'push' : 'pull', trigger: 'retry' });
	}
}

let current: { db: Db; timers: Set<NodeJS.Timeout> } | null = null;

/** Stops the scheduler (a new server takes over). */
export function stopSync() {
	for (const t of current?.timers ?? []) clearTimeout(t);
	current = null;
	sessions.clear();
}

/** Starts the scheduler for the current server (attachCollab, when GitHub sync is configured): ticks every `tickMs`
 *  and, 2 s apart, pushes every active link with unpushed changes (the push pulls first) and pulls the others
 *  (FR-023). Stops itself when the server's db changes or closes, like history's sweeper. */
export function startSync() {
	stopSync();
	const c = githubConfig();
	if (!c) return;
	const me = { db: db(), timers: new Set<NodeJS.Timeout>() };
	current = me;
	const alive = () => current === me && globalThis.__overtreeServer?.db === me.db && me.db.$client.open;
	const stop = () => {
		for (const t of me.timers) clearTimeout(t);
		if (current === me) current = null;
	};
	const interval = setInterval(() => {
		if (!alive()) return stop();
		try {
			tick();
		} catch (e) {
			console.error('GitHub sync tick failed', e);
		}
	}, c.tickMs);
	interval.unref();
	me.timers.add(interval);

	const links = me.db.select().from(githubLinks).where(eq(githubLinks.status, 'active')).all();
	links.forEach((link, i) => {
		const t = setTimeout(() => {
			me.timers.delete(t);
			if (!alive()) return;
			try {
				const fresh = getLink(link.projectId);
				if (fresh?.status === 'active') later(link.projectId, { kind: hasUnpushed(fresh) ? 'push' : 'pull', trigger: 'startup' });
			} catch (e) {
				console.error('GitHub startup sync failed', e);
			}
		}, i * STARTUP_GAP_MS);
		t.unref();
		me.timers.add(t);
	});
}
