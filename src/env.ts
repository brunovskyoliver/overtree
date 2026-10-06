import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_TEST_HOOKS: {
		public: true,
		description: 'Set to 1 to expose window.__overtree (Playwright).',
		schema: (value) => value === '1'
	}
});
