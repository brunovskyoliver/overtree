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
	// one shared server: specs run one at a time (each test works in its own project)
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
		// public and static: every page redirects to sign-in without a session
		url: `http://127.0.0.1:${PORT}/robots.txt`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			PORT: String(PORT),
			DATA_DIR,
			PUBLIC_TEST_HOOKS: '1',
			// test sign-in bypass (research R4): helpers.ts signs every context in as admin@test.local
			OVERTREE_TEST_AUTH: '1',
			ADMIN_EMAILS: 'admin@test.local',
			COMPILE_TIMEOUT_MS: '5000',
			// upload.spec refuses a file just over this; no other spec uploads more than a few KB
			UPLOAD_MAX_FILE_MB: '1'
		}
	}
});
