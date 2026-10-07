import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { getCompiler, setCompiler } from '../../src/lib/server/compile.ts';
import { createEntry, getMainFileId, getText, listFiles, setMainFile, setText, uploadFile } from '../../src/lib/server/files.ts';
import {
	createProject,
	deleteProject,
	duplicateProject,
	getProject,
	leaveProject,
	listProjects,
	normalizeTitle,
	renameProject
} from '../../src/lib/server/projects.ts';
import { documents, files, memberships, overrides, projects, updates } from '../../src/lib/server/schema.ts';
import { latexEscape, TEMPLATES, templateText } from '../../src/lib/server/templates.ts';
import * as importRoute from '../../src/routes/api/projects/import/+server.ts';
import * as listRoute from '../../src/routes/api/projects/+server.ts';
import * as projectRoute from '../../src/routes/api/projects/[pid]/+server.ts';
import * as leaveRoute from '../../src/routes/api/projects/[pid]/leave/+server.ts';
import { connect, OWNER, project, start, status, user, waitFor, type Started } from './helpers.ts';

// Projects on the dashboard (005 US2): templates, list, rename, duplicate, delete, leave.

const B = 'b@test.local';
const C = 'c@test.local';

function member(server: Started, pid: string, email: string, role: 'editor' | 'reader' | null, viaLink = false) {
	server.db
		.insert(memberships)
		.values({
			projectId: pid,
			userId: user(email).id,
			role,
			viaLink,
			createdAt: Date.now()
		})
		.run();
}

/** A route handler's response (status and JSON body), or the status of the error it throws. */
async function hit(handler: (event: never) => Response | Promise<Response>, event: object) {
	try {
		const res = await handler(event as never);
		return {
			status: res.status,
			body: res.status === 204 ? null : await res.json()
		};
	} catch (e) {
		return { status: (e as { status: number }).status, body: null };
	}
}

