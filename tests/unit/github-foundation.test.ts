import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMainFileId, setText, uploadFile } from '../../src/lib/server/files.ts';
import { exchangeCode, gh, GitHubError, installationToken, refreshUserToken, toGitHubError } from '../../src/lib/server/github/api.ts';
import { githubConfig, githubConfigProblem } from '../../src/lib/server/github/config.ts';
import { open, seal, signState, STATE_MS, verifyState } from '../../src/lib/server/github/crypto.ts';
import { DEFAULT_IGNORE, gitBlobSha, ignoreFilter, isIgnored, projectFiles, readBase, writeBase } from '../../src/lib/server/github/paths.ts';
import { closeVersion, getVersion } from '../../src/lib/server/history.ts';
import { deleteProject } from '../../src/lib/server/projects.ts';
import { githubLinks, githubRuns } from '../../src/lib/server/schema.ts';
import * as meRoute from '../../src/routes/api/me/+server.ts';
import { fakeGitHub } from '../fake-github/server.ts';
import { cleanup, ev, hit, OWNER, project, start, user } from './helpers.ts';

// GitHub plumbing (012 Phase 2): config, sealed tokens, OAuth state, git SHAs, filters, API errors.

const KEY = readFileSync(join(import.meta.dirname, '../fake-github/key.pem'), 'utf8');
const ENV = {
	GITHUB_APP_ID: '1',
	GITHUB_APP_SLUG: 'overtree-test',
	GITHUB_APP_CLIENT_ID: 'test-client-id',
	GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
	// one line with literal \n, as in an env file
	GITHUB_APP_PRIVATE_KEY: KEY.replace(/\n/g, '\\n')
};
const ALL = [...Object.keys(ENV), 'GITHUB_API_URL', 'GITHUB_URL', 'GITHUB_GRACE_MS'];

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
	for (const k of ALL) delete process.env[k];
});

async function fake() {
	const g = fakeGitHub();
	const { url, stop } = await g.start();
	cleanup.push(stop);
	process.env.GITHUB_API_URL = url;
	process.env.GITHUB_URL = url;
	g.addUser({ login: 'ada', name: 'Ada', email: 'ada@example.com' });
	const inst = g.addInstallation({ account: 'ada' });
	g.addRepo({ name: 'thesis', installation: inst.id, files: { 'main.tex': 'x\n' } });
	return { g, url, inst };
}

describe('config', () => {
	it('is null without GITHUB_APP_ID and complete with it', () => {
		for (const k of ALL) delete process.env[k];
		expect(githubConfig()).toBeNull();
		expect(githubConfigProblem()).toBeNull();
		Object.assign(process.env, ENV, { GITHUB_GRACE_MS: '1500', GITHUB_API_URL: 'http://ghe.test/api/v3/' });
		expect(githubConfig()).toMatchObject({
			appId: '1',
			slug: 'overtree-test',
			privateKey: KEY,
			apiUrl: 'http://ghe.test/api/v3',
			webUrl: 'https://github.com',
			graceMs: 1500,
			longMs: 1_800_000,
			pullMs: 120_000,
			tickMs: 15_000
		});
		expect(githubConfigProblem()).toBeNull();
	});

	it('names the first missing variable when only some are set', () => {
		delete process.env.GITHUB_APP_CLIENT_SECRET;
		delete process.env.GITHUB_APP_PRIVATE_KEY;
		expect(githubConfigProblem()).toMatch(/^GITHUB_APP_CLIENT_SECRET must be set/);
		for (const k of ALL) delete process.env[k];
		process.env.GITHUB_APP_SLUG = 'x';
		expect(githubConfigProblem()).toMatch(/^GITHUB_APP_ID must be set/);
		expect(githubConfig()).toBeNull();
		Object.assign(process.env, ENV, { GITHUB_APP_ID: 'abc' });
		expect(githubConfigProblem()).toMatch(/numeric/);
	});

	it('/api/me says whether GitHub is configured', async () => {
		await start();
		expect(await hit(meRoute.GET, ev(OWNER, {}))).toMatchObject({ status: 200, body: { github: { configured: true } } });
		delete process.env.GITHUB_APP_ID;
		expect(await hit(meRoute.GET, ev(OWNER, {}))).toMatchObject({ status: 200, body: { github: null } });
	});
});

