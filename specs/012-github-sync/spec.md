# Feature Specification: GitHub repository sync

**Feature Branch**: `012-github-sync`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "i would like to create a github integration -> meaning that i can assign each project a github repository and it would automatically sync up the changes into the github repo. we need to be smart about the syncing so we do not push on each edit, rather when user closes the app or disconnects or come up with better solution. for example inside the repo i have this [.github/workflows/render-latex.yaml: on push to main, a self-hosted runner compiles every .tex with xu-cheng/latex-action and commits the PDFs back with stefanzweifel/git-auto-commit-action, file_pattern *.pdf] so i do not have to render the pdfs from overtree automatically.. the github action will do it... can we please come up with a smart integration? the owner of the project would sign in inside github as an integration so he can still be logged in as a gmail user / email user.. and then he chooses repo under which he is / organization under him where he has permissions to do so"

## Clarifications

### Session 2026-10-07

- Q: When should Overtree push? → A: When the editing session ends (nobody connected for 2 minutes), during long sessions at most every 30 minutes, and on "Push now".
- Q: What happens when someone edits on GitHub a file that Overtree also tracks? → A: Two-way sync: GitHub edits are pulled into Overtree and merged into the live documents.
- Q: How should commits credit the Overtree users who wrote the changes? → A: Commits come from the Overtree integration with a `Co-authored-by` trailer (display name and email) per contributor, so GitHub links their accounts.
- Q: What happens when the linked repository already has files? → A: Preview (added / overwritten / left alone) and confirm before the first push; an empty project can instead import the repository.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a GitHub account and link a project to a repository (Priority: P1)

A project owner who signs in to Overtree with Google or email opens the project's GitHub settings (from the project menu) and clicks "Connect GitHub". GitHub asks them to authorize Overtree and to choose which of their personal or organization repositories Overtree may access. Back in Overtree, the owner sees the repositories they granted, grouped by account or organization, picks one and a branch (the repository's default branch is preselected), and saves. Their Overtree sign-in does not change: GitHub is a connection attached to their account, not a way to log in.

**Why this priority**: Without a link there is nothing to sync. It is also the step that carries the security weight: only repositories the owner explicitly granted may be written.

**Independent Test**: Owner signed in with email connects a GitHub account, grants access to one repository of an organization they administer, links the project to it, and sees the link (repository, branch, "not synced yet") in the project's GitHub settings, while their Overtree session is still the email account.

**Acceptance Scenarios**:

1. **Given** an owner with no GitHub connection, **When** they click "Connect GitHub" and approve on GitHub, **Then** they return to the project's GitHub settings with the connection shown (GitHub username) and their Overtree sign-in unchanged.
2. **Given** a connected owner, **When** they open the repository picker, **Then** it lists only the repositories Overtree was granted on their personal account and on organizations where the integration is installed and they have write access, grouped by owner, searchable, with a link "Grant access to more repositories" to GitHub's access settings.
3. **Given** the owner picks a repository and a branch, **When** they save, **Then** the project shows as linked to `owner/repo` on that branch; one project links to at most one repository.
4. **Given** an editor or reader of the project, **When** they open the project, **Then** they can see whether and where the project is linked, but cannot link, change or unlink it, and the server refuses such requests from them.
5. **Given** a linked project, **When** the owner clicks "Unlink", **Then** syncing stops in both directions, nothing in the repository or the project is deleted, and the project can be linked again later.
6. **Given** a user who disconnects their GitHub account in Overtree (or revokes it on GitHub), **When** a project of theirs is linked, **Then** that project's sync shows "needs reconnect" and stops until the owner reconnects.

---

### User Story 2 - Overtree changes reach GitHub automatically, without a push per edit (Priority: P1)

Collaborators work in Overtree as usual. Overtree does not push each keystroke or each version. It pushes once when an editing session ends: when the last person in the project has left or been disconnected for a short grace period. During long sessions it also pushes when a history version closes and the last push is at least 30 minutes old, so GitHub never lags far behind. Each push is one commit on the linked branch containing every project file that changed since the previous sync; Overtree's own compile output is never pushed. A push to `main` then triggers the repository's own workflow, which builds and commits the PDFs.

