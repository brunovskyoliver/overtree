import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { authConfigProblem } from './src/lib/server/auth.ts';
import { attachCollab } from './src/lib/server/collab.ts';
import { githubConfigProblem } from './src/lib/server/github/config.ts';

export default defineConfig({
	resolve: {
		// spell-check dictionaries (editor/spelling.ts): their packages export only a Node loader; the browser fetches the files
		alias: [{ find: /^(dictionary-[a-z-]+)\/(index\.(?:aff|dic))/, replacement: `${fileURLToPath(new URL('node_modules', import.meta.url))}/$1/$2` }]
	},
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
				// dev without keys still starts (pages need sign-in, so nothing works until they're set): warn, don't exit
				const problem = authConfigProblem();
				if (problem && !process.env.VITEST) {
					if (process.env.NODE_ENV === 'production' && process.env.OVERTREE_TEST_AUTH === '1') throw new Error(problem);
					server.config.logger.warn(`Overtree: ${problem}`);
				}
				const githubProblem = githubConfigProblem();
				if (githubProblem && !process.env.VITEST) server.config.logger.warn(`Overtree: ${githubProblem}`);
				if (server.httpServer && !process.env.VITEST) attachCollab(server.httpServer as import('node:http').Server);
			}
		}
	],
	test: {
		include: ['tests/unit/**/*.test.ts'],
		// unit tests sign in through the test bypass (research R4)
		env: { OVERTREE_TEST_AUTH: '1' }
	}
});
