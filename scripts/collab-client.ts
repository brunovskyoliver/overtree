// Tiny collab client for scripts/compose-smoke.sh and manual checks.
//   node scripts/collab-client.ts <ws-url> refused                  connect without a token; exit 0 once the server refuses
//   node scripts/collab-client.ts <ws-url> <project-id> read        print the project's main document
//   node scripts/collab-client.ts <ws-url> <project-id> append <t>  append text to it, wait until the server has it
// read/append need OVERTREE_TOKEN: a Clerk session JWT (in a signed-in tab's console: `await Clerk.session.getToken()`,
// valid for about a minute), or `test:<email>` against `pnpm dev` with OVERTREE_TEST_AUTH=1.
import { HocuspocusProvider } from '@hocuspocus/provider';

const [url, a, b, arg = ''] = process.argv.slice(2);
const mode = a === 'refused' ? a : b;
const token = mode === 'refused' ? null : process.env.OVERTREE_TOKEN;
if (!url || !['refused', 'read', 'append'].includes(mode) || (mode !== 'refused' && !token)) {
	console.error('usage: collab-client.ts <ws-url> refused | OVERTREE_TOKEN=… collab-client.ts <ws-url> <project-id> read|append [text]');
	process.exit(2);
}

let name = 'refused-check';
if (mode !== 'refused') {
	// documents are named by file id: ask the app for the project's main document
	const api = `${url.replace(/^ws/, 'http').replace(/\/collab$/, '')}/api/projects/${a}`;
	const headers: Record<string, string> = token!.startsWith('test:')
		? { cookie: `overtree-test-user=${encodeURIComponent(token!.slice(5))}` }
		: { authorization: `Bearer ${token}` };
	const res = await fetch(api, { headers });
	if (!res.ok) {
		console.error(`collab-client: GET ${api} → ${res.status}`);
		process.exit(1);
	}
	name = (await res.json()).mainFileId;
}

const provider = new HocuspocusProvider({ url, name, token });
const text = provider.document.getText('content');

const timeout = setTimeout(() => {
	console.error(`collab-client: timed out (${mode})`);
	process.exit(1);
}, 15_000);

provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
	if (mode === 'refused') return done();
	console.error(`collab-client: authentication failed (${reason})`);
	process.exit(1);
});

provider.on('synced', () => {
	if (mode === 'refused') {
		console.error('collab-client: connected without a token');
		process.exit(1);
	}
	if (mode === 'read') {
		process.stdout.write(text.toString());
		return done();
	}
	text.insert(text.length, arg);
	const check = () => !provider.hasUnsyncedChanges && done();
	provider.on('unsyncedChanges', check);
	check();
});

function done() {
	clearTimeout(timeout);
	provider.destroy();
	process.exit(0);
}