**Why this priority**: This is the feature. Pushing once per session (rather than per edit or per version) keeps the repository history readable and avoids running the repository's PDF workflow dozens of times an hour.

**Independent Test**: Link a project to a test repository, edit two files with two users over a few minutes, close both browsers; within about three minutes the branch has exactly one new commit containing both changed files, crediting both users, and nothing from Overtree's compile output.

**Acceptance Scenarios**:

1. **Given** a linked project with unpushed changes, **When** the last connected collaborator closes the tab or loses connection and does not come back within 2 minutes, **Then** one commit with all changes since the last sync is pushed to the linked branch.
2. **Given** a collaborator who reconnects within the 2-minute grace period (page reload, short network drop), **When** the grace period would have ended, **Then** no push happens yet.
3. **Given** continuous editing for over 30 minutes, **When** a history version closes and the last push is at least 30 minutes old, **Then** a push happens even though people are still editing.
4. **Given** no file changed since the last sync, **When** a push trigger fires, **Then** nothing is pushed and no empty commit is created.
5. **Given** a push, **When** it is made, **Then** it contains added, edited, renamed, moved and deleted project files and folders (text and uploaded binaries such as images), and never Overtree's compile output (PDF, log, auxiliary files).
6. **Given** the commit, **When** viewed on GitHub, **Then** its title summarizes the changed files and it carries one `Co-authored-by: Name <email>` trailer per Overtree user whose changes it contains.
7. **Given** the branch moved on GitHub since the last sync (for example the workflow's PDF commit, or someone's edit), **When** Overtree pushes, **Then** it first pulls those changes (User Story 3) and then adds its commit on top of the branch's current head; nothing is force-pushed and no GitHub commit is lost.

---

### User Story 3 - GitHub changes flow back into Overtree (Priority: P1)

Someone edits `chapter2.tex` on GitHub, or pushes from their laptop, while the project may or may not be open in Overtree. Overtree notices the new commits on the linked branch and brings the changes into the project: edited text files are merged into the live documents, so anyone currently typing in Overtree keeps their own edits and sees the GitHub changes appear like a collaborator's; new, renamed and deleted files show up in the file tree. The merge is recorded as a history version "Merged from GitHub <commit>", so it can be inspected and undone with restore. Files produced by the repository's workflow (the compiled PDFs) and repository plumbing (`.github/`) are not pulled into the project.

**Why this priority**: The owner chose two-way sync; without it, edits made on GitHub would be overwritten by the next push.

**Independent Test**: With the project open in two browsers and one user typing in `main.tex`, commit a change to another paragraph of `main.tex` and a new file `appendix.tex` on GitHub; within about two minutes both browsers show the GitHub paragraph change merged next to the user's ongoing edits and `appendix.tex` in the tree, history shows a "Merged from GitHub" version, and the workflow's `main.pdf` commit does not appear in the project.

**Acceptance Scenarios**:

