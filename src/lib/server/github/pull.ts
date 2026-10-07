import { eq } from 'drizzle-orm';
import { getServer } from '../collab.ts';
import { githubLinks } from '../schema.ts';
import { branchHead, repoPath, type Link } from './accounts.ts';
import { gh, GitHubError, installationToken } from './api.ts';
import { ignoreFilter, projectFiles, readBase } from './paths.ts';

// GitHub → Overtree (012 research R6). PHASE 4 STUB (T024), replaced by Phase 5 (T030–T033, T036):
// - head equals `base_commit` (or both are absent: empty repository) → nothing to pull, only `last_pull_at` moves;
// - every path changed between `base_commit` and head (GitHub's compare) is "not pulled" → `base_commit := head`,
//   base map kept, no version, no note (the workflow's PDF commit, SC-005);
// - anything else → a `conflict` GitHubError ("GitHub has changes; pull not implemented yet").
// Note for Phase 5: the "head equals base_commit" fast path is a Phase 4 shortcut, not a rule to keep. Confirming a
// link (`confirmLink(pid, 'merge')`) sets `base_commit := head` but leaves GitHub-only files out of the base map, so
// the first pull (trigger `link`) must diff the head tree against the base map even when head equals `base_commit`,
// or those files never arrive. The stub compares commit to commit (GitHub's compare), not tree to base map, so it
// doesn't depend on that; Phase 5 chooses its own fast path (e.g. not for trigger `link`, or keyed on a "base map
// complete" flag) and must not copy this one as is.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;

export type PullResult = { result: 'pulled' | 'noop'; commit?: string };

const NOT_YET = 'GitHub has changes; pull not implemented yet.';
// GitHub lists at most 300 files in a compare; with that many, "only ignored paths changed" can't be shown
const COMPARE_FILES_MAX = 300;

/** Brings GitHub's side into the project (stub, see the header): advances the base past commits that only touch
 *  "not pulled" paths, throws `conflict` for anything else. */
export async function pull(link: Link): Promise<PullResult> {
	const pid = link.projectId;
	const token = await installationToken(link.installationId);
	const { head, empty } = await branchHead(token, link.repo, link.branch);
	const now = Date.now();
	const touch = (set: Partial<Link> = {}) =>
		db()
			.update(githubLinks)
			.set({ lastPullAt: now, ...set })
			.where(eq(githubLinks.projectId, pid))
			.run();

	if (head === link.baseCommit) {
		touch();
		return { result: 'noop', ...(head ? { commit: head } : {}) };
	}
	if (!head) {
		// the branch went away (or the repository was emptied) after a sync
		if (empty) throw new GitHubError(409, 'conflict', 'The GitHub repository was emptied after the last sync.');
		throw new GitHubError(404, 'needs-access', `The branch “${link.branch}” no longer exists on GitHub.`);
	}
	if (!link.baseCommit) throw new GitHubError(409, 'conflict', NOT_YET);

	let compare: { status: string; files?: { filename: string; previous_filename?: string }[] };
	try {
		compare = await gh(token, 'GET', `/repos/${repoPath(link.repo)}/compare/${link.baseCommit}...${head}`);
	} catch (e) {
		// base commit unknown (history rewritten): Phase 5 (T036) turns this into `pending`
		if (e instanceof GitHubError && e.status === 404) throw new GitHubError(409, 'conflict', NOT_YET);
		throw e;
	}
	const changed = (compare.files ?? []).flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));
	if (compare.status !== 'ahead' || changed.length >= COMPARE_FILES_MAX) throw new GitHubError(409, 'conflict', NOT_YET);
	const base = readBase(link);
	const ignored = ignoreFilter(JSON.parse(link.ignore) as string[], [...changed, ...Object.keys(base), ...projectFiles(pid).keys()]);
	if (!changed.every(ignored)) throw new GitHubError(409, 'conflict', NOT_YET);
	touch({ baseCommit: head });
	return { result: 'noop', commit: head };
}
