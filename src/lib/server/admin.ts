import { and, count, desc, eq, ne } from 'drizzle-orm';
import { kick } from './access.ts';
import type { User } from './auth.ts';
import { getServer } from './collab.ts';
import { fail } from './files.ts';
import { memberships, projects, settings, users, type SiteRole } from './schema.ts';

// Instance administration (005 US5, contracts/http-api.md "Admin"). Loaded unbundled by server.ts in production:
// no SvelteKit imports here; errors are FileErrors, routes wrap them in api().

const db = () => getServer().db;

export type AdminUser = Pick<User, 'id' | 'email' | 'name' | 'avatarUrl' | 'role' | 'disabled' | 'lastSeenAt'> & { projectCount: number };

/** Every user with the number of projects they own, by email. */
export function listUsers(): AdminUser[] {
	const owned = new Map(
		db()
			.select({ ownerId: projects.ownerId, n: count() })
			.from(projects)
			.groupBy(projects.ownerId)
			.all()
			.map((r) => [r.ownerId, r.n])
	);
	return db()
		.select({ id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl, role: users.role, disabled: users.disabled, lastSeenAt: users.lastSeenAt })
		.from(users)
		.orderBy(users.email)
		.all()
		.map((u) => ({ ...u, projectCount: owned.get(u.id) ?? 0 }));
}

/** Promote, demote, disable or enable a user. The last enabled admin can be neither demoted nor disabled (409),
 *  checked in the same transaction as the write. Disabling closes the user's live connections (research R6);
 *  role changes apply on the next request (hooks.server.ts reads the row every time). */
export function updateUser(id: string, change: { role?: unknown; disabled?: unknown }): AdminUser {
	const { role, disabled } = change;
	if (role !== undefined && role !== 'admin' && role !== 'user') fail(422, 'Role must be admin or user.');
	if (disabled !== undefined && typeof disabled !== 'boolean') fail(422, 'Disabled must be true or false.');
	const set = { ...(role !== undefined && { role: role as SiteRole }), ...(disabled !== undefined && { disabled: disabled as boolean }) };
	db().transaction((tx) => {
		const u = tx.select().from(users).where(eq(users.id, id)).get();
		if (!u) fail(404, 'User not found.');
		const wasAdmin = u!.role === 'admin' && !u!.disabled;
		const staysAdmin = (set.role ?? u!.role) === 'admin' && !(set.disabled ?? u!.disabled);
		if (wasAdmin && !staysAdmin) {
			const others = tx
				.select({ n: count() })
				.from(users)
				.where(and(eq(users.role, 'admin'), eq(users.disabled, false), ne(users.id, id)))
				.get()!.n;
			if (others === 0) fail(409, 'The last admin can’t be removed or disabled.');
		}
		if (Object.keys(set).length) tx.update(users).set(set).where(eq(users.id, id)).run();
	});
	if (set.disabled) kick({ userId: id });
	return listUsers().find((u) => u.id === id)!;
}

export type SignupSettings = { signupMode: 'open' | 'invite'; allowlist: string[] };

export function getSettings(): SignupSettings {
	const s = db().select().from(settings).where(eq(settings.id, 1)).get();
	return { signupMode: s?.signupMode ?? 'invite', allowlist: s ? JSON.parse(s.allowlist) : [] };
}

const ENTRY = /^[^@\s]*@[^@\s]+$/;

/** Save the sign-up policy: allowlist entries trimmed and lower-cased, blank ones dropped, duplicates removed; each
 *  must be `name@host` or `@host` (422 naming the first bad entry). */
export function putSettings(body: { signupMode?: unknown; allowlist?: unknown }): SignupSettings {
	const { signupMode, allowlist } = body ?? {};
	if (signupMode !== 'open' && signupMode !== 'invite') fail(422, 'Sign-up must be open or invite.');
	if (!Array.isArray(allowlist) || allowlist.some((e) => typeof e !== 'string')) fail(422, 'The allowlist must be a list of emails and domains.');
	const entries = [...new Set((allowlist as string[]).map((e) => e.trim().toLowerCase()).filter(Boolean))];
	const bad = entries.find((e) => !ENTRY.test(e));
	if (bad) fail(422, `“${bad}” isn’t an email (name@example.org) or a domain (@example.org).`);
	const row = { signupMode: signupMode as SignupSettings['signupMode'], allowlist: JSON.stringify(entries) };
	db()
		.insert(settings)
		.values({ id: 1, ...row })
		.onConflictDoUpdate({ target: settings.id, set: row })
		.run();
	return { signupMode: row.signupMode, allowlist: entries };
}

export type AdminProject = { id: string; title: string; owner: { id: string; name: string; email: string } | null; collaborators: number; updatedAt: number };

/** Every project with its owner and number of members, most recently modified first. */
export function listAllProjects(): AdminProject[] {
	const members = new Map(
		db()
			.select({ projectId: memberships.projectId, n: count() })
			.from(memberships)
			.groupBy(memberships.projectId)
			.all()
			.map((r) => [r.projectId, r.n])
	);
	return db()
		.select({ id: projects.id, title: projects.title, updatedAt: projects.updatedAt, ownerId: users.id, ownerName: users.name, ownerEmail: users.email })
		.from(projects)
		.leftJoin(users, eq(users.id, projects.ownerId))
		.orderBy(desc(projects.updatedAt))
		.all()
		.map((p) => ({
			id: p.id,
			title: p.title,
			owner: p.ownerId ? { id: p.ownerId, name: p.ownerName!, email: p.ownerEmail! } : null,
			collaborators: members.get(p.id) ?? 0,
			updatedAt: p.updatedAt
		}));
}
