import { describe, expect, it } from 'vitest';
import { listFiles } from '../../src/lib/server/files.ts';
import { pathOf } from '../../src/lib/files.ts';
import { memberships } from '../../src/lib/server/schema.ts';
import { dropped, itemPath, picked, withoutJunk } from '../../src/lib/upload.ts';
import * as filesRoute from '../../src/routes/api/projects/[pid]/files/+server.ts';
import { ev, hit, OWNER, project, start, user } from './helpers.ts';

// Uploading a folder from the desktop: the files it holds, with their folders (lib/upload.ts), and the route making
// each folder level (`folder` = "thesis/figs").

const file = (name: string, relative = '') => Object.defineProperty(new File(['x'], name), 'webkitRelativePath', { value: relative });

/** A FileSystemEntry tree like a dropped folder's; directories hand out their entries in batches of two. */
function entry(name: string, children?: FileSystemEntry[]): FileSystemEntry {
	if (!children) return { name, isFile: true, isDirectory: false, file: (ok: (f: File) => void) => ok(file(name)) } as unknown as FileSystemEntry;
	return {
		name,
		isFile: false,
		isDirectory: true,
		createReader: () => {
			let at = 0;
			return { readEntries: (ok: (e: FileSystemEntry[]) => void) => ok(children.slice(at, (at += 2))) };
		}
	} as unknown as FileSystemEntry;
}

describe('the files of a picked or dropped folder', () => {
	it('picked: the folder path from webkitRelativePath; a plain file has none', () => {
		expect(picked([file('a.png', 'thesis/figs/a.png'), file('main.tex', 'thesis/main.tex'), file('loose.txt')]).map(itemPath)).toEqual([
			'thesis/figs/a.png',
			'thesis/main.tex',
			'loose.txt'
		]);
	});

	it('dropped: every file of the folder and its subfolders, all batches read', async () => {
		const tree = entry('thesis', [entry('main.tex'), entry('refs.bib'), entry('figs', [entry('a.png'), entry('b.png'), entry('c.png')]), entry('.DS_Store')]);
		const items = await dropped(tree);
		expect(items.map(itemPath).sort()).toEqual(['thesis/.DS_Store', 'thesis/figs/a.png', 'thesis/figs/b.png', 'thesis/figs/c.png', 'thesis/main.tex', 'thesis/refs.bib']);
		expect((await dropped(entry('loose.tex'))).map(itemPath)).toEqual(['loose.tex']);
	});

	it('leaves out junk: .DS_Store, Thumbs.db, anything in .git or __MACOSX', () => {
		const items = picked([
			file('main.tex', 'thesis/main.tex'),
			file('.DS_Store', 'thesis/.DS_Store'),
			file('Thumbs.db', 'thesis/figs/Thumbs.db'),
			file('HEAD', 'thesis/.git/HEAD'),
			file('x.png', '__MACOSX/thesis/x.png')
		]);
		expect(withoutJunk(items).map(itemPath)).toEqual(['thesis/main.tex']);
	});
});

const form = (fields: Record<string, string | File>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return new Request('http://x/', { method: 'POST', body: f });
};
const send = (email: string, pid: string, name: string, folder: string) =>
	hit(filesRoute.POST, ev(email, { pid }, form({ file: new File(['\\section{A}'], name), parentId: '', folder })));

describe('the upload route with a folder path', () => {
	it('makes each missing level once and puts the file in the deepest', async () => {
		await start();
		const pid = project();
		expect((await send(OWNER, pid, 'a.tex', 'thesis/chapters')).status).toBe(201);
		expect((await send(OWNER, pid, 'b.tex', 'thesis/chapters')).status).toBe(201);
		expect((await send(OWNER, pid, 'main.tex', 'thesis')).status).toBe(201);
		const files = listFiles(pid);
		expect(files.map((f) => pathOf(f.id, files)).sort()).toEqual(['main.tex', 'thesis', 'thesis/chapters', 'thesis/chapters/a.tex', 'thesis/chapters/b.tex', 'thesis/main.tex']);
	});

	it('refuses a bad level before making any, and readers', async () => {
		const server = await start();
		const pid = project();
		expect((await send(OWNER, pid, 'a.tex', 'ok/../x')).status).toBe(400);
		server.db.insert(memberships).values({ projectId: pid, userId: user('r@test.local').id, role: 'reader', viaLink: false, createdAt: Date.now() }).run();
		expect((await send('r@test.local', pid, 'a.tex', 'thesis/figs')).status).toBe(403);
		expect(listFiles(pid).map((f) => f.name)).toEqual(['main.tex']);
	});
});