1. **Given** a linked project open in Overtree, **When** new commits land on the linked branch, **Then** their changes appear in the project within 2 minutes without a reload.
2. **Given** a linked project nobody has open, **When** someone opens it after commits landed on GitHub, **Then** the GitHub changes are pulled before or within seconds of the project loading.
3. **Given** a user editing paragraph 1 of a file in Overtree and a GitHub commit that changed paragraph 5 of the same file since the last sync, **When** the pull happens, **Then** the file contains both changes and the user's cursor and unsaved typing are not disturbed.
4. **Given** both sides changed the same lines since the last sync, **When** the pull happens, **Then** both versions of the text are kept (nothing is silently dropped), the merge version in history names the file, and the status shows a one-time note "merged overlapping edits in <file>" so someone can tidy it up.
5. **Given** a GitHub commit that adds, renames, moves or deletes files, **When** pulled, **Then** the project tree follows; a deleted file that someone in Overtree changed since the last sync is kept (Overtree's change wins over the deletion) and the note names it.
6. **Given** a binary file (image) changed on both sides since the last sync, **When** the pull happens, **Then** Overtree's version is kept and pushed on the next push, and the note names the file; the GitHub version stays in GitHub's history.
7. **Given** the workflow commits compiled PDFs (files matching the "not pulled" patterns: by default `.github/`, LaTeX build files such as `*.aux`/`*.log`/`*.synctex.gz`, and `X.pdf` next to a `X.tex`), **When** the pull runs, **Then** those files are not added to the project and remain untouched on GitHub.
8. **Given** a pull, **When** it changes the project, **Then** a history version "Merged from GitHub" is recorded with the GitHub commit(s) and their authors' names, and restoring an earlier version works as in feature 008.

---

### User Story 4 - See sync status and sync on demand (Priority: P2)

Anyone in the project sees a small GitHub indicator in the top bar: linked repository, "in sync", "changes not pushed yet", "syncing…", or "sync failed" with the reason. Editors and the owner can click "Push now" with an optional commit title when they want GitHub updated immediately, for example right before submitting, and "Pull now" to fetch GitHub changes without waiting.

**Why this priority**: Automatic sync must be visible to be trusted, and manual actions cover the "I need it now" moment. It builds on Stories 2 and 3.

**Independent Test**: Edit a file in a linked project, see "changes not pushed yet", click "Push now" with title "draft for review", see "in sync" and the commit on GitHub with that title.

**Acceptance Scenarios**:

1. **Given** a linked project, **When** any member looks at the top bar, **Then** they see the repository name, the sync state, and the time and link of the last synced commit.
2. **Given** an editor or owner, **When** they click "Push now" and optionally enter a title, **Then** a sync (pull, then push of all unpushed changes) happens within seconds and uses their title for the commit.
3. **Given** an editor or owner, **When** they click "Pull now", **Then** GitHub changes are pulled within seconds.
4. **Given** a reader, **When** they view the indicator, **Then** "Push now" and "Pull now" are not offered and the server refuses those requests from them.
5. **Given** a sync fails (network, revoked access, branch protected, repository deleted or renamed), **When** the failure happens, **Then** the indicator shows "sync failed" with a plain-language reason, unpushed changes stay queued, Overtree retries automatically with growing delays, and the owner sees what to do (reconnect, choose another branch, grant access).
6. **Given** a sync is already running, **When** another trigger or a manual request arrives, **Then** syncs of one project never run concurrently; the later request results in at most one follow-up sync.

---

### User Story 5 - Start from what is already in the repository (Priority: P3)

When the owner links a repository that already has files, Overtree shows what the first sync would do before anything happens: which files would be added on GitHub, which existing files would be overwritten with the project's content, which GitHub files would be added to the project, and which stay GitHub-only. If the Overtree project is still empty (new blank project), the owner can instead import the repository's files into the project, so a thesis already on GitHub can be continued in Overtree.

**Why this priority**: Linking to an existing repository is common (the owner's repository already has a workflow), and an unannounced overwrite would destroy trust. Import is a convenience on top.

**Independent Test**: Link a project containing `main.tex` to a repository that has `main.tex`, `refs.bib`, `README.md`, `main.pdf` and `.github/workflows/render-latex.yaml`; the preview lists `main.tex` as "GitHub copy will be overwritten", `refs.bib` and `README.md` as "will be added to the project", and `main.pdf` and the workflow as "stays on GitHub only"; after confirming, the first push changes only `main.tex`.

**Acceptance Scenarios**:

1. **Given** a repository with files, **When** the owner links a non-empty project, **Then** before saving they see the preview and must confirm; on confirm, files present on both sides take the project's content in the first commit.
2. **Given** an empty project and a non-empty repository, **When** the owner chooses "Import from repository", **Then** the branch's files (except the "not pulled" patterns) become project files (text files editable, others as uploaded files), subject to the usual upload size limits, and the project is in sync with that commit.
3. **Given** files that match the "not pulled" patterns, **When** later syncs happen, **Then** Overtree never deletes or modifies them on GitHub.

---

### Edge Cases

- After every Overtree push, the workflow commits compiled PDFs back. The next pull sees that commit, finds only "not pulled" files, advances its record of the branch and changes nothing in the project, with no history version and no conflict note.
- A project file that is a PDF but not a compile output (an uploaded `figure.pdf` with no `figure.tex` beside it) is synced both ways like any file.
- The owner adds a pattern (for example `notes/**`) to the "not pulled" list in the link settings: matching GitHub files stop being pulled; files already in the project are not deleted by that change.
- The linked branch is deleted or renamed on GitHub: sync fails with "branch not found"; the owner picks another branch or recreates it from the project ("Create branch from project").
- History on the linked branch is rewritten on GitHub (force-push) so the last synced commit is gone: Overtree treats the new head like a first link (preview, confirm) instead of guessing.
- The repository is renamed or transferred: sync follows it if GitHub still grants access; otherwise "needs access".
- Branch protection blocks direct pushes: push fails with that reason; pulls continue.
- The owner loses access to the organization: same as revoked access, "needs reconnect".
- Ownership of the project is transferred: the link stays, but sync pauses with "new owner must connect GitHub" until the new owner connects their account and confirms the link.
- A project is deleted: its link is removed; nothing on GitHub changes. A duplicated project is not linked.
- The server restarts with unpushed changes or unseen GitHub commits: both are handled after restart (state is stored, not held in memory).
- A file over GitHub's per-file limit, or over Overtree's upload limit when pulling: that sync fails or skips with the file name; other projects are unaffected.
- A file name git cannot store, or a GitHub path Overtree cannot represent: the sync names the file and skips it.
- A GitHub change to a file that an editor has as read-only through a per-file override (feature 005): pulls still apply it; permissions restrict people, not the sync.
- Restoring a version (feature 008) is an ordinary change and is pushed like any other edit.
- An Overtree user with no email: their trailer is omitted and their name appears in the commit body instead.

## Requirements *(mandatory)*

### Functional Requirements

**Connection**

- **FR-001**: Any signed-in user MUST be able to connect one GitHub account to their Overtree account, and disconnect it, without changing how they sign in to Overtree.
- **FR-002**: Overtree MUST only be able to read and write repositories the user explicitly granted it on GitHub (per repository or per account/organization), and MUST link to GitHub's settings to change that grant.
- **FR-003**: Overtree MUST store GitHub credentials only on the server, never expose them to the browser or logs, and stop using them when the user disconnects or GitHub revokes them.
- **FR-004**: The integration MUST be optional for the instance: if the instance admin has not configured it, no GitHub UI appears and the rest of the app works unchanged.

**Linking**

- **FR-005**: Only the project owner MUST be able to link, change or unlink the project's repository and branch and edit its "not pulled" patterns; the server MUST enforce this.
- **FR-006**: The repository picker MUST list only repositories the owner's connection can write to, grouped by personal account and organization, with search.
- **FR-007**: A project MUST link to at most one repository and one branch; linking defaults to the repository's default branch.
- **FR-008**: Before the first sync with a repository that already has files, the owner MUST see which files will be added or overwritten on GitHub, which will be added to the project, and which stay GitHub-only, and confirm.
- **FR-009**: When the project is empty, the owner MUST be able to import the linked branch's files into the project instead.
- **FR-010**: Unlinking, deleting the project, or disconnecting GitHub MUST NOT delete or change anything on GitHub or in the project.

**Push (Overtree → GitHub)**

- **FR-011**: The system MUST NOT push per edit. It MUST push when the project's editing session ends (no collaborator connected for 2 minutes), when a history version closes and the previous push is at least 30 minutes old, and when an editor or the owner clicks "Push now".
- **FR-012**: Every push MUST first pull (FR-016) and then add a single commit on top of the linked branch's current head containing every project change since the last sync (adds, edits, renames, moves, deletions, binaries). It MUST NOT force-push or rewrite branch history.
- **FR-013**: Pushes MUST NOT include Overtree's compile output and MUST NOT modify or delete files matching the "not pulled" patterns.
- **FR-014**: A push trigger with no changes since the last sync MUST NOT create a commit.
- **FR-015**: The commit title MUST summarize the changed files ("Push now" may set a custom title), and the commit MUST carry a `Co-authored-by: <display name> <email>` trailer for each Overtree user whose changes it includes.

**Pull (GitHub → Overtree)**

- **FR-016**: The system MUST pull new commits on the linked branch when the project is opened, at least every 2 minutes while anyone has it open, before every push, and on "Pull now".
- **FR-017**: Pulled text changes MUST be merged into the live documents as collaborative edits: concurrent Overtree edits are kept, and connected users see the change live without reloading.
- **FR-018**: When both sides changed overlapping text, both versions MUST be kept and the file named in a merge note; for binaries changed on both sides, and for files deleted on GitHub but changed in Overtree, Overtree's version MUST be kept and named in the note.
- **FR-019**: Pulled additions, renames, moves and deletions MUST update the project tree.
- **FR-020**: Files matching the "not pulled" patterns MUST NOT be pulled. Defaults: `.github/**`, LaTeX build files (`*.aux`, `*.log`, `*.out`, `*.toc`, `*.fls`, `*.fdb_latexmk`, `*.synctex.gz`, `*.bbl`, `*.blg`), and `X.pdf` when `X.tex` exists in the same folder. The owner MUST be able to edit the list.
- **FR-021**: Each pull that changes the project MUST be recorded as a history version "Merged from GitHub", naming the GitHub commit(s) and their authors; pulls that change nothing MUST NOT create a version.

**Coordination and status**

- **FR-022**: At most one sync (pull or push) per project MUST run at a time; requests arriving during a sync MUST collapse into at most one follow-up.
- **FR-023**: Unpushed changes and the last synced GitHub commit MUST survive a server restart.
- **FR-024**: On failure, the system MUST keep changes queued, retry automatically with increasing delays (up to a limit), and report a plain-language reason.
- **FR-025**: Every project member MUST see whether the project is linked, the repository and branch, the sync state (in sync / changes not pushed / syncing / failed / needs reconnect), the last synced commit with time and link, and the latest merge note.
- **FR-026**: Readers MUST NOT be able to push or pull on demand; the server MUST refuse it.
- **FR-027**: When the owner changes (ownership transfer), sync MUST pause until the new owner connects GitHub and confirms the link.

### Key Entities

- **GitHub connection**: belongs to one Overtree user; the GitHub account identity (username) and the server-side authorization to act on the repositories that user granted. At most one per user.
- **Repository link**: belongs to one project; repository (owner/name), branch, the connection it uses (the project owner's), the "not pulled" patterns, and the sync base: the last GitHub commit both sides agree on together with the project state it corresponds to.
- **Sync run**: one pull or push attempt for a project: trigger (session end, long session, open, periodic, manual), who requested it, result (commit pushed, changes pulled, nothing to do, failed with reason), merge notes, time; used for the status indicator and retries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner signed in with Google or email can connect GitHub and link a project to a repository in under 2 minutes, without creating or switching any Overtree account.
- **SC-002**: After the last collaborator leaves a project with changes, the changes are on GitHub within 3 minutes in 95% of cases.
- **SC-003**: An editing session of any length creates at most one Overtree commit per 30 minutes plus one at the end, plus manual pushes.
- **SC-004**: A GitHub commit to a project someone has open shows up for them within 2 minutes, and no Overtree edit made meanwhile is lost.
- **SC-005**: Across a test run of 20 alternating Overtree pushes and workflow PDF commits, zero workflow files are pulled into the project, zero are modified or deleted on GitHub, and no merge notes are produced.
- **SC-006**: Zero GitHub credentials reach the browser or the logs.
- **SC-007**: When a sync fails, the indicator shows a reason within 30 seconds, and no change from either side is lost once the cause is fixed.

## Assumptions

- The instance admin registers the integration with GitHub once (an app owned by them or their organization) and supplies its identifiers and secret through environment variables; each user then connects their own account through it.
- Overtree may not be reachable from the internet, so it cannot rely on GitHub notifying it; it checks for new commits itself (FR-016).
- The repository must already exist; creating repositories from Overtree is out of scope.
- Pushes go directly to the linked branch; pull requests are out of scope.
- The repository root mirrors the project root (no subfolder mapping).
- Compiling PDFs is the repository's job (for example the owner's `render-latex.yaml` workflow); Overtree does not push its own PDFs and does not watch the workflow's result.
- `Co-authored-by` trailers include the contributors' Overtree emails; the project owner accepts that these become visible to anyone who can read the repository.
- Grace period (2 minutes), long-session interval (30 minutes) and pull interval (2 minutes) are fixed defaults, overridable only for tests.
