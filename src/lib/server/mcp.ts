import { kindForName, pathOf, type FileEntry } from '../files.ts';
import { broadcast, canEdit, fileRoles, requireEditFiles, requireEditFolder, requireProject, requireUser, type Need } from './access.ts';
import type { User } from './auth.ts';
import { getServer } from './collab.ts';
import { compileProject, compileRoot } from './compile.ts';
import { createEntry, deleteEntry, ensureFolder, fail, FileError, findFolder, getMainFileId, listFiles, renameOrMove, setMainFile, setText } from './files.ts';
import { closeVersion, currentText } from './history.ts';
import { getLink, patchLink } from './github/links.ts';
import { createProject, kickOverridden, listProjects } from './projects.ts';
import { searchProject } from './search.ts';
import { isTemplate, TEMPLATES, templateText } from './templates.ts';
import type { TokenScope } from './tokens.ts';

// MCP server for coding agents (Claude Code, Codex): the Streamable HTTP transport, stateless, one JSON-RPC message
// per POST and a JSON reply, no SSE. Tools act as the token's user with the same checks as the HTTP routes; text
// edits go through Hocuspocus so open editors see them live and history credits the user. No SvelteKit imports.
// ponytail: hand-rolled JSON-RPC, tools only (no resources, prompts, progress or batching); the SDK if we need those

type Locals = { user?: User | null; token?: TokenScope };
type Args = Record<string, unknown>;
type Id = string | number | null;
type Reply = { jsonrpc: '2.0'; id: Id } & ({ result: unknown } | { error: { code: number; message: string } });

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS =
	'Overtree is a collaborative LaTeX editor. Call list_projects first: every other tool takes a project id from it. ' +
	'Files are addressed by slash path from the project root, e.g. chapters/intro.tex. Edits go live to collaborators ' +
	'with the project open and into its history under your user. Compile after changes to check your work.';

const rpcError = (id: Id, code: number, message: string): Reply => ({ jsonrpc: '2.0', id, error: { code, message } });
class ParamsError extends Error {}

// --- arguments, projects and paths ---------------------------------------------------------------------------------

function str(args: Args, key: string, optional = false): string {
	const v = args[key];
	if (v === undefined && optional) return '';
	if (typeof v !== 'string') fail(400, `${key} must be a string.`);
	return v as string;
}
const bool = (args: Args, key: string) => {
	if (args[key] !== undefined && typeof args[key] !== 'boolean') fail(400, `${key} must be true or false.`);
	return args[key] === true;
};

/** The project of `args.project` like a route resolves `[pid]`; a token scoped to another project gets the same 404. */
function project(locals: Locals, args: Args, need: Need = 'read') {
	const pid = str(args, 'project');
	if (locals.token?.projectId && locals.token.projectId !== pid) fail(404, 'Project not found.');
	return { pid, ...requireProject(locals, pid, need) };
}

