# UI contract

Accessible names below are what Playwright tests select by (`getByRole(role, { name })`).

## Top bar (editor page `/project/:id`)

Left: brand link "Overtree" → `/` (dashboard). Centre: project title; owner sees a button "Rename project" (title becomes a text input, Enter saves, Escape cancels); others see plain text. Right, in order:
- presence: up to 5 avatar buttons, name = "<Name> (go to cursor)", 28 px circle with avatar image or initial, ring in the user's color; then a "+N" button opening a list of the rest. Hidden when alone.
- connection indicator (`role=status`): "Offline, reconnecting…" while disconnected; reuses 003 "Saved"/"Connecting…" text otherwise.
- button "Share" (green, as in reference layout).
- account menu button, name "Account" (own avatar): menu items "Dashboard", "Admin" (admins only), "Sign out".

Read-only banner under the tabs when the active file is read-only: "Read only: you can view and compile but not edit."

## Share dialog (`role=dialog`, name "Share project")

Owner view:
- Invite row: textbox "Email", select "Role" (Editor, Reader), button "Invite". Inline errors.
- List "People with access": owner row ("Owner"), each member row: name, email, select "Role for <email>" (Editor, Reader), button "Remove <email>", menu item "Make owner" (confirm dialog), and an expandable "File permissions" list of that user's overrides with remove buttons.
- Pending invites: "<email> (invited)" with role select and "Withdraw invite <email>".
- Link section: switch "Anyone with the link", select "Link role", textbox (read-only) "Share link", button "Copy link", button "Reset link".
Non-owner view: the list read-only, no controls.

## File tree additions

- Context menu item "Permissions…" (owner only, when the project has members) → dialog "Permissions for <path>": one row per member, select with "Project role (<role>)", "Editor", "Reader".
- Lock icon (`aria-label="Read only"`) on rows the user can only read. Create/upload/rename/delete/move items disabled on those rows; header buttons disabled when the root is read-only.

## Editor

- Read-only files: CodeMirror `readOnly` + not `editable`; formatting toolbar buttons disabled.
- Remote cursors: y-codemirror caret with name label in the user's color; selection in `colorLight`.

## Dashboard `/`

- Heading "Projects"; textbox "Search projects"; button "New project" → menu "Blank project", "Article", "Report", "Beamer presentation", "Letter", "Upload zip".
- Creating opens dialog "New project" with textbox "Project title" and button "Create".
- Table with columns Title (link), Owner, Your role, Last modified; row actions menu "Actions for <title>": "Rename", "Duplicate", "Delete" (owner), "Leave" (non-owner); confirm dialogs name the project.
- Empty state: "No projects yet" with the New project button.

## Admin `/admin`

Tabs "Users", "Projects", "Settings".
- Users: textbox "Search users"; table Name, Email, Role, Status, Last seen, Projects; per row buttons "Make admin"/"Remove admin", "Disable"/"Enable".
- Projects: table Title, Owner, Collaborators, Last modified; "Delete <title>" with confirm.
- Settings: radio group "Sign-up" ("Open to anyone", "Invite only"); textarea "Allowed emails and domains" (one per line); button "Save".

## Other pages

- `/sign-in`: Clerk sign-in widget centered on the dark background, Overtree heading.
- `/share/:token` signed out: "<title>" heading, text "Sign in to open this project", button "Sign in".
- `/blocked`: "Your account is disabled" or "Your email isn't allowed on this instance", button "Sign out".
- No access to a project: "You don't have access to this project" + link "Back to dashboard". Access removed live: same page with "Your access was removed". Deleted live: "This project was deleted".
