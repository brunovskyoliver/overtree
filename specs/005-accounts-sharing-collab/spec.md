# Feature Specification: Accounts, roles, sharing & live collaboration

**Feature Branch**: `005-accounts-sharing-collab`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "005 Accounts, roles, sharing & live collaboration (Clerk). One feature with several parts (former roadmap rows 005, 006 and 007, bundled so multi-user works today). Phase order: sign-in and user mirror → site roles and admin page → dashboard / own space → project roles and sharing → per-file permissions → live presence. **Sign-in (Clerk).** Google sign-in and plain email sign-in (email code or password). Signed-out visitors see only the sign-in page and share-link landing pages. The app keeps its own users table mirrored from Clerk (id, email, display name, avatar, site role, disabled flag), created on first sign-in. Clerk keys come from environment variables. Every HTTP route and every WebSocket connection verifies the Clerk session on the server. **Site roles: admin and user.** Admin page lists all users with role, last seen and project count; promote/demote admin, disable/re-enable an account (disabled users are signed out and blocked), choose open sign-up or invite-only (allowlist of emails/domains), and see or delete any project. The first user to sign in becomes admin, and ADMIN_EMAILS can seed admins. **Own space.** Dashboard of own projects and projects shared with the user, with owner, role and last-modified time: create blank or from template (article, report, beamer, letter), upload zip, rename, duplicate, delete, search. Project title in the top bar is editable by the owner. The existing single project from 001–003 is migrated to the first admin. **Project roles: owner, editor, reader.** Owner: share, change any permission, rename, delete, transfer ownership. Editors change files and the tree; readers get a read-only editor and can still compile and download. Roles are enforced on the server for every Yjs update, file-tree operation and HTTP route. **Sharing.** Share dialog from the top bar Share button: invite by email as editor or reader (invites to unknown emails are accepted after sign-up), list collaborators and change or remove them, anyone with the link for read or edit, revocable. **Per-file and per-folder permissions.** The owner can override a collaborator's role on any file or folder from the file tree context menu or the share dialog; a folder override applies to everything inside it; the most specific rule wins; the owner is never restricted. Lock icon on read-only files, editor opens them read-only. **Live collaboration.** Colored remote cursors and selections with name labels; avatars of connected users in the top bar, clicking one jumps to their cursor. File-tree changes propagate live. Undo/redo reverts only your own changes. Reconnecting merges offline edits; revoking access disconnects that user's socket. Tested with two and five concurrent browser sessions."

Reference layout: [`reference-layout.png`](./reference-layout.png) (top bar: project title with a dropdown in the centre; on the right a round green avatar "S" for a connected user, then History, Layout and a green "Share" button).

## Clarifications

### Session 2026-10-06

- Q: How are Clerk keys provided and how do automated tests sign in? → A: The operator created a Clerk development instance (Google + email code/password); keys are stored in the keychain as `overtree/clerk-publishable-key` and `overtree/clerk-secret-key`. Most automated tests use a test-only sign-in bypass that is absent from production builds; a smaller set signs in through the real provider with its testing tokens.
- Q: On a fresh instance, is sign-up open or invite-only by default? → A: Invite-only by default. Admin-seed emails, allowlisted emails/domains and emails with a pending project invite may sign up; the first user ever is always allowed and becomes admin.
- Q: Does "anyone with the link" work for signed-out visitors? → A: No. Sign-in is required; the landing page shows only the project title and a sign-in button, then the person opens the project with the link's role.
- Q: Can a per-file override grant more than the project role? → A: Yes, both directions: a project Reader can get Editor on a file or folder, and an Editor can get Reader.
- Q: Can admins open other users' projects? → A: No. Admins can list and delete any project but cannot open its contents unless invited like anyone else.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in and stay signed in (Priority: P1)

A visitor opens the instance and sees only a sign-in page. They sign in with Google or with their email address (code or password). The app remembers who they are: their name and avatar appear in the top-right account menu, and they can sign out from there. Every page, file request, compile and live-editing connection checks who is asking.

**Why this priority**: Nothing else in this feature (roles, own projects, sharing, presence) exists without knowing who the user is.

