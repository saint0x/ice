# Frontend Production Checklist

This file is the current frontend checklist for the Vite/Tauri UI in `/Users/deepsaint/Desktop/ice/frontend`.

Rules for this checklist:

- Unfinished work stays at the top.
- Verified work stays at the bottom.
- Sections are grouped by concern.
- Only items that are implemented and verified should use `✅`.

## Highest Priority Remaining

### Backend Wiring
- [ ] Add editor-local search and replace UI on top of the now-live backend file read/write/search contracts.
- [ ] Keep removing the last local-only helper logic in frontend stores and surfaces so startup and mutations come exclusively from backend truth.

### Filesystem / Editor

- [ ] Add stale-version conflict-resolution UI on top of the backend file `versionToken` instead of just surfacing the raw save failure.

### Git

- [ ] Subscribe to `app://git` `mutationCompleted` events so the UI can distinguish stage, unstage, restore, commit, checkout, fetch, pull, and push outcomes without inferring intent from a generic status refresh.

### Browser

- [ ] Improve renderer metadata capture beyond the current native-host URL/loading/title/favicon sync, especially blocked-frame fallbacks.
- [ ] Add conflict-resolution UX for backend save-token mismatches instead of showing the raw backend error banner.

### Terminal

- [ ] Keep the bottom dock session model synced to backend session persistence.

### Codex / Agent UX

- [ ] Add richer artifact- and tool-result-specific rendering on top of the now-live canonical Codex message stream.

### Multi-Project UX

- [ ] Keep sidebar project sections synced with backend project order and active project state.
- [ ] Support live add/remove project flows from the backend.
- [ ] Ensure pane tabs, terminal sessions, browser tabs, git state, and Codex threads all stay properly keyed by `projectId`.

### Polish / Desktop Quality

- [ ] Add keyboard shortcuts for core pane, tab, terminal, and project actions beyond current starter bindings.
- [ ] Add focus ring and active-pane synchronization between sidebar, tab bar, and surface content.
- [ ] Add empty, loading, and failure states for every backend-driven surface.
- [ ] Add error toasts / banners for backend command failures.

### Verification

- [ ] Add frontend integration tests around backend hydration and event synchronization.
- [ ] Add end-to-end Tauri verification once real backend wiring is complete.

## Verified Done

### Shell / Layout

- ✅ The frontend already has a composed app shell in [AppShell.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/shell/AppShell.tsx) with title bar, sidebar, workbench, bottom dock, and chat panel regions.
- ✅ Pane layout state supports leaf/split composition, active pane tracking, tab open/close/activate, and split resizing in [workspace.ts](/Users/deepsaint/Desktop/ice/frontend/src/stores/workspace.ts).
- ✅ Content rendering is already separated by surface type in [ContentRenderer.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/panes/ContentRenderer.tsx).

### Multi-Project Sidebar

- ✅ The frontend is already built around a stacked multi-project sidebar instead of a single hidden current-project switcher.
- ✅ Project order, active project, collapse state, and expanded section state are modeled per project in [projects.ts](/Users/deepsaint/Desktop/ice/frontend/src/stores/projects.ts).
- ✅ Sidebar project cards render files, git, browser, terminal, and action affordances in [ProjectSection.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/sidebar/ProjectSection.tsx).

### Surface Inventory

- ✅ Dedicated surfaces exist for editor, browser, terminal, git, and Codex views under [surfaces](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces).
- ✅ A terminal renderer based on `xterm` is already scaffolded in [TerminalSurface.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces/TerminalSurface.tsx).
- ✅ Git, file tree, terminal list, and Codex list components already exist in the sidebar.

### State Shape

