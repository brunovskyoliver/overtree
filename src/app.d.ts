// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { EditorHandle } from '#lib/editor/types.ts';

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
}

export {};