**Independent Test**: Signed out, open any app URL and get the sign-in page; sign in by email; see your name in the account menu; reload and stay signed in; sign out and get the sign-in page again. A request to any project URL or the live-editing endpoint without a session is refused.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor, **When** they open any app page (dashboard, project, admin), **Then** they are sent to the sign-in page and, after signing in, back to the page they asked for.
2. **Given** the sign-in page, **When** the visitor signs in with Google or with an email code or password, **Then** they land on their dashboard and their display name and avatar show in the account menu.
3. **Given** a person signs in for the first time, **When** sign-in completes, **Then** the app creates their user record (email, display name, avatar, site role, enabled) and later sign-ins update name, email and avatar from the identity provider.
4. **Given** a signed-in user, **When** they choose "Sign out" in the account menu, **Then** their session ends and every open project tab of theirs stops syncing.
5. **Given** no valid session, **When** anything calls a data endpoint (files, compile, project, admin) or opens a live-editing connection, **Then** the request is refused and no project data is returned.
6. **Given** a signed-out visitor with a share link, **When** they open it, **Then** they see a landing page naming the project and inviting them to sign in to open it; no file content is shown.

---

### User Story 2 - My projects dashboard (Priority: P1)

After sign-in the user sees a dashboard listing their own projects and the projects shared with them: title, owner, their role and last-modified time. They create a blank project or one from a template (article, report, beamer, letter), create one from a zip, rename, duplicate, delete with confirmation and search by title. Clicking a project opens the editor; the project title in the top bar is editable by the owner. The single project that existed before this feature belongs to the first admin.

**Why this priority**: With accounts, each user needs their own space; one shared global project would leak work between users.

**Independent Test**: Sign in as a new user; dashboard is empty with a "New project" call to action; create "Thesis" from the report template, open it, compile, rename it from the top bar, return to the dashboard, duplicate it, search "thes", delete the copy.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they open the dashboard, **Then** it lists every project they own or are a collaborator on, with title, owner name, their role (Owner, Editor, Reader) and last-modified time, newest first.
2. **Given** the dashboard, **When** the user picks New project → Blank / Article / Report / Beamer / Letter and enters a title, **Then** a project with that title and the matching starter files is created, owned by them, and opens; it compiles without errors.
3. **Given** the dashboard, **When** the user picks New project → Upload zip and chooses a zip, **Then** a new project is created from the zip's files (same rules and limits as feature 003's import) and opens.
4. **Given** a project the user owns, **When** they rename it (from the dashboard or by editing the title in the top bar), **Then** the new title shows everywhere, including for collaborators; non-owners see the title but cannot edit it.
5. **Given** any project the user can open, **When** they pick Duplicate, **Then** a copy titled "Copy of <title>" with the same files and main document is created, owned by them, with no collaborators.
6. **Given** a project the user owns, **When** they pick Delete and confirm, **Then** the project and its files are removed for everyone; collaborators can instead "Leave" a shared project, which removes only their access.
7. **Given** text in the search box, **When** the user types, **Then** the list filters to projects whose title contains the text, case-insensitively.
8. **Given** the instance was used before this feature, **When** the first user signs in, **Then** the existing project (files, text, compile settings) appears on their dashboard as their own project.
9. **Given** a user opens a project URL they have no access to, **When** the page loads, **Then** they see "You don't have access to this project" with a link back to the dashboard, and no project data.

---

### User Story 3 - Share a project with roles (Priority: P1)

The owner clicks "Share" in the top bar and invites people by email as Editor or Reader. Collaborators find the project on their dashboard. Editors can change files and the tree; Readers see a read-only editor and tree but can still compile, view the PDF and download. The owner can change or remove a collaborator's role, turn on "anyone with the link" (Reader or Editor) and revoke it, and transfer ownership. These rules hold even if someone bypasses the interface.

**Why this priority**: Sharing is the reason accounts exist in a collaborative editor.

**Independent Test**: Owner invites B as Reader; B opens the project, cannot type or change the tree, can compile and download; owner switches B to Editor; B can now type. An edit sent directly to the server by a reader is rejected.

**Acceptance Scenarios**:

1. **Given** the owner opens the Share dialog, **When** they enter an email of an existing user, choose Editor or Reader and click Invite, **Then** that user becomes a collaborator with that role, the project shows on their dashboard, and the dialog lists them.
2. **Given** an email with no account yet, **When** the owner invites it, **Then** the dialog lists it as "Invited"; when someone signs up with that email, they become a collaborator with that role automatically.
3. **Given** the collaborator list, **When** the owner changes a role or removes a collaborator, **Then** it takes effect within 2 seconds for that user's open sessions (editor switches to read-only, or the project closes with "Your access was removed").
4. **Given** the Share dialog, **When** the owner turns on "Anyone with the link" and picks Reader or Editor, **Then** a link is shown with a copy button; a signed-in user who opens it gets that access; turning it off (or regenerating it) makes the old link stop working and disconnects users who only had access through it.
5. **Given** a Reader, **When** they open the project, **Then** the editor is read-only (typing, paste, toolbar formatting and tree actions that change files are unavailable), and Recompile, PDF view, file download and project zip download work.
6. **Given** an Editor, **When** they open the project, **Then** they can edit text and create, upload, rename, move and delete files, but cannot share, rename, delete or transfer the project.
7. **Given** the owner, **When** they transfer ownership to a collaborator and confirm, **Then** that collaborator becomes owner and the former owner becomes an Editor.
8. **Given** a user without edit rights, **When** a text change, tree change or file upload for the project reaches the server by any route, **Then** the server rejects it and no stored content changes.
9. **Given** a non-owner, **When** they open the Share dialog, **Then** they see the collaborator list read-only and no invite or link controls.

---

### User Story 4 - Edit together live (Priority: P1)

Several users edit the same files at once. Each sees the others' cursors and selections in a distinct color with a name label. Avatars of everyone connected to the project appear in the top bar; clicking one opens the file that person is in and scrolls to their cursor. File-tree changes by one user appear for everyone without reload. Undo reverts only your own edits. After a network drop, edits made offline merge on reconnect without losing anyone's text.

**Why this priority**: Live collaboration is the product's core promise (constitution principle I); sharing without it would be half a feature.

**Independent Test**: Two browser sessions as two users on the same file: each sees the other's labelled cursor; both type in the same paragraph; both end with the same text containing both edits; one undoes and only their own text goes away. Repeat with five sessions.

**Acceptance Scenarios**:

1. **Given** users A and B in the same file, **When** B moves the cursor or selects text, **Then** A sees B's cursor or selection in B's color with B's name label within 300 ms on a local network.
2. **Given** users connected to a project, **When** anyone opens it, **Then** the top bar shows one avatar per connected user (other than oneself), with their name on hover and the same color as their cursor; the avatar disappears when they leave.
3. **Given** B's avatar, **When** A clicks it, **Then** A's editor opens the file B is in and scrolls to B's cursor.
4. **Given** A and B editing, **When** A creates, renames, moves or deletes a file or folder, **Then** B's tree, tabs and main-document marker update without reload.
5. **Given** A and B typing in the same file, **When** A presses Undo, **Then** only A's most recent change is reverted; B's text stays.
6. **Given** B loses the network and keeps typing, **When** the connection returns, **Then** B's offline edits and A's edits made meanwhile are both present for both users; the interface shows an "Offline, reconnecting" indicator while disconnected.
7. **Given** B is connected, **When** the owner removes B or B's account is disabled, **Then** B's live connection is closed within 2 seconds and B's further edits do not reach other users.
8. **Given** five users editing the same file at once, **When** each types for one minute, **Then** all five end with identical text containing every user's edits.

---

### User Story 5 - Administer the instance (Priority: P2)

The first person to sign in becomes admin, and any email listed in the admin-seed setting becomes admin on sign-in. Admins open an Admin page from the account menu: a table of all users with role, last seen and number of projects; they can promote or demote admins, disable or re-enable accounts, choose open sign-up or invite-only (the default) with an allowlist of emails and domains, and list and delete any project. Admins cannot open other users' projects unless invited. Ordinary users see no Admin entry and cannot reach the page or its actions.

**Why this priority**: Needed to run a shared instance safely, but a small group can start collaborating before the admin page exists.

**Independent Test**: First sign-in becomes admin; second user is a user; admin promotes them, disables them (their session is cut and they cannot sign back in), re-enables them; switches to invite-only with `@example.org`, and a non-matching email can no longer sign up.

