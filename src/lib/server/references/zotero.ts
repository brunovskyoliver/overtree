import { hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ZoteroAccountInfo } from '../../reference-types.ts';
import { parseEntries, type Entry } from '../../references/bibtex.ts';
import { getServer } from '../collab.ts';
import { fail } from '../files.ts';
import { openWith, sealWith } from '../github/crypto.ts';
import { zoteroAccounts } from '../schema.ts';
import { fetchText, refsConfig, statusError } from './fetch.ts';

// Zotero libraries (017 US2): one per Overtree user, connected with a user ID and a private API key from
// zotero.org/settings/keys. The key is sealed with the GitHub token cipher and never leaves the server: not to the
// browser, not into logs or error messages. Loaded unbundled by server.ts: no SvelteKit imports here.

const db = () => getServer().db;
export const SEARCH_LIMIT = 25;

let cached: { dir: string; key: Buffer } | null = null;
/** AES-256 key = HKDF-SHA256(32 random bytes in $DATA_DIR/secret.key, made on first use).
 *  ponytail: the secret sits on the data volume next to the database, so it protects copies of overtree.db (backups,
 *  a shared dump), not a stolen volume; take it from an environment secret if that matters. Losing the file means
 *  users connect Zotero again. */
function zoteroKey(): Buffer {
	const dir = getServer().dataDir;
	if (cached?.dir === dir) return cached.key;
	const path = join(dir, 'secret.key');
	try {
		writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
	}
	const key = Buffer.from(hkdfSync('sha256', readFileSync(path), Buffer.alloc(0), 'overtree-zotero-keys', 32));
	cached = { dir, key };
	return key;
}

const getRow = (userId: string) => db().select().from(zoteroAccounts).where(eq(zoteroAccounts.userId, userId)).get() ?? null;

export function zoteroAccount(userId: string): ZoteroAccountInfo {
	const row = getRow(userId);
	return row ? { connected: true, userId: row.zoteroUserId, username: row.username } : { connected: false };
}

const headers = (apiKey: string) => ({ 'Zotero-API-Key': apiKey, 'Zotero-API-Version': '3' });

/** Checks the key with Zotero (it must belong to `zoteroUserId` and read the library) and stores it sealed. */
export async function connectZotero(userId: string, body: { userId?: unknown; apiKey?: unknown }): Promise<ZoteroAccountInfo> {
	const zid = typeof body.userId === 'string' ? body.userId.trim() : '';
	const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
	if (!/^\d{1,12}$/.test(zid)) fail(400, 'The user ID is the number shown on zotero.org/settings/keys ("Your userID for use in API calls").');
	if (!/^[A-Za-z0-9]{8,64}$/.test(apiKey)) fail(400, 'That doesn’t look like a Zotero API key: 24 letters and digits.');
	const r = await fetchText('zotero', `${refsConfig().zoteroUrl}/keys/current`, headers(apiKey));
	if (r.status === 403 || r.status === 404) fail(400, 'Zotero doesn’t accept this API key. Check it, or create a new one.');
	if (r.status !== 200) statusError('zotero', r.status);
	let info: { userID?: number; username?: string; access?: { user?: { library?: boolean } } };
	try {
		info = JSON.parse(r.text);
	} catch {
		return fail(502, 'Zotero sent an answer Overtree can’t read.');
	}
	if (String(info.userID) !== zid) fail(400, 'This API key belongs to another Zotero user ID.');
	if (!info.access?.user?.library) fail(400, 'This API key can’t read your library. Tick "Allow library access" for it on zotero.org.');
	const now = Date.now();
	const row = { zoteroUserId: zid, username: info.username || zid, apiKey: sealWith(zoteroKey(), apiKey), updatedAt: now };
	db()
		.insert(zoteroAccounts)
		.values({ userId, ...row, createdAt: now })
		.onConflictDoUpdate({ target: zoteroAccounts.userId, set: row })
		.run();
	return zoteroAccount(userId);
}

/** Deletes the stored key. Nothing changes on zotero.org; revoking the key there is the user's call. */
export function disconnectZotero(userId: string) {
	db().delete(zoteroAccounts).where(eq(zoteroAccounts.userId, userId)).run();
}

type ZoteroJsonItem = {
	key: string;
	data?: { itemType?: string };
	bibtex?: string;
};

/** Top-level items of the user's library matching `q` (title, creator, year; the most recently changed first when
 *  empty), each with its BibTeX entry. Notes and attachments, which have no entry, are left out. */
export async function searchZotero(userId: string, q: string): Promise<{ id: string; itemType: string; entry: Entry }[]> {
	const row = getRow(userId);
	if (!row) fail(409, 'Connect your Zotero library first.');
	let apiKey: string;
	try {
		apiKey = openWith(zoteroKey(), row!.apiKey);
	} catch {
		return fail(409, 'The stored Zotero key can no longer be read. Disconnect and connect Zotero again.');
	}
	const params = new URLSearchParams({ format: 'json', include: 'data,bibtex', limit: String(SEARCH_LIMIT), sort: 'dateModified', direction: 'desc' });
	if (q.trim()) params.set('q', q.trim().slice(0, 200)), params.set('qmode', 'titleCreatorYear');
	const r = await fetchText('zotero', `${refsConfig().zoteroUrl}/users/${row!.zoteroUserId}/items/top?${params}`, headers(apiKey));
	if (r.status === 403) fail(409, 'Zotero refused the stored key: it was revoked or lost library access. Disconnect and connect again.');
	if (r.status === 404) fail(404, 'Zotero has no library for this user ID. Disconnect and check the ID.');
	if (r.status !== 200) statusError('zotero', r.status);
	let items: ZoteroJsonItem[];
	try {
		items = JSON.parse(r.text);
		if (!Array.isArray(items)) throw new Error('not a list');
	} catch {
		return fail(502, 'Zotero sent an answer Overtree can’t read.');
	}
	return items.flatMap((item) => {
		const type = item.data?.itemType ?? '';
		const entry = type === 'note' || type === 'attachment' ? undefined : parseEntries(item.bibtex ?? '')[0];
		return entry ? [{ id: item.key, itemType: type, entry }] : [];
	});
}
