// OAuth state cookie shared by the connect and callback routes (012 contracts/http-api.md).
export const STATE_COOKIE = 'overtree_github_state';
export const STATE_PATH = '/api/github';

/** `ret` when it is a path on this site (`/project/x?github=1`), else null: no `//host`, `/\host`, schemes or
 *  control characters (no open redirect through the OAuth round trip). */
export function samePath(ret: string | null): string | null {
	if (!ret || !ret.startsWith('/') || ret.startsWith('//') || ret.startsWith('/\\') || /[\x00-\x1f\x7f\\]/.test(ret)) return null;
	try {
		const u = new URL(ret, 'http://overtree.invalid');
		return u.origin === 'http://overtree.invalid' ? u.pathname + u.search + u.hash : null;
	} catch {
		return null;
	}
}
