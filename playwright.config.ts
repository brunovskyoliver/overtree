import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// fresh data per run; exported so specs can delete compile output (clearCompileOutput)
// ponytail: the config is evaluated again in each worker, keep the first dir
const DATA_DIR = (process.env.OVERTREE_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'overtree-e2e-')));

export default defineConfig({
	testDir: 'tests/e2e',
	// one shared server + document: specs run one at a time
	workers: 1,
	fullyParallel: false,
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
			DATA_DIR,
			PUBLIC_TEST_HOOKS: '1',
			COMPILE_TIMEOUT_MS: '5000'
		}
	}
});
