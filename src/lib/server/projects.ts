import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getServer } from './collab.ts';
import { pathOf } from '../files.ts';
import { colorFor } from '../presence.ts';
import { fail, getText, listFiles, textUpdate, type Row } from './files.ts';
import { broadcast, kick, projectRole, type Role } from './access.ts';
import { compileSettings, documents, files, invites, memberships, overrides, projects, updates, users, type MemberRole } from './schema.ts';

// Projects (005 research R11). Loaded unbundled by server.ts in production: no SvelteKit imports here.

export type Project = typeof projects.$inferSelect;

const db = () => getServer().db;

/** The title trimmed; 422 unless 1–120 characters (data-model.md). */
export function normalizeTitle(title: unknown): string {
	const t = typeof title === 'string' ? title.trim() : '';
	if (!t || t.length > 120) fail(422, 'The title must be 1–120 characters.');
	return t;
}

export const getProject = (pid: string): Project | null => db().select().from(projects).where(eq(projects.id, pid)).get() ?? null;

/** A new project from file rows (parents before children) and the text of its text files, in one transaction. */
export function insertProject(
	{ ownerId, title }: { ownerId: string; title: string },
	rows: Omit<Row, 'projectId'>[],
	texts: Map<string, string>,
	mainFileId: string | null
): string {
	const id = randomUUID();
	const now = Date.now();
	db().transaction((tx) => {
		tx.insert(projects).values({ id, title: normalizeTitle(title), ownerId, mainFileId, createdAt: now, updatedAt: now }).run();
		// one statement: the parent FK is checked at its end
		if (rows.length) tx.insert(files).values(rows.map((r) => ({ ...r, projectId: id }))).run();
		// fresh ids: nobody has them open, so the text goes in as one stored update each
		for (const [docName, t] of texts) tx.insert(updates).values({ docName, update: textUpdate(t), createdAt: now }).run();
	});
	return id;
}

/** A project with one root `main.tex` (the main document) holding `mainText`. */
export function createProject({ ownerId, title, mainText }: { ownerId: string; title: string; mainText: string }): string {
	const now = Date.now();
	const main = { id: randomUUID(), parentId: null, name: 'main.tex', kind: 'text' as const, hash: null, size: null, createdAt: now, updatedAt: now };
	return insertProject({ ownerId, title }, [main], new Map([[main.id, mainText]]), main.id);
}

/** Rename (owner only, checked by the route); open editors get `project` and reload the details. */
export function renameProject(pid: string, title: unknown) {
	const t = normalizeTitle(title);
	if (!db().update(projects).set({ title: t, updatedAt: Date.now() }).where(eq(projects.id, pid)).run().changes) fail(404, 'Project not found.');
	broadcast(pid, { type: 'project' });
}

/** A copy owned by `ownerId` titled "Copy of <title>" (cut to 120 characters): new file ids, the same blobs, each
 *  text document's current text as one stored update, the same main file and compiler, no members. */
export async function duplicateProject(pid: string, ownerId: string): Promise<string> {
	const p = getProject(pid) ?? fail(404, 'Project not found.');
	const all = db().select().from(files).where(eq(files.projectId, pid)).all();
	const ids = new Map(all.map((f) => [f.id, randomUUID()]));
	const now = Date.now();
	const texts = new Map<string, string>();
	// through Hocuspocus: edits of open editors not stored yet (debounced) are in the copy too
	for (const f of all) if (f.kind === 'text') texts.set(ids.get(f.id)!, await getText(f.id));
	const rows = all.map(({ projectId: _, ...f }) => ({ ...f, id: ids.get(f.id)!, parentId: f.parentId && ids.get(f.parentId)!, createdAt: now, updatedAt: now }));
	const title = `Copy of ${p.title}`.slice(0, 120);
	const id = insertProject({ ownerId, title }, rows, texts, (p.mainFileId && ids.get(p.mainFileId)) || null);
	// compile.ts setCompiler(); not imported, compile.ts pulls in the compile runner
	const compiler = db().select().from(compileSettings).where(eq(compileSettings.project, pid)).get()?.compiler;
	if (compiler) db().insert(compileSettings).values({ project: id, compiler }).run();
	return id;
}

/** A collaborator leaves (the owner can't: 403): their membership and file overrides go, their sockets are kicked. */
export function leaveProject(pid: string, userId: string) {
	if (getProject(pid)?.ownerId === userId) fail(403, 'The owner can’t leave their own project.');
	db().transaction((tx) => {
		tx.delete(overrides).where(and(eq(overrides.projectId, pid), eq(overrides.userId, userId))).run();
		tx.delete(memberships).where(and(eq(memberships.projectId, pid), eq(memberships.userId, userId))).run();
	});
	broadcast(pid, { type: 'access' });
	kick({ userId, projectId: pid });
}

