import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// fresh data per run; exported so specs can delete compile output (clearCompileOutput)
// ponytail: the config is evaluated again in each worker, keep the first dir
const DATA_DIR = (process.env.OVERTREE_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'overtree-e2e-')));

// The `clerk` smoke project (tests/e2e/clerk.smoke.spec.ts) runs against the real Clerk dev instance on its own
// server without the test bypass; only with both keys in the environment.
const CLERK_PORT = 4174;
const clerkKeys = !!(process.env.CLERK_SECRET_KEY && process.env.PUBLIC_CLERK_PUBLISHABLE_KEY);
const CLERK_DATA_DIR = clerkKeys ? (process.env.OVERTREE_E2E_CLERK_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'overtree-e2e-clerk-'))) : '';

export default defineConfig({
	testDir: 'tests/e2e',
	// one shared server: specs run one at a time (each test works in its own project)
	workers: 1,
	fullyParallel: false,
	use: { baseURL: `http://127.0.0.1:${PORT}` },
	// clerkSetup() (testing token for the smoke set) when the keys are there; a no-op otherwise
	globalSetup: './tests/e2e/global-setup.ts',
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /\.smoke\.spec\.ts$/ },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /\.smoke\.spec\.ts$/ },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /\.smoke\.spec\.ts$/ },
		{ name: 'clerk', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${CLERK_PORT}` }, testMatch: /\.smoke\.spec\.ts$/ }
	],
	webServer: [
		{
			command: 'pnpm build && node server.ts',
			url: `http://127.0.0.1:${PORT}/sign-in`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				PORT: String(PORT),
				DATA_DIR,
				PUBLIC_TEST_HOOKS: '1',
				// test sign-in bypass (research R4): helpers.ts signs every context in as admin@test.local
				OVERTREE_TEST_AUTH: '1',
				// never Clerk here, even with the keys exported for the clerk project
				PUBLIC_CLERK_PUBLISHABLE_KEY: '',
				CLERK_SECRET_KEY: '',
				ADMIN_EMAILS: 'admin@test.local',
				COMPILE_TIMEOUT_MS: '5000',
				// upload.spec refuses a file just over this; no other spec uploads more than a few KB
				UPLOAD_MAX_FILE_MB: '1'
			}
		},
		// started after the first one (Playwright sets web servers up in order), so it reuses that build
		...(clerkKeys
			? [
					{
						command: 'node server.ts',
						url: `http://localhost:${CLERK_PORT}/sign-in`,
						reuseExistingServer: false,
						timeout: 60_000,
						env: {
							PORT: String(CLERK_PORT),
							HOST: 'localhost',
							DATA_DIR: CLERK_DATA_DIR,
							PUBLIC_TEST_HOOKS: '1',
							PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.PUBLIC_CLERK_PUBLISHABLE_KEY!,
							CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY!,
							OVERTREE_TEST_AUTH: '',
							COMPILE_TIMEOUT_MS: '5000'
						}
					}
				]
			: [])
	]
});
