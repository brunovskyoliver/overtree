// Production entry: SvelteKit handler + /collab on one HTTP server. Run with `node server.ts`.
import { createServer } from 'node:http';
import { attachCollab } from './src/lib/server/collab.ts';

// non-literal path so svelte-check doesn't type-check the generated build output
const { handler } = await import(new URL('./build/handler.js', import.meta.url).href);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1'; // the Docker image sets 0.0.0.0

const server = createServer(handler);
attachCollab(server);
server.listen(port, host, () => console.log(`Overtree on http://${host}:${port}`));
