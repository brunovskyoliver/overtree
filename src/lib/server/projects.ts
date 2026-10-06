import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getServer } from './collab.ts';
import { fail, getText, textUpdate, type Row } from './files.ts';
import { broadcast, kick, projectRole, type Role } from './access.ts';
import { compileSettings, documents, files, invites, memberships, overrides, projects, updates, users } from './schema.ts';

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
	return db().transaction((tx) => {
		const p = token ? tx.select().from(projects).where(eq(projects.linkToken, token)).get() : undefined;
		if (!p) return null;
		if (p.ownerId === userId) return p.id;
		const where = and(eq(memberships.projectId, p.id), eq(memberships.userId, userId));
		if (tx.select().from(memberships).where(where).get()) tx.update(memberships).set({ viaLink: true }).where(where).run();
		else tx.insert(memberships).values({ projectId: p.id, userId, role: null, viaLink: true, createdAt: Date.now() }).run();
		return p.id;
	});
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
