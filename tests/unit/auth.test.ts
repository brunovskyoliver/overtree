import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { authConfigProblem, authenticateRequest, authenticateToken, mirrorUser, NotAllowed, testAuth } from '../../src/lib/server/auth.ts';
import { inviteMember, joinByLink } from '../../src/lib/server/projects.ts';
import { historyLog, invites, memberships, projects, settings, users, versionLabels, versions } from '../../src/lib/server/schema.ts';
import { handle } from '../../src/hooks.server.ts';
import { OWNER, project, start, user } from './helpers.ts';

// Sign-in (005 US1, research R2–R5): the test bypass, the user mirror with the sign-up policy, hooks.server.ts and
// joining through a share link.

const KEYS = ['NODE_ENV', 'OVERTREE_TEST_AUTH', 'PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'ADMIN_EMAILS'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

const identity = (email: string, name?: string) => ({ id: `id_${email}`, email, name });
const request = (path: string, email?: string) =>
	new Request(`http://127.0.0.1${path}`, email ? { headers: { cookie: `overtree-test-user=${encodeURIComponent(email)}` } } : {});

describe('test bypass', () => {
	it('is refused with NODE_ENV=production', async () => {
		await start();
		expect(testAuth()).toBe(true);
		expect(await authenticateToken(`test:${OWNER}`)).toMatchObject({ email: OWNER });

		process.env.NODE_ENV = 'production';
		expect(testAuth()).toBe(false);
		expect(await authenticateToken(`test:${OWNER}`)).toBeNull();
		expect(authConfigProblem()).toMatch(/OVERTREE_TEST_AUTH=1 is refused/);
	});

	it('without test auth both Clerk keys are required', () => {
		delete process.env.OVERTREE_TEST_AUTH;
		delete process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
		delete process.env.CLERK_SECRET_KEY;
		expect(authConfigProblem()).toMatch(/CLERK_SECRET_KEY must be set/);
		process.env.PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';
		process.env.CLERK_SECRET_KEY = 'sk_test_x';
		expect(authConfigProblem()).toBeNull();
	});

	it('a request without the cookie is signed out; with it, the user is mirrored', async () => {
		await start();
		expect(await authenticateRequest(request('/'))).toBeNull();
		expect(await authenticateRequest(request('/', 'Someone@Test.local'))).toMatchObject({ user: { id: 'test_someone@test.local', email: 'someone@test.local' } });
		expect(await authenticateToken('')).toBeNull();
	});
});

describe('mirrorUser', () => {
	it('a new account with a known email is refused, unless it adopts the old one, which moves with everything it had', async () => {
		const { db } = await start();
		const old = user(OWNER);
		const b = user('b@test.local');
		const pid = project();
		inviteMember(pid, b.email, 'reader');
		const now = Date.now();
		const log = db.insert(historyLog).values({ projectId: pid, docName: null, userId: old.id, kind: 'tree', createdAt: now }).returning().get();
		const v = db
			.insert(versions)
			.values({ projectId: pid, kind: 'edit', watermark: 0, manifestHash: 'x', authors: JSON.stringify([b.id, old.id]), changed: '[]', startedAt: now, createdAt: now })
			.returning()
			.get();
		db.insert(versionLabels).values({ projectId: pid, versionId: v.id, name: 'draft', userId: old.id, createdAt: now }).run();

		expect(() => mirrorUser({ id: 'user_new', email: OWNER })).toThrow(NotAllowed);
		expect(() => mirrorUser({ id: 'user_new', email: OWNER }, b.id)).toThrow(NotAllowed); // adopt must match the email
		const moved = mirrorUser({ id: 'user_new', email: OWNER, name: 'New Name' }, old.id);
		expect(moved).toMatchObject({ id: 'user_new', email: OWNER, role: 'admin', name: 'New Name', createdAt: old.createdAt });
		expect(db.select().from(users).where(eq(users.id, old.id)).get()).toBeUndefined();
		expect(db.select().from(projects).where(eq(projects.id, pid)).get()!.ownerId).toBe('user_new');
		expect(db.select().from(historyLog).where(eq(historyLog.id, log.id)).get()!.userId).toBe('user_new');
		expect(JSON.parse(db.select().from(versions).where(eq(versions.id, v.id)).get()!.authors)).toEqual([b.id, 'user_new']);
		expect(db.select().from(versionLabels).get()!.userId).toBe('user_new');

		const movedB = mirrorUser({ id: 'user_b', email: b.email }, b.id);
		expect(movedB.role).toBe('user');
		expect(db.select().from(memberships).where(eq(memberships.projectId, pid)).all().map((m) => [m.userId, m.role])).toEqual([['user_b', 'reader']]);
	});

	it('creates the user, name falling back to the email local part; the first user is admin', async () => {
		await start();
		const a = mirrorUser(identity('first@test.local'));
		expect(a).toMatchObject({ email: 'first@test.local', name: 'first', role: 'admin', disabled: false, avatarUrl: null });
		const b = mirrorUser({ ...identity('second@test.local', '  Bo Second '), avatarUrl: 'https://img/x.png' });
		expect(b).toMatchObject({ name: 'Bo Second', role: 'user', avatarUrl: 'https://img/x.png' });
	});

	it('ADMIN_EMAILS are admins', async () => {
		await start();
		user(OWNER);
		process.env.ADMIN_EMAILS = 'boss@elsewhere.org, other@x.org';
		// not on the allowlist either: the seeded admin email gets in anyway
		expect(mirrorUser(identity('Boss@Elsewhere.org')).role).toBe('admin');
		expect(user('plain@test.local').role).toBe('user');
	});

	it('refreshes the profile at most every 10 minutes', async () => {
		const server = await start();
		const id = user(OWNER).id;
		server.db.update(users).set({ name: 'Stale' }).where(eq(users.id, id)).run();
		expect((await authenticateToken(`test:${OWNER}`))!.name).toBe('Stale');
		server.db
			.update(users)
			.set({ syncedAt: Date.now() - 11 * 60 * 1000 })
			.where(eq(users.id, id))
			.run();
		expect((await authenticateToken(`test:${OWNER}`))!.name).toBe('owner');
	});

	it('invite-only: refuses unknown emails, allows allowlisted emails, domains and invited emails', async () => {
		const server = await start();
		user(OWNER); // the first user is let in regardless
		expect(() => mirrorUser(identity('x@example.org'))).toThrow(NotAllowed);
		expect(server.db.select().from(users).where(eq(users.email, 'x@example.org')).get()).toBeUndefined();

		server.db.update(settings).set({ allowlist: JSON.stringify(['@test.local', 'one@example.org', '@example.net']) }).run();
		expect(mirrorUser(identity('one@example.org')).role).toBe('user');
		expect(mirrorUser(identity('any@example.net')).role).toBe('user');
		expect(() => mirrorUser(identity('two@example.org'))).toThrow(NotAllowed);

		const pid = project();
		server.db.insert(invites).values({ projectId: pid, email: 'two@example.org', role: 'reader', createdAt: Date.now() }).run();
		const two = mirrorUser(identity('Two@Example.org'));
		const m = server.db.select().from(memberships).where(and(eq(memberships.projectId, pid), eq(memberships.userId, two.id))).get();
		expect(m).toMatchObject({ role: 'reader', viaLink: false });
		expect(server.db.select().from(invites).all()).toEqual([]);

		// open sign-up lets anyone in; a signed-out request of a refused email reports it
		expect(await authenticateRequest(request('/', 'nope@example.com'))).toEqual({ refused: 'not-allowed' });
		server.db.update(settings).set({ signupMode: 'open' }).run();
		expect(mirrorUser(identity('three@example.com')).role).toBe('user');
	});

	it('pending invites become memberships, keeping a higher existing role', async () => {
		const server = await start();
		const pid = project();
		const b = user('b@test.local');
		server.db.insert(memberships).values({ projectId: pid, userId: b.id, role: 'editor', viaLink: false, createdAt: Date.now() }).run();
		server.db.insert(invites).values({ projectId: pid, email: 'b@test.local', role: 'reader', createdAt: Date.now() }).run();
		server.db
			.update(users)
			.set({ syncedAt: 0 })
			.where(eq(users.id, b.id))
			.run();
		await authenticateToken('test:b@test.local');
		expect(server.db.select().from(memberships).where(eq(memberships.userId, b.id)).get()!.role).toBe('editor');
		expect(server.db.select().from(invites).all()).toEqual([]);
	});
});

describe('hooks.server.ts', () => {
	/** Run `handle` for `path`; the response, or the thrown redirect. */
	async function hit(path: string, email?: string) {
		const event = { url: new URL(`http://127.0.0.1${path}`), request: request(path, email), locals: {} as App.Locals };
		try {
			const res = await handle({ event, resolve: async () => new Response('page') } as unknown as Parameters<typeof handle>[0]);
			return { status: res.status, location: res.headers.get('location'), body: await res.text(), locals: event.locals };
		} catch (e) {
			const r = e as { status: number; location: string };
			return { status: r.status, location: r.location, body: '', locals: event.locals };
		}
	}

	it('signed out: pages redirect to sign-in with the path, the API answers 401, public pages render', async () => {
		await start();
		expect(await hit('/project/abc?x=1')).toMatchObject({ status: 303, location: `/sign-in?redirect=${encodeURIComponent('/project/abc?x=1')}` });
		expect(await hit('/')).toMatchObject({ status: 303, location: '/sign-in?redirect=%2F' });
		expect(await hit('/api/projects')).toMatchObject({ status: 401 });
		expect(await hit('/api/projects/abc/files')).toMatchObject({ status: 401 });
		expect(await hit('/share/x')).toMatchObject({ status: 200, body: 'page' });
		expect(await hit('/sign-in')).toMatchObject({ status: 200 });
	});

	it('signed in: locals.user is set; disabled and not-allowed users are blocked', async () => {
		const server = await start();
		const r = await hit('/api/projects', OWNER);
		expect(r.status).toBe(200);
		expect(r.locals.user).toMatchObject({ email: OWNER });

		server.db.update(users).set({ disabled: true }).where(eq(users.email, OWNER)).run();
		expect(await hit('/project/abc', OWNER)).toMatchObject({ status: 303, location: '/blocked?reason=disabled' });
		const api = await hit('/api/projects', OWNER);
		expect(api.status).toBe(403);
		expect(JSON.parse(api.body)).toMatchObject({ reason: 'disabled' });

		expect(await hit('/', 'out@example.com')).toMatchObject({ status: 303, location: '/blocked?reason=not-allowed' });
		expect(await hit('/share/x', 'out@example.com')).toMatchObject({ status: 200 });
	});
});

describe('joinByLink', () => {
	it('adds a link membership or flags an existing one; unknown and disabled links join nothing', async () => {
		const server = await start();
		const pid = project();
		server.db.update(projects).set({ linkToken: 'tok', linkRole: 'reader' }).where(eq(projects.id, pid)).run();
		const b = user('b@test.local');
		const c = user('c@test.local');
		server.db.insert(memberships).values({ projectId: pid, userId: c.id, role: 'editor', viaLink: false, createdAt: Date.now() }).run();

		expect(joinByLink('nope', b.id)).toBeNull();
		expect(joinByLink('tok', b.id)).toBe(pid);
		expect(joinByLink('tok', c.id)).toBe(pid);
		expect(joinByLink('tok', user().id)).toBe(pid); // the owner joins nothing
		const rows = server.db.select().from(memberships).where(eq(memberships.projectId, pid)).all();
		expect(rows.map(({ userId, role, viaLink }) => ({ userId, role, viaLink })).sort((a, z) => a.userId.localeCompare(z.userId))).toEqual([
			{ userId: b.id, role: null, viaLink: true },
			{ userId: c.id, role: 'editor', viaLink: true }
		]);

		server.db.update(projects).set({ linkToken: null, linkRole: null }).where(eq(projects.id, pid)).run();
		expect(joinByLink('tok', b.id)).toBeNull();
		expect(joinByLink('', b.id)).toBeNull();
	});
});
