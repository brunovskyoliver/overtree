// Production entry: SvelteKit handler + /collab on one HTTP server. Run with `node server.ts`.
import { createServer } from 'node:http';
import { attachCollab } from './src/lib/server/collab.ts';

// adapter-node takes the protocol to be https unless told, and SvelteKit's CSRF check then refuses body-less
// DELETEs and form posts whose browser Origin says http. This server speaks plain HTTP: say so, unless the
// deployer set ORIGIN or a proxy's PROTOCOL_HEADER (e.g. x-forwarded-proto) for TLS in front.
const plainHttp = !process.env.ORIGIN && !process.env.PROTOCOL_HEADER;
if (plainHttp) process.env.PROTOCOL_HEADER = 'x-overtree-protocol';

// non-literal path so svelte-check doesn't type-check the generated build output
const { handler } = await import(new URL('./build/handler.js', import.meta.url).href);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1'; // the Docker image sets 0.0.0.0

const server = createServer((req, res) => {
	if (plainHttp) req.headers['x-overtree-protocol'] = 'http';
	handler(req, res);
});
attachCollab(server);
server.listen(port, host, () => console.log(`Overtree on http://${host}:${port}`));
