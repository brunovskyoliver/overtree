import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
	testDir: 'tests/e2e',
	use: { baseURL: `http://127.0.0.1:${PORT}` },
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } }
	],
	webServer: {
		command: 'pnpm build && node server.ts',
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			PORT: String(PORT),
			// fresh database per run
			DATA_DIR: mkdtempSync(join(tmpdir(), 'overtree-e2e-')),
			PUBLIC_TEST_HOOKS: '1'
		}
	}
});
