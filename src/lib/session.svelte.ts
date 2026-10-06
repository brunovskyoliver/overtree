import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { checkBlocked, getToken } from './auth.svelte.ts';

// One editor page's live connection (research R8): the shared WebSocket every document of the tab goes over, and
// the `project:<pid>` document whose stateless channel carries the server's project events. Presence on that
// document comes with US4.

export type ProjectEvent = { type: 'tree' | 'project' | 'access' | 'deleted' };
/** Why the project closed under the user: access removed (re-authentication refused) or the project deleted. */
export type Ended = 'removed' | 'deleted';

export type SessionHandlers = {
	/** role or membership changed, or the connection came back: refetch details and files */
	access(): void;
	/** the tree changed */
	tree(): void;
	/** title or main document changed */
	project(): void;
};

export class Session {
	readonly socket: HocuspocusProviderWebsocket;
	readonly events: HocuspocusProvider;
	ended = $state<Ended | null>(null);
	#joined = false;

	constructor(pid: string, on: SessionHandlers) {
		this.socket = new HocuspocusProviderWebsocket({ url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab` });
		this.events = new HocuspocusProvider({ websocketProvider: this.socket, name: `project:${pid}`, token: getToken });
		this.events.on('stateless', ({ payload }: { payload: string }) => {
			let event: ProjectEvent;
			try {
				event = JSON.parse(payload);
			} catch {
				return;
			}
			if (event.type === 'deleted') this.end('deleted');
			else on[event.type]?.();
		});
		// after a kick (4403) every document re-authenticates on the new socket: the role is fresh, events may
		// have been missed meanwhile
		this.events.on('authenticated', () => {
			if (this.#joined) on.access();
			this.#joined = true;
		});
		// refused after having been in: access removed (a disabled account goes to /blocked instead). Refused on the
		// first try: no access at all, the page's 404 handles that.
		this.events.on('authenticationFailed', () => {
			checkBlocked();
			if (this.#joined) this.end('removed');
		});
		this.events.attach();
	}

	/** Show why the project closed and stop reconnecting. A deletion wins over the refusal that follows it. */
	end(why: Ended) {
		if (this.ended) return;
		this.ended = why;
		this.destroy();
	}

	destroy() {
		this.events.destroy();
		this.socket.destroy();
	}
}
