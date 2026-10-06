// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Hocuspocus } from '@hocuspocus/server';
import type { EditorHandle } from '#lib/editor/types.ts';
import type { Db } from '#lib/server/db.ts';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	interface Window {
		/** test hook, only set in dev or with PUBLIC_TEST_HOOKS */
		__overtree?: EditorHandle;
	}
	/** set by attachCollab, read through getServer() */
	var __overtreeServer: { hocuspocus: Hocuspocus; db: Db } | undefined;
}

export {};