**Acceptance Scenarios**:

1. **Given** an instance with no users, **When** the first person signs in, **Then** they become admin; **Given** an email in the admin-seed setting, **When** that person signs in, **Then** they are admin.
2. **Given** an admin, **When** they open Admin → Users, **Then** they see every user with email, display name, role, status, last seen time and number of owned projects, searchable by name or email.
3. **Given** the Users table, **When** the admin promotes a user to admin or demotes an admin, **Then** the change applies on that user's next request; the last remaining admin cannot be demoted or disabled.
4. **Given** the Users table, **When** the admin disables an account, **Then** that user's open sessions and live connections end within 2 seconds, and further sign-ins show "Your account is disabled"; re-enabling restores access with their projects intact.
5. **Given** a fresh instance, **When** a second person whose email is not allowlisted and has no invite tries to sign up, **Then** they are refused: sign-up is invite-only by default.
6. **Given** Admin → Settings, **When** the admin sets sign-up to invite-only and lists allowed emails and domains, **Then** new people whose email is not allowed (and who have no pending project invite) are refused with a clear message; existing users are unaffected.
7. **Given** Admin → Projects, **When** the admin views it, **Then** they see every project with title, owner, collaborator count and last-modified time, and can delete any project after confirmation; there is no "open" action, and an admin who opens the project URL without being a member gets "You don't have access".
8. **Given** a non-admin, **When** they request the Admin page or any admin action, **Then** it is refused.

---

### User Story 6 - Per-file and per-folder permissions (Priority: P3)

The owner can give a collaborator a different role on one file or folder than on the rest of the project, for example making `chapters/` editable but `main.tex` read-only for a co-author. Overrides are set from the file tree context menu ("Permissions…") or from the Share dialog. A folder override covers everything inside it; the most specific rule wins; the owner is never restricted. Files the current user can only read show a lock icon in the tree and open read-only.

**Why this priority**: Refines sharing; useful but not needed for the first collaborative sessions.

**Independent Test**: Owner shares as Editor with B, sets `main.tex` to Reader for B; B sees a lock on `main.tex`, cannot type there, can still edit other files; a direct edit to `main.tex` from B is rejected.

**Acceptance Scenarios**:

1. **Given** the owner and a collaborator B, **When** the owner opens "Permissions…" on a file or folder and sets B to Reader or Editor there, **Then** the override is saved and listed in the Share dialog under B.
2. **Given** B is an Editor with a Reader override on folder `figures/`, **When** B views the tree, **Then** `figures/` and everything under it show a lock icon, B cannot create, rename, move, delete or upload inside it, and text files there open read-only.
3. **Given** a Reader override on `chapters/` and an Editor override on `chapters/intro.tex`, **When** B opens `chapters/intro.tex`, **Then** it is editable (the more specific rule wins).
4. **Given** overrides, **When** B sends a change to a file that resolves to Reader for B by any route, **Then** the server rejects it.
5. **Given** the owner, **When** any override exists, **Then** it never limits the owner.
6. **Given** an overridden file is moved into another folder, **When** permissions are computed, **Then** the file's own override still applies and folder overrides of its new location apply where it has none.
7. **Given** B is a project Reader with an Editor override on `chapters/`, **When** B opens `chapters/intro.tex`, **Then** B can edit it and create files in `chapters/`, and everything outside `chapters/` stays read-only.
8. **Given** the owner removes an override, **When** B's session receives the change, **Then** B's access returns to the project role within 2 seconds without reload.

---

### Edge Cases

- A user's role is lowered while they have unsent offline edits: on reconnect the edits are rejected, the user sees "Your changes could not be saved: you no longer have edit access", and the shared text is unchanged.
- Two owners' actions race (owner transfers ownership while the new owner is being removed): the operations apply in order and the project always has exactly one owner.
- The owner invites their own email or an existing collaborator: refused with a message, or the role is updated.
- An invite to an unknown email is withdrawn before sign-up: the person gets no access when they sign up.
- Identity provider unreachable: the sign-in page shows an error; already-signed-in users keep working until their session expires.
- A user's email changes at the identity provider: the user record follows the provider's stable id, not the email.
- A disabled user who owns projects: their projects stay accessible to collaborators; the admin can still delete them.
- A project is deleted while collaborators are in it: their live connections close and they see "This project was deleted" with a link to the dashboard.
- A file is deleted while another user has it open with unsaved changes: their tab closes with a notice (as in 003).
- Link access and a named role both apply to a user: the higher of the two is used.
- Very long names, names without a display name (email local part is used), and missing avatars (initial in a colored circle).
- More than eight remote users: colors repeat in a fixed palette; the top bar shows up to five avatars and a "+N" counter that lists the rest.