/** The path's segments: a leading `/` or `./` is dropped, `..` and `.` are refused. */
function segments(path: string): string[] {
	const parts = path.replace(/^\.?\//, '').split('/').filter(Boolean);
	if (!parts.length) fail(400, 'path must name a file or folder.');
	if (parts.some((p) => p === '..' || p === '.')) fail(400, 'path must not contain . or .. segments.');
	return parts;
}

/** The entry at `parts`, matched case-sensitively, or null. */
function lookup(all: FileEntry[], parts: string[]): FileEntry | null {
	let at: FileEntry | undefined;
	for (const name of parts) {
		const parentId = at ? at.id : null;
		at = all.find((f) => f.parentId === parentId && f.name === name);
		if (!at) return null;
	}
	return at ?? null;
}

function resolve(pid: string, path: string): FileEntry {
	return lookup(listFiles(pid), segments(path)) ?? fail(404, `No file or folder at ${path}.`);
}

function textFile(pid: string, path: string): FileEntry {
	const f = resolve(pid, path);
	if (f.kind === 'folder') fail(400, `${path} is a folder.`);
	if (f.kind === 'binary') fail(400, `${path} is a binary file (${f.size ?? 0} bytes); only text files can be read or edited.`);
	return f;
}

/** The folder `parts` (null: the root), each missing level created; same checks as the files POST route's `folder`. */
function folderAt(pid: string, userId: string, parts: string[]): string | null {
	let parentId: string | null = null;
	let created = false;
	for (const name of parts) {
		const into: string | null = parentId;
		const found = findFolder(pid, into, name);
		if (!found) requireEditFolder(pid, userId, into);
		created ||= !found;
		parentId = found?.id ?? ensureFolder(pid, into, name, userId).id;
	}
	if (created) broadcast(pid, { type: 'tree' });
	return parentId;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- tools ---------------------------------------------------------------------------------------------------------

type Tool = {
	name: string;
	description: string;
	properties: Record<string, object>;
	required: string[];
	annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
	run: (locals: Locals, args: Args) => string | Promise<string>;
};

const P = { project: { type: 'string', description: 'Project id from list_projects.' } };
const PATH = { type: 'string', description: 'Slash path from the project root, e.g. chapters/intro.tex.' };
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const WRITE = (destructiveHint: boolean, idempotentHint: boolean) => ({ readOnlyHint: false, destructiveHint, idempotentHint });

const TOOLS: Tool[] = [
	{
		name: 'list_projects',
		description: 'The projects you can open: id, title, your role, owner and last change.',
		properties: {},
		required: [],
		annotations: READ,
		run: (locals) =>
			pretty(
				listProjects(requireUser(locals).id)
					.filter((p) => !locals.token?.projectId || p.id === locals.token.projectId)
					.map((p) => ({ id: p.id, title: p.title, role: p.role, owner: p.owner?.name ?? null, updated: new Date(p.updatedAt).toISOString() }))
			)
	},
	{
		name: 'create_project',
		description: 'Create a project you own with a main.tex from a template. Returns its id.',
		properties: { title: { type: 'string' }, template: { type: 'string', enum: [...TEMPLATES], default: 'blank' } },
		required: ['title'],
		annotations: WRITE(false, false),
		run: (locals, args) => {
			const user = requireUser(locals);
			if (locals.token?.projectId) fail(403, 'This token is limited to one project and can’t create projects.');
			const t = args.template ?? 'blank';
			const template = isTemplate(t) ? t : fail(400, `template must be one of ${TEMPLATES.join(', ')}.`);
			const title = str(args, 'title').trim();
			return pretty({ id: createProject({ ownerId: user.id, title, mainText: templateText(template, title) }) });
		}
	},
	{
		name: 'list_files',
		description: 'Every file and folder of a project by path, with the main document and whether you may edit each.',
		properties: P,
		required: ['project'],
		annotations: READ,
		run: (locals, args) => {
			const { pid, user } = project(locals, args);
			const all = listFiles(pid);
			const { roleOf } = fileRoles(pid, user.id);
			const main = getMainFileId(pid);
			const files = all
				.map((f) => ({ path: pathOf(f.id, all), kind: f.kind, ...(f.size != null && { size: f.size }), can_edit: canEdit(roleOf(f.id)) }))
				.sort((a, b) => a.path.localeCompare(b.path));
			return pretty({ main: main ? pathOf(main, all) : null, files });
		}
	},
	{
		name: 'read_file',
		description: 'The current text of a text file, including edits collaborators haven’t saved as a version yet.',
		properties: { ...P, path: PATH },
		required: ['project', 'path'],
		annotations: READ,
		run: (locals, args) => {
			const { pid } = project(locals, args);
			return currentText(textFile(pid, str(args, 'path')).id);
		}
	},
	{
		name: 'write_file',
		description: 'Create a text file (and missing folders) or replace a text file’s whole content. Prefer edit_file for changes to an existing file.',
		properties: { ...P, path: PATH, content: { type: 'string' } },
		required: ['project', 'path', 'content'],
		annotations: WRITE(true, true),
		run: async (locals, args) => {
			const { pid, user } = project(locals, args);
			const path = str(args, 'path');
			const content = str(args, 'content');
			const parts = segments(path);
			if (kindForName(parts.at(-1)!) !== 'text') fail(400, 'write_file only writes text files (.tex, .bib, .sty, .md, …).');
			const ctx = { userId: user.id, projectId: pid };
			const existing = lookup(listFiles(pid), parts);
			if (existing) {
				if (existing.kind !== 'text') fail(400, `${path} is a ${existing.kind}, not a text file.`);
				requireEditFiles(pid, user.id, [existing.id]);
				await setText(existing.id, content, ctx);
				return `Replaced ${path} (${plural(content.length, 'character')}).`;
			}
			const parentId = folderAt(pid, user.id, parts.slice(0, -1));
			requireEditFolder(pid, user.id, parentId);
			const entry = createEntry(pid, { kind: 'text', name: parts.at(-1)!, parentId }, user.id);
			broadcast(pid, { type: 'tree' });
			await setText(entry.id, content, ctx);
			return `Created ${path} (${plural(content.length, 'character')}).`;
		}
	},
	{
		name: 'edit_file',
		description:
			'Replace old_string with new_string in a text file. old_string must match exactly once unless replace_all is true. Returns how many were replaced.',
		properties: { ...P, path: PATH, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean', default: false } },
		required: ['project', 'path', 'old_string', 'new_string'],
		annotations: WRITE(false, false),
		run: async (locals, args) => {
			const { pid, user } = project(locals, args);
			const path = str(args, 'path');
			const [from, to, all] = [str(args, 'old_string'), str(args, 'new_string'), bool(args, 'replace_all')];
			if (!from) fail(400, 'old_string must not be empty.');
			const f = textFile(pid, path);
			requireEditFiles(pid, user.id, [f.id]);
			let found = 0;
			// counted on the live text inside the transaction, so concurrent typing can't shift a match under us
			const conn = await getServer().hocuspocus.openDirectConnection(f.id, { userId: user.id, projectId: pid });
			try {
				await conn.transact((doc) => {
					const t = doc.getText('content');
					const text = t.toString();
					const at: number[] = [];
					for (let i = text.indexOf(from); i >= 0; i = text.indexOf(from, i + from.length)) at.push(i);
					found = at.length;
					if (!found || (found > 1 && !all)) return;
					// from the end: earlier offsets stay valid
					for (const i of at.reverse()) {
						t.delete(i, from.length);
						if (to) t.insert(i, to);
					}
				});
			} finally {
				await conn.disconnect();
			}
			if (!found) fail(400, `old_string was not found in ${path}.`);
			if (found > 1 && !all) fail(400, `old_string matches ${found} times in ${path}. Add context to make it unique or set replace_all.`);
			return `Replaced ${plural(found, 'occurrence')} in ${path}.`;
		}
	},
	{
		name: 'delete_file',
		description:
			'Delete a file, or a folder with everything in it. History keeps the old versions. In a GitHub-linked project the ' +
			'deletion is pushed to the repo unless the path matches github_ignore.',
		properties: { ...P, path: PATH },
		required: ['project', 'path'],
		annotations: WRITE(true, true),
		run: (locals, args) => {
			const { pid, user } = project(locals, args);
			const path = str(args, 'path');
			const f = resolve(pid, path);
			requireEditFiles(pid, user.id, [f.id]);
			deleteEntry(pid, f.id, user.id);
			broadcast(pid, { type: 'tree' });
			return `Deleted ${path}.`;
		}
	},
	{
		name: 'move_file',
		description: 'Rename and/or move a file or folder. new_path is the full new path; missing folders are created.',
		properties: { ...P, path: PATH, new_path: PATH },
		required: ['project', 'path', 'new_path'],
		annotations: WRITE(false, false),
		run: (locals, args) => {
			const { pid, user } = project(locals, args);
			const [path, newPath] = [str(args, 'path'), str(args, 'new_path')];
			const f = resolve(pid, path);
			const parts = segments(newPath);
			requireEditFiles(pid, user.id, [f.id]);
			const parentId = folderAt(pid, user.id, parts.slice(0, -1));
			const moved = parentId !== f.parentId;
			if (moved) requireEditFolder(pid, user.id, parentId);
			renameOrMove(pid, f.id, { name: parts.at(-1)!, ...(moved && { parentId }) }, user.id);
			broadcast(pid, { type: 'tree' });
			if (moved) kickOverridden(pid); // per-file roles may differ in the new place, like the PATCH route
			return `Moved ${path} to ${parts.join('/')}.`;
		}
	},
	{
		name: 'set_main_file',
		description: 'Make a .tex file the main document that compile builds.',
		properties: { ...P, path: PATH },
		required: ['project', 'path'],
		annotations: WRITE(false, true),
		run: (locals, args) => {
			const { pid, user } = project(locals, args, 'edit');
			const path = str(args, 'path');
			setMainFile(pid, resolve(pid, path).id, user.id);
			broadcast(pid, { type: 'project' });
			return `${path} is now the main document.`;
		}
	},
	{
		name: 'search',
		description: 'Search every text file of a project. One line per match: path:line: excerpt.',
		properties: {
			...P,
			query: { type: 'string' },
			regex: { type: 'boolean', default: false },
			case_sensitive: { type: 'boolean', default: false },
			whole_word: { type: 'boolean', default: false }
		},
		required: ['project', 'query'],
		annotations: READ,
		run: (locals, args) => {
			const { pid, user } = project(locals, args);
			const o = { query: str(args, 'query'), regex: bool(args, 'regex'), caseSensitive: bool(args, 'case_sensitive'), wholeWord: bool(args, 'whole_word') };
			const r = searchProject(pid, user.id, o);
			if (!r.total) return 'No matches.';
			const lines = r.files.flatMap((f) => f.matches.map((m) => `${f.path}:${m.line}: ${m.before}${m.match}${m.after}`));
			const head = `${plural(r.total, 'match', 'matches')} in ${plural(r.files.length, 'file')}${r.truncated ? ' (stopped at the cap, narrow the search)' : ''}:`;
			return [head, ...lines].join('\n');
		}
	},
	{
		name: 'github_ignore',
		description:
			'Owner only, GitHub-linked projects: the “Not pulled from GitHub” glob patterns. Matching paths are neither pulled ' +
			'nor pushed, so deleting them here afterwards leaves them on GitHub (until a pattern is removed: then the next push ' +
			'deletes them there). Without patterns: the current list. With patterns: replaces the whole list, so keep the ' +
			'defaults you read.',
		properties: { ...P, patterns: { type: 'array', items: { type: 'string' }, description: 'Optional: the new full list, one glob each.' } },
		required: ['project'],
		annotations: WRITE(false, true),
		run: async (locals, args) => {
			const { pid, user } = project(locals, args, 'owner');
			if (!getLink(pid)) fail(404, 'This project isn’t linked to a GitHub repository.');
			if (args.patterns !== undefined) await patchLink(pid, user.id, { ignore: args.patterns });
			return (JSON.parse(getLink(pid)!.ignore) as string[]).join('\n');
		}
	},
	{
		name: 'compile',
		description:
			'Compile the main document (or path: a standalone .tex) with the project’s compiler and return the errors and warnings from the log.',
		properties: { ...P, path: { ...PATH, description: 'Optional: a .tex file to compile on its own instead of the main document.' } },
		required: ['project'],
		annotations: WRITE(false, true),
		run: async (locals, args) => {
			const { pid } = project(locals, args);
			const path = str(args, 'path', true);
			const root = compileRoot(pid, path ? resolve(pid, path).id : null);
			closeVersion(pid, 'compile');
			const r = await compileProject(pid, { stopOnFirstError: false }, root);
			const of = (level: string) => r.entries.filter((e) => e.level === level);
			const typesetting = of('typesetting');
			const picked = [...of('error'), ...of('warning'), ...of('chktex'), ...(typesetting.length <= 10 ? typesetting : [])];
			const CAP = 50;
			return pretty({
				status: r.status,
				...(r.message && { message: r.message }),
				duration_ms: r.durationMs,
				errors: of('error').length,
				warnings: of('warning').length + of('chktex').length,
				entries: picked.slice(0, CAP).map((e) => ({
					level: e.level,
					...(e.file && { at: e.line ? `${e.file}:${e.line}` : e.file }),
					message: e.message,
					...(e.hint && { hint: e.hint.explanation })
				})),
				...(picked.length > CAP && { omitted: picked.length - CAP }),
				...(typesetting.length > 10 && { typesetting_skipped: typesetting.length })
			});
		}
	}
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// --- JSON-RPC ------------------------------------------------------------------------------------------------------

async function call(locals: Locals, method: string, params: Args): Promise<unknown> {
	switch (method) {
		case 'initialize': {
			const asked = params.protocolVersion;
			return {
				protocolVersion: VERSIONS.includes(asked as string) ? asked : '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'overtree', version: '1.0.0' },
				instructions: INSTRUCTIONS
			};
		}
		case 'ping':
			return {};
		case 'tools/list':
			return {
				tools: TOOLS.map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: { type: 'object', properties: t.properties, required: t.required, additionalProperties: false },
					annotations: t.annotations
				}))
			};
		case 'tools/call': {
			const tool = typeof params.name === 'string' ? BY_NAME.get(params.name) : undefined;
			if (!tool) throw new ParamsError(`Unknown tool: ${String(params.name)}`);
			const args = params.arguments ?? {};
			if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new ParamsError('arguments must be an object');
			try {
				return { content: [{ type: 'text', text: await tool.run(locals, args as Args) }] };
			} catch (e) {
				if (e instanceof FileError) return { content: [{ type: 'text', text: e.message }], isError: true };
				throw e;
			}
		}
		default:
			return undefined;
	}
}

/** One JSON-RPC message (the POST body) → the reply, or null for a notification or a client's response (HTTP 202). */
export async function handleMcp(locals: Locals, body: string): Promise<Reply | null> {
	let msg: unknown;
	try {
		msg = JSON.parse(body);
	} catch {
		return rpcError(null, -32700, 'Parse error');
	}
	if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request');
	const m = msg as Args;
	const id = m.id;
	if (m.jsonrpc !== '2.0' || (id !== undefined && typeof id !== 'string' && typeof id !== 'number')) return rpcError(null, -32600, 'Invalid Request');
	if (m.method === undefined && ('result' in m || 'error' in m)) return null; // a response to a request we never send
	if (typeof m.method !== 'string') return rpcError((id as Id) ?? null, -32600, 'Invalid Request');
	if (id === undefined) return null; // notifications/initialized, cancelled: nothing to do statelessly
	const params = m.params ?? {};
	if (typeof params !== 'object' || params === null || Array.isArray(params)) return rpcError(id, -32602, 'params must be an object');
	try {
		const result = await call(locals, m.method, params as Args);
		return result === undefined ? rpcError(id, -32601, `Method not found: ${m.method}`) : { jsonrpc: '2.0', id, result };
	} catch (e) {
		if (e instanceof ParamsError) return rpcError(id, -32602, e.message);
		console.error('mcp', m.method, e);
		return rpcError(id, -32603, 'Internal error');
	}
}
