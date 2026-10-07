// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Hocuspocus } from '@hocuspocus/server';
import type { CompileState } from '#lib/compile.svelte.ts';
import type { EditorHandle } from '#lib/editor/types.ts';
import type { User } from '#lib/server/auth.ts';
import type { Db } from '#lib/server/db.ts';

declare global {
	namespace App {
		interface Error {
			message: string;
			/** 409 on upload: the file with the same name (contracts/files-api.md) */
			existingId?: string;
			/** 403 from hooks.server.ts: why the signed-in user is blocked */
			reason?: 'disabled' | 'not-allowed';
			/** 409 from GitHub routes: the user's GitHub connection is dead, reconnect (012 contracts/http-api.md) */
			reconnect?: boolean;
		}
		interface Locals {
			/** the signed-in, enabled user (hooks.server.ts); null when signed out or blocked */
			user: User | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	interface Window {
		/** test hook, only set in dev or with PUBLIC_TEST_HOOKS */
		__overtree?: EditorHandle & { compile?: CompileState };
	}
	/** set by attachCollab, read through getServer() */
	var __overtreeServer: { hocuspocus: Hocuspocus; db: Db; dataDir: string } | undefined;
	// history.ts state shared by server.ts' copy and the bundled routes' copy (008 history log buffer)
	var __overtreeHistory: { pending: unknown; open: Set<string> } | undefined;
	// GitHub sync state shared the same way (012): token refreshes in flight, sync requests (sync.ts)
	var __overtreeGitHub: { refreshing: Map<string, Promise<string>>; sync: Map<string, unknown> } | undefined;
}

export {};