## Requirements *(mandatory)*

### Functional Requirements

**Sign-in and users**

- **FR-001**: The system MUST require sign-in for every page and data endpoint except the sign-in page, the share-link landing page and static assets.
- **FR-002**: Users MUST be able to sign in with Google and with email (one-time code or password), through the external identity provider.
- **FR-003**: The system MUST verify the session on the server for every HTTP request and every live-editing connection, and refuse unauthenticated or disabled users.
- **FR-004**: The system MUST keep its own user record per identity-provider account: provider id, email, display name, avatar URL, site role, disabled flag, created and last-seen times; created on first sign-in and refreshed on later sign-ins.
- **FR-005**: Users MUST be able to sign out from an account menu in the top bar showing their avatar and name.
- **FR-006**: Identity-provider keys MUST come from environment variables; the app MUST refuse to start in production without them.
- **FR-007**: Automated tests MUST be able to sign in without the real sign-in UI, through a mechanism that is absent from production builds; a smaller test set MUST sign in through the real identity provider using its testing tokens.

**Site roles and administration**

- **FR-010**: Each user MUST have site role `admin` or `user`. The first user ever created and anyone whose email is in the admin-seed setting MUST be admin.
- **FR-011**: Admins MUST be able to list all users (email, name, role, status, last seen, owned-project count), promote, demote, disable and re-enable them; the last enabled admin cannot be demoted or disabled.
- **FR-012**: Disabling a user MUST end their sessions and live connections within 2 seconds and block further sign-ins.
- **FR-013**: Admins MUST be able to set sign-up to open or invite-only, with an allowlist of full emails and `@domain` entries. Invite-only is the default on a fresh instance. Under invite-only, admin-seed emails, allowlisted emails and people with a pending project invite are allowed; the first user ever is always allowed.
- **FR-014**: Admins MUST be able to list all projects (title, owner, collaborators, last modified) and delete any project. Site admin status MUST NOT grant access to a project's contents; admins need a membership like anyone else.
- **FR-015**: Non-admins MUST NOT see or reach admin pages or actions.

**Projects and dashboard**