/** Last modified time for the dashboard (research R14). */
export function touchProject(pid: string) {
	db().update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, pid)).run();
}

export type ProjectListItem = { id: string; title: string; owner: { id: string; name: string } | null; role: Role; updatedAt: number };

/** Projects the user owns or is a member of, most recently modified first.
 *  ponytail: one role query per project; fine for the hundreds of projects of a small instance */
export function listProjects(userId: string): ProjectListItem[] {
	const ids = new Set([
		...db().select({ id: projects.id }).from(projects).where(eq(projects.ownerId, userId)).all().map((r) => r.id),
		...db().select({ id: memberships.projectId }).from(memberships).where(eq(memberships.userId, userId)).all().map((r) => r.id)
	]);
	const out: ProjectListItem[] = [];
	for (const { project: p, ownerName } of db()
		.select({ project: projects, ownerName: users.name })
		.from(projects)
		.leftJoin(users, eq(users.id, projects.ownerId))
		.where(inArray(projects.id, [...ids]))
		.orderBy(desc(projects.updatedAt))
		.all()) {
		const role = projectRole(p.id, userId);
		if (role) out.push({ id: p.id, title: p.title, owner: p.ownerId ? { id: p.ownerId, name: ownerName ?? '' } : null, role, updatedAt: p.updatedAt });
	}
	return out;
}

/** The project behind a share link, or null when the token is unknown or link sharing is off. */
export const projectByLink = (token: string): Project | null =>
	(token && db().select().from(projects).where(eq(projects.linkToken, token)).get()) || null;

/** Join through a share link (data-model "Effective role"): sets `viaLink` on the user's membership, inserting one
 *  with no named role if absent; the effective role is then the higher of the named and the link role. The owner
 *  joins nothing. Returns the project id, or null for an unknown or disabled link. */
export function joinByLink(token: string, userId: string): string | null {
	const pid = db().transaction((tx) => {
		const p = token ? tx.select().from(projects).where(eq(projects.linkToken, token)).get() : undefined;
		if (!p) return null;
		if (p.ownerId === userId) return p.id;
		const where = and(eq(memberships.projectId, p.id), eq(memberships.userId, userId));
		if (tx.select().from(memberships).where(where).get()) tx.update(memberships).set({ viaLink: true }).where(where).run();
		else tx.insert(memberships).values({ projectId: p.id, userId, role: null, viaLink: true, createdAt: Date.now() }).run();
		return p.id;
	});
	// the owner's Share dialog lists the newcomer
	if (pid && getProject(pid)?.ownerId !== userId) broadcast(pid, { type: 'access' });
	return pid;
}

/** Delete a project and everything in it (T023): files, Yjs documents and updates, memberships, invites, overrides
 *  and compile settings in one transaction, then the compile output; open editors get `deleted` and are kicked.
 *  404 for an unknown project. Blobs stay (content-addressed, maybe shared: files.ts putBlob). */
export function deleteProject(pid: string) {
	db().transaction((tx) => {
		if (!tx.select({ id: projects.id }).from(projects).where(eq(projects.id, pid)).get()) fail(404, 'Project not found.');
		const text = tx
			.select({ id: files.id })
			.from(files)
			.where(and(eq(files.projectId, pid), eq(files.kind, 'text')))
			.all()
			.map((f) => f.id);
		tx.delete(overrides).where(eq(overrides.projectId, pid)).run();
		tx.delete(memberships).where(eq(memberships.projectId, pid)).run();
		tx.delete(invites).where(eq(invites.projectId, pid)).run();
		tx.delete(compileSettings).where(eq(compileSettings.project, pid)).run();
		tx.delete(files).where(eq(files.projectId, pid)).run(); // one statement: the parent FK is checked at its end
		if (text.length) {
			tx.delete(documents).where(inArray(documents.name, text)).run();
			tx.delete(updates).where(inArray(updates.docName, text)).run();
		}
		tx.delete(projects).where(eq(projects.id, pid)).run();
	});
	// compile.ts compileDir(); not imported, compile.ts pulls in the compile runner
	rmSync(join(getServer().dataDir, 'compile', pid), { recursive: true, force: true });
	broadcast(pid, { type: 'deleted' });
	kick({ projectId: pid });
}

