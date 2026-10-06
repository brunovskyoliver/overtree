import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { checkBlocked, getToken, type Me } from './auth.svelte.ts';

// One editor page's live connection (research R8): the shared WebSocket every document of the tab goes over, and
// the `project:<pid>` document: its stateless channel carries the server's project events, its awareness who is
// in the project and in which file (top-bar avatars).

export type ProjectEvent = { type: 'tree' | 'project' | 'access' | 'deleted' };
/** Why the project closed under the user: access removed (re-authentication refused) or the project deleted. */
export type Ended = 'removed' | 'deleted';

/** Another user connected to the project; `fileId` is the file of their most recently active tab. */
export type Peer = { id: string; name: string; color: string; avatarUrl: string | null; fileId: string | null };

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
	/** the socket dropped after having been connected (contracts/ui.md "Offline, reconnecting…") */
	offline = $state(false);
	/** other users in the project, one entry per user however many tabs they have open */
	peers = $state<Peer[]>([]);
	#joined = false;
	#me: string | null = null;

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
		this.socket.on('status', ({ status }: { status: string }) => {
			if (status === 'connected') this.#was = true;
			this.offline = this.#was && status !== 'connected';
		});
		// the browser knows before the socket does (a dead socket only times out after 30 s): drop it now, and
		// reconnect when the network is back instead of retrying meanwhile or waiting for the retry backoff
		addEventListener('offline', this.#drop);
		addEventListener('online', this.#back);
		this.events.awareness!.on('change', () => this.#peers());
		this.events.attach();
	}

	#was = false;
	// ponytail: trusts navigator.onLine, so a browser that claims offline with the server on localhost stays off
	#drop = () => {
		this.socket.disconnect();
		// the close event of a socket on a dead network can take long: the status changes now
		this.socket.onClose({ event: new CloseEvent('close', { code: 4408, reason: 'offline' }) });
	};
	#back = () => this.socket.connect();

	/** Who this tab is and which file it shows, for the others' avatars. */
	present(me: Me | null, fileId: string | null) {
		const aw = this.events.awareness!;
		this.#me = me?.id ?? null;
		if (me && aw.getLocalState()?.user?.id !== me.id)
			aw.setLocalStateField('user', { id: me.id, name: me.name, color: me.color, avatarUrl: me.avatarUrl });
		// `at`: which of a user's tabs was switched last (the one the avatar jumps to)
		if (aw.getLocalState()?.fileId !== fileId) aw.setLocalState({ ...aw.getLocalState(), fileId, at: Date.now() });
		this.#peers();
	}

	#peers() {
		const aw = this.events.awareness!;
		const byUser = new Map<string, { peer: Peer; at: number }>();
		for (const [client, s] of aw.getStates()) {
			const u = s.user;
			if (client === aw.clientID || !u?.id || u.id === this.#me) continue;
			const at: number = s.at ?? 0;
			if ((byUser.get(u.id)?.at ?? -1) < at)
				byUser.set(u.id, { peer: { id: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl ?? null, fileId: s.fileId ?? null }, at });
		}
		this.peers = [...byUser.values()].map((p) => p.peer).sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Show why the project closed and stop reconnecting. A deletion wins over the refusal that follows it. */
	end(why: Ended) {
		if (this.ended) return;
		this.ended = why;
		this.destroy();
	}

	destroy() {
		removeEventListener('offline', this.#drop);
		removeEventListener('online', this.#back);
		this.events.destroy();
		this.socket.destroy();
	}
}
