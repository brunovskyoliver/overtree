// Shapes of the GitHub sync API (012 contracts/http-api.md), shared by the server and the browser.

// "Not pulled" defaults (research R8); the settings dialog offers them as "Reset to defaults".
/** "`X.pdf` when `X.tex` is in the same folder": the CI workflow's output (R8). */
export const COMPILE_OUTPUT_PDF = '<compile-output-pdf>';

export const DEFAULT_IGNORE = [
	'.github/**',
	'**/*.aux',
	'**/*.log',
	'**/*.out',
	'**/*.toc',
	'**/*.fls',
	'**/*.fdb_latexmk',
	'**/*.synctex.gz',
	'**/*.bbl',
	'**/*.blg',
	COMPILE_OUTPUT_PDF
];

export type GitHubState = 'pending' | 'in-sync' | 'unpushed' | 'syncing' | 'failed' | 'needs-reconnect' | 'needs-access' | 'owner-changed';

export type MergeNoteReason = 'overlap' | 'kept-deleted' | 'kept-binary' | 'skipped-name' | 'skipped-size';
export type MergeNote = {
	at: number;
	commit: string;
	files: { path: string; reason: MergeNoteReason }[];
};

export type GitHubLinkInfo = {
	repo: string;
	branch: string;
	/** the branch on GitHub */
	url: string;
	state: GitHubState;
	/** plain language */
	error: string | null;
	nextAttemptAt: number | null;
	lastCommit: { sha: string; url: string; at: number } | null;
	lastPushAt: number | null;
	lastPullAt: number | null;
	note: MergeNote | null;
	/** "not pulled" patterns; the owner only */
	ignore?: string[];
	linkedBy: { id: string; name: string };
};

export type GitHubRun = {
	kind: 'push' | 'pull' | 'import';
	trigger: string;
	result: 'pushed' | 'pulled' | 'noop' | 'failed';
	commit: string | null;
	error: string | null;
	at: number;
	user: { name: string } | null;
};

/** `GET /api/projects/:pid/github` */
export type GitHubStatus = {
	configured: true;
	link: GitHubLinkInfo | null;
	/** the owner */
	canManage: boolean;
	/** owner or editor, with an active (or retrying) link */
	canSync: boolean;
	runs?: GitHubRun[];
};

/** `GET /api/github/account` */
export type GitHubAccountInfo =
	| { connected: false; installUrl: string }
	| {
			connected: true;
			login: string;
			avatarUrl: string;
			installUrl: string;
			manageUrl: string;
	  };

export type GitHubRepoInfo = {
	id: number;
	fullName: string;
	defaultBranch: string;
	private: boolean;
};

/** `GET /api/github/repos` */
export type GitHubRepos = {
	accounts: {
		login: string;
		type: 'User' | 'Organization';
		avatarUrl: string;
		installationId: number;
		repos: GitHubRepoInfo[];
	}[];
};

/** `GET /api/github/repos/:owner/:repo/branches` */
export type GitHubBranches = { branches: string[]; defaultBranch: string };
