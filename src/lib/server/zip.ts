import { randomUUID } from 'node:crypto';
import { strFromU8, Unzip, UnzipInflate, zipSync, type Zippable } from 'fflate';
import { kindForName, limits, pathOf, validateName } from '../files.ts';
import { collectProject } from './compile.ts';
import { FileError, listFiles, putBlob, readBlob, type Row } from './files.ts';
import { manifestPaths, type Manifest } from './history.ts';
import { insertProject } from './projects.ts';

// Project zip export and import (research R7).

const NOT_A_ZIP = 'This file is not a valid zip.';
const CHUNK = 16 * 1024; // pushed to the inflater at a time: deflate expands ~1000×, so at most ~16 MB in one step

/** Every folder (as a `dir/` entry) and file at its path; no compile output. */
export async function exportZip(pid: string): Promise<Uint8Array> {
	const all = listFiles(pid);
	const entries: Zippable = {};
	for (const f of all) if (f.kind === 'folder') entries[`${pathOf(f.id, all)}/`] = new Uint8Array();
	for (const { path, data } of (await collectProject(pid)).files) entries[path] = data;
	return zip(entries);
}

/** The project at a version (research R7): every folder as a `dir/` entry, texts and binaries from their blobs. */
export function manifestZip(manifest: Manifest): Uint8Array {
	const paths = manifestPaths(manifest.entries);
	const entries: Zippable = {};
	for (const e of manifest.entries) {
		const path = paths.get(e.id)!;
		entries[e.kind === 'folder' ? `${path}/` : path] = e.hash ? readBlob(e.hash) : new Uint8Array();
	}
	return zip(entries);
}

// ponytail: built in memory and blocks the event loop while compressing; the streaming `Zip` once projects grow
const zip = (entries: Zippable) => zipSync(entries, { level: 6 });

/** Names the central directory marks as Unix symlinks; fflate's reader doesn't expose external attributes.
 *  Throws (RangeError or FileError) when there is no readable central directory: not a zip. */
function symlinks(b: Uint8Array): Set<string> {
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let end = b.length - 22; // the end record is 22 bytes plus a comment of up to 64 KB
	while (end >= Math.max(0, b.length - 22 - 0xffff) && v.getUint32(end, true) !== 0x06054b50) end--;
	if (end < 0 || v.getUint32(end, true) !== 0x06054b50) throw new FileError(400, NOT_A_ZIP);
	let count = v.getUint16(end + 10, true);
	let at = v.getUint32(end + 16, true);
	if (count === 0xffff || at === 0xffffffff) {
		// Zip64: the locator just before the end record points at the Zip64 end record with the real values
		const z64 = Number(v.getBigUint64(end - 20 + 8, true));
		count = Number(v.getBigUint64(z64 + 32, true));
		at = Number(v.getBigUint64(z64 + 48, true));
	}
	const out = new Set<string>();
	for (let i = 0; i < count; i++) {
		if (v.getUint32(at, true) !== 0x02014b50) throw new FileError(400, NOT_A_ZIP);
		const nameLength = v.getUint16(at + 28, true);
		// S_IFLNK in the upper 16 bits of the external attributes
		if (((v.getUint32(at + 38, true) >>> 16) & 0o170000) === 0o120000)
			out.add(strFromU8(b.subarray(at + 46, at + 46 + nameLength), !(v.getUint16(at + 8, true) & 0x800))); // decoded like fflate
		at += 46 + nameLength + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
	}
	return out;
}

