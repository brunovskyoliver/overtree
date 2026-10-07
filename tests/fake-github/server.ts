// In-memory GitHub for tests (012 research R11): the REST and OAuth endpoints the sync uses, with real git SHA-1s
// for blobs, trees and commits. API and web paths are served from one origin, as @octokit/oauth-methods derives the
// OAuth URL from a non-github.com baseUrl by dropping `/api/v3`.
// Renamed or transferred repositories answer under the old `owner/name` with a 301 to the new one, as GitHub does
// (or a 404, as configured); protected branches refuse ref updates with GitHub's 422.
// ponytail: no pagination (every list fits one page), no rename detection in compare.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type Person = { name: string; email: string; date: string };
type Entry = { name: string; mode: string; type: 'blob' | 'tree' | 'commit'; sha: string };
type Commit = { tree: string; parents: string[]; author: Person; committer: Person; message: string };
type Obj = { type: 'blob'; data: Buffer } | { type: 'tree'; entries: Entry[] } | { type: 'commit'; commit: Commit };

type Account = { id: number; login: string; type: 'User' | 'Organization'; name: string; email: string | null };
type Installation = { id: number; account: Account; users: Set<string>; all: boolean; repos: Set<number> };
type Repo = {
	id: number;
	owner: Account;
	name: string;
	private: boolean;
	defaultBranch: string;
	refs: Map<string, string>; // branch → commit sha
	objects: Map<string, Obj>;
};
type Auth = { kind: 'user'; login: string } | { kind: 'installation'; id: number } | null;
type Reply = { status: number; body?: unknown; location?: string };

export type FakeRequest = { method: string; path: string; auth: 'user' | 'installation' | 'app' | null; body?: Record<string, unknown> };
export type FileMap = Record<string, string | Buffer | null>;

const sha1 = (data: Buffer) => createHash('sha1').update(data).digest('hex');
const gitHash = (type: string, body: Buffer) => sha1(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]));
const isoSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const token = (prefix: string) => `${prefix}_${randomBytes(18).toString('hex')}`;
const fail = (status: number, message: string): Reply => ({ status, body: { message, documentation_url: 'https://docs.github.com/rest', status: String(status) } });
const notFound = () => fail(404, 'Not Found');

/** git's tree order: names compared bytewise, trees as if they ended in `/`. */
const treeKey = (e: Entry) => (e.type === 'tree' ? `${e.name}/` : e.name);
const sortEntries = (entries: Entry[]) => entries.sort((a, b) => (treeKey(a) < treeKey(b) ? -1 : treeKey(a) > treeKey(b) ? 1 : 0));

