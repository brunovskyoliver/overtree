# Feature Specification: Light theme and appearance switch

**Feature Branch**: `018-light-theme`

**Created**: 2026-10-21

**Status**: Implemented

**Input**: User description: "The app is dark-only. Many writers work in a light editor, especially in daylight. Appearance setting with three choices: Dark (default, unchanged look), Light, System (follows the operating system, live when it switches). Applies everywhere, with no flash of the wrong theme on load. The PDF viewer keeps its own dark-page toggle."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch the app to a light appearance (Priority: P1)

A writer working by a sunny window opens the account menu (the avatar at the top right of every signed-in page) and picks Appearance → Light. The whole app turns light at once: the dashboard, the project page with its file tree, outline, tabs, editor and toolbar, the logs, the history view and its diffs, dialogs, menus, the PDF pane's toolbar and background, and the admin page. LaTeX highlighting stays easy to read on the white editor. The same choice is also in the editor's settings popover (the "Aa" button), next to font size and spelling. Someone who never touches the setting sees the app exactly as before.

**Why this priority**: This is the feature. A dark-only editor is hard to read in bright light, and some people simply prefer light editors.

**Independent Test**: In a fresh browser, sign in, check the editor looks as before (dark), pick Light in the account menu, and check the dashboard and the editor are light, then reload and check they are still light.

**Acceptance Scenarios**:

1. **Given** a user who never chose an appearance, **When** they open any page, **Then** it is dark and the account menu shows Appearance "Dark" as selected.
2. **Given** a signed-in user on any page with the top bar, **When** they pick Appearance → Light in the account menu, **Then** every part of the page switches to light colors immediately, without a reload.
3. **Given** a user who chose Light, **When** they reload, open another page or come back later in the same browser, **Then** the app is light.
4. **Given** a user who chose Dark (or never chose), **When** they use the app, **Then** colors are the same as before this feature.
5. **Given** a user in the editor, **When** they pick an appearance in the editor settings popover, **Then** it applies the same way as from the account menu, and both places show the same current choice.

---

### User Story 2 - Follow the operating system (Priority: P2)

A writer whose laptop switches to dark mode at sunset picks Appearance → System. During the day Overtree is light; when the operating system switches to dark, Overtree follows within a moment, even with a project open, and back again in the morning.

**Why this priority**: Useful for people who already let the OS manage light and dark, but Light and Dark alone cover the core need.

**Independent Test**: Pick System with the OS set to light and see the app light; switch the OS to dark and see the open app turn dark without a reload.

**Acceptance Scenarios**:

1. **Given** the OS in light mode, **When** the user picks System, **Then** the app is light; with the OS in dark mode it is dark.
2. **Given** System is chosen and a page is open, **When** the OS switches between light and dark, **Then** the page follows without a reload, the editor included.
3. **Given** Dark or Light is chosen, **When** the OS switches, **Then** the app stays as chosen.

---

### User Story 3 - The right theme from the first frame (Priority: P2)

A writer who chose Light reloads the project page. The page never flashes dark before turning light, not even for a frame. The sign-in page and the share-link landing page, which people see before they are signed in, use the same appearance chosen earlier in that browser.

**Why this priority**: A dark flash on every load in a light app is jarring and looks broken.

**Independent Test**: Choose Light, reload with the app's scripts blocked, and check the page is already marked light; open the sign-in page signed out and see it light.

**Acceptance Scenarios**:

1. **Given** Light (or System with a light OS) was chosen, **When** any page loads, **Then** its first painted frame already uses the light colors.
2. **Given** Light was chosen in this browser, **When** the user signs out and opens the sign-in page or a share link, **Then** that page is light.

---

### Edge Cases

- The PDF viewer's own "Dark pages" toggle is independent: it inverts PDF pages in either appearance, and the app appearance never inverts pages.
- Other people's cursors and name labels stay readable on both the dark and the light editor. Their colors stay the same per person; on the light editor, carets and labels are drawn in a darker shade of that color so they stand out from white.
- Native controls (checkboxes, select menus, scrollbars) follow the appearance.
- Storage unavailable (private mode, full): the choice applies for the open page and falls back to Dark on the next load.
- A stored value the app doesn't know (for example from a later version): treated as Dark.
- The choice is stored per browser, like font size and spelling: a second computer starts dark until the user picks there too.
- The sign-in widget takes its colors when it appears; if the OS switches while it is open with System chosen, the page around it follows and the widget follows on the next load.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST offer an Appearance setting with exactly three choices: Dark, Light and System. Dark MUST be the default.
- **FR-002**: The setting MUST be reachable from the account menu on every page with the top bar, and from the editor settings popover.
- **FR-003**: Changing the setting MUST apply immediately to the whole open page without a reload.
- **FR-004**: The choice MUST persist in the browser together with the other editor preferences and apply to every page of the app, including sign-in, share-link landing and blocked-account pages.
- **FR-005**: System MUST follow the operating system's light or dark preference, including changes while a page is open.
- **FR-006**: Pages MUST paint their first frame in the chosen appearance (no flash of the other theme).
- **FR-007**: The Dark appearance MUST keep every color the app had before this feature.
- **FR-008**: In Light, LaTeX syntax colors, line numbers and body text in the editor MUST have a contrast of at least 4.5:1 against the editor background, and carets, bracket highlights and focus rings at least 3:1.
- **FR-009**: Remote cursors and their name labels MUST be readable in both appearances.
- **FR-010**: Native form controls and scrollbars MUST match the appearance.
- **FR-011**: The PDF viewer's dark-page toggle MUST keep working independently of the appearance.

### Key Entities

- **Appearance preference**: the user's choice (Dark, Light or System), stored per browser with the editor preferences (font size, spelling).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Switching appearance takes one menu choice and recolors the page in under 100 ms.
- **SC-002**: With Light chosen, zero frames of a page load show the dark theme.
- **SC-003**: Screenshots of the dark app before and after this feature are identical, except native checkboxes on the project page on a light OS (they now render dark to match, FR-010).
- **SC-004**: Every Light editor color in FR-008 meets its contrast ratio.

## Assumptions

- "Per user" means per browser, as for the existing editor preferences; syncing preferences across devices is a separate feature.
- The account menu is the home for app-wide settings until there is a settings page.
- The PDF page itself and the SyncTeX highlight on it keep their own colors in both appearances.