/** The entry's project path, or null for unsafe entries (`..`, absolute, drive letter, bad names) and junk. */
function cleanPath(name: string): string | null {
	const p = name.replaceAll('\\', '/');
	if (p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
	const parts = p.split('/').filter((s) => s && s !== '.');
	if (!parts.length || parts.some((s) => validateName(s, []) !== null)) return null; // also refuses '..'
	if (parts.includes('__MACOSX') || parts.at(-1) === '.DS_Store') return null;
	return parts.join('/');
}

type FileRow = Omit<Row, 'projectId'>;

/** A new project owned by `ownerId` with the zip's files; returns its id. Everything is read and checked before
 *  anything is written. */
export function importZipAsProject(ownerId: string, title: string, bytes: Uint8Array): string {
	const maxBytes = limits.importMaxMb * 1024 * 1024;
	const maxEntries = limits.projectMaxFiles;
	const tooBig = () => new FileError(413, `A project zip can unpack to at most ${limits.importMaxMb} MB.`);
	const tooMany = () => new FileError(413, `A project can have at most ${maxEntries} files.`);
	const entries: { path: string; data: Uint8Array | null }[] = []; // data null = folder
	try {
		const links = symlinks(bytes);
		let total = 0;
		const unzip = new Unzip((file) => {
			const path = links.has(file.name) ? null : cleanPath(file.name);
			const entry = path === null ? null : { path, data: file.name.endsWith('/') ? null : new Uint8Array() };
			if (entry) entries.push(entry);
			if (entries.length > maxEntries) throw tooMany();
			const chunks: Uint8Array[] = [];
			// skipped entries are inflated too: counting their real bytes keeps them under the limit as well
			file.ondata = (err, chunk, final) => {
				if (err) throw err;
				total += chunk.length;
				if (total > maxBytes) throw tooBig();
				chunks.push(chunk);
				if (final && entry?.data) entry.data = Buffer.concat(chunks);
			};
			file.start();
		});
		unzip.register(UnzipInflate);
		for (let i = 0; i < bytes.length; i += CHUNK) unzip.push(bytes.subarray(i, i + CHUNK), i + CHUNK >= bytes.length);
	} catch (e) {
		if (e instanceof FileError) throw e;
		throw new FileError(400, NOT_A_ZIP);
	}

	// one folder holding everything (GitHub's `repo-main/`, Overleaf's project folder): drop it
	const top = new Set(entries.map((e) => e.path.split('/')[0]));
	if (top.size === 1 && entries.every((e) => e.path.includes('/') || e.data === null)) {
		for (const e of entries) e.path = e.path.includes('/') ? e.path.slice(e.path.indexOf('/') + 1) : '';
	}

	// folders from dir entries and file paths; keys lower-case because names are unique case-insensitively
	const now = Date.now();
	const rows: FileRow[] = [];
	const folders = new Map<string, string>(); // lower-case path → id
	const folderId = (path: string): string | null => {
		if (!path) return null;
		const key = path.toLowerCase();
		let id = folders.get(key);
		if (!id) {
			const cut = path.lastIndexOf('/');
			const parentId = folderId(path.slice(0, Math.max(cut, 0)));
			id = randomUUID();
			folders.set(key, id);
			rows.push({ id, parentId, name: path.slice(cut + 1), kind: 'folder', hash: null, size: null, createdAt: now, updatedAt: now });
		}
		return id;
	};
	for (const e of entries) if (e.data === null && e.path) folderId(e.path);
	const dir = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
	for (const e of entries) if (e.data) folderId(dir(e.path));

	const texts = new Map<string, string>();
	const taken = new Set<string>();
	const tex: { id: string; path: string; text: string }[] = [];
	const blobs: { row: FileRow; data: Uint8Array }[] = [];
	for (const e of entries) {
		const key = e.path.toLowerCase();
		// a name used twice (or by a folder too): the first one wins
		if (!e.data || !e.path || folders.has(key) || taken.has(key)) continue;
		taken.add(key);
		const name = e.path.slice(e.path.lastIndexOf('/') + 1);
		let text: string | null = null;
		if (kindForName(name) === 'text') {
			try {
				text = new TextDecoder('utf-8', { fatal: true }).decode(e.data);
			} catch {
				// not UTF-8: stored as binary, like an upload
			}
		}
		const row: FileRow = {
			id: randomUUID(),
			parentId: folders.get(dir(key)) ?? null,
			name,
			kind: text === null ? 'binary' : 'text',
			hash: null,
			size: text === null ? e.data.length : null,
			createdAt: now,
			updatedAt: now
		};
		rows.push(row);
		if (text === null) blobs.push({ row, data: e.data });
		else {
			texts.set(row.id, text);
			if (name.toLowerCase().endsWith('.tex')) tex.push({ id: row.id, path: e.path, text });
		}
	}
	if (!rows.length) throw new FileError(400, 'The zip has no files to import.');
	if (rows.length > maxEntries) throw tooMany();

	// main: root main.tex, else the shallowest .tex with \documentclass (by path among equals), else none
	const depth = (p: string) => p.split('/').length;
	const main =
		tex.find((t) => t.path === 'main.tex') ??
		tex.filter((t) => t.text.includes('\\documentclass')).sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))[0];

	// blob files are content-addressed: writing them first leaves nothing visible if the swap fails
	for (const { row, data } of blobs) row.hash = putBlob(data);
	return insertProject({ ownerId, title }, rows, texts, main?.id ?? null);
}
