// Shared by the history server modules and the client (specs/008-history-synctex/contracts/http-api.md).

export type VersionKind = 'baseline' | 'edit' | 'compile' | 'restore' | 'github';
export type Compare = 'current' | 'previous';

/** A user as history shows them; a deleted or unknown account: name 'Unknown user'. */
export type UserRef = { id: string; name: string; avatarUrl: string | null; color: string };

export type Label = { id: number; versionId: number; name: string; user: UserRef; createdAt: number; canEdit: boolean };

/** Why a file of a GitHub pull wasn't merged cleanly (012 data-model `MergeNote`). */
export type MergeReason = 'overlap' | 'kept-deleted' | 'kept-binary' | 'skipped-name' | 'skipped-size';
/** What a `github` version merged (012 data-model `versions.source`): the first 20 commits, the noted files. */
export type GitHubSource = { commits: { sha: string; author: string; message: string }[]; notes: { path: string; reason: MergeReason }[] };

export type ChangedFile = { id: string; path: string; change: 'added' | 'edited' | 'deleted' | 'renamed'; from?: string };

/** `Version` in the contract (the server's `Version` is the table row). */
export type VersionInfo = {
	id: number;
	kind: VersionKind;
	startedAt: number;
	createdAt: number;
	authors: UserRef[];
	changed: ChangedFile[];
	restoredFrom: { id: number; createdAt: number } | null;
	labels: Label[];
	github?: GitHubSource; // `github` versions only
};

/** `userId`: who inserted (`+`) or deleted (`-`) the run; null when unknown and always for `=`. */
export type Segment = { op: '=' | '+' | '-'; text: string; userId: string | null };

export type FileDiff = {
	id: string; // file id in the newer state, else the older one
	path: string;
	oldPath?: string; // renamed/moved
	kind: 'text' | 'binary';
	change: 'added' | 'deleted' | 'edited' | 'renamed';
	segments?: Segment[]; // text only
	size?: { old: number | null; new: number | null }; // binary only
	canRestore: boolean; // the caller may restore this file to the version
};

/** `GET /history` */
export type HistoryPage = { versions: VersionInfo[]; hasMore: boolean };
/** `GET /history/:vid`; `users`: everyone a segment names, for the legend */
export type VersionDiff = { version: VersionInfo; files: FileDiff[]; users: UserRef[] };
