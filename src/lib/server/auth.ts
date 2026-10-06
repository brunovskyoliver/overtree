import { createClerkClient, verifyToken, type ClerkClient } from '@clerk/backend';
import { and, count, eq, isNull } from 'drizzle-orm';
import { getServer } from './collab.ts';
import type { Tx } from './files.ts';
import { invites, memberships, projects, settings, users } from './schema.ts';

// Authentication (research R2–R5): Clerk sessions on HTTP and WebSocket, the test bypass, the user mirror and the
// sign-up policy. Loaded unbundled by server.ts in production: no SvelteKit imports here.

export type User = typeof users.$inferSelect;
/** What we learn about a signed-in person from Clerk or the test bypass. */
export type Identity = { id: string; email: string; name?: string | null; avatarUrl?: string | null };

/** The sign-up policy refuses this email (research R5). */
export class NotAllowed extends Error {}

export type AuthResult = { user: User } | { redirect: Response } | { refused: 'not-allowed' } | null;

const REFRESH_MS = 10 * 60 * 1000;
export const TEST_COOKIE = 'overtree-test-user';
const TEST_TOKEN = 'test:';

/** The test sign-in bypass is on: OVERTREE_TEST_AUTH=1 and not a production build (research R4). */
export const testAuth = () => process.env.OVERTREE_TEST_AUTH === '1' && process.env.NODE_ENV !== 'production';

/** Why the app can't start with this auth configuration, or null when it can. */
export function authConfigProblem(): string | null {
	const env = process.env;
	if (env.OVERTREE_TEST_AUTH === '1' && env.NODE_ENV === 'production')
		return 'OVERTREE_TEST_AUTH=1 is refused with NODE_ENV=production: the test sign-in must never run in a deployed app.';
	if (!testAuth() && !(env.PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY))
		return 'PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be set (see README.md, Clerk setup).';
	return null;
}

const testIdentity = (email: string): Identity => {
	const e = email.trim().toLowerCase();
	return { id: `test_${e}`, email: e, name: null, avatarUrl: null };
};

let clerk: ClerkClient | undefined;
const clerkClient = () =>
	(clerk ??= createClerkClient({
		secretKey: process.env.CLERK_SECRET_KEY,
		publishableKey: process.env.PUBLIC_CLERK_PUBLISHABLE_KEY,
		jwtKey: process.env.CLERK_JWT_KEY || undefined
	}));

/** Primary email, full name and image of a Clerk user. */
async function clerkIdentity(id: string): Promise<Identity> {
	const u = await clerkClient().users.getUser(id);
	const email = (u.primaryEmailAddress ?? u.emailAddresses[0])?.emailAddress;
	if (!email) throw new NotAllowed('Clerk user without an email address');
	return { id, email, name: u.fullName, avatarUrl: u.hasImage ? u.imageUrl : null };
}

function cookie(request: Request, name: string): string | undefined {
	for (const part of request.headers.get('cookie')?.split(';') ?? []) {
		const [k, ...v] = part.trim().split('=');
		if (k === name) return decodeURIComponent(v.join('='));
	}
}

/** The signed-in user of an HTTP request (research R2). `redirect`: Clerk's handshake (dev instances, expired
 *  cookies) for page requests; `refused`: the sign-up policy said no; null: signed out. */
export async function authenticateRequest(request: Request): Promise<AuthResult> {
	if (testAuth()) {
		const email = cookie(request, TEST_COOKIE);
		return email ? resolve(testIdentity(email).id, async () => testIdentity(email)) : null;
	}
	// ORIGIN when the deployer set it, else the URL adapter-node built for this request; never the raw Host header (M3)
	const state = await clerkClient().authenticateRequest(request, {
		authorizedParties: [process.env.ORIGIN || new URL(request.url).origin],
		jwtKey: process.env.CLERK_JWT_KEY || undefined
	});
	if (state.status === 'handshake') return { redirect: new Response(null, { status: 307, headers: state.headers }) };
	if (!state.isAuthenticated) return null;
	const { userId } = state.toAuth();
	return resolve(userId, () => clerkIdentity(userId));
}

/** The user behind a WebSocket token (research R3): a Clerk session JWT, or `test:<email>` with the test bypass. */
export async function authenticateToken(token: string): Promise<User | null> {
	if (!token) return null;
	if (testAuth() && token.startsWith(TEST_TOKEN)) {
		const identity = testIdentity(token.slice(TEST_TOKEN.length));
		return userOf(await resolve(identity.id, async () => identity));
	}
	if (token.startsWith(TEST_TOKEN)) return null;
	try {
		// ponytail: no authorizedParties without ORIGIN (the upgrade only has the Host header to go by); set ORIGIN in production
		const origin = process.env.ORIGIN;
		const claims = await verifyToken(token, {
			secretKey: process.env.CLERK_SECRET_KEY,
			jwtKey: process.env.CLERK_JWT_KEY || undefined,
			...(origin && { authorizedParties: [origin] })
		});
		return userOf(await resolve(claims.sub, () => clerkIdentity(claims.sub)));
	} catch {
		return null;
	}
}

