import { and, asc, eq, gt, lte, max } from 'drizzle-orm';
import { getServer } from '../collab.ts';
import { putBlob } from '../files.ts';
import { flushHistory } from '../history.ts';
import { githubLinks, historyLog, users } from '../schema.ts';
import { branchHead, branchPath, repoPath, type Link } from './accounts.ts';
import { gh, GitHubError, installationToken } from './api.ts';
import { ignoreFilter, projectFiles, readBase, writeBase, type BaseMap } from './paths.ts';
import { pull } from './pull.ts';

// Overtree → GitHub (012 research R4, R9; FR-012–015): one commit per push on top of the branch head through the
// Git Data API, never forced. Paths outside the change set (GitHub-only files, "not pulled" paths such as the
// workflow's PDFs and `.github/`) are inherited from `base_tree` untouched (FR-013).
// An empty repository refuses every Git Data call (409 "Git Repository is empty."): there the first file goes in
// with one Contents API PUT, which creates the branch, and the rest follows as the normal commit on top.
// ponytail: the first push to an empty repository makes two commits.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;

const ATTEMPTS = 3; // fast-forward races: someone pushed between our head read and the ref update (FR-024)
const PULLS = 3; // pulls before a push while GitHub keeps moving
export const TITLE_MAX = 72;
const BODY_LINES = 20;
const MODE = '100644';

export type PushOptions = { title?: string; trigger: string; userId?: string };
export type PushResult = { result: 'pushed' | 'noop'; commit?: string };
/** `sha`: the git blob added, or the one deleted (rename detection for the message). */
export type FileChange = { op: 'A' | 'M' | 'D'; path: string; sha?: string };
export type CoAuthor = { name: string; email: string | null };

function need(pid: string): Link {
	const link = db().select().from(githubLinks).where(eq(githubLinks.projectId, pid)).get();
	if (!link) throw new GitHubError(409, 'conflict', 'The project was unlinked from GitHub.');
	return link;
}

const isRefRace = (e: unknown) => e instanceof GitHubError && e.status === 422;
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The newest history log id of the project, after flushing the buffered rows: what this push covers. */
function logWatermark(pid: string): number {
	flushHistory();
	return db().select({ id: max(historyLog.id) }).from(historyLog).where(eq(historyLog.projectId, pid)).get()?.id ?? 0;
}

/** People whose edits the push carries: distinct authors of the log rows in `(from, to]` (FR-015). */
export function coAuthors(pid: string, from: number, to: number): CoAuthor[] {
	return db()
		.selectDistinct({ name: users.name, email: users.email })
		.from(historyLog)
		.innerJoin(users, eq(users.id, historyLog.userId))
		.where(and(eq(historyLog.projectId, pid), gt(historyLog.id, from), lte(historyLog.id, to)))
		.orderBy(asc(users.name))
		.all();
}

/** The commit message (research R9): the custom title (trimmed, ≤ 72 characters) or `Update a.tex [and N more
 *  files]`; a body of up to 20 `M`/`A`/`D`/`R old -> new` lines, then `…and N more`; users without an email by name
 *  in the body; one `Co-authored-by` trailer per user with one. Exact-content renames show as `R` (the tree still
 *  gets delete + add). */
export function commitMessage(changes: FileChange[], authors: CoAuthor[], title?: string): string {
	const added = changes.filter((c) => c.op === 'A');
	const renamedFrom = new Map<string, string>(); // new path → old path
	for (const c of changes) {
		if (c.op !== 'D' || !c.sha) continue;
		const to = added.find((a) => a.sha === c.sha && !renamedFrom.has(a.path));
		if (to) renamedFrom.set(to.path, c.path);
	}
	const renamedAway = new Set(renamedFrom.values());
	const lines: { path: string; text: string }[] = [];
	for (const c of changes) {
		if (c.op === 'D' && renamedAway.has(c.path)) continue;
		const from = c.op === 'A' ? renamedFrom.get(c.path) : undefined;
		lines.push({ path: c.path, text: from ? `R ${from} -> ${c.path}` : `${c.op} ${c.path}` });
	}
	const custom = title?.trim().slice(0, TITLE_MAX).trim();
	const first = lines[0]?.path ?? '';
	const more = lines.length - 1;
	const subject = custom || (more > 0 ? `Update ${first} and ${more} more ${more === 1 ? 'file' : 'files'}` : `Update ${first}`);
	const body = lines.slice(0, BODY_LINES).map((l) => l.text);
	if (lines.length > BODY_LINES) body.push(`…and ${lines.length - BODY_LINES} more`);
	const nameOnly = authors.filter((a) => !a.email).map((a) => a.name);
	if (nameOnly.length) body.push('', `Also edited by ${nameOnly.join(', ')}`);
	const trailers = authors.filter((a) => a.email).map((a) => `Co-authored-by: ${a.name} <${a.email}>`);
	return [subject, '', ...body, ...(trailers.length ? ['', ...trailers] : [])].join('\n');
}

type Content = { kind: 'text' | 'binary'; bytes: Buffer; sha: string; hash: string | null };

/** The Overtree blob of what was pushed (base text for a later diff3, research R6): a binary's own hash, the base
 *  entry's when unchanged, else the text stored now. */
const storedHash = (c: Content, prev?: BaseMap[string]) => c.hash ?? (prev?.sha === c.sha && prev.hash ? prev.hash : putBlob(c.bytes));

