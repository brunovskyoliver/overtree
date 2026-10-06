// Tiny collab client for scripts/compose-smoke.sh.
//   node scripts/collab-client.ts <ws-url> append <text>   append text to main.tex, wait until the server has it
//   node scripts/collab-client.ts <ws-url> read            print main.tex
import { HocuspocusProvider } from '@hocuspocus/provider';

const [url, mode, arg = ''] = process.argv.slice(2);
// documents are named by file id: ask the app for main.tex's
const api = url.replace(/^ws/, 'http').replace(/\/collab$/, '/api/files');
const { files } = await (await fetch(api)).json();
const name = files.find((f: { name: string; parentId: string | null }) => f.name === 'main.tex' && !f.parentId).id;
const provider = new HocuspocusProvider({ url, name });
const text = provider.document.getText('content');

const timeout = setTimeout(() => {
	console.error(`collab-client: timed out (${mode})`);
	process.exit(1);
}, 15_000);

provider.on('synced', () => {
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
