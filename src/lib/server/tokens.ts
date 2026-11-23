import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { projectRole } from './access.ts';
import type { User } from './auth.ts';
import { getServer } from './collab.ts';
import { fail } from './files.ts';
import { accessTokens, projects, users } from './schema.ts';

// Personal access tokens for MCP clients (Claude Code, Codex): `Authorization: Bearer otk_…` on /mcp acts as the
// token's user, with that user's roles. Shown once at creation; only the SHA-256 is stored, so a leaked database
// doesn't leak working tokens. Loaded unbundled by server.ts in production: no SvelteKit imports here.

export const TOKEN_PREFIX = 'otk_';
const NAME_MAX = 60;
const PER_USER = 20;

export type TokenInfo = {
	id: string;
	name: string;
	prefix: string;
	project: { id: string; title: string } | null; // null: every project the user can open
	createdAt: number;
	lastUsedAt: number | null;
};
/** What a request authenticated by a token may reach: `projectId` null for all of the user's projects. */
export type TokenScope = { tokenId: string; projectId: string | null };

const db = () => getServer().db;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export function listTokens(userId: string): TokenInfo[] {
	return db()
		.select({ t: accessTokens, title: projects.title })
		.from(accessTokens)
		.leftJoin(projects, eq(projects.id, accessTokens.projectId))
		.where(eq(accessTokens.userId, userId))
		.orderBy(desc(accessTokens.createdAt))
		.all()
		.map(({ t, title }) => ({
			id: t.id,
			name: t.name,
			prefix: t.prefix,
			project: t.projectId ? { id: t.projectId, title: title ?? '' } : null,
			createdAt: t.createdAt,
			lastUsedAt: t.lastUsedAt
		}));
}

/** A new token for `userId`; `projectId` limits it to one project the user can open. The token text is returned
 *  only here. 422 for a bad name, 404 for a project out of reach, 409 past PER_USER tokens. */
export function createToken(userId: string, { name, projectId }: { name: unknown; projectId?: unknown }): { token: string; info: TokenInfo } {
	const n = typeof name === 'string' ? name.trim() : '';
	if (!n || n.length > NAME_MAX) fail(422, `The name must be 1–${NAME_MAX} characters.`);
	const pid = projectId == null || projectId === '' ? null : typeof projectId === 'string' ? projectId : fail(400, 'expected projectId: string | null');
	if (pid && !projectRole(pid, userId)) fail(404, 'Project not found.');
	if (listTokens(userId).length >= PER_USER) fail(409, `You can have at most ${PER_USER} tokens. Revoke one first.`);
	const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
	const row = { id: randomUUID(), userId, name: n, projectId: pid, hash: digest(token), prefix: token.slice(0, 10), createdAt: Date.now(), lastUsedAt: null };
	db().insert(accessTokens).values(row).run();
	return { token, info: listTokens(userId).find((t) => t.id === row.id)! };
}

/** 404 unless the token is the user's. */
export function revokeToken(userId: string, id: string) {
	const r = db().delete(accessTokens).where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId))).run();
	if (!r.changes) fail(404, 'Token not found.');
}

/** The enabled user behind a bearer token and what it may reach, or null. Marks the token used (once a minute). */
export function authenticateBearer(header: string | null): { user: User; scope: TokenScope } | null {
	const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
	if (!token?.startsWith(TOKEN_PREFIX)) return null;
	const row = db()
		.select({ t: accessTokens, u: users })
		.from(accessTokens)
		.innerJoin(users, eq(users.id, accessTokens.userId))
		.where(eq(accessTokens.hash, digest(token)))
		.get();
	if (!row || row.u.disabled) return null;
	const now = Date.now();
	if (!row.t.lastUsedAt || now - row.t.lastUsedAt > 60_000) db().update(accessTokens).set({ lastUsedAt: now }).where(eq(accessTokens.id, row.t.id)).run();
	return { user: row.u, scope: { tokenId: row.t.id, projectId: row.t.projectId } };
}
