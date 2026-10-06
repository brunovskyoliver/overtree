// Test zips built in memory with fflate (no binary zips in the repo). Functions, so the big ones
// are only built by the tests that need them.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { strToU8, zipSync, type Zippable } from 'fflate';

const MULTI = join(import.meta.dirname, 'multi');

/** Every file under `dir` keyed by its slash path relative to `dir`. */
export function readTree(dir: string): Record<string, Uint8Array> {
	const out: Record<string, Uint8Array> = {};
	for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const full = join(entry.parentPath, entry.name);
		out[relative(dir, full).split('\\').join('/')] = readFileSync(full);
	}
	return out;
}

// flat keys: fflate takes 'a/b.tex' as the entry name as-is
const zip = (files: Zippable) => zipSync(files, { level: 6 });

export const zips = {
	roundtrip: () => zip(readTree(MULTI)),

	wrapped: () => zip(Object.fromEntries(Object.entries(readTree(MULTI)).map(([p, d]) => [`thesis-main/${p}`, d]))),

	junk: () =>
		zip({
			...readTree(MULTI),
			'__MACOSX/._main.tex': strToU8('resource fork'),
			'.DS_Store': strToU8('finder'),
			'chapters/.DS_Store': strToU8('finder')
		}),

	evil: () =>
		zip({
			'main.tex': strToU8('\\documentclass{article}\\begin{document}ok\\end{document}\n'),
			'../evil.tex': strToU8('escaped'),
			'/abs.tex': strToU8('absolute'),
			'C:\\x.tex': strToU8('drive letter'),
			// unix symlink: S_IFLNK in the upper 16 bits of the external attributes, target as data
			'link.tex': [strToU8('/etc/passwd'), { os: 3, attrs: (0o120777 << 16) >>> 0 }]
		}),

	// 2 MB of zeros, a few KB zipped: over IMPORT_MAX_MB=1, which the unit test sets (deflating 201 MB for the
	// default limit took up to 9 s under the full suite's load)
	bomb: () => zip({ 'main.tex': new Uint8Array(2 * 1024 * 1024) }),

	'too-many': () => zip(Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`f${i}.txt`, strToU8(String(i))]))),

	'not-a-zip': () => Uint8Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))
};
