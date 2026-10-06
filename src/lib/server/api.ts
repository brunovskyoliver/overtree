import { error } from '@sveltejs/kit';
import { FileError } from './files.ts';

/** Runs a file-service call in a route, turning its FileError into SvelteKit's `error()` (`{ message }` + status). */
export function api<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof FileError) error(e.status, e.message);
		throw e;
	}
}
