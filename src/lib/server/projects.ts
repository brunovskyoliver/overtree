import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { getServer } from './collab.ts';
import { fail, textUpdate, type Row } from './files.ts';
import { projectRole, type Role } from './access.ts';
import { files, memberships, projects, updates, users } from './schema.ts';

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
