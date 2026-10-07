import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { githubConfig } from './config.ts';

// Sealed GitHub user tokens (research R10) and the signed OAuth `state` (contracts "GET /api/github/connect").
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const IV = 12;
const TAG = 16;
export const STATE_MS = 10 * 60_000;

function config() {
	const c = githubConfig();
	if (!c) throw new Error('GitHub sync is not configured');
	return c;
}

let cached: { pem: string; key: Buffer } | null = null;
/** AES-256 key = HKDF-SHA256(App private key, info 'overtree-github-tokens'). ponytail: rotating the App key makes
 *  stored tokens unreadable, their owners reconnect (R10). */
function tokenKey(): Buffer {
	const pem = config().privateKey;
	if (cached?.pem !== pem) cached = { pem, key: Buffer.from(hkdfSync('sha256', pem, Buffer.alloc(0), 'overtree-github-tokens', 32)) };
	return cached.key;
}

/** `text` encrypted with AES-256-GCM: iv ‖ tag ‖ ciphertext. */
export function seal(text: string): Buffer {
	const iv = randomBytes(IV);
	const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
	const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** The text `seal` encrypted; throws when `buf` was altered or sealed with another key. */
export function open(buf: Uint8Array): string {
	const b = Buffer.from(buf);
	if (b.length < IV + TAG) throw new Error('sealed token too short');
	const decipher = createDecipheriv('aes-256-gcm', tokenKey(), b.subarray(0, IV));
	decipher.setAuthTag(b.subarray(IV, IV + TAG));
	return Buffer.concat([decipher.update(b.subarray(IV + TAG)), decipher.final()]).toString('utf8');
}

export type OAuthState = { userId: string; return: string; nonce: string; exp: number };

const mac = (payload: string) => createHmac('sha256', config().clientSecret).update(payload).digest();

/** `payload.signature`, both base64url; nonce and expiry (now + 10 min) filled in when not given. */
export function signState(s: Pick<OAuthState, 'userId' | 'return'> & Partial<OAuthState>): string {
	const state: OAuthState = { nonce: randomBytes(16).toString('base64url'), exp: Date.now() + STATE_MS, ...s };
	const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
	return `${payload}.${mac(payload).toString('base64url')}`;
}

/** The state `signState` made, or null when the signature is wrong, it expired or it is malformed. */
export function verifyState(s: string, now = Date.now()): OAuthState | null {
	const [payload, sig, extra] = s.split('.');
	if (!payload || !sig || extra !== undefined) return null;
	const given = Buffer.from(sig, 'base64url');
	const want = mac(payload);
	if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
	try {
		const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
		if (typeof state.userId !== 'string' || typeof state.return !== 'string' || typeof state.exp !== 'number') return null;
		return state.exp > now ? state : null;
	} catch {
		return null;
	}
}
