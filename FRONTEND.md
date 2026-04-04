# Frontend Production Checklist

This file is the current frontend checklist for the Vite/Tauri UI in `/Users/deepsaint/Desktop/ice/frontend`.

Rules for this checklist:

- Unfinished work stays at the top.
- Verified work stays at the bottom.
- Sections are grouped by concern.
- Only items that are implemented and verified should use `✅`.

## Highest Priority Remaining

### Backend Wiring

- [ ] Replace the remaining demo Zustand seed data in [terminal.ts](/Users/deepsaint/Desktop/ice/frontend/src/stores/terminal.ts) and [codex.ts](/Users/deepsaint/Desktop/ice/frontend/src/stores/codex.ts) with Tauri IPC loaders.
- [ ] Subscribe to backend events for filesystem, git, browser, terminal, and Codex updates instead of relying on local-only mutations.
- [ ] Add browser, terminal, and Codex event subscriptions on top of the now-live filesystem and git listeners.
- [ ] Persist and hydrate workspace layout from the backend rather than purely local in-memory state.

### Filesystem / Editor

- [ ] Open real editor tabs from `file_read` / `file_read_text` and push edits through backend writes.
- [ ] Add dirty-state tracking, save affordances, and stale-version conflict UI using the backend file `versionToken`.
- [ ] Wire the Search quick action in [ProjectSection.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/sidebar/ProjectSection.tsx) to `file_search_paths` and `file_search_text`.

### Git

- [ ] Add stage / unstage / commit interactions in [GitSurface.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces/GitSurface.tsx).
- [ ] Use `git_commit_readiness` to preflight author config and message validity before enabling the final commit action.
- [ ] Add file-level diff rendering and change selection flows.
- [ ] Use `git_diff_tree_read` for staged and unstaged change groups so the frontend does not have to fan out per-file diff requests just to render the git surface.
- [ ] Use `git_restore_paths` for discard/revert actions instead of local-only row removal.
- [ ] Wire branch list / checkout / fetch / pull / push actions to the now-available backend git commands.
- [ ] Subscribe to `app://git` `mutationCompleted` events so the UI can distinguish stage, unstage, restore, commit, checkout, fetch, pull, and push outcomes without inferring intent from a generic status refresh.

### Browser

- [ ] Replace the placeholder browser viewport in [BrowserSurface.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces/BrowserSurface.tsx) with the real Tauri-native browser rendering strategy.
- [ ] Wire address bar and nav buttons to backend browser commands.
- [ ] Render per-project browser tab lists instead of the current “No browser tabs” placeholder in [ProjectSection.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/sidebar/ProjectSection.tsx).
- [ ] Hydrate browser tab chrome from backend `BrowserTabRecord` metadata instead of local placeholder fields.
- [ ] Use `browser_tab_renderer_state_set` from the renderer host to keep loading, title, favicon, security-origin, and nav affordances in sync.
- [ ] Use `browser_tab_pin_set` for pinned tabs and `browser_tab_open_external` for “open in external browser” affordances.
- [ ] Use `browser_renderer_attach` / `browser_renderer_detach` when the pane-hosted native browser surface mounts and unmounts.
- [ ] Route in-page search through `browser_find_in_page` and feed renderer results back through `browser_find_in_page_report`.
- [ ] Route download intent from the renderer through `browser_download_request` instead of opening ad hoc OS dialogs directly.
- [ ] Use `project_browser_sidebar` for sidebar browser rows and `project_browser_restore_policy_get/set` for per-project restore settings.

### Terminal

- [ ] Replace the demo xterm banner with live PTY data from backend terminal events in [TerminalSurface.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces/TerminalSurface.tsx).
- [ ] Wire terminal create / rename / close / resize / write flows to backend IPC.
- [ ] Bind terminal tabs to backend `terminal_scrollback_read` plus live `app://terminal` events so restored sessions render persisted output before new PTY data arrives.
- [ ] Use backend `terminal_respawn` for restored stopped sessions instead of inventing new local terminal ids.
- [ ] Keep the bottom dock session model synced to backend session persistence.

### Codex / Agent UX

- [ ] Replace the demo thread store with backend thread and approval state.
- [ ] Render real streaming turn output in [CodexSurface.tsx](/Users/deepsaint/Desktop/ice/frontend/src/components/surfaces/CodexSurface.tsx).
- [ ] Add approval prompts bound to backend pending approvals, using approval `category` and `riskLevel` for intent-specific UI.
- [ ] Add thread creation and prompt submission wired to backend Codex commands.
- [ ] Use `project_codex_sidebar` for project-scoped sidebar thread previews instead of recomputing them from the full thread store.

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
