import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { attachCollab } from './src/lib/server/collab.ts';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		}),
		{
			name: 'overtree-collab',
			apply: 'serve',
			// `pnpm dev` serves /collab on the Vite server; prod does the same in server.ts
			configureServer(server) {
				if (server.httpServer && !process.env.VITEST) attachCollab(server.httpServer as import('node:http').Server);
			}
		}
	],
	test: {
		include: ['tests/unit/**/*.test.ts']
	}
});
