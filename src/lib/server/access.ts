import { and, eq } from 'drizzle-orm';
import type { User } from './auth.ts';
import { getServer } from './collab.ts';
import { FileError, withDescendants } from './files.ts';
import { files, memberships, overrides, projects, users, type MemberRole } from './schema.ts';

// Authorization (005 data-model "Effective role", research R6, R8, R10). Used by every route and by Hocuspocus.
// Loaded unbundled by server.ts in production: no SvelteKit imports; guards throw FileError, routes wrap them in api().

export type Role = 'owner' | MemberRole;
export type Need = 'read' | 'edit' | 'owner';

const db = () => getServer().db;
const higher = (a: MemberRole | null, b: MemberRole | null): MemberRole | null => (a === 'editor' || b === 'editor' ? 'editor' : (a ?? b));
export const canEdit = (role: Role | null) => role === 'owner' || role === 'editor';

/** The user's role on the project, or null (no access, unknown project or disabled user). */
export function projectRole(pid: string, userId: string): Role | null {
	const user = db().select({ disabled: users.disabled }).from(users).where(eq(users.id, userId)).get();
	const project = db().select().from(projects).where(eq(projects.id, pid)).get();
	if (!user || user.disabled || !project) return null;
	if (project.ownerId === userId) return 'owner';
	const m = db().select().from(memberships).where(and(eq(memberships.projectId, pid), eq(memberships.userId, userId))).get();
	if (!m) return null;
	return higher(m.role, m.viaLink && project.linkToken ? project.linkRole : null);
}

/** Per-file roles of one user in one project: the nearest override up the parent chain, else the project role. */
export function fileRoles(pid: string, userId: string) {
	const base = projectRole(pid, userId);
	const all = db().select({ id: files.id, parentId: files.parentId }).from(files).where(eq(files.projectId, pid)).all();
	const own =
		base && base !== 'owner'
			? new Map(
					db()
						.select({ fileId: overrides.fileId, role: overrides.role })
						.from(overrides)
						.where(and(eq(overrides.projectId, pid), eq(overrides.userId, userId)))
						.all()
						.map((o) => [o.fileId, o.role])
				)
			: new Map<string, MemberRole>();
	const parent = new Map(all.map((f) => [f.id, f.parentId]));
	const roleOf = (fileId: string | null): Role | null => {
		if (base === 'owner' || base === null) return base;
		for (let id = fileId; id !== null && id !== undefined; id = parent.get(id) ?? null) {
			const o = own.get(id);
			if (o) return o;
		}
		return base;
	};
	return { base, all, roleOf };
}

/** The user's role on one file or folder (null: the project root). */
export const fileRole = (pid: string, userId: string, fileId: string | null): Role | null => fileRoles(pid, userId).roleOf(fileId);

/** Whether the user may edit each of `ids` and all their descendants (rename, move, delete: research R10). */
export function canEditFiles(pid: string, userId: string, ids: string[]): boolean {
	const { base, all, roleOf } = fileRoles(pid, userId);
	if (base === 'owner') return true;
	return ids.every((id) => withDescendants(id, all).every((f) => canEdit(roleOf(f))));
}

const NEED_OK: Record<Need, (r: Role) => boolean> = { read: () => true, edit: canEdit, owner: (r) => r === 'owner' };

/** Guard for project routes: 401 signed out, 404 for non-members (ids don't leak), 403 when the role is too low. */
export function requireProject(locals: { user?: User | null }, pid: string, need: Need): { user: User; role: Role } {
	const user = locals.user;
	if (!user) throw new FileError(401, 'Sign in to continue.');
	const role = projectRole(pid, user.id);
	if (!role) throw new FileError(404, 'Project not found.');
	if (!NEED_OK[need](role)) throw new FileError(403, need === 'owner' ? 'Only the owner can do this.' : 'You can only view this project.');
	return { user, role };
}

/** 403 unless the user may edit `ids` and their descendants. */
export function requireEditFiles(pid: string, userId: string, ids: (string | null)[]) {
	const files = ids.filter((id) => id !== null);
	// null: the project root, editable with the project role
	const ok = (ids.includes(null) ? canEdit(projectRole(pid, userId)) : true) && canEditFiles(pid, userId, files);
	if (!ok) throw new FileError(403, 'You don’t have edit access to this file.');
}

/** 403 unless the user may edit the folder (null: the root) to create or upload into it. */
export function requireEditFolder(pid: string, userId: string, folderId: string | null) {
	if (!canEdit(fileRole(pid, userId, folderId))) throw new FileError(403, 'You don’t have edit access to this folder.');
}

export type ConnectionContext = { userId?: string; projectId?: string };

/** Close the sockets of matching connections with code 4403 (research R6): providers reconnect on their own and
 *  onAuthenticate decides again with the current role. The whole socket goes, not just the document: Hocuspocus'
 *  per-document close leaves the provider unauthenticated without retrying. No filter closes nothing. */
export function kick({ userId, projectId }: ConnectionContext) {
	if (!userId && !projectId) return;
	const sockets = new Set<{ close(code?: number, reason?: string): void }>();
	for (const doc of getServer().hocuspocus.documents.values()) {
		for (const conn of doc.getConnections()) {
			const ctx = conn.context as ConnectionContext;
			if ((userId === undefined || ctx.userId === userId) && (projectId === undefined || ctx.projectId === projectId)) sockets.add(conn.webSocket);
		}
	}
	for (const ws of sockets) ws.close(4403, 'access-changed');
}

export type ProjectEvent = { type: 'tree' | 'project' | 'access' | 'deleted' };

/** A server event to everyone on the project's presence document (research R8); nobody connected, nothing sent. */
export function broadcast(pid: string, event: ProjectEvent) {
	getServer().hocuspocus.documents.get(`project:${pid}`)?.broadcastStateless(JSON.stringify(event));
}

/** Guard for admin routes: 401 signed out, 403 unless a site admin (contracts/http-api.md, Admin). */
export function requireAdmin(locals: { user?: User | null }): User {
	const user = locals.user;
	if (!user) throw new FileError(401, 'Sign in to continue.');
	if (user.role !== 'admin') throw new FileError(403, 'Only admins can do this.');
	return user;
}