// --- sharing (005 US3, contracts/http-api.md "Sharing") ------------------------------------------------------------
// Every change kicks the affected users' sockets (they reconnect with the new role, research R6) and broadcasts
// `access` so open Share dialogs and editors refetch (research R8).

export type Person = { id: string; email: string; name: string; avatarUrl: string | null; color: string };
export type Members = {
	owner: Person | null;
	/** `role`: the effective role; `via`: 'invite' when named by the owner, 'link' when only the share link grants it */
	members: { user: Person; role: MemberRole; via: 'invite' | 'link' }[];
	invites: { email: string; role: MemberRole }[];
	overrides: { userId: string; fileId: string; path: string; role: MemberRole }[];
};

const ROLES: MemberRole[] = ['editor', 'reader'];
const EMAIL = /^[^@\s]+@[^@\s]+$/;

function memberRole(role: unknown): MemberRole {
	if (!ROLES.includes(role as MemberRole)) fail(422, 'Role must be editor or reader.');
	return role as MemberRole;
}

const person = (u: Pick<typeof users.$inferSelect, 'id' | 'email' | 'name' | 'avatarUrl'>): Person => ({
	id: u.id,
	email: u.email,
	name: u.name,
	avatarUrl: u.avatarUrl,
	color: colorFor(u.id)
});

const memberWhere = (pid: string, userId: string) => and(eq(memberships.projectId, pid), eq(memberships.userId, userId));

/** Owner, collaborators with their effective roles, and (owner only) pending invites and file overrides. */
export function listMembers(pid: string, forOwner: boolean): Members {
	const p = getProject(pid) ?? fail(404, 'Project not found.');
	const owner = p.ownerId ? db().select().from(users).where(eq(users.id, p.ownerId)).get() : undefined;
	const members: Members['members'] = [];
	for (const { m, u } of db()
		.select({ m: memberships, u: users })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(eq(memberships.projectId, pid))
		.orderBy(users.email)
		.all()) {
		const role = projectRole(pid, u.id);
		// a link-only row while the link is off, or a disabled user: no access, not listed
		if (role && role !== 'owner') members.push({ user: person(u), role, via: m.role ? 'invite' : 'link' });
	}
	if (!forOwner) return { owner: owner ? person(owner) : null, members, invites: [], overrides: [] };
	const all = listFiles(pid);
	return {
		owner: owner ? person(owner) : null,
		members,
		invites: db()
			.select({ email: invites.email, role: invites.role })
			.from(invites)
			.where(eq(invites.projectId, pid))
			.orderBy(invites.email)
			.all(),
		overrides: db()
			.select({ userId: overrides.userId, fileId: overrides.fileId, role: overrides.role })
			.from(overrides)
			.where(eq(overrides.projectId, pid))
			.all()
			.map((o) => ({ ...o, path: pathOf(o.fileId, all) }))
	};
}

/** Invite by email (owner): an existing account gets the named role on its membership (a link membership keeps
 *  `viaLink`), an unknown email a pending invite (role updated when invited again). 422 for the owner's own email. */
export function inviteMember(pid: string, email: unknown, role: unknown): 'member' | 'invited' {
	const r = memberRole(role);
	const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
	if (!EMAIL.test(e)) fail(422, 'Enter an email address.');
	const p = getProject(pid) ?? fail(404, 'Project not found.');
	const u = db().select().from(users).where(eq(users.email, e)).get();
	if (u && u.id === p.ownerId) fail(422, 'You already own this project.');
	const now = Date.now();
	if (u) {
		db()
			.insert(memberships)
			.values({ projectId: pid, userId: u.id, role: r, viaLink: false, createdAt: now })
			.onConflictDoUpdate({ target: [memberships.projectId, memberships.userId], set: { role: r } })
			.run();
	} else {
		db()
			.insert(invites)
			.values({ projectId: pid, email: e, role: r, createdAt: now })
			.onConflictDoUpdate({ target: [invites.projectId, invites.email], set: { role: r } })
			.run();
	}
	broadcast(pid, { type: 'access' });
	if (u) kick({ userId: u.id, projectId: pid });
	return u ? 'member' : 'invited';
}

/** Change a collaborator's named role (owner); 404 when they aren't a member. */
export function setMemberRole(pid: string, userId: string, role: unknown) {
	const r = memberRole(role);
	if (!db().update(memberships).set({ role: r }).where(memberWhere(pid, userId)).run().changes) fail(404, 'Not a collaborator.');
	broadcast(pid, { type: 'access' });
	kick({ userId, projectId: pid });
}

