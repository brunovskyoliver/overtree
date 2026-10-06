import { error } from '@sveltejs/kit';
import { FileError } from './files.ts';

/** Runs a file-service call in a route, turning its FileError into SvelteKit's `error()` (`{ message }` + status).
 *  Async calls work too: the returned promise rejects with the converted error. */
export function api<T>(fn: () => T): T {
	const convert = (e: unknown): never => {
		if (e instanceof FileError) error(e.status, { message: e.message, ...(e.existingId && { existingId: e.existingId }) });
		throw e;
	};
	try {
		const r = fn();
		return (r instanceof Promise ? r.catch(convert) : r) as T;
	} catch (e) {
		return convert(e);
	}
}

// RFC 5987 (`filename*=UTF-8''…`): encodeURIComponent leaves ' ( ) * as they are
export const attrChars = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
