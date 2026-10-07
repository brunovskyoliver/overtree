import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAppAuth, createOAuthUserAuth, type GitHubAppUserAuthenticationWithExpiration } from '@octokit/auth-app';
import { request } from '@octokit/request';
import { describe, expect, it } from 'vitest';
import { fakeGitHub } from '../fake-github/server.ts';
import { cleanup, tempDir } from './helpers.ts';

// Self-test of the fake GitHub (012 research R11) that the github-*.test.ts suites build on.

const KEY = readFileSync(join(import.meta.dirname, '../fake-github/key.pem'), 'utf8');

async function setup() {
	const gh = fakeGitHub();
	const { url, stop } = await gh.start();
	cleanup.push(stop);
	gh.addUser({ login: 'ada', name: 'Ada Lovelace', email: 'ada@example.com' });
	const inst = gh.addInstallation({ account: 'ada' });
	const repo = gh.addRepo({ name: 'thesis', installation: inst.id, files: { 'main.tex': '\\documentclass{article}\n', 'chapters/intro.tex': 'Intro\n' } });
	const token = gh.userToken('ada');
	const call = async (method: string, path: string, body?: unknown, auth = token) => {
		const res = await fetch(url + path, {
			method,
			headers: { authorization: `token ${auth}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		return { status: res.status, body: res.status === 204 ? null : await res.json() };
	};
	return { gh, url, inst, repo, token, call };
}

/** `git` in a scratch repository with fixed identities and dates. */
function git(dir: string, args: string[], input?: string) {
	const date = '1700000000 +0000';
	return execFileSync('git', args, {
		cwd: dir,
		input,
		encoding: 'utf8',
		env: { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_COMMITTER_DATE: date }
	}).trim();
}

describe('fake GitHub', () => {
	it('computes the same blob, tree and commit SHAs as git', async () => {
		const { call } = await setup();
		const blob = await call('POST', '/repos/ada/thesis/git/blobs', { content: 'hello\n', encoding: 'utf-8' });
		expect(blob).toMatchObject({ status: 201, body: { sha: 'ce013625030ba8dba906f756967f9e9ca394464a' } });
		const binary = await call('POST', '/repos/ada/thesis/git/blobs', { content: Buffer.from([0, 1, 2, 255]).toString('base64'), encoding: 'base64' });

		const tree = await call('POST', '/repos/ada/thesis/git/trees', {
			tree: [
				{ path: 'b.tex', mode: '100644', type: 'blob', sha: blob.body.sha },
				{ path: 'a/x.bin', mode: '100644', type: 'blob', sha: binary.body.sha },
				{ path: 'a.tex', mode: '100644', type: 'blob', content: 'A\n' }
			]
		});
		expect(tree.status).toBe(201);
		const commit = await call('POST', '/repos/ada/thesis/git/commits', {
			message: 'Add files\n',
			tree: tree.body.sha,
			parents: [],
			author: { name: 'Ada', email: 'ada@example.com', date: '2023-11-14T22:13:20Z' }
		});
		expect(commit.status).toBe(201);
		expect(commit.body).toMatchObject({ tree: { sha: tree.body.sha }, parents: [], author: { name: 'Ada', date: '2023-11-14T22:13:20Z' }, committer: { name: 'Ada' } });

		const dir = tempDir();
		git(dir, ['init', '-q']);
		writeFileSync(join(dir, 'b.tex'), 'hello\n');
		writeFileSync(join(dir, 'a.tex'), 'A\n');
		mkdirSync(join(dir, 'a'));
		writeFileSync(join(dir, 'a/x.bin'), Buffer.from([0, 1, 2, 255]));
		git(dir, ['add', '.']);
		const gitTree = git(dir, ['write-tree']);
		expect(tree.body.sha).toBe(gitTree);
		expect(commit.body.sha).toBe(git(dir, ['commit-tree', gitTree], 'Add files\n'));
	});

	it('builds trees on base_tree with nested paths and sha: null deletes, and lists them recursively', async () => {
		const { gh, call } = await setup();
		const head = await call('GET', '/repos/ada/thesis/git/ref/heads/main');
		expect(head.body).toMatchObject({ ref: 'refs/heads/main', object: { type: 'commit', sha: gh.head('ada/thesis', 'main') } });
		const base = await call('GET', `/repos/ada/thesis/git/commits/${head.body.object.sha}`);

		const tree = await call('POST', '/repos/ada/thesis/git/trees', {
			base_tree: base.body.tree.sha,
			tree: [
				{ path: 'chapters/intro.tex', mode: '100644', type: 'blob', sha: null },
				{ path: 'figures/deep/plot.tex', mode: '100644', type: 'blob', content: 'plot\n' },
				{ path: 'gone/never.tex', mode: '100644', type: 'blob', sha: null }
			]
		});
		expect(tree.status).toBe(201);
		const listed = await call('GET', `/repos/ada/thesis/git/trees/${tree.body.sha}?recursive=1`);
		// chapters/ became empty and is gone, like in git
		expect(listed.body.tree.map((e: { path: string; type: string }) => [e.path, e.type])).toEqual([
			['figures', 'tree'],
			['figures/deep', 'tree'],
			['figures/deep/plot.tex', 'blob'],
			['main.tex', 'blob']
		]);
		expect(listed.body).toMatchObject({ truncated: false, tree: expect.arrayContaining([expect.objectContaining({ path: 'main.tex', size: 24 })]) });

		const blob = await call('GET', `/repos/ada/thesis/git/blobs/${listed.body.tree[2].sha}`);
		expect(blob.body).toMatchObject({ encoding: 'base64', size: 5 });
		expect(Buffer.from(blob.body.content, 'base64').toString()).toBe('plot\n');
	});

	it('moves a ref only fast-forward unless forced, and compares commits', async () => {
		const { gh, call } = await setup();
		const h0 = gh.head('ada/thesis', 'main')!;
		const tree = await call('POST', '/repos/ada/thesis/git/trees', { base_tree: gh.commit('ada/thesis', h0)!.tree, tree: [{ path: 'main.tex', mode: '100644', type: 'blob', content: 'ours\n' }] });
		const ours = await call('POST', '/repos/ada/thesis/git/commits', { message: 'Update main.tex', tree: tree.body.sha, parents: [h0] });
		expect(ours.body.author).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });

		// a workflow commits in between: our commit is no longer a fast-forward
		const theirs = gh.commitFiles('ada/thesis', 'main', { 'main.pdf': Buffer.from('%PDF') }, { name: 'github-actions[bot]', email: 'bot@github.test' }, 'Render PDF');
		const refused = await call('PATCH', '/repos/ada/thesis/git/refs/heads/main', { sha: ours.body.sha, force: false });
		expect(refused).toMatchObject({ status: 422, body: { message: 'Update is not a fast forward' } });
		expect(gh.head('ada/thesis', 'main')).toBe(theirs);

		const cmp = await call('GET', `/repos/ada/thesis/compare/${h0}...main`);
		expect(cmp.body).toMatchObject({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, merge_base_commit: { sha: h0 } });
		expect(cmp.body.commits).toMatchObject([{ sha: theirs, commit: { message: 'Render PDF', author: { name: 'github-actions[bot]' } }, parents: [{ sha: h0 }] }]);
		expect(cmp.body.files).toMatchObject([{ filename: 'main.pdf', status: 'added' }]);
		expect((await call('GET', `/repos/ada/thesis/compare/${ours.body.sha}...${theirs}`)).body).toMatchObject({ status: 'diverged', ahead_by: 1, behind_by: 1 });

		const ff = await call('POST', '/repos/ada/thesis/git/commits', { message: 'On top', tree: tree.body.sha, parents: [theirs] });
		expect(await call('PATCH', '/repos/ada/thesis/git/refs/heads/main', { sha: ff.body.sha, force: false })).toMatchObject({ status: 200, body: { object: { sha: ff.body.sha } } });
		expect(gh.files('ada/thesis', 'main').get('main.tex')?.toString()).toBe('ours\n');
		expect((await call('PATCH', '/repos/ada/thesis/git/refs/heads/main', { sha: h0, force: true })).status).toBe(200);

		const created = await call('POST', '/repos/ada/thesis/git/refs', { ref: 'refs/heads/draft', sha: theirs });
		expect(created).toMatchObject({ status: 201, body: { ref: 'refs/heads/draft', object: { sha: theirs } } });
		expect((await call('POST', '/repos/ada/thesis/git/refs', { ref: 'refs/heads/draft', sha: theirs })).status).toBe(422);
		expect((await call('GET', '/repos/ada/thesis/branches')).body.map((b: { name: string }) => b.name)).toEqual(['draft', 'main']);
		expect((await call('GET', '/repos/ada/thesis/git/ref/heads/nope')).status).toBe(404);
	});

	it('lists installations and pushable repositories, and enforces access', async () => {
		const { gh, inst, repo, call } = await setup();
		gh.addUser({ login: 'bob' });
		gh.addRepo({ name: 'outside', owner: 'ada', files: { 'a.tex': 'a' } }); // not in the installation
		const org = gh.addInstallation({ account: 'lab', users: ['ada'] });
		gh.addRepo({ name: 'paper', installation: org.id });

		expect((await call('GET', '/user')).body).toMatchObject({ login: 'ada', name: 'Ada Lovelace', type: 'User' });
		const list = await call('GET', '/user/installations');
		expect(list.body).toMatchObject({ total_count: 2, installations: [{ id: inst.id, account: { login: 'ada', type: 'User' } }, { id: org.id, account: { login: 'lab', type: 'Organization' } }] });
		gh.setPush('ada', 'lab/paper', false);
		const repos = await call('GET', `/user/installations/${org.id}/repositories`);
		expect(repos.body).toMatchObject({ total_count: 1, repositories: [{ full_name: 'lab/paper', default_branch: 'main', private: true, permissions: { push: false } }] });
		expect((await call('GET', `/repositories/${repo.id}`)).body).toMatchObject({ full_name: 'ada/thesis', permissions: { push: true } });
		expect((await call('GET', '/repos/ada/outside')).status).toBe(404);
		expect((await call('POST', '/repos/lab/paper/git/blobs', { content: 'x' })).status).toBe(403);
		// an empty repository refuses the Git Data API
		expect((await call('GET', '/repos/lab/paper/git/ref/heads/main')).status).toBe(409);
		expect((await call('GET', `/user/installations/${inst.id}/repositories`, undefined, gh.userToken('bob'))).status).toBe(404);

		gh.failNext(502);
		expect((await call('GET', '/user')).status).toBe(502);
		expect((await call('GET', '/user')).status).toBe(200);
		gh.revoke('ada');
		expect(await call('GET', '/user')).toMatchObject({ status: 401, body: { message: 'Bad credentials' } });
		expect(gh.requests.filter((r) => r.method !== 'GET')).toHaveLength(1);
	});

	it('serves @octokit/auth-app: installation tokens, code exchange and refresh', async () => {
		const { gh, url, inst } = await setup();
		const req = request.defaults({ baseUrl: url });
		const auth = createAppAuth({ appId: 1, privateKey: KEY, clientId: 'test-client-id', clientSecret: 'test-client-secret', request: req });

		const installation = await auth({ type: 'installation', installationId: inst.id });
		const repo = await fetch(`${url}/repos/ada/thesis`, { headers: { authorization: `token ${installation.token}` } });
		expect(await repo.json()).toMatchObject({ full_name: 'ada/thesis' });
		expect((await fetch(`${url}/app/installations/${inst.id}/access_tokens`, { method: 'POST' })).status).toBe(401);

		const authorize = await fetch(`${url}/login/oauth/authorize?client_id=test-client-id&redirect_uri=${encodeURIComponent('http://app.test/cb')}&state=s1`, { redirect: 'manual' });
		const callback = new URL(authorize.headers.get('location')!);
		expect(callback.searchParams.get('state')).toBe('s1');
		const user = (await auth({ type: 'oauth-user', code: callback.searchParams.get('code')! })) as GitHubAppUserAuthenticationWithExpiration;
		expect(user).toMatchObject({ token: expect.stringMatching(/^ghu_/), refreshToken: expect.stringMatching(/^ghr_/), expiresAt: expect.any(String) });
		const me = await fetch(`${url}/user`, { headers: { authorization: `token ${user.token}` } });
		expect(await me.json()).toMatchObject({ login: 'ada' });

		const userAuth = createOAuthUserAuth({
			clientType: 'github-app',
			clientId: 'test-client-id',
			clientSecret: 'test-client-secret',
			request: req,
			token: user.token,
			refreshToken: user.refreshToken,
			expiresAt: user.expiresAt,
			refreshTokenExpiresAt: user.refreshTokenExpiresAt
		});
		const refreshed = await userAuth({ type: 'refresh' });
		expect(refreshed.token).not.toBe(user.token);
		gh.revoke('ada');
		await expect(userAuth({ type: 'refresh' })).rejects.toThrow(/bad_refresh_token/);
	});
});
