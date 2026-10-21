import { fail } from '../files.ts';

// Outgoing requests of "Add reference" (017 plan.md "Fetching"): fixed services only, so no request goes to a host
// a user typed (no SSRF), with a time limit, a size cap and errors a writer can act on. Base URLs come from the
// environment so tests point them at tests/fake-refs. Loaded unbundled by server.ts: no SvelteKit imports here.

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export const refsConfig = () => ({
	doiUrl: trimSlash(process.env.DOI_URL || 'https://doi.org'),
	arxivUrl: trimSlash(process.env.ARXIV_API_URL || 'https://export.arxiv.org/api/query'),
	zoteroUrl: trimSlash(process.env.ZOTERO_API_URL || 'https://api.zotero.org')
});

export const TIMEOUT_MS = 8000;
export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;

// doi.org answers content negotiation with a redirect to the registration agency's metadata service
// ponytail: Crossref, DataCite and mEDRA cover nearly all DOIs; add other agencies' hosts here when someone needs them
const DOI_AGENCIES = ['data.crossref.org', 'api.crossref.org', 'data.datacite.org', 'api.datacite.org', 'data.medra.org'];

/** Hosts `service` may be fetched from (redirects included): its configured base, plus the DOI agencies. */
export function allowedHosts(service: Service): Set<string> {
	const c = refsConfig();
	const base = { doi: c.doiUrl, arxiv: c.arxivUrl, zotero: c.zoteroUrl }[service];
	return new Set([new URL(base).host, ...(service === 'doi' ? DOI_AGENCIES : [])]);
}

export type Service = 'doi' | 'arxiv' | 'zotero';
const NAMES: Record<Service, string> = { doi: 'doi.org', arxiv: 'arXiv', zotero: 'Zotero' };

export type Fetched = { status: number; headers: Headers; text: string };

/** The body as text, refusing more than MAX_BYTES. */
async function readCapped(res: Response, service: Service): Promise<string> {
	if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
		await res.body?.cancel();
		fail(502, `${NAMES[service]} sent more data than Overtree accepts.`);
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = res.body?.getReader();
	if (!reader) return '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BYTES) {
			await reader.cancel();
			fail(502, `${NAMES[service]} sent more data than Overtree accepts.`);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/** GET `url` from `service` with its allowlist, a time limit and the size cap. Network trouble, a timeout or a
 *  redirect elsewhere become a FileError (502/504); HTTP error statuses are returned for the caller to explain. */
export async function fetchText(service: Service, url: string, headers: Record<string, string> = {}): Promise<Fetched> {
	const allowed = allowedHosts(service);
	const signal = AbortSignal.timeout(TIMEOUT_MS);
	let target = new URL(url);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (!allowed.has(target.host) || !/^https?:$/.test(target.protocol))
			fail(502, `${NAMES[service]} redirected to ${target.host}, which Overtree doesn’t fetch from.`);
		let res: Response;
		try {
			res = await fetch(target, { headers, redirect: 'manual', signal });
		} catch (e) {
			if (signal.aborted) fail(504, `${NAMES[service]} didn’t answer within ${TIMEOUT_MS / 1000} seconds. Try again later.`);
			fail(502, `Couldn’t reach ${NAMES[service]}. The server may be offline.`);
			throw e;
		}
		const location = res.headers.get('location');
		if (res.status >= 300 && res.status < 400 && location) {
			await res.body?.cancel();
			target = new URL(location, target);
			continue;
		}
		try {
			return { status: res.status, headers: res.headers, text: await readCapped(res, service) };
		} catch (e) {
			if (signal.aborted) fail(504, `${NAMES[service]} didn’t answer within ${TIMEOUT_MS / 1000} seconds. Try again later.`);
			throw e;
		}
	}
	return fail(502, `${NAMES[service]} redirected too often.`);
}

/** The usual HTTP failures of a lookup service as a FileError. */
export function statusError(service: Service, status: number): never {
	if (status === 429 || status === 503) fail(429, `${NAMES[service]} is rate-limiting requests. Wait a minute and try again.`);
	return fail(502, `${NAMES[service]} answered with an error (${status}). Try again later.`);
}