describe('crypto', () => {
	it('seals and opens tokens, and rejects tampering or another key', () => {
		const sealed = seal('ghu_secret');
		expect(sealed.toString('latin1')).not.toContain('ghu_secret');
		expect(seal('ghu_secret').equals(sealed)).toBe(false); // fresh IV
		expect(open(sealed)).toBe('ghu_secret');
		const bad = Buffer.from(sealed);
		bad[bad.length - 1] ^= 1;
		expect(() => open(bad)).toThrow();
		expect(() => open(sealed.subarray(0, 10))).toThrow();
		process.env.GITHUB_APP_PRIVATE_KEY = 'another key';
		expect(() => open(sealed)).toThrow();
	});

	it('signs the OAuth state and refuses forged or expired ones', () => {
		const s = signState({ userId: 'u1', return: '/projects/p1?github=1' });
		expect(verifyState(s)).toMatchObject({ userId: 'u1', return: '/projects/p1?github=1', nonce: expect.any(String) });
		expect(verifyState(s, Date.now() + STATE_MS + 1000)).toBeNull();
		const [payload, sig] = s.split('.');
		const forged = Buffer.from(JSON.stringify({ ...verifyState(s), userId: 'u2' })).toString('base64url');
		expect(verifyState(`${forged}.${sig}`)).toBeNull();
		expect(verifyState(`${payload}.${sig}x`)).toBeNull();
		expect(verifyState('garbage')).toBeNull();
		process.env.GITHUB_APP_CLIENT_SECRET = 'other';
		expect(verifyState(s)).toBeNull();
	});
});