const userOf = (r: AuthResult) => (r && 'user' in r ? r.user : null);

/** The mirrored user: from SQLite while the profile is fresh, else refreshed (or created) from `identity()`. */
async function resolve(id: string, identity: () => Promise<Identity>): Promise<AuthResult> {
	const row = getServer().db.select().from(users).where(eq(users.id, id)).get();
	if (row && Date.now() - row.syncedAt < REFRESH_MS) return { user: row };
	try {
		return { user: mirrorUser(await identity()) };
	} catch (e) {
		if (e instanceof NotAllowed) return { refused: 'not-allowed' };
		throw e;
	}
}

const adminEmails = () =>
	(process.env.ADMIN_EMAILS ?? '')
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);

/** The sign-up policy for an email without an account (research R5). */
function allowedToSignUp(tx: Tx, email: string): boolean {
	const s = tx.select().from(settings).where(eq(settings.id, 1)).get();
	if (!s || s.signupMode === 'open') return true;
	const allowlist: string[] = JSON.parse(s.allowlist);
	const domain = email.slice(email.lastIndexOf('@'));
	if (allowlist.includes(email) || allowlist.includes(domain)) return true;
	return !!tx.select().from(invites).where(eq(invites.email, email)).get();
}

/** Insert or refresh the user in one transaction (research R5): first user and ADMIN_EMAILS become admins (never
 *  demoted here), unknown emails pass the sign-up policy or get NotAllowed, pending invites become memberships,
 *  and projects without an owner go to the first admin. Disabled users are returned as they are. */
export function mirrorUser(identity: Identity): User {
	const email = identity.email.trim().toLowerCase();
	const name = identity.name?.trim() || email.slice(0, email.indexOf('@')) || email;
	const avatarUrl = identity.avatarUrl ?? null;
	const now = Date.now();
	const seeded = adminEmails().includes(email);
	return getServer().db.transaction((tx) => {
		const existing = tx.select().from(users).where(eq(users.id, identity.id)).get();
		let user: User;
		if (existing) {
			// an email now used by another account stays with that account
			const clash = email !== existing.email && tx.select().from(users).where(eq(users.email, email)).get();
			const set = {
				...(!clash && { email }),
				name,
				avatarUrl,
				syncedAt: now,
				lastSeenAt: now,
				...(seeded && { role: 'admin' as const })
			};
			tx.update(users).set(set).where(eq(users.id, existing.id)).run();
			user = { ...existing, ...set };
		} else {
			const first = tx.select({ n: count() }).from(users).get()!.n === 0;
			if (!first && !seeded && !allowedToSignUp(tx, email)) throw new NotAllowed(email);
			// ponytail: a second Clerk account with an email we already have (deleted and recreated in Clerk) is refused;
			// moving the old row to the new id needs every foreign key rewritten
			if (tx.select().from(users).where(eq(users.email, email)).get()) throw new NotAllowed(email);
			user = { id: identity.id, email, name, avatarUrl, role: first || seeded ? 'admin' : 'user', disabled: false, createdAt: now, lastSeenAt: now, syncedAt: now };
			tx.insert(users).values(user).run();
		}
		// pending invites for this email become memberships (an existing membership keeps the higher role)
		for (const inv of tx.select().from(invites).where(eq(invites.email, user.email)).all()) {
			const project = tx.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, inv.projectId)).get();
			if (project?.ownerId !== user.id) {
				const m = tx.select().from(memberships).where(and(eq(memberships.projectId, inv.projectId), eq(memberships.userId, user.id))).get();
				if (!m) tx.insert(memberships).values({ projectId: inv.projectId, userId: user.id, role: inv.role, viaLink: false, createdAt: now }).run();
				else if (m.role !== 'editor')
					tx.update(memberships).set({ role: inv.role }).where(and(eq(memberships.projectId, inv.projectId), eq(memberships.userId, user.id))).run();
			}
			tx.delete(invites).where(and(eq(invites.projectId, inv.projectId), eq(invites.email, inv.email))).run();
		}
		// the migrated pre-005 project goes to the first admin (FR-025)
		if (user.role === 'admin') tx.update(projects).set({ ownerId: user.id }).where(isNull(projects.ownerId)).run();
		return user;
	});
}