/** A fresh fake; `start()` listens on `port` (0: any) and returns `{ url, stop }`. */
export function fakeGitHub(options: { clientId?: string; clientSecret?: string; callbackUrl?: string } = {}) {
	const clientId = options.clientId ?? 'test-client-id';
	const clientSecret = options.clientSecret ?? 'test-client-secret';
	let url = '';
	let nextId = 1000;

	const accounts = new Map<string, Account>(); // users and organizations by login
	const installations = new Map<number, Installation>();
	const repos = new Map<number, Repo>();
	const noPush = new Set<string>(); // `${login}:${repoId}`
	const protectedBranches = new Set<string>(); // `${repoId}:${branch}`
	const movedFrom = new Map<string, { id: number; redirect: boolean }>(); // old `owner/name`, lower-case → repository
	const codes = new Map<string, string>(); // OAuth code → login
	const userTokens = new Map<string, { login: string; expiresAt: number }>();
	const refreshTokens = new Map<string, { login: string; expiresAt: number }>();
	const installationTokens = new Map<string, { id: number; expiresAt: number }>();
	const failures: number[] = [];
	const requests: FakeRequest[] = [];

	const fake = {
		/** Seconds until user-to-server tokens expire (GitHub: 8 h) and refresh tokens (about 6 months). */
		accessTtl: 8 * 3600,
		refreshTtl: 15_897_600,
		/** Who approves `/login/oauth/authorize`; default the first user added. */
		authorizeAs: null as string | null,
		/** Redirect target when the authorize request has no `redirect_uri` (the App's callback URL). */
		callbackUrl: options.callbackUrl ?? null,
		requests,
		get count() {
			return requests.length;
		},
		get url() {
			return url;
		},

		addUser(user: { login: string; name?: string; email?: string | null }) {
			const account: Account = { id: nextId++, login: user.login, type: 'User', name: user.name ?? user.login, email: user.email ?? `${user.login}@users.noreply.github.test` };
			accounts.set(user.login, account);
			fake.authorizeAs ??= user.login;
			return account;
		},

		/** An installation on `account` (a user, or an organization created on the fly), usable by `users` (default: the
		 *  account itself when it is a user). `all`: covers every repository of the account. */
		addInstallation(inst: { account: string; type?: 'User' | 'Organization'; users?: string[]; all?: boolean }) {
			let account = accounts.get(inst.account);
			if (!account) {
				account = { id: nextId++, login: inst.account, type: inst.type ?? 'Organization', name: inst.account, email: null };
				accounts.set(inst.account, account);
			}
			const users = new Set(inst.users ?? (account.type === 'User' ? [account.login] : []));
			const installation: Installation = { id: nextId++, account, users, all: !!inst.all, repos: new Set() };
			installations.set(installation.id, installation);
			return installation;
		},

		/** A repository of `owner` (default: the installation's account), selected in `installation`; with `files` it
		 *  gets an initial commit on the default branch, without it stays empty. */
		addRepo(repo: { name: string; owner?: string; installation?: number; private?: boolean; defaultBranch?: string; files?: FileMap }) {
			const installation = repo.installation === undefined ? undefined : installations.get(repo.installation);
			const owner = accounts.get(repo.owner ?? installation?.account.login ?? '');
			if (!owner) throw new Error(`fake GitHub: unknown owner of ${repo.name}`);
			const r: Repo = {
				id: nextId++,
				owner,
				name: repo.name,
				private: repo.private ?? true,
				defaultBranch: repo.defaultBranch ?? 'main',
				refs: new Map(),
				objects: new Map()
			};
			repos.set(r.id, r);
			if (installation) installation.repos.add(r.id);
			if (repo.files) fake.commitFiles(r, r.defaultBranch, repo.files, undefined, 'Initial commit');
			return r;
		},

		/** One commit on `branch` (created if missing) changing `files` (null deletes), as a GitHub web edit or a workflow
		 *  would make it. Returns the commit sha. */
		commitFiles(repo: Repo | string, branch: string, files: FileMap, author?: { name: string; email: string }, message = 'Update files') {
			const r = resolve(repo);
			const head = r.refs.get(branch);
			const base = head ? (get(r, head, 'commit')!.commit.tree) : null;
			const tree = buildTree(
				r,
				base,
				Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', sha: content === null ? null : put(r, 'blob', typeof content === 'string' ? Buffer.from(content) : content) }))
			);
			const who = { name: author?.name ?? 'GitHub', email: author?.email ?? 'noreply@github.com', date: isoSeconds(Date.now()) };
			const sha = writeCommit(r, { tree, parents: head ? [head] : [], author: who, committer: who, message });
			r.refs.set(branch, sha);
			return sha;
		},

		/** Deletes `branch` (someone removed it on GitHub); its commits stay reachable by sha. */
		deleteBranch(repo: Repo | string, branch: string) {
			resolve(repo).refs.delete(branch);
		},
		/** Head commit of `branch`, or undefined. */
		head: (repo: Repo | string, branch: string) => resolve(repo).refs.get(branch),
		/** Files at `ref` (branch or commit sha) as path → content. */
		files(repo: Repo | string, ref: string) {
			const r = resolve(repo);
			const commit = get(r, r.refs.get(ref) ?? ref, 'commit');
			const out = new Map<string, Buffer>();
			if (commit) for (const e of walk(r, commit.commit.tree)) if (e.type === 'blob') out.set(e.path, get(r, e.sha, 'blob')!.data);
			return out;
		},
		commit: (repo: Repo | string, sha: string) => get(resolve(repo), sha, 'commit')?.commit,
		/** Renames `repo` (404 under the old name). */
		renameRepo(repo: Repo | string, name: string) {
			fake.moveRepo(repo, { name, redirect: false });
		},
		/** Renames `repo` and/or transfers it to `owner` (an organization is created on the fly). A transfer takes it out
		 *  of every installation that selected it (`installation`: selected there instead). The old `owner/name` answers
		 *  301 to the new one (`redirect`, default, as GitHub does) or 404. */
		moveRepo(repo: Repo | string, to: { name?: string; owner?: string; installation?: number; redirect?: boolean }) {
			const r = resolve(repo);
			movedFrom.set(`${r.owner.login}/${r.name}`.toLowerCase(), { id: r.id, redirect: to.redirect ?? true });
			if (to.name) r.name = to.name;
			if (to.owner && to.owner !== r.owner.login) {
				let owner = accounts.get(to.owner);
				if (!owner) {
					owner = { id: nextId++, login: to.owner, type: 'Organization', name: to.owner, email: null };
					accounts.set(to.owner, owner);
				}
				r.owner = owner;
				for (const i of installations.values()) i.repos.delete(r.id);
			}
			if (to.installation !== undefined) installations.get(to.installation)?.repos.add(r.id);
			movedFrom.delete(`${r.owner.login}/${r.name}`.toLowerCase()); // moved back
			return r;
		},
		/** Branch protection on `branch` (`on` false lifts it): ref updates answer 422 "Protected branch update failed". */
		protect(repo: Repo | string, branch: string, on = true) {
			const key = `${resolve(repo).id}:${branch}`;
			if (on) protectedBranches.add(key);
			else protectedBranches.delete(key);
		},

		/** A user-to-server token for `login` without the OAuth dance. */
		userToken(login: string) {
			const t = token('ghu');
			userTokens.set(t, { login, expiresAt: Date.now() + fake.accessTtl * 1000 });
			return t;
		},
		/** Revokes every token of `login` (the user removed the App's authorization). */
		revoke(login: string) {
			for (const map of [userTokens, refreshTokens]) for (const [t, v] of map) if (v.login === login) map.delete(t);
		},
		setPush(login: string, repo: Repo | string, push: boolean) {
			const key = `${login}:${resolve(repo).id}`;
			if (push) noPush.delete(key);
			else noPush.add(key);
		},
		/** The next `times` API requests answer `status`. */
		failNext(status: number, times = 1) {
			for (let i = 0; i < times; i++) failures.push(status);
		},
		/** Drops the failures `failNext` queued and no request took yet. */
		clearFailures() {
			failures.length = 0;
		},

		async start(port = 0) {
			const server = createServer((req, res) => void serve(req, res));
			await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
			url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			const stop = async () => {
				server.closeAllConnections();
				await new Promise((r) => server.close(r));
			};
			return { url, stop };
		}
	};

	// --- objects ------------------------------------------------------------------------------------------------------

	function resolve(repo: Repo | string) {
		if (typeof repo !== 'string') return repo;
		const r = [...repos.values()].find((r) => `${r.owner.login}/${r.name}`.toLowerCase() === repo.toLowerCase());
		if (!r) throw new Error(`fake GitHub: no repository ${repo}`);
		return r;
	}

	function get<T extends Obj['type']>(r: Repo, sha: string, type: T) {
		const obj = r.objects.get(sha);
		return obj?.type === type ? (obj as Extract<Obj, { type: T }>) : undefined;
	}

	function put(r: Repo, type: 'blob', data: Buffer): string;
	function put(r: Repo, type: 'tree', entries: Entry[]): string;
	function put(r: Repo, type: 'blob' | 'tree', value: Buffer | Entry[]) {
		if (type === 'blob') {
			const sha = gitHash('blob', value as Buffer);
			r.objects.set(sha, { type, data: value as Buffer });
			return sha;
		}
		const entries = sortEntries([...(value as Entry[])]);
		const body = Buffer.concat(entries.flatMap((e) => [Buffer.from(`${e.mode === '040000' ? '40000' : e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')]));
		const sha = gitHash('tree', body);
		r.objects.set(sha, { type, entries });
		return sha;
	}

	function writeCommit(r: Repo, c: Commit) {
		const sig = (p: Person) => `${p.name} <${p.email}> ${Math.floor(Date.parse(p.date) / 1000)} +0000`;
		const lines = [`tree ${c.tree}`, ...c.parents.map((p) => `parent ${p}`), `author ${sig(c.author)}`, `committer ${sig(c.committer)}`];
		const sha = gitHash('commit', Buffer.from(`${lines.join('\n')}\n\n${c.message}`));
		r.objects.set(sha, { type: 'commit', commit: c });
		return sha;
	}

	/** Every entry under tree `sha` with its full path, trees before their contents (`recursive=1`). */
	function walk(r: Repo, sha: string, prefix = ''): (Entry & { path: string })[] {
		return get(r, sha, 'tree')!.entries.flatMap((e) => {
			const path = prefix + e.name;
			return [{ ...e, path }, ...(e.type === 'tree' ? walk(r, e.sha, `${path}/`) : [])];
		});
	}

	type Item = Entry | { name: string; dir: Map<string, Item> };
	type Change = { path: string; mode: string; type: string; sha: string | null };

	/** `POST git/trees` semantics: start from `base` (or empty), apply nested-path changes (sha null deletes), drop
	 *  folders left empty. Throws a message for 422. */
	function buildTree(r: Repo, base: string | null, changes: Change[]) {
		const load = (sha: string) => new Map<string, Item>(get(r, sha, 'tree')!.entries.map((e) => [e.name, e]));
		const root = base ? load(base) : new Map<string, Item>();
		// the folder at `names`, expanding stored subtrees on the way; undefined when missing and not `create`
		const descend = (dir: Map<string, Item>, names: string[], create: boolean): Map<string, Item> | undefined => {
			if (!names.length) return dir;
			const [name, ...rest] = names;
			const found = dir.get(name);
			const sub = found && 'dir' in found ? found.dir : found?.type === 'tree' ? load(found.sha) : create ? new Map<string, Item>() : undefined;
			if (!sub) return undefined;
			dir.set(name, { name, dir: sub });
			return descend(sub, rest, create);
		};
		for (const c of changes) {
			const parts = c.path.split('/');
			if (!c.path || parts.some((p) => !p || p === '.' || p === '..')) throw new Error(`tree.path ${c.path} is invalid`);
			if (parts.some((p) => /^\.git$/i.test(p))) throw new Error('tree.path contains a malformed path component');
			if (c.sha !== null && !r.objects.has(c.sha) && c.type !== 'commit') throw new Error(`tree.sha ${c.sha} is not a valid ${c.type}`);
			const dir = descend(root, parts.slice(0, -1), c.sha !== null);
			const name = parts.at(-1)!;
			if (c.sha === null) dir?.delete(name);
			else dir!.set(name, { name, mode: c.mode, type: c.type as Entry['type'], sha: c.sha });
		}
		const save = (dir: Map<string, Item>): string | null => {
			const entries: Entry[] = [];
			for (const item of dir.values()) {
				if (!('dir' in item)) entries.push(item);
				else {
					const sha = save(item.dir);
					if (sha) entries.push({ name: item.name, mode: '040000', type: 'tree', sha });
				}
			}
			return entries.length || dir === root ? put(r, 'tree', entries) : null;
		};
		return save(root)!;
	}

	function ancestors(r: Repo, sha: string) {
		const seen: string[] = [];
		const set = new Set<string>();
		const queue = [sha];
		while (queue.length) {
			const s = queue.shift()!;
			if (set.has(s)) continue;
			set.add(s);
			seen.push(s);
			queue.push(...(get(r, s, 'commit')?.commit.parents ?? []));
		}
		return seen; // breadth-first from `sha`
	}

	// --- JSON shapes --------------------------------------------------------------------------------------------------

	const api = (r: Repo) => `${url}/repos/${r.owner.login}/${r.name}`;
	const accountJson = (a: Account) => ({
		login: a.login,
		id: a.id,
		type: a.type,
		avatar_url: `${url}/avatars/${a.login}`,
		html_url: `${url}/${a.login}`
	});
	function repoJson(r: Repo, auth: Auth) {
		const json: Record<string, unknown> = {
			id: r.id,
			node_id: `R_${r.id}`,
			name: r.name,
			full_name: `${r.owner.login}/${r.name}`,
			owner: accountJson(r.owner),
			private: r.private,
			visibility: r.private ? 'private' : 'public',
			html_url: `${url}/${r.owner.login}/${r.name}`,
			url: api(r),
			default_branch: r.defaultBranch
		};
		if (auth?.kind === 'user') {
			const push = !noPush.has(`${auth.login}:${r.id}`);
			json.permissions = { admin: false, maintain: false, push, triage: push, pull: true };
		}
		return json;
	}
	const refJson = (r: Repo, branch: string) => ({
		ref: `refs/heads/${branch}`,
		node_id: `REF_${branch}`,
		url: `${api(r)}/git/refs/heads/${branch}`,
		object: { sha: r.refs.get(branch)!, type: 'commit', url: `${api(r)}/git/commits/${r.refs.get(branch)}` }
	});
	const gitCommitJson = (r: Repo, sha: string) => {
		const c = get(r, sha, 'commit')!.commit;
		return {
			sha,
			node_id: `C_${sha}`,
			url: `${api(r)}/git/commits/${sha}`,
			html_url: `${url}/${r.owner.login}/${r.name}/commit/${sha}`,
			author: c.author,
			committer: c.committer,
			tree: { sha: c.tree, url: `${api(r)}/git/trees/${c.tree}` },
			message: c.message,
			parents: c.parents.map((p) => ({ sha: p, url: `${api(r)}/git/commits/${p}`, html_url: `${url}/${r.owner.login}/${r.name}/commit/${p}` })),
			verification: { verified: false, reason: 'unsigned', signature: null, payload: null }
		};
	};
	const userByEmail = (email: string) => [...accounts.values()].find((a) => a.type === 'User' && a.email === email);
	const commitJson = (r: Repo, sha: string) => {
		const git = gitCommitJson(r, sha);
		const author = userByEmail(git.author.email);
		const committer = userByEmail(git.committer.email);
		return {
			sha,
			node_id: git.node_id,
			url: `${api(r)}/commits/${sha}`,
			html_url: git.html_url,
			commit: { author: git.author, committer: git.committer, message: git.message, tree: git.tree, url: git.url },
			author: author ? accountJson(author) : null,
			committer: committer ? accountJson(committer) : null,
			parents: git.parents
		};
	};

	// --- access -------------------------------------------------------------------------------------------------------

	const covers = (i: Installation, r: Repo) => (i.all ? i.account.id === r.owner.id : i.repos.has(r.id));
	function canRead(auth: Auth, r: Repo) {
		if (auth?.kind === 'installation') return covers(installations.get(auth.id)!, r);
		if (auth?.kind === 'user') return [...installations.values()].some((i) => i.users.has(auth.login) && covers(i, r));
		return false;
	}
	const canWrite = (auth: Auth, r: Repo) => canRead(auth, r) && !(auth?.kind === 'user' && noPush.has(`${auth.login}:${r.id}`));

	function authenticate(header: string | undefined): Auth | 'app' | 'bad' {
		if (!header) return null;
		const [scheme, value] = header.split(/\s+/, 2);
		if (!/^(token|bearer)$/i.test(scheme) || !value) return 'bad';
		const now = Date.now();
		const user = userTokens.get(value);
		if (user) return user.expiresAt > now ? { kind: 'user', login: user.login } : 'bad';
		const inst = installationTokens.get(value);
		if (inst) return inst.expiresAt > now ? { kind: 'installation', id: inst.id } : 'bad';
		// an App JWT: three base64url parts, signature not checked
		if (/^bearer$/i.test(scheme) && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return 'app';
		return 'bad';
	}

	// --- routes -------------------------------------------------------------------------------------------------------

	function oauthTokens(login: string) {
		const access = fake.userToken(login);
		const refresh = token('ghr');
		refreshTokens.set(refresh, { login, expiresAt: Date.now() + fake.refreshTtl * 1000 });
		return { access_token: access, expires_in: fake.accessTtl, refresh_token: refresh, refresh_token_expires_in: fake.refreshTtl, scope: '', token_type: 'bearer' };
	}
	const oauthError = (error: string, description: string): Reply => ({
		status: 200,
		body: { error, error_description: description, error_uri: 'https://docs.github.com/apps/oauth' }
	});

	async function route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>, header: string | undefined): Promise<Reply> {
		let m: RegExpMatchArray | null;

		// web: OAuth (GitHub answers errors with 200 and an `error` field)
		if (method === 'GET' && path === '/login/oauth/authorize') {
			if (query.get('client_id') !== clientId) return fail(404, 'Not Found');
			const redirect = query.get('redirect_uri') ?? fake.callbackUrl;
			if (!redirect || !fake.authorizeAs) return fail(400, 'redirect_uri missing or no user to approve');
			const code = token('code');
			codes.set(code, fake.authorizeAs);
			const to = new URL(redirect);
			to.searchParams.set('code', code);
			if (query.get('state') !== null) to.searchParams.set('state', query.get('state')!);
			return { status: 302, location: to.href };
		}
		if (method === 'POST' && path === '/login/oauth/access_token') {
			if (body.client_id !== clientId || body.client_secret !== clientSecret)
				return oauthError('incorrect_client_credentials', 'The client_id and/or client_secret passed are incorrect.');
			if (body.grant_type === 'refresh_token') {
				const rt = refreshTokens.get(String(body.refresh_token));
				refreshTokens.delete(String(body.refresh_token)); // GitHub rotates refresh tokens
				if (!rt || rt.expiresAt <= Date.now()) return oauthError('bad_refresh_token', 'The refresh token passed is incorrect or expired.');
				return { status: 200, body: oauthTokens(rt.login) };
			}
			const login = codes.get(String(body.code));
			codes.delete(String(body.code));
			if (!login) return oauthError('bad_verification_code', 'The code passed is incorrect or expired.');
			return { status: 200, body: oauthTokens(login) };
		}
		if (method === 'GET' && path === '/') return { status: 200, body: { current_user_url: `${url}/user` } };

		// API
		const auth = authenticate(header);
		if (auth === 'bad') return fail(401, 'Bad credentials');

		if (method === 'POST' && (m = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/))) {
			if (auth !== 'app') return fail(401, 'A JSON web token could not be decoded');
			const inst = installations.get(Number(m[1]));
			if (!inst) return notFound();
			const t = token('ghs');
			const expiresAt = Date.now() + 3600_000;
			installationTokens.set(t, { id: inst.id, expiresAt });
			return {
				status: 201,
				body: {
					token: t,
					expires_at: isoSeconds(expiresAt),
					permissions: { contents: 'write', metadata: 'read' },
					repository_selection: inst.all ? 'all' : 'selected'
				}
			};
		}
		if (auth === 'app' || auth === null) return fail(401, 'Requires authentication');

		if (path === '/user' || path.startsWith('/user/')) {
			if (auth.kind !== 'user') return fail(403, 'Resource not accessible by integration');
			const me = accounts.get(auth.login)!;
			if (method === 'GET' && path === '/user') return { status: 200, body: { ...accountJson(me), name: me.name, email: me.email } };
			const mine = [...installations.values()].filter((i) => i.users.has(auth.login));
			if (method === 'GET' && path === '/user/installations')
				return {
					status: 200,
					body: {
						total_count: mine.length,
						installations: mine.map((i) => ({
							id: i.id,
							account: accountJson(i.account),
							app_slug: 'overtree-test',
							target_type: i.account.type,
							repository_selection: i.all ? 'all' : 'selected',
							permissions: { contents: 'write', metadata: 'read' }
						}))
					}
				};
			if (method === 'GET' && (m = path.match(/^\/user\/installations\/(\d+)\/repositories$/))) {
				const inst = mine.find((i) => i.id === Number(m![1]));
				if (!inst) return notFound();
				const list = [...repos.values()].filter((r) => covers(inst, r));
				return {
					status: 200,
					body: { total_count: list.length, repository_selection: inst.all ? 'all' : 'selected', repositories: list.map((r) => repoJson(r, auth)) }
				};
			}
			return notFound();
		}

		if (method === 'GET' && (m = path.match(/^\/repositories\/(\d+)$/))) {
			const r = repos.get(Number(m[1]));
			return r && canRead(auth, r) ? { status: 200, body: repoJson(r, auth) } : notFound();
		}

		if (!(m = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/))) return notFound();
		const r = [...repos.values()].find((r) => r.owner.login.toLowerCase() === m![1].toLowerCase() && r.name.toLowerCase() === m![2].toLowerCase());
		const rest = m[3] ?? '';
		if (!r) {
			const moved = movedFrom.get(`${m[1]}/${m[2]}`.toLowerCase());
			const to = moved?.redirect ? repos.get(moved.id) : undefined;
			if (!to || !canRead(auth, to)) return notFound();
			const location = `${api(to)}${rest}${query.size ? `?${query}` : ''}`;
			return { status: 301, location, body: { message: 'Moved Permanently', url: location, documentation_url: 'https://docs.github.com/rest' } };
		}
		if (!canRead(auth, r)) return notFound();
		const write = method !== 'GET';
		if (write && !canWrite(auth, r)) return fail(403, 'Resource not accessible by integration');
		const empty = r.refs.size === 0;
		const isEmpty = () => fail(409, 'Git Repository is empty.');

		if (method === 'GET' && rest === '') return { status: 200, body: repoJson(r, auth) };
		if (method === 'GET' && rest === '/branches') {
			const perPage = Math.min(Number(query.get('per_page') ?? 30), 100);
			const branches = [...r.refs.keys()].sort().slice(0, perPage);
			return {
				status: 200,
				body: branches.map((name) => ({ name, commit: { sha: r.refs.get(name), url: `${api(r)}/commits/${r.refs.get(name)}` }, protected: false }))
			};
		}

		// refs: `git/ref/heads/b` (single) and the older `git/refs/heads/b` (single on exact match, else prefix list)
		if ((m = rest.match(/^\/git\/(ref|refs)\/heads\/(.+)$/))) {
			const branch = decodeURIComponent(m[2]);
			if (method === 'GET') {
				if (empty) return isEmpty();
				if (r.refs.has(branch)) return { status: 200, body: refJson(r, branch) };
				const prefixed = m[1] === 'refs' ? [...r.refs.keys()].filter((b) => b.startsWith(branch)).sort() : [];
				return prefixed.length ? { status: 200, body: prefixed.map((b) => refJson(r, b)) } : notFound();
			}
			if (method === 'PATCH' && m[1] === 'refs') {
				const current = r.refs.get(branch);
				if (!current) return fail(422, 'Reference does not exist');
				if (protectedBranches.has(`${r.id}:${branch}`)) return fail(422, `Protected branch update failed for refs/heads/${branch}.`);
				const sha = String(body.sha ?? '');
				if (!get(r, sha, 'commit')) return fail(422, 'Object does not exist');
				if (!body.force && !ancestors(r, sha).includes(current)) return fail(422, 'Update is not a fast forward');
				r.refs.set(branch, sha);
				return { status: 200, body: refJson(r, branch) };
			}
			if (method === 'DELETE' && m[1] === 'refs') {
				if (!r.refs.delete(branch)) return fail(422, 'Reference does not exist');
				return { status: 204 };
			}
		}
		if (method === 'POST' && rest === '/git/refs') {
			const ref = String(body.ref ?? '');
			if (!/^refs\/[^/]+\/.+/.test(ref)) return fail(422, "ref must start with 'refs' and have at least two slashes.");
			if (!ref.startsWith('refs/heads/')) return fail(422, 'fake GitHub: only branches are supported');
			const branch = ref.slice('refs/heads/'.length);
			if (r.refs.has(branch)) return fail(422, 'Reference already exists');
			if (!get(r, String(body.sha ?? ''), 'commit')) return fail(422, 'Object does not exist');
			r.refs.set(branch, String(body.sha));
			return { status: 201, body: refJson(r, branch) };
		}

		// Contents API, create only (the first file of an empty repository, 012 T024): one commit on `branch` (default
		// branch when absent); on an empty repository it creates the branch
		if (method === 'PUT' && (m = rest.match(/^\/contents\/(.+)$/))) {
			const path = m[1].split('/').map(decodeURIComponent).join('/');
			if (typeof body.message !== 'string') return fail(422, 'Invalid request.\n\n"message" wasn\'t supplied.');
			if (typeof body.content !== 'string') return fail(422, 'Invalid request.\n\n"content" wasn\'t supplied.');
			const branch = typeof body.branch === 'string' ? body.branch : r.defaultBranch;
			const head = r.refs.get(branch);
			if (!head && !empty) return fail(404, `Branch ${branch} not found`);
			if (head && fake.files(r, head).has(path) && typeof body.sha !== 'string') return fail(422, 'Invalid request.\n\n"sha" wasn\'t supplied.');
			const bot = { name: 'overtree-test[bot]', email: 'overtree-test[bot]@users.noreply.github.test' };
			let sha: string;
			try {
				sha = fake.commitFiles(r, branch, { [path]: Buffer.from(body.content, 'base64') }, bot, body.message);
			} catch (e) {
				return fail(422, (e as Error).message);
			}
			const blob = walk(r, get(r, sha, 'commit')!.commit.tree).find((e) => e.path === path)!;
			const size = get(r, blob.sha, 'blob')!.data.length;
			return {
				status: 201,
				body: { content: { name: path.split('/').at(-1), path, sha: blob.sha, size, type: 'file' }, commit: gitCommitJson(r, sha) }
			};
		}

		// git data; GitHub refuses all of it on a repository without commits
		if (rest.startsWith('/git/') && empty) return isEmpty();
		if (method === 'POST' && rest === '/git/blobs') {
			if (typeof body.content !== 'string') return fail(422, 'Invalid request.\n\n"content" wasn\'t supplied.');
			const data = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8');
			const sha = put(r, 'blob', data);
			return { status: 201, body: { sha, url: `${api(r)}/git/blobs/${sha}` } };
		}
		if (method === 'GET' && (m = rest.match(/^\/git\/blobs\/([0-9a-f]{40})$/))) {
			const blob = get(r, m[1], 'blob');
			if (!blob) return notFound();
			const b64 = blob.data.toString('base64').replace(/.{60}/g, '$&\n');
			return {
				status: 200,
				body: { sha: m[1], node_id: `B_${m[1]}`, size: blob.data.length, url: `${api(r)}/git/blobs/${m[1]}`, content: b64, encoding: 'base64' }
			};
		}
		if (method === 'POST' && rest === '/git/trees') {
			if (!Array.isArray(body.tree)) return fail(422, 'Invalid tree info');
			const base = body.base_tree === undefined || body.base_tree === null ? null : String(body.base_tree);
			if (base && !get(r, base, 'tree')) return fail(422, `base_tree ${base} is not a valid tree oid`);
			try {
				const changes = (body.tree as Record<string, unknown>[]).map((e) => {
					const type = String(e.type ?? 'blob');
					const sha = typeof e.content === 'string' ? put(r, 'blob', Buffer.from(e.content)) : e.sha === null ? null : String(e.sha);
					return { path: String(e.path ?? ''), mode: String(e.mode ?? '100644'), type, sha };
				});
				const sha = buildTree(r, base, changes);
				const entries = get(r, sha, 'tree')!.entries;
				return { status: 201, body: { sha, url: `${api(r)}/git/trees/${sha}`, tree: entries.map((e) => treeEntryJson(r, e, e.name)), truncated: false } };
			} catch (e) {
				return fail(422, (e as Error).message);
			}
		}
		if (method === 'GET' && (m = rest.match(/^\/git\/trees\/(.+)$/))) {
			// tree-ish: a tree sha, a commit sha or a branch name
			const ish = decodeURIComponent(m[1]);
			const commit = get(r, r.refs.get(ish) ?? ish, 'commit');
			const sha = commit ? commit.commit.tree : ish;
			if (!get(r, sha, 'tree')) return notFound();
			const entries = query.get('recursive') ? walk(r, sha) : get(r, sha, 'tree')!.entries.map((e) => ({ ...e, path: e.name }));
			return { status: 200, body: { sha, url: `${api(r)}/git/trees/${sha}`, tree: entries.map((e) => treeEntryJson(r, e, e.path)), truncated: false } };
		}
		if (method === 'POST' && rest === '/git/commits') {
			const tree = String(body.tree ?? '');
			const parents = Array.isArray(body.parents) ? body.parents.map(String) : [];
			if (!get(r, tree, 'tree')) return fail(422, 'Tree SHA does not exist');
			if (parents.some((p) => !get(r, p, 'commit'))) return fail(422, 'Parent SHA does not exist or is not a commit object');
			if (typeof body.message !== 'string') return fail(422, 'Invalid request.\n\n"message" wasn\'t supplied.');
			const me = auth.kind === 'user' ? accounts.get(auth.login)! : null;
			const fallback = { name: me?.name ?? 'overtree-test[bot]', email: me?.email ?? 'overtree-test[bot]@users.noreply.github.test' };
			const person = (p: unknown): Person => {
				const x = (p ?? {}) as Partial<Person>;
				return { name: x.name ?? fallback.name, email: x.email ?? fallback.email, date: isoSeconds(x.date ? Date.parse(x.date) : Date.now()) };
			};
			const author = person(body.author);
			const sha = writeCommit(r, { tree, parents, author, committer: body.committer ? person(body.committer) : author, message: body.message });
			return { status: 201, body: gitCommitJson(r, sha) };
		}
		if (method === 'GET' && (m = rest.match(/^\/git\/commits\/([0-9a-f]{40})$/)))
			return get(r, m[1], 'commit') ? { status: 200, body: gitCommitJson(r, m[1]) } : notFound();

		if (method === 'GET' && (m = rest.match(/^\/compare\/(.+)\.\.\.(.+)$/))) {
			if (empty) return notFound();
			const [base, head] = [m[1], m[2]].map((x) => decodeURIComponent(x)).map((x) => r.refs.get(x) ?? x);
			if (!get(r, base, 'commit') || !get(r, head, 'commit')) return notFound();
			const fromBase = ancestors(r, base);
			const fromHead = ancestors(r, head);
			const mergeBase = fromHead.find((s) => fromBase.includes(s));
			if (!mergeBase) return fail(404, 'No common ancestor between base and head');
			const ahead = fromHead.filter((s) => !fromBase.includes(s));
			const behind = fromBase.filter((s) => !fromHead.includes(s));
			// oldest first, like GitHub
			const date = (sha: string) => Date.parse(get(r, sha, 'commit')!.commit.committer.date);
			const commits = [...ahead].sort((a, b) => date(a) - date(b) || ahead.indexOf(b) - ahead.indexOf(a));
			const flat = (sha: string) => new Map(walk(r, get(r, sha, 'commit')!.commit.tree).filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
			const before = flat(mergeBase);
			const after = flat(head);
			const files = [...new Set([...before.keys(), ...after.keys()])]
				.sort()
				.filter((p) => before.get(p) !== after.get(p))
				.map((filename) => ({
					sha: after.get(filename) ?? before.get(filename),
					filename,
					status: !before.has(filename) ? 'added' : !after.has(filename) ? 'removed' : 'modified'
				}));
			const status = !ahead.length && !behind.length ? 'identical' : !behind.length ? 'ahead' : !ahead.length ? 'behind' : 'diverged';
			return {
				status: 200,
				body: {
					url: `${api(r)}/compare/${m[1]}...${m[2]}`,
					html_url: `${url}/${r.owner.login}/${r.name}/compare/${m[1]}...${m[2]}`,
					base_commit: commitJson(r, base),
					merge_base_commit: commitJson(r, mergeBase),
					status,
					ahead_by: ahead.length,
					behind_by: behind.length,
					total_commits: ahead.length,
					commits: commits.slice(0, 250).map((s) => commitJson(r, s)),
					files
				}
			};
		}
		return notFound();
	}

	function treeEntryJson(r: Repo, e: Entry, path: string) {
		const blob = e.type === 'blob' ? get(r, e.sha, 'blob') : undefined;
		const kind = e.type === 'tree' ? 'trees' : 'blobs';
		return { path, mode: e.mode, type: e.type, sha: e.sha, ...(blob ? { size: blob.data.length } : {}), url: `${api(r)}/git/${kind}/${e.sha}` };
	}

	// --- HTTP ---------------------------------------------------------------------------------------------------------

	// Test-only control endpoint for other processes (Playwright): POST /_fake/<helper> with { args: [...] }.
	const remote = ['addUser', 'addInstallation', 'addRepo', 'commitFiles', 'revoke', 'setPush', 'failNext', 'clearFailures', 'renameRepo', 'moveRepo', 'protect', 'head', 'commit', 'deleteBranch'] as const;

	async function serve(req: IncomingMessage, res: ServerResponse) {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const raw = Buffer.concat(chunks).toString('utf8');
		const { pathname, searchParams } = new URL(req.url ?? '/', 'http://fake');
		const method = req.method ?? 'GET';
		let body: Record<string, unknown> = {};
		if (raw) {
			try {
				body = (req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
			} catch {
				return send(res, fail(400, 'Problems parsing JSON'));
			}
		}

		const helper = pathname.match(/^\/_fake\/(\w+)$/)?.[1] as (typeof remote)[number] | undefined;
		if (method === 'POST' && helper && remote.includes(helper)) {
			try {
				const result = (fake[helper] as (...args: unknown[]) => unknown)(...((body.args as unknown[]) ?? []));
				// objects (accounts, installations, repos) answer their id
				const json = result && typeof result === 'object' && 'id' in result ? { id: result.id } : (result ?? null);
				return send(res, { status: 200, body: json });
			} catch (e) {
				return send(res, fail(400, (e as Error).message));
			}
		}

		const auth = authenticate(req.headers.authorization);
		requests.push({
			method,
			path: pathname,
			auth: auth === 'bad' || auth === null ? null : auth === 'app' ? 'app' : auth.kind,
			...(raw && method !== 'GET' ? { body } : {})
		});
		const failure = failures.shift();
		if (failure !== undefined) return send(res, fail(failure, `fake failure ${failure}`));
		send(res, await route(method, pathname, searchParams, body, req.headers.authorization));
	}

	function send(res: ServerResponse, reply: Reply) {
		if (reply.location) res.setHeader('location', reply.location);
		if (reply.body === undefined) return res.writeHead(reply.status).end();
		res.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(reply.body));
	}

	return fake;
}

export type FakeGitHub = ReturnType<typeof fakeGitHub>;