describe('paths', () => {
	it('computes the blob SHA git does', () => {
		const text = 'Hello, \\LaTeX\n';
		expect(gitBlobSha(Buffer.from(text))).toBe(execFileSync('git', ['hash-object', '--stdin'], { input: text, encoding: 'utf8' }).trim());
		expect(gitBlobSha(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
	});

	it('ignores the defaults, dot folders included, and PDFs only next to their .tex', () => {
		const all = ['main.tex', 'main.pdf', 'figure.pdf', 'ch/a.tex', 'ch/a.pdf', 'ch/b.pdf', '.github/workflows/x.yaml', 'a/b.aux'];
		const ignored = ignoreFilter(DEFAULT_IGNORE, all);
		expect(all.filter(ignored)).toEqual(['main.pdf', 'ch/a.pdf', '.github/workflows/x.yaml', 'a/b.aux']);
		expect(isIgnored('.cache/x.log', DEFAULT_IGNORE, [])).toBe(true);
		expect(isIgnored('main.synctex.gz', DEFAULT_IGNORE, [])).toBe(true);
		expect(isIgnored('figure.pdf', DEFAULT_IGNORE, ['figure.pdf'])).toBe(false);
		expect(isIgnored('main.pdf', DEFAULT_IGNORE, ['main.pdf'])).toBe(false); // no main.tex on either side
		expect(isIgnored('notes/*.md', ['notes/*.md'], [])).toBe(true);
		expect(isIgnored('main.pdf', ['**/*.aux'], ['main.tex'])).toBe(false); // the PDF rule only when listed
		expect(isIgnored('main.tex', [], [])).toBe(false);
	});

	it('lists project files with lazy SHAs and stores the base map as a blob', async () => {
		await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		await setText(main, 'Hello\n', {});
		await uploadFile(pid, null, 'fig.png', new Uint8Array([1, 2, 3]), false, user().id);
		const map = projectFiles(pid);
		expect([...map.keys()].sort()).toEqual(['fig.png', 'main.tex']);
		expect(map.get('main.tex')).toMatchObject({ id: main, kind: 'text', hash: null });
		expect(map.get('main.tex')!.sha()).toBe(gitBlobSha(Buffer.from('Hello\n')));
		expect(map.get('fig.png')!.bytes()).toEqual(Buffer.from([1, 2, 3]));
		expect(map.get('fig.png')!.sha()).toBe(gitBlobSha(new Uint8Array([1, 2, 3])));

		expect(readBase({ baseFiles: null })).toEqual({});
		const base = { 'b.tex': { sha: 'b'.repeat(40), hash: 'h' }, 'a.tex': { sha: 'a'.repeat(40) } };
		const hash = writeBase(base);
		expect(writeBase({ 'a.tex': base['a.tex'], 'b.tex': base['b.tex'] })).toBe(hash);
		expect(readBase({ baseFiles: hash })).toEqual(base);
	});
});

describe('api', () => {
	it('maps GitHub errors to reasons, with messages free of tokens', async () => {
		const { g } = await fake();
		const token = g.userToken('ada');
		expect(await gh(token, 'GET', '/user')).toMatchObject({ login: 'ada' });

		const err = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as GitHubError;
		const bad = await err(gh('ghu_notavalidtoken', 'GET', '/user'));
		expect(bad).toMatchObject({ name: 'GitHubError', status: 401, reason: 'needs-reconnect' });
		expect(bad.message).not.toContain('ghu_notavalidtoken');
		for (const [status, reason] of [
			[403, 'needs-access'],
			[404, 'needs-access'],
			[409, 'conflict'],
			[422, 'conflict'],
			[500, 'retry'],
			[502, 'retry']
		] as const) {
			g.failNext(status);
			const e = await err(gh(token, 'GET', '/user'));
			expect(e).toBeInstanceOf(GitHubError);
			expect([e.status, e.reason]).toEqual([status, reason]);
			expect(e.message).toContain(`(${status})`);
		}
		expect(await err(gh(token, 'GET', '/repos/ada/nope'))).toMatchObject({ status: 404, reason: 'needs-access' });
		expect(toGitHubError(new TypeError('fetch failed'))).toMatchObject({ status: 0, reason: 'retry' });
		expect(toGitHubError({ status: 401, response: { data: { message: 'token ghs_abc123 is bad' } } }).message).not.toContain('ghs_abc123');

		process.env.GITHUB_API_URL = 'http://127.0.0.1:1';
		expect(await err(gh(token, 'GET', '/user'))).toMatchObject({ status: 0, reason: 'retry' });
	});

	it('mints installation tokens and exchanges and refreshes user tokens through the fake', async () => {
		const { g, url, inst } = await fake();
		const it = await installationToken(inst.id);
		expect(await gh(it, 'GET', '/repos/ada/thesis')).toMatchObject({ full_name: 'ada/thesis' });
		expect(await installationToken(inst.id)).toBe(it); // cached by @octokit/auth-app
		expect(await installationToken(999_999).catch((e) => e)).toMatchObject({ status: 404, reason: 'needs-access' });

		const authorize = await fetch(`${url}/login/oauth/authorize?client_id=test-client-id&redirect_uri=${encodeURIComponent('http://app.test/cb')}`, { redirect: 'manual' });
		const code = new URL(authorize.headers.get('location')!).searchParams.get('code')!;
		const user1 = await exchangeCode(code);
		expect(user1).toMatchObject({ token: expect.stringMatching(/^ghu_/), refreshToken: expect.stringMatching(/^ghr_/) });
		expect(user1.expiresAt).toBeGreaterThan(Date.now());
		expect(user1.refreshExpiresAt).toBeGreaterThan(user1.expiresAt);
		expect(await exchangeCode(code).catch((e) => e)).toMatchObject({ reason: 'needs-reconnect' }); // used up

		const user2 = await refreshUserToken(user1.refreshToken);
		expect(user2.token).not.toBe(user1.token);
		expect(await gh(user2.token, 'GET', '/user')).toMatchObject({ login: 'ada' });
		g.revoke('ada');
		expect(await refreshUserToken(user2.refreshToken).catch((e) => e)).toMatchObject({ reason: 'needs-reconnect' });
	});
});

describe('history and projects', () => {
	it('a github version stores its source; pulls without changes make none', async () => {
		await start();
		const pid = project();
		closeVersion(pid, 'baseline');
		expect(closeVersion(pid, 'github', { source: { commits: [], notes: [] } })).toBeNull();
		await setText(getMainFileId(pid)!, 'From GitHub\n', {});
		const source = { commits: [{ sha: 'a'.repeat(40), author: 'Ada', message: 'Fix typo' }], notes: [{ path: 'main.tex', reason: 'overlap' as const }] };
		const v = closeVersion(pid, 'github', { source })!;
		expect(getVersion(pid, v, user().id)).toMatchObject({ kind: 'github', github: source });
		expect(getVersion(pid, closeVersion(pid, 'edit', {}) ?? v, user().id).github).toEqual(source); // nothing new: still v
	});

	it('deleting a project deletes its GitHub link and runs', async () => {
		const server = await start();
		const pid = project();
		const now = Date.now();
		server.db
			.insert(githubLinks)
			.values({ projectId: pid, userId: user().id, installationId: 1, repoId: 2, repo: 'ada/thesis', branch: 'main', ignore: '[]', status: 'active', createdAt: now, updatedAt: now })
			.run();
		server.db.insert(githubRuns).values({ projectId: pid, kind: 'push', trigger: 'manual', result: 'noop', startedAt: now, finishedAt: now }).run();
		deleteProject(pid);
		expect(server.db.select().from(githubLinks).where(eq(githubLinks.projectId, pid)).all()).toEqual([]);
		expect(server.db.select().from(githubRuns).where(eq(githubRuns.projectId, pid)).all()).toEqual([]);
	});
});