/** Pushes project `pid` (research R4): pulls (merges) while GitHub's head isn't the base, then one commit with every added,
 *  changed and deleted non-ignored path; nothing changed → `noop` (FR-014). On success the base becomes the pushed
 *  state and the watermark the log id read before building. Throws GitHubError. */
export async function push(pid: string, opts: PushOptions): Promise<PushResult> {
	let link = need(pid);
	const token = await installationToken(link.installationId);
	const api = (path: string) => `/repos/${repoPath(link.repo)}${path}`;

	for (let attempt = 1; ; ) {
		link = need(pid);
		let { head, empty } = await branchHead(token, link.repo, link.branch);
		for (let pulls = 0; head !== link.baseCommit; pulls++) {
			if (pulls === PULLS) throw new GitHubError(0, 'retry', 'GitHub kept changing while Overtree was catching up; Overtree retries.');
			await pull(link);
			link = need(pid);
			({ head, empty } = await branchHead(token, link.repo, link.branch));
		}

		// what GitHub gets: the log up to here and the files as they are now (later edits stay unpushed)
		const watermark = logWatermark(pid);
		const files = projectFiles(pid);
		const base = readBase(link);
		const ignored = ignoreFilter(JSON.parse(link.ignore) as string[], [...files.keys(), ...Object.keys(base)]);
		const contents = new Map<string, Content>();
		const changes: FileChange[] = [];
		for (const [path, f] of files) {
			if (ignored(path)) continue;
			const bytes = f.bytes();
			const sha = f.sha(); // from the same bytes (a text is read once)
			contents.set(path, { kind: f.kind, bytes, sha, hash: f.hash });
			if (base[path]?.sha !== sha) changes.push({ op: base[path] ? 'M' : 'A', path, sha });
		}
		// a base entry that matches a pattern added later is neither pushed nor deleted (FR-013)
		for (const [path, entry] of Object.entries(base)) if (!files.has(path) && !ignored(path)) changes.push({ op: 'D', path, sha: entry.sha });
		changes.sort((a, b) => byPath(a.path, b.path));

		if (!changes.length) {
			db().update(githubLinks).set({ watermark, pendingPush: false }).where(eq(githubLinks.projectId, pid)).run();
			return { result: 'noop', ...(head ? { commit: head } : {}) };
		}

		if (empty) {
			// seed the empty repository with one file (creates the branch), make that the base and go on from there
			const first = changes.find((c) => c.op !== 'D')!;
			const c = contents.get(first.path)!;
			const res = await gh<{ commit: { sha: string } }>(token, 'PUT', api(`/contents/${branchPath(first.path)}`), {
				message: `Add ${first.path}`,
				content: c.bytes.toString('base64'),
				branch: link.branch
			});
			const seeded: BaseMap = { [first.path]: { sha: c.sha, hash: storedHash(c) } };
			db()
				.update(githubLinks)
				.set({ baseCommit: res.commit.sha, baseFiles: writeBase(seeded), updatedAt: Date.now() })
				.where(eq(githubLinks.projectId, pid))
				.run();
			continue;
		}

		const entries = await Promise.all(
			changes.map(async (ch) => {
				if (ch.op === 'D') return { path: ch.path, mode: MODE, type: 'blob', sha: null };
				const c = contents.get(ch.path)!;
				if (c.kind === 'text') return { path: ch.path, mode: MODE, type: 'blob', content: c.bytes.toString('utf8') };
				const blob = await gh<{ sha: string }>(token, 'POST', api('/git/blobs'), { content: c.bytes.toString('base64'), encoding: 'base64' });
				return { path: ch.path, mode: MODE, type: 'blob', sha: blob.sha };
			})
		);
		const parentTree = head ? (await gh<{ tree: { sha: string } }>(token, 'GET', api(`/git/commits/${head}`))).tree.sha : null;
		const tree = await gh<{ sha: string }>(token, 'POST', api('/git/trees'), { ...(parentTree ? { base_tree: parentTree } : {}), tree: entries });
		const message = commitMessage(changes, coAuthors(pid, link.watermark, watermark), opts.title);
		const commit = await gh<{ sha: string }>(token, 'POST', api('/git/commits'), { message, tree: tree.sha, parents: head ? [head] : [] });
		try {
			// never forced: a branch that moved meanwhile refuses with 422
			if (head) await gh(token, 'PATCH', api(`/git/refs/heads/${branchPath(link.branch)}`), { sha: commit.sha, force: false });
			else await gh(token, 'POST', api('/git/refs'), { ref: `refs/heads/${link.branch}`, sha: commit.sha });
		} catch (e) {
			if (!isRefRace(e)) throw e;
			if (attempt === ATTEMPTS) throw new GitHubError(422, 'retry', 'GitHub’s branch kept moving while Overtree pushed; Overtree retries.');
			attempt++; // start over from the new head, pulling it first
			continue;
		}
		const pushed: BaseMap = {};
		for (const [path, entry] of Object.entries(base)) if (ignored(path)) pushed[path] = entry;
		for (const [path, c] of contents) pushed[path] = { sha: c.sha, hash: storedHash(c, base[path]) };
		const now = Date.now();
		db()
			.update(githubLinks)
			.set({ baseCommit: commit.sha, baseFiles: writeBase(pushed), watermark, pendingPush: false, lastPushAt: now, updatedAt: now })
			.where(eq(githubLinks.projectId, pid))
			.run();
		return { result: 'pushed', commit: commit.sha };
	}
}