- ✅ The frontend types already model the right major concepts in [index.ts](/Users/deepsaint/Desktop/ice/frontend/src/types/index.ts): projects, tabs, pane layouts, file entries, git state, terminal sessions, Codex threads, and approvals.
- ✅ Important state is already keyed by `projectId` across project, file, git, terminal, and Codex stores.
- ✅ The backend now exposes a first-class workspace session payload through bootstrap and dedicated workspace session IPC commands, so the frontend no longer needs to invent pane/tab state locally.
- ✅ The frontend now bootstraps projects, workspace chrome/session, nested file trees, and git state from the backend through [backend.ts](/Users/deepsaint/Desktop/ice/frontend/src/lib/backend.ts) and [useBackendIntegration.ts](/Users/deepsaint/Desktop/ice/frontend/src/hooks/useBackendIntegration.ts).
- ✅ The frontend now persists workspace chrome/session changes back through `workspace_chrome_set` and `workspace_session_set`, replacing the old local-only workspace seed path in [workspace.ts](/Users/deepsaint/Desktop/ice/frontend/src/stores/workspace.ts).
- ✅ The sidebar file tree now hydrates from `project_tree_read_nested`, so [FileTree.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/sidebar/FileTree.tsx) consumes backend-shaped `children` hierarchies directly.
- ✅ The git store now hydrates from live backend status reads and `app://git` events instead of demo git rows.
- ✅ Browser tabs now hydrate from backend `browser_tabs_list`, stay live from `app://browser`, and render per-project sidebar rows through [BrowserList.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/sidebar/BrowserList.tsx) plus [browser.ts](/Users/deepsaint/Desktop/ice/frontend/src/stores/browser.ts).
- ✅ Title bar browser creation and browser-surface address/nav actions now route through backend browser IPC in [TitleBar.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/shell/TitleBar.tsx) and [BrowserSurface.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces/BrowserSurface.tsx).
- ✅ The browser surface is now a pane-hosted native child-webview host that attaches/detaches through the backend browser bridge and syncs runtime bounds through backend IPC.
- ✅ Browser find-in-page now executes inside the native child-webview runtime and returns real match counts plus active selection state through backend browser events instead of frontend-fabricated results.
- ✅ Browser downloads now surface real backend-driven requested/finished notices with canonical destination paths under `~/.ice/browser/downloads`, and popup/new-window requests now materialize as in-app browser tabs.
- ✅ The editor surface now reads real file contents from the backend, blocks binary-file text editing, saves through backend `file_write_text`, and honors backend version-token save guards.
- ✅ The existing title-bar and project utility actions now open real backend-backed workbench tabs for files, project search, diagnostics, and debug state instead of decorative placeholders.
- ✅ Demo/default startup entities have been removed from project, git, terminal, Codex, and workspace stores so the shell now waits for canonical backend hydration instead of rendering fake placeholder state.
- ✅ The Git surface now stages, unstages, restores, reads diffs, and commits through backend git IPC with commit-readiness feedback instead of placeholder-only controls.
- ✅ Codex surfaces now have real thread selection, unread clearing, approval execution, and stronger runtime-status presentation without inventing fake history the backend does not persist.
- ✅ Codex surfaces and the chat panel now share one production conversation renderer, keep approval context structured, render real live streaming updates, and expose expandable request details instead of flattening approval payloads into generic text.
- ✅ Terminal surfaces now keep xterm mounted across scrollback updates, send resize back to the backend PTY, and expose explicit respawn UI instead of silently restarting dead sessions.
- ✅ Browser surfaces now route open-external through the backend browser contract, and the native host now drives URL/title/load-state/favicon updates back into canonical backend browser state.
- ✅ Browser sidebar rows and browser-surface chrome now use backend `browser_tab_pin_set` for pinned-tab state instead of local-only affordances.
- ✅ The browser sidebar now uses backend `project_browser_restore_policy_get/set` for per-project restore behavior instead of keeping restore behavior implicit.
- ✅ Browser and Codex sidebar sections now consume canonical backend `project_browser_sidebar` and `project_codex_sidebar` projections instead of recomputing those rows from full local stores.
- ✅ The Git surface now supports backend branch creation and upstream-aware publish/push flows instead of treating branch sync as a fixed current-branch-only action bar.
- ✅ The Git surface now uses backend branch/fetch/pull/push controls, and the terminal dock now uses backend rename plus richer active-session metadata.
- ✅ The Git surface now uses backend `git_diff_tree_read` for staged and unstaged whole-tree diff views, and the terminal dock now exposes persisted scrollback plus session diagnostics from backend state.
- ✅ The Git surface now uses backend git-history and commit-show contracts for recent commit browsing and commit diff inspection instead of stopping at working-tree mutation state.
- ✅ Terminal sessions and scrollback now hydrate from backend `terminal_list` / `terminal_scrollback_read`, and the frontend listens to live `app://terminal` events through [useBackendIntegration.ts](/Users/deepsaint/Desktop/ice/frontend/src/hooks/useBackendIntegration.ts).
- ✅ Terminal create, close, write, and respawn flows now route through backend IPC in [TerminalList.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/sidebar/TerminalList.tsx), [BottomDock.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/shell/BottomDock.tsx), and [TerminalSurface.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces/TerminalSurface.tsx).
- ✅ Terminal surfaces and dock diagnostics now also use backend interrupt, EOF, and scrollback-clear actions instead of leaving those operational controls outside the shell.
- ✅ Codex threads and approvals now hydrate from backend `codex_threads_list` / `codex_approvals_list`, and the frontend listens to live `app://codex` events through [useBackendIntegration.ts](/Users/deepsaint/Desktop/ice/frontend/src/hooks/useBackendIntegration.ts).
- ✅ Codex thread creation, prompt submission, and approval approve/deny actions now route through backend IPC in [CodexSurface.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces/CodexSurface.tsx), [ChatPanel.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/shell/ChatPanel.tsx), and [ProjectSection.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/sidebar/ProjectSection.tsx).
- ✅ Codex surfaces and the chat panel now render canonical multi-turn history from backend `codex_thread_messages_list` plus live `messageUpserted` events instead of relying on summary-only thread previews.
- ✅ Filesystem, git, browser, terminal, and Codex event subscriptions are live, and workspace chrome/session now persist and hydrate through backend contracts instead of staying local-only.
- ✅ Backend persistence now tracks an explicit schema version in SQLite, which gives production migrations a canonical upgrade baseline instead of implicit table-shape assumptions.
- ✅ The backend tree API now supports hidden-file and `.gitignore` controls, and the file-read API now distinguishes binary files from editable text.
- ✅ The backend now exposes project-scoped filename and content search commands for the sidebar search entrypoint.
- ✅ The backend file-read/write contract now supports optimistic save conflict detection through a version token.
- ✅ The backend file-read/write contract now exposes encoding and BOM metadata so the frontend can preserve legacy text files correctly on save.
- ✅ The backend Codex thread payload now includes normalized status, unread state, and last assistant message summaries for sidebar/chat rendering.
- ✅ The backend now exposes classified approval metadata and a `codex_restart` command for recovery UI.
- ✅ The backend now exposes Codex runtime contract info so diagnostics or settings UI can show the installed CLI/app-server capabilities.
- ✅ The backend now exposes approval audit history plus an explicit deny path for approval UX and diagnostics surfaces.
- ✅ The backend now enforces destructive-action policy server-side, including auto-blocking clearly dangerous shell and git requests.

### Visual / Product Direction

- ✅ The frontend already carries a dense desktop-style shell and token system in [tokens.css](/Users/deepsaint/Desktop/ice/frontend/src/styles/tokens.css).
- ✅ The frontend has separate sidebar, pane, shell, and surface modules rather than one collapsed component tree.