- **FR-020**: The system MUST support many projects; each project has a title, exactly one owner, its own file tree, main document and compile settings.
- **FR-021**: The dashboard MUST list projects the user owns or collaborates on, with title, owner, the user's role and last-modified time, sorted by last modified, with title search.
- **FR-022**: Users MUST be able to create a project blank or from templates Article, Report, Beamer, Letter, or from a zip (rules and limits of 003's import); each template compiles without errors.
- **FR-023**: Owners MUST be able to rename (dashboard and top-bar title) and delete projects; any user with access MUST be able to duplicate a project into one they own; collaborators MUST be able to leave a project.
- **FR-024**: Last-modified time MUST update on any text or tree change.
- **FR-025**: On first start after upgrade, the existing project MUST be kept with its files, text and settings and assigned to the first admin.

**Project roles and sharing**

- **FR-030**: Project roles are Owner, Editor and Reader. Owner: everything, including share, permissions, rename, delete and transfer. Editor: change text, files and tree. Reader: read, compile, view and download.
- **FR-031**: The server MUST enforce the effective role on every text update, tree operation, upload, settings change and project action; the UI only mirrors it.
- **FR-032**: The Share dialog MUST let the owner invite by email as Editor or Reader, list collaborators and pending invites with roles, change roles, remove collaborators and withdraw invites.
- **FR-033**: Invites to emails without an account MUST be honoured automatically when someone signs in with that email.
- **FR-034**: The owner MUST be able to enable link sharing with role Reader or Editor, copy the link, and disable or regenerate it; a disabled or old link MUST stop granting access immediately. Link visitors MUST sign in first; the landing page shows only the project title and a sign-in button.
- **FR-035**: The owner MUST be able to transfer ownership to an existing collaborator; the former owner becomes Editor.
- **FR-036**: A role change, removal, link revocation or project deletion MUST take effect on the affected user's open sessions within 2 seconds (read-only switch or disconnect with a message).
- **FR-037**: Readers MUST be able to trigger compiles and download the PDF, single files and the project zip, but not change compile settings or the main document.

**Per-file and per-folder permissions**

- **FR-040**: The owner MUST be able to set, per collaborator, an Editor or Reader override on any file or folder (raising or lowering the project role), from the tree context menu or the Share dialog, and remove it.
- **FR-041**: The effective role on a file MUST be the override on the nearest of the file itself or its ancestor folders, else the project role; the owner is never restricted.
- **FR-042**: Tree operations MUST require edit rights on every affected item and destination (create/upload: the target folder; rename/delete: the item and, for folders, everything inside; move: the item and the destination).
- **FR-043**: The tree MUST show a lock icon on items the current user can only read, and text files the user can only read MUST open read-only.

**Live collaboration**

- **FR-050**: Each connected user MUST be shown to others with a stable color, a name label on their cursor and selection, and an avatar in the top bar; clicking the avatar jumps to their file and cursor.
- **FR-051**: Remote edits and cursor moves MUST appear for other users within 300 ms on a local network.
- **FR-052**: File-tree changes (create, rename, move, delete, upload, main-document change, project rename) MUST appear for all connected users without reload.
- **FR-053**: Undo and redo MUST revert only the local user's own changes.
- **FR-054**: Edits made while disconnected MUST merge on reconnect without loss, if the user still has edit rights; a connection-state indicator MUST show when the user is offline.
- **FR-055**: Collaborative behavior MUST be verified with automated tests using two and five concurrent sessions.

### Key Entities

- **User**: a person known to the identity provider; provider id (stable key), email, display name, avatar, site role (admin/user), disabled flag, created and last-seen times.
- **Project**: title, owner (User), main document, compile settings, created and last-modified times, optional share link (token + role).
- **Membership**: a User's role (Editor/Reader) on a Project. The owner is stored on the Project.
- **Invite**: an email and role on a Project, pending until someone with that email signs in.
- **Permission override**: Project, User, file or folder, role (Editor/Reader).
- **Instance settings**: sign-up mode (open/invite-only) and the allowlist of emails and domains.
- **File** (from 003): now belongs to a Project.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user signs in and creates and opens a project from a template in under 1 minute.
- **SC-002**: 100% of tested write attempts (text, tree, upload, settings, sharing) by users without the needed role are rejected by the server, in automated tests that bypass the interface.
- **SC-003**: Remote edits and cursor moves are visible to other users within 300 ms on a local network, with 2 and with 5 concurrent sessions.
- **SC-004**: After 1 minute of five users typing concurrently in one file, all sessions hold identical text containing every user's edits.
- **SC-005**: Role changes, removals, link revocations and account disables reach the affected user's open session within 2 seconds.
- **SC-006**: After a 30-second network drop with edits on both sides, no text is lost on reconnect.
- **SC-007**: The pre-existing project is intact (same files and text, compiles to the same page count) after upgrade and belongs to the first admin.
- **SC-008**: Every acceptance scenario above passes as an automated test (constitution principle IV).

## Assumptions

- The identity provider is Clerk (constitution v1.1.0). The operator creates a Clerk application with Google and email sign-in enabled and supplies its publishable and secret keys; the app stores no passwords.
- Sign-up policy is enforced by the app at first sign-in (an account created at the provider but not allowed by the app is refused and not mirrored).
- Invites are not emailed by the app in this feature; the owner tells the invitee, who finds the project on their dashboard after signing in. Email notifications can come later.
- Overrides apply to named collaborators; link-only users get the link role everywhere.
- Each project keeps one shared compile output; any member's compile replaces it for everyone.
- Templates are bundled starter files (Article, Report, Beamer, Letter), each compiling with the default compiler.
- Project deletion is permanent after confirmation; history and trash come with feature 008.
- Mobile layouts are out of scope.