const locals = (email: string) => ({ user: user(email) });
const jsonRequest = (method: string, body: unknown) =>
	new Request('http://x/', {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

describe('templates', () => {
	it('every template creates a project with one main.tex holding its text, the title substituted', async () => {
		const server = await start();
		const me = user(OWNER);
		for (const template of TEMPLATES) {
			const { status: s, body } = await hit(listRoute.POST, {
				locals: { user: me },
				request: jsonRequest('POST', { title: ' Thesis ', template })
			});
			expect(s).toBe(201);
			const files = listFiles(body.id);
			expect(files.map((f) => f.name)).toEqual(['main.tex']);
			expect(getMainFileId(body.id)).toBe(files[0].id);
			expect(getProject(body.id)).toMatchObject({
				title: 'Thesis',
				ownerId: me.id
			});
			const text = await getText(files[0].id);
			expect(text).toBe(templateText(template, 'Thesis'));
			expect(text).toContain('\\documentclass');
			if (template !== 'letter') expect(text).toContain('\\title{Thesis}');
		}
		expect(server.db.select().from(projects).all()).toHaveLength(TEMPLATES.length);
	});

	it('escapes LaTeX specials in the title; unknown templates are refused', async () => {
		await start();
		expect(latexEscape('A & B_1 {50%} #x ~ ^ \\ $')).toBe(
			'A \\& B\\_1 \\{50\\%\\} \\#x \\textasciitilde{} \\textasciicircum{} \\textbackslash{} \\$'
		);
		expect(templateText('article', '$1')).toContain('\\title{\\$1}');
		expect(
			(
				await hit(listRoute.POST, {
					locals: locals(OWNER),
					request: jsonRequest('POST', { title: 'X', template: 'thesis' })
				})
			).status
		).toBe(400);
		// no template: blank
		const { body } = await hit(listRoute.POST, {
			locals: locals(OWNER),
			request: jsonRequest('POST', { title: 'X' })
		});
		expect(await getText(listFiles(body.id)[0].id)).toBe(templateText('blank', 'X'));
	});
});

describe('titles', () => {
	it('must be 1–120 characters after trimming', async () => {
		await start();
		expect(normalizeTitle('  Thesis  ')).toBe('Thesis');
		expect(normalizeTitle('x'.repeat(120))).toHaveLength(120);
		for (const bad of ['', '   ', 'x'.repeat(121), 42, null]) expect(status(() => normalizeTitle(bad))).toBe(422);
		for (const bad of ['', 'x'.repeat(121)])
			expect(
				(
					await hit(listRoute.POST, {
						locals: locals(OWNER),
						request: jsonRequest('POST', { title: bad, template: 'blank' })
					})
				).status
			).toBe(422);
	});

	it('only the owner renames; the rename bumps the last modified time', async () => {
		const server = await start();
		const pid = project(OWNER, 'Old');
		member(server, pid, B, 'editor');
		const before = getProject(pid)!.updatedAt;
		await new Promise((r) => setTimeout(r, 5));
		const patch = (email: string, title: unknown) =>
			hit(projectRoute.PATCH, {
				locals: locals(email),
				params: { pid },
				request: jsonRequest('PATCH', { title })
			});
		expect(await patch(B, 'Mine now')).toMatchObject({ status: 403 });
		expect(await patch(C, 'Mine now')).toMatchObject({ status: 404 });
		expect(await patch(OWNER, '  ')).toMatchObject({ status: 422 });
		expect(await patch(OWNER, ' New ')).toEqual({
			status: 200,
			body: { title: 'New' }
		});
		expect(getProject(pid)!.updatedAt).toBeGreaterThan(before);
		expect(status(() => renameProject('nope', 'X'))).toBe(404);
	});
});

describe('list', () => {
	it('lists own and shared projects with the caller’s role, most recently modified first', async () => {
		const server = await start();
		const set = (pid: string, updatedAt: number) => server.db.update(projects).set({ updatedAt }).where(eq(projects.id, pid)).run();
		const mine = project(OWNER, 'Mine');
		const edited = project(B, 'Edited');
		const read = project(B, 'Read');
		const linked = project(C, 'Linked');
		const hidden = project(C, 'Hidden');
		member(server, edited, OWNER, 'editor');
		member(server, read, OWNER, 'reader');
		member(server, linked, OWNER, null, true);
		member(server, hidden, OWNER, null, true); // link turned off: no access, not listed
		server.db.update(projects).set({ linkToken: 'tok', linkRole: 'editor' }).where(eq(projects.id, linked)).run();
		set(mine, 1000);
		set(edited, 4000);
		set(read, 3000);
		set(linked, 2000);

		const list = listProjects(user(OWNER).id);
		expect(list.map((p) => [p.title, p.role, p.owner?.name])).toEqual([
			['Edited', 'editor', 'b'],
			['Read', 'reader', 'b'],
			['Linked', 'editor', 'c'],
			['Mine', 'owner', 'owner']
		]);
		expect(list[0]).toEqual({
			id: edited,
			title: 'Edited',
			owner: { id: user(B).id, name: 'b' },
			role: 'editor',
			updatedAt: 4000
		});
		expect(listProjects(user('nobody@test.local').id)).toEqual([]);
		const { body } = await hit(listRoute.GET, { locals: locals(OWNER) });
		expect(body.projects.map((p: { id: string }) => p.id)).toEqual([edited, read, linked, mine]);
	});
});

describe('duplicate', () => {
	it('copies text (incl. unsaved edits), blobs, folders, main file and compiler, but not members', async () => {
		const server = await start();
		const pid = project(OWNER, 'Thesis');
		member(server, pid, B, 'reader');
		const [main] = listFiles(pid);
		// a folder with a text file and an image, the text file as main document, lualatex
		const folder = createEntry(pid, {
			kind: 'folder',
			name: 'ch',
			parentId: null
		}, user().id);
		const intro = createEntry(pid, {
			kind: 'text',
			name: 'intro.tex',
			parentId: folder.id
		}, user().id);
		await setText(intro.id, 'Intro text', {});
		const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
		await uploadFile(pid, folder.id, 'dot.png', png, false, user().id);
		setMainFile(pid, intro.id, user().id);
		setCompiler(pid, 'lualatex');
		// an open editor's latest change, maybe not stored yet
		const { text, provider } = await connect(server.url, main.id);
		text.insert(0, '% edited\n');
		await waitFor(() => !provider.hasUnsyncedChanges);

		const copy = await duplicateProject(pid, user(B).id);
		const p = getProject(copy)!;
		expect(p).toMatchObject({
			title: 'Copy of Thesis',
			ownerId: user(B).id,
			linkToken: null
		});
		const orig = server.db.select().from(files).where(eq(files.projectId, pid)).all();
		const dup = server.db.select().from(files).where(eq(files.projectId, copy)).all();
		expect(dup).toHaveLength(orig.length);
		expect(dup.some((f) => orig.some((o) => o.id === f.id))).toBe(false); // new ids
		const byName = (rows: typeof dup, name: string) => rows.find((f) => f.name === name)!;
		expect(byName(dup, 'intro.tex').parentId).toBe(byName(dup, 'ch').id);
		expect(byName(dup, 'dot.png')).toMatchObject({
			hash: byName(orig, 'dot.png').hash,
			size: png.length,
			parentId: byName(dup, 'ch').id
		});
		expect(p.mainFileId).toBe(byName(dup, 'intro.tex').id);
		expect(getCompiler(copy)).toBe('lualatex');
		// each text stored as exactly one update, before anyone opens it
		for (const f of dup.filter((f) => f.kind === 'text'))
			expect(server.db.select().from(updates).where(eq(updates.docName, f.id)).all()).toHaveLength(1);
		expect(await getText(byName(dup, 'main.tex').id)).toMatch(/^% edited\n\\documentclass/);
		expect(await getText(byName(dup, 'intro.tex').id)).toBe('Intro text');
		expect(server.db.select().from(memberships).where(eq(memberships.projectId, copy)).all()).toEqual([]);
		// the reader can copy; the copy is the reader's own
		expect(listProjects(user(B).id).find((x) => x.id === copy)?.role).toBe('owner');
	});

	it('cuts a long title to 120 characters', async () => {
		await start();
		const pid = project(OWNER, 'x'.repeat(120));
		expect(getProject(await duplicateProject(pid, user(OWNER).id))!.title).toBe(`Copy of ${'x'.repeat(112)}`);
	});
});

describe('delete', () => {
	it('removes files, documents, updates, memberships, overrides and compile output', async () => {
		const server = await start();
		const pid = project(OWNER);
		const other = project(OWNER, 'Other');
		member(server, pid, B, 'editor');
		const [main] = listFiles(pid);
		server.db
			.insert(overrides)
			.values({
				projectId: pid,
				userId: user(B).id,
				fileId: main.id,
				role: 'reader'
			})
			.run();
		// a stored snapshot, like after a restart
		server.db
			.insert(documents)
			.values({ name: main.id, state: Buffer.from([0]), updatedAt: 1 })
			.run();
		const out = join(server.dataDir, 'compile', pid);
		mkdirSync(out, { recursive: true });
		writeFileSync(join(out, 'output.pdf'), 'x');

		deleteProject(pid);
		expect(getProject(pid)).toBeNull();
		expect(server.db.select().from(files).where(eq(files.projectId, pid)).all()).toEqual([]);
		expect(server.db.select().from(documents).where(eq(documents.name, main.id)).all()).toEqual([]);
		expect(server.db.select().from(updates).where(eq(updates.docName, main.id)).all()).toEqual([]);
		expect(server.db.select().from(memberships).all()).toEqual([]);
		expect(server.db.select().from(overrides).all()).toEqual([]);
		expect(existsSync(out)).toBe(false);
		expect(listFiles(other)).toHaveLength(1); // the other project is untouched
	});
});

describe('leave', () => {
	it('removes only the caller’s membership and overrides; the owner can’t leave', async () => {
		const server = await start();
		const pid = project(OWNER);
		member(server, pid, B, 'editor');
		member(server, pid, C, 'reader');
		const [main] = listFiles(pid);
		server.db
			.insert(overrides)
			.values({
				projectId: pid,
				userId: user(B).id,
				fileId: main.id,
				role: 'reader'
			})
			.run();
		server.db
			.insert(overrides)
			.values({
				projectId: pid,
				userId: user(C).id,
				fileId: main.id,
				role: 'editor'
			})
			.run();
		const { provider } = await connect(server.url, main.id, B);
		let closed = 0;
		provider.on('close', ({ event }: { event: { code: number } }) => event.code === 4403 && closed++);

		const leave = (email: string) => hit(leaveRoute.POST, { locals: locals(email), params: { pid } });
		expect(await leave(OWNER)).toMatchObject({ status: 403 });
		expect(await leave('nobody@test.local')).toMatchObject({ status: 404 });
		expect(await leave(B)).toMatchObject({ status: 204 });
		expect(server.db.select({ userId: memberships.userId }).from(memberships).all()).toEqual([{ userId: user(C).id }]);
		expect(server.db.select({ userId: overrides.userId }).from(overrides).all()).toEqual([{ userId: user(C).id }]);
		expect(listProjects(user(B).id)).toEqual([]);
		await waitFor(() => closed > 0);
		expect(await leave(B)).toMatchObject({ status: 404 });
		expect(status(() => leaveProject(pid, user(OWNER).id))).toBe(403);
	});
});

describe('import', () => {
	it('creates a project from a zip, titled after the file unless a title is given', async () => {
		await start();
		const zip = zipSync({
			'paper/main.tex': strToU8('\\documentclass{article}\\begin{document}Hi\\end{document}'),
			'paper/refs.bib': strToU8('')
		});
		const post = (title?: string) => {
			const form = new FormData();
			form.set('file', new File([zip], 'My paper.zip'));
			if (title !== undefined) form.set('title', title);
			return hit(importRoute.POST, {
				locals: locals(OWNER),
				request: new Request('http://x/', { method: 'POST', body: form })
			});
		};
		const a = await post();
		expect(a.status).toBe(201);
		expect(getProject(a.body.id)).toMatchObject({
			title: 'My paper',
			ownerId: user(OWNER).id
		});
		expect(
			listFiles(a.body.id)
				.map((f) => f.name)
				.sort()
		).toEqual(['main.tex', 'refs.bib']);
		const b = await post('Named');
		expect(getProject(b.body.id)!.title).toBe('Named');
		expect((await post('x'.repeat(121))).status).toBe(422);
	});
});
