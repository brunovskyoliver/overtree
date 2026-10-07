# UI contract: GitHub sync

Hidden entirely when the integration is not configured (FR-004). Dark theme, keyboard reachable, ARIA as in 005/008.

## Top bar indicator (`GitHubStatus.svelte`, US4)

- Position: left of the History button. Shown when the project is linked; for an unlinked project only the owner sees a muted "GitHub" button that opens the settings dialog.
- Button `#github-status`: GitHub mark + state dot + short text, `aria-label="GitHub: <repo>, <state text>"`.

| state | dot | text |
|---|---|---|
| in-sync | green | `In sync` |
| unpushed | amber | `Not pushed yet` |
| syncing | spinner | `Syncing…` |
| failed | red | `Sync failed` |
| needs-reconnect / needs-access / owner-changed | red | `Needs attention` |
| pending | grey | `Finish setup` |

- Click opens a popover (`role="dialog"`, `aria-label="GitHub sync"`):
  - repo/branch as a link to GitHub; "Last synced <relative time>" with the commit's short SHA linking to it;
  - error text and "Retrying at <time>" when failing; the fix-it action for the owner ("Reconnect GitHub", "Choose branch", "Create branch", "Grant access", "Take over link");
  - merge note, if any: "Merged GitHub changes on <time>: overlapping edits in `a.tex`; kept your version of `fig.png`" (one line per file), owner can "Dismiss";
  - editors/owner: title input (placeholder "Commit title (optional)") + **Push now**, and **Pull now**; readers see neither (FR-026);
  - "Settings…" (owner) opens the dialog;
  - last runs list (collapsed by default).

## Settings dialog (`GitHubDialog.svelte`, US1, US5)

Opened from the project actions menu ("GitHub…", owner) and the popover. Steps:

1. **Not connected**: text "Connect a GitHub account to sync this project with a repository. You stay signed in to Overtree as <email>." + button **Connect GitHub** → `/api/github/connect?return=/project/<id>?github=1`. Returning with `?github=1` reopens the dialog.
2. **Connected, not linked**: "Connected as @login · Disconnect". Repository picker: search box + list grouped by account/org (avatar, login), each repo row with a lock icon if private. Empty state: "No repositories yet. Install Overtree on your account or an organization." → **Grant access** (`installUrl`, new tab) with "Refresh list". A branch select (default branch preselected). **Link repository**.
3. **Pending (preview)**: the preview lists from the API in collapsible groups: "Will be overwritten on GitHub", "Will be added to GitHub", "Will be added to this project", "Stays on GitHub only", "Identical". Buttons **Sync now** (`merge`) and, when the project is empty, **Import from repository** (`import`), plus Cancel (unlinks).
4. **Linked**: repo/branch with **Change…** and **Unlink** (confirm dialog: "Overtree stops syncing. Nothing on GitHub or in this project is deleted."). "Not pulled from GitHub" pattern list: a textarea, one pattern per line, with the defaults shown and **Reset to defaults**.

## History timeline (008 component, FR-021)

`github` versions show a GitHub mark, the title "Merged from GitHub", the first commit's message and short SHA, and the commit authors' names instead of Overtree avatars; files in the note get a warning chip ("overlapping edits").

## Test hooks

`data-state` attribute on `#github-status` with the raw state for Playwright.