/** Remove a collaborator with their file overrides (owner); 404 when they aren't a member. */
export function removeMember(pid: string, userId: string) {
	const gone = db().transaction((tx) => {
		tx.delete(overrides).where(and(eq(overrides.projectId, pid), eq(overrides.userId, userId))).run();
		return tx.delete(memberships).where(memberWhere(pid, userId)).run().changes;
	});
	if (!gone) fail(404, 'Not a collaborator.');
	broadcast(pid, { type: 'access' });
	kick({ userId, projectId: pid });
}

/** Withdraw a pending invite (owner): signing up later gives nothing. 404 when there is none. */
export function withdrawInvite(pid: string, email: string) {
	const e = email.trim().toLowerCase();
	if (!db().delete(invites).where(and(eq(invites.projectId, pid), eq(invites.email, e))).run().changes) fail(404, 'No such invite.');
	broadcast(pid, { type: 'access' });
}

export type Link = { token: string; role: MemberRole } | null;

/** Link sharing (owner): `role` null turns it off; a role turns it on (a new token if off) or changes its role;
 *  `regenerate` issues a new token. Turning it off or regenerating makes the old link worthless: `viaLink` is
 *  cleared everywhere and link-only memberships go (data-model "memberships"). Everyone who had link access is
 *  kicked so they reconnect with what is left. */
export function setLink(pid: string, role: unknown, regenerate = false): Link {
	const r = role === null ? null : memberRole(role);
	const affected = db().transaction((tx) => {
		const p = tx.select().from(projects).where(eq(projects.id, pid)).get() ?? fail(404, 'Project not found.');
		const linked = tx
			.select({ userId: memberships.userId })
			.from(memberships)
			.where(and(eq(memberships.projectId, pid), eq(memberships.viaLink, true)))
			.all()
			.map((m) => m.userId);
		const reset = p.linkToken !== null && (r === null || regenerate);
		if (reset) {
			// overrides of link-only members go with their membership
			const linkOnly = tx
				.select({ userId: memberships.userId })
				.from(memberships)
				.where(and(eq(memberships.projectId, pid), isNull(memberships.role)))
				.all()
				.map((m) => m.userId);
			if (linkOnly.length) tx.delete(overrides).where(and(eq(overrides.projectId, pid), inArray(overrides.userId, linkOnly))).run();
			tx.delete(memberships).where(and(eq(memberships.projectId, pid), isNull(memberships.role))).run();
			tx.update(memberships).set({ viaLink: false }).where(eq(memberships.projectId, pid)).run();
		}
		const token = r === null ? null : !p.linkToken || regenerate ? randomBytes(32).toString('base64url') : p.linkToken;
		tx.update(projects).set({ linkToken: token, linkRole: r }).where(eq(projects.id, pid)).run();
		// a changed link role changes the role of every link member too
		return reset || r !== p.linkRole ? linked : [];
	});
	broadcast(pid, { type: 'access' });
	for (const userId of affected) kick({ userId, projectId: pid });
	const p = getProject(pid)!;
	return p.linkToken ? { token: p.linkToken, role: p.linkRole! } : null;
}

/** Hand the project to a collaborator (owner `fromId`), in one transaction (data-model "Transfer"): the new owner's
 *  membership and overrides go, the old owner becomes an Editor. 403 unless `fromId` still owns it (two racing
 *  transfers apply in order), 422 unless the target is a collaborator. */
export function transferOwnership(pid: string, fromId: string, toId: unknown) {
	if (typeof toId !== 'string' || !toId) fail(422, 'Choose a collaborator.');
	const to = toId as string;
	db().transaction((tx) => {
		const p = tx.select().from(projects).where(eq(projects.id, pid)).get() ?? fail(404, 'Project not found.');
		if (p.ownerId !== fromId) fail(403, 'Only the owner can do this.');
		if (!tx.select().from(memberships).where(memberWhere(pid, to)).get()) fail(422, 'The new owner must be a collaborator.');
		tx.delete(overrides).where(and(eq(overrides.projectId, pid), eq(overrides.userId, to))).run();
		tx.delete(memberships).where(memberWhere(pid, to)).run();
		tx.insert(memberships).values({ projectId: pid, userId: fromId, role: 'editor', viaLink: false, createdAt: Date.now() }).run();
		tx.update(projects).set({ ownerId: to }).where(eq(projects.id, pid)).run();
	});
	broadcast(pid, { type: 'access' });
	broadcast(pid, { type: 'project' });
	kick({ userId: fromId, projectId: pid });
	kick({ userId: to, projectId: pid });
}
