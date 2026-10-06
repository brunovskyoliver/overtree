import { json } from '@sveltejs/kit';
import { scanBib, scanTex, type ProjectSymbols } from '#lib/completion/scan.ts';
import { pathOf } from '#lib/files.ts';
import { getText, listFiles } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

// Symbols of every text file (research R13). `exclude` lists files the browser scans itself (its open tabs).
// ponytail: reads and scans every text file per request; cache per file version if projects get large
export const GET: RequestHandler = async ({ url }) => {
	const exclude = new Set(url.searchParams.get('exclude')?.split(','));
	const all = listFiles();
	const out: ProjectSymbols = { labels: [], commands: [], environments: [], bibKeys: [], files: [] };
	for (const f of all) {
		if (f.kind === 'folder') continue;
		out.files.push({ path: pathOf(f.id, all), kind: f.kind });
		if (f.kind !== 'text' || exclude.has(f.id)) continue;
		const text = await getText(f.id);
		if (f.name.toLowerCase().endsWith('.bib')) out.bibKeys.push(...scanBib(text));
		else {
			const s = scanTex(text);
			out.labels.push(...s.labels);
			out.commands.push(...s.commands);
			out.environments.push(...s.environments);
		}
	}
	return json(out);
};
