import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IGNORE } from '../../src/lib/github-types.ts';
import { branchHead, repoPath } from '../../src/lib/server/github/accounts.ts';
import { gh, installationToken } from '../../src/lib/server/github/api.ts';
import { confirmLink, getLink } from '../../src/lib/server/github/links.ts';
import { requestSync } from '../../src/lib/server/github/sync.ts';
import { currentText } from '../../src/lib/server/history.ts';
import { files, githubLinks, versions } from '../../src/lib/server/schema.ts';
import { project, start, user } from './helpers.ts';

// 012 T048: the real GitHub API instead of the fake, skipped unless GITHUB_SMOKE=1 (quickstart.md "Manual against
// real GitHub"). Needs GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_SMOKE_INSTALLATION (an installation id of the
// App) and GITHUB_SMOKE_REPO (`owner/name`, a throwaway repository in that installation). Works on a new branch
// `overtree-smoke-<timestamp>` and deletes it afterwards. The browser OAuth step is skipped: the link is written
// directly with a fresh access check, so every call uses the installation token.

const env = process.env;
const on = env.GITHUB_SMOKE === '1';

describe.skipIf(!on)('GitHub smoke test (real API)', () => {
	it('push, a workflow-style PDF commit, then a pull that brings nothing in', { timeout: 120_000 }, async () => {
		for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_SMOKE_INSTALLATION', 'GITHUB_SMOKE_REPO'])
			if (!env[name]) throw new Error(`${name} must be set for the smoke test`);
		const installationId = Number(env.GITHUB_SMOKE_INSTALLATION);
		const repo = env.GITHUB_SMOKE_REPO!;
		const api = (path: string) => `/repos/${repoPath(repo)}${path}`;
		const server = await start();
		const pid = project();
		const token = await installationToken(installationId);
		const info = await gh<{ id: number; default_branch: string }>(token, 'GET', api(''));
		const branch = `overtree-smoke-${Date.now()}`;
		const { head: from } = await branchHead(token, repo, info.default_branch);
		if (from) await gh(token, 'POST', api('/git/refs'), { ref: `refs/heads/${branch}`, sha: from });

		try {
			const now = Date.now();
			server.db
				.insert(githubLinks)
				.values({
					projectId: pid,
					userId: user().id,
					installationId,
					repoId: info.id,
					repo,
					branch,
					ignore: JSON.stringify(DEFAULT_IGNORE),
					status: 'pending',
					lastCheckAt: now, // no access check through a user token (there is none here)
					createdAt: now,
					updatedAt: now
				})
				.run();

			// first sync: the project's main.tex goes up in one commit
			await confirmLink(pid, 'merge');
			const pushed = getLink(pid)!;
			expect(pushed).toMatchObject({ status: 'active', error: null });
			expect(pushed.baseCommit).toBeTruthy();
			expect(pushed.baseCommit).not.toBe(from);

			// the workflow stand-in: a compiled PDF committed next to main.tex
			await gh(token, 'PUT', api('/contents/main.pdf'), {
				message: 'Build PDF (smoke test)',
				content: Buffer.from('%PDF-1.5 smoke').toString('base64'),
				branch
			});
			const { head } = await branchHead(token, repo, branch);
			const snapshot = () =>
				server.db
					.select()
					.from(files)
					.where(eq(files.projectId, pid))
					.all()
					.map((f) => `${f.name}:${f.kind === 'text' ? currentText(f.id) : f.hash}`)
					.sort();
			const before = snapshot();
			const versionCount = () => server.db.select().from(versions).where(eq(versions.projectId, pid)).all().length;
			const beforeVersions = versionCount();

			const r = await requestSync(pid, { kind: 'pull', trigger: 'manual' });
			expect(r).toMatchObject({ result: 'noop', commit: head });
			expect(getLink(pid)).toMatchObject({ status: 'active', baseCommit: head, note: null });
			expect(snapshot()).toEqual(before);
			expect(versionCount()).toBe(beforeVersions);
		} finally {
			await gh(token, 'DELETE', api(`/git/refs/heads/${branch}`)).catch(() => undefined);
		}
	});
});
