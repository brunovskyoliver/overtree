# Implementation Plan: Light theme and appearance switch

**Branch**: `018-light-theme` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

## Summary

Every color in the app becomes a CSS custom property in `src/app.css`. `:root` holds the dark set with the exact pre-018 values; `:root[data-theme='light']` overrides the same names. The appearance (`dark | light | system`) lives in the existing editor prefs (`src/lib/editor/prefs.svelte.ts`, localStorage key `overtree:editor-prefs`), which resolves it to a theme and writes `data-theme` on `<html>`. A small inline script in `src/app.html` does the same before first paint and listens to `prefers-color-scheme`, so pages without the app bundle (and the first frame of every page) are already right. The CodeMirror theme takes its colors from the same tokens; a compartment switches CodeMirror's own `darkTheme` facet so its base styles (tooltips, panels from other extensions) match.

## Technical Context

- **Stack**: SvelteKit + Svelte 5 runes, CodeMirror 6; no new dependencies.
- **Storage**: browser localStorage, next to font size and spelling. No server or schema change.
- **Testing**: Vitest (`tests/unit/appearance.test.ts`, `tests/unit/theme-tokens.test.ts`), Playwright (`tests/e2e/appearance.spec.ts`).

## Design decisions

1. **Tokens, not two stylesheets.** Components keep one set of rules using `var(--x)`. A light theme is one override block. Other features merged after this one only need to use tokens (`theme-tokens.test.ts` fails on an undefined `var(--x)` without fallback, and on a token missing from the light set).
2. **Semantic names, one per distinct pre-018 value.** Dark must stay pixel-identical, so near-duplicates (`#f28b82` / `#f08a8a`, `#e0a030` / `#e0a526`) became separate tokens (`--error` / `--error-alt`, `--warn-stripe` / `--warn-dot`) with the same light value where that made sense. Merging them is a later cleanup that changes dark.
3. **Selected vs. primary.** Dark used `--accent` both for the selected file/outline row and for primary buttons. In light a solid green row with dark text is unreadable, so `--selected` (dark: same green; light: pale green under dark text) splits off, and text on solid accent/danger buttons uses `--on-accent` (dark: `--text`'s value; light: white).
4. **Pre-paint script duplicates `resolveTheme`.** `app.html` can't import modules. The script is 10 lines; `appearance.test.ts` runs it in a fake browser for every stored value × OS preference and compares it with `resolveTheme`. `<html>` defaults to `data-theme="dark"` in the markup so a failing script still gives the old look.
5. **Two listeners for System.** The inline script follows `prefers-color-scheme` on every page (sign-in, share, blocked have no prefs module); prefs follows it too because the editor needs the resolved theme reactively. Both write the same value.
6. **Remote cursors.** Presence colors (`presence.ts`) are shared between users through awareness, so they can't depend on the viewer's theme. Measured on white, the pastel palette's carets reach only 1.6–2.5:1. In light, `--presence-caret-filter: brightness(0.55)` darkens caret and label (caret ≥ 5.0:1 on white) and the label text turns white (≥ 5.0:1 on every darkened color). Dark keeps `filter: none`, which is the initial value. Avatars keep dark initials on the pastel color (≥ 6.6:1, theme independent).
7. **`color-scheme`.** `:root` sets it, but pdf.js's viewer CSS (loaded on the project page) sets `:root { color-scheme: light dark }` and won. `:root[data-theme='dark']` restores `dark`. Effect on dark mode: on a light-OS machine, native checkboxes on the project page are now dark (the only dark pixel change, SC-003).
8. **Clerk.** The sign-in widget wants literal colors; it now reads the current token values with `getComputedStyle` when it mounts and uses Clerk's `dark` base theme only in dark. `ponytail:` a System switch while the widget is open doesn't recolor it until reload.
9. **Where the setting lives.** Account menu (every page with the top bar: dashboard, project, admin) as three `menuitemradio`s, so `getByRole('menuitem')` lists stay unchanged; and a `<select>` in the editor settings popover.

## Light palette and contrast

Light editor background `#ffffff`. Measured contrast ratios: editor text 15.8, syntax command `#a32b84` 6.5, argument `#8f5200` 6.2, math `#00745a` 5.8, comment `#636a76` 5.5 (5.0 on the active line), bracket `#4b5260` 7.9, number `#a14a00` 6.0, invalid `#c5221f` 5.8, gutter `#6b7280` 4.8, muted UI text `#555c67` ≥ 5.4 on every panel, white on accent `#2e7d32` 5.1. `theme-tokens.test.ts` asserts the 4.5:1 / 3:1 thresholds from the CSS itself.

## Hex/rgb literals left in `src` (exceptions)

| Where | Literal | Why it stays |
|---|---|---|
| `src/app.css` | all tokens | the definitions |
| `src/lib/presence.ts` | `PALETTE` | user colors are data shared through awareness; readability per theme handled by tokens (decision 6) |
| `src/lib/components/HistoryDiff.svelte` | `NEUTRAL = '#9aa1ad'` | author color for unknown authors, same role as `PALETTE` (gets `33` alpha appended, needs hex) |
| `src/lib/editor/theme.ts` | `'#fff'` on the selected completion row | white on the accent green in both themes (dark 6.5:1, light 5.1:1) |
| `src/lib/components/GitHubStatus.svelte` | `.dot` `#8a8a8a` | neutral status dot, mid grey reads on both backgrounds |
| `src/lib/components/RecompileButton.svelte` | `rgb(0 0 0 / 0.25)` | divider inside the green button, independent of the page |
| `src/lib/components/PdfViewer.svelte` | `rgb(255 196 0 / …)` | SyncTeX highlight drawn on the PDF page, which is white (or inverted by the PDF toggle) in both themes |

Every other literal (about 120, in components, routes and `theme.ts`) now uses a token. Shadows and the dialog backdrop became tokens too (lighter in light).

## Constitution Check

| Principle | Status | How |
|---|---|---|
| I. Collaboration is the data model | ✅ | No document change; the preference is local UI state. |
| II. Self-hostable by one person | ✅ | No new service or config. |
| III. Untrusted compilation | ✅ | Untouched. |
| IV. Test the seams | ✅ | Vitest for the resolver, the pre-paint script and the tokens; Playwright for every acceptance scenario (default dark, switching from both places, reload without flash, scripts blocked, System live via `emulateMedia`, sign-in signed out). |
| V. Simplicity first | ✅ | CSS custom properties and one data attribute; no theme library, no second stylesheet. `ponytail:` Clerk widget recolors on reload only. |
| Tech constraints, UI line | ➕ addition | The constitution says "dark theme matching the reference layout". Dark stays the default and unchanged; Light is an opt-in addition, not a replacement, so this is not a violation. Proposed wording (PATCH, for the owner to apply): "**UI**: dark theme by default matching the reference layout, with an optional light theme; (file tree + outline \| editor \| PDF), keyboard-first, accessible (focus states, ARIA on tree and menus)." |

## Source changes

```text
src/app.css                       tokens: dark set (pre-018 values) + light set
src/app.html                      pre-paint script, data-theme="dark" default
src/lib/editor/prefs.svelte.ts    appearance, resolveTheme, theme, setAppearance
src/lib/editor/theme.ts           colors → tokens, colorScheme() for the darkTheme facet
src/lib/components/*.svelte       literals → tokens; TopBar + Toolbar gain the setting; Editor reconfigures colorScheme
src/routes/**                     literals → tokens; sign-in reads tokens for Clerk
tests/unit/appearance.test.ts     resolver, app.html script, prefs store
tests/unit/theme-tokens.test.ts   token coverage, light contrast, dark values
tests/e2e/appearance.spec.ts      user journeys
```

Also fixed for port-isolated e2e runs: `tests/e2e/auth.spec.ts` uses `baseURL` instead of port 4173, and `tests/e2e/github.spec.ts` reads `FAKE_GITHUB_URL` (default `http://127.0.0.1:4175`).
