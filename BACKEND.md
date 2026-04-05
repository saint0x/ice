# Backend Production Checklist

This file is now the implementation checklist for the Rust/Tauri backend in `/Users/deepsaint/Desktop/ice/src-tauri`.

Rules for this checklist:

- Unfinished work stays at the top.
- Verified work stays at the bottom.
- Sections are grouped by concern.
- Only items that are implemented and verified should use `✅`.

## Highest Priority Remaining

### Filesystem / IDE

### Git

### Browser

### Terminal

- [ ] Add terminal event schema docs for the frontend, including `sessionCreated`, `data`, `sessionExited`, `sessionReadError`, and `sessionClosed`.
- [ ] Decide whether richer terminal-native UI protocol support should stay behind the current PTY contract or move to a dedicated Ghostty/libghostty bridge later.

### Codex / Agent Runtime

- ✅ Codex thread creation now validates the target project before the thread is created, and turn execution now rejects cross-project thread reuse instead of rebinding threads to whichever `projectId` the caller supplies.
- ✅ Codex turn execution now injects a canonical project-scope preamble derived from the registered project root, so each turn explicitly tells the agent which project it is in and forbids work outside that root.
- ✅ Codex approval handling now blocks unscoped actions and project-root escape attempts by validating approval path and command context against the owning project root before the user is even prompted.
- ✅ Codex thread-history reads now require both `projectId` and `threadId`, so message-history access is validated against thread ownership instead of being keyed by thread id alone.

### Security / Approvals

### Persistence / State

- [ ] Add dedicated persistence for dock session contents beyond shell chrome dimensions and open/closed flags.
- [ ] Add periodic integrity checks and repair tooling for `~/.ice/ice.db`.
- [ ] Add cleanup policies for stale sessions, stale browser history, and stale diagnostics artifacts.

### Frontend Contract Support

- [ ] Publish a typed shared contract for project, tree, git, browser, terminal, Codex, and approval payloads.
### Testing / Release

- [ ] Expand Fozzy scenarios further into browser navigation and Codex recovery flows.
- [ ] Add host-backed Fozzy coverage for the new git and filesystem mutation commands.
- [ ] Add startup smoke tests that assert canonical storage under `~/.ice`.
- [ ] Add release packaging checks for Tauri bundles once the frontend wiring is complete.

## Verified Done

### App Layout / Canonical Storage

- ✅ Canonical local root is `~/.ice`, managed by [paths.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/app/paths.rs).
- ✅ Canonical SQLite database path is `~/.ice/ice.db`.
- ✅ Concern directories are created under `~/.ice/{projects,workspace,browser,terminal,codex,diagnostics}` during startup in [startup.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/app/startup.rs).
- ✅ Startup seeds canonical storage config into SQLite through `app_config`.

### Persistence

- ✅ SQLite persistence exists for projects, workspace layouts, workspace sessions, browser tabs, browser history, terminal sessions, Codex threads, Codex messages, Codex approvals, and app config in [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Schema versioning now exists through `schema_metadata`, with a canonical backend schema version recorded during startup migrations in [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Browser tab metadata and navigation history are persisted locally.
- ✅ Terminal session metadata is persisted locally, including `is_running`.
- ✅ Codex thread bindings are persisted locally.
- ✅ Pending Codex approvals are persisted locally.

### Filesystem / IDE

- ✅ Project-root-scoped path resolution prevents escapes outside the project root in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/fs/service.rs).
- ✅ Tree reads, text file reads, and text writes exist.
- ✅ Nested tree snapshots now exist through `project_tree_read_nested`, so the frontend can consume backend-shaped `children` hierarchies instead of reconstructing them from flat rows.
- ✅ Directory creation, entry deletion, and entry rename commands are implemented.
- ✅ File tree rows can include git status annotations from the native git service.
- ✅ File watch support exists and emits `app://fs` events for live project updates.
- ✅ Tree reads now support ignore-aware traversal controls for `.gitignore`, hidden files, and entry-count suppression.
- ✅ File reads now expose binary-safe metadata through [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/fs/service.rs), and text reads reject binary payloads instead of pretending they are editable text.
- ✅ Project-scoped filename and content search primitives now exist in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/fs/service.rs), with ignore-aware path search and `rg`-backed content search.
- ✅ File reads now return a version token, and writes can reject stale saves to prevent clobbering files changed externally after open.
- ✅ File reads now detect text encodings and BOM state, and file writes can preserve non-UTF-8 text encodings instead of forcing UTF-8 on save.

### Git

- ✅ Native git status reads use `git status --porcelain=2 --branch --untracked-files=all` in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/git/service.rs).
- ✅ Git status payloads now include branch, ahead/behind counts, staged/modified/untracked/conflicted counts, and per-file change rows.
- ✅ Native git stage, unstage, and commit commands are implemented.
- ✅ Native git branch list, checkout, fetch, pull, and push commands are implemented behind typed IPC commands.
- ✅ Pull uses `--ff-only` by default to avoid hidden merge commits from the desktop shell.
- ✅ Filesystem watch activity now triggers debounced native git status refresh events so git surfaces can stay hot without blind frontend polling.
- ✅ Native git restore/discard flows now exist through typed backend commands with explicit staged/worktree targeting in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/git/service.rs).
- ✅ Whole-tree staged and unstaged diff payload reads now exist alongside per-file diffs through `git_diff_tree_read`.
- ✅ Commit readiness now exposes author config, commit-message validation, hooks path, and active hooks so the frontend can explain blocked commits before execution.
- ✅ Structured git mutation events now emit through `app://git` as `mutationCompleted`, with typed action/context payloads for stage, unstage, restore, commit, checkout, fetch, pull, and push outcomes.
- ✅ The current frontend now consumes those structured `mutationCompleted` git events directly, so the Git surface reflects concrete backend mutation outcomes instead of inferring intent from status-only refreshes.
- ✅ Native git history and commit-show contracts now exist through typed backend commands, so the frontend can render real recent commits and inspect commit diffs without shelling out locally.
- ✅ The frontend now also uses backend file search, health/runtime diagnostics, approval audit, and project snapshot contracts for existing utility tabs and quick actions instead of decorative-only project controls.
- ✅ The current frontend now surfaces backend command failures through a canonical shell-level notification path instead of trapping operational errors only inside local component state.
- ✅ The current frontend now keeps pane activation and focus synchronized across sidebar-driven opens, tab activation, and split creation, so the active workbench target is explicit and stable during backend-driven navigation.
- ✅ The current frontend now also uses broader shell shortcuts and explicit empty/loading states on top of the existing backend contracts, so backend-driven workbench actions no longer depend on click-only paths or silent missing-state fallbacks.
- ✅ The current frontend now also uses the version-token backend guard for visual editor conflict comparison and merged-draft resolution instead of leaving stale-save recovery at a raw reload-or-overwrite boundary.

### Browser

- ✅ Browser tabs are project-scoped and persistent.
- ✅ Browser navigation state supports navigate, back, forward, reload, close, list, and history retrieval in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/browser/service.rs).
- ✅ Browser events are emitted through `app://browser`.
- ✅ Browser tab metadata now persists loading state, favicon URL, security origin, and secure-context state in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/browser/service.rs) and [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Renderer-facing browser sync commands now exist for pinning, tab metadata updates, and open-external requests without hard-coding a specific browser engine into the backend contract.
- ✅ Browser renderer bridge commands now exist for renderer attach/detach, renderer session lookup, find-in-page requests/results, and download requests without coupling the rest of the backend to a specific native browser implementation.
- ✅ Project-level browser restore policy now exists as backend state, with canonical per-project get/set commands under the project service.
- ✅ The current frontend now uses the browser renderer bridge for a pane-hosted native child-webview host, with runtime-managed attach/detach and bounds synchronization through backend browser IPC.
- ✅ Native browser panes now inject a runtime script that reports favicon metadata and executes real in-page text search inside the mounted child webview instead of fabricating search results in the React shell.
- ✅ Native browser downloads now land under `~/.ice/browser/downloads`, emit requested/finished browser events with destination-path metadata, and stay inside the canonical backend browser concern instead of using ad hoc renderer-owned paths.
- ✅ Native browser new-window requests now create in-app project browser tabs through the backend service instead of bypassing the shell with placeholder external-window behavior.
- ✅ The current frontend now consumes backend browser runtime events through canonical store-backed notice state for find results, downloads, external-open requests, and renderer lifecycle updates instead of using component-local helper banners.
- ✅ The current frontend now also uses the production file IO backend for editor reads and saves, including binary-file detection and optimistic version-token save enforcement.
- ✅ The current frontend now also uses that same file IO contract for in-editor find/replace workflows and explicit stale-save conflict resolution instead of surfacing raw version-token save failures.
- ✅ The current frontend no longer seeds fake startup projects, git state, terminal sessions, Codex threads, or workspace tabs before backend hydration.
- ✅ The current frontend now uses backend git mutation and readiness commands for stage, unstage, restore, commit, and per-file diff inspection in the Git surface.
- ✅ The current frontend Codex surfaces now execute approvals, clear unread state, switch active threads correctly, and present runtime status without inventing message history the backend does not expose.
- ✅ The current frontend terminal surface now uses the backend resize contract and explicit respawn flow, instead of remounting xterm on every scrollback update or silently auto-respawning dead sessions.
- ✅ The backend now owns the native browser renderer lifecycle for mounted browser panes, including child-webview creation, native navigation/reload synchronization, title/load-state updates, and new-window/download event bridging.
- ✅ The current frontend now uses backend browser pin-state commands in both the sidebar and the browser surface instead of local-only browser tab chrome.
- ✅ The current frontend now uses backend per-project browser restore-policy state instead of treating browser session restore behavior as an implicit local choice.
- ✅ The current frontend now uses backend git branch/fetch/pull/push controls and backend terminal rename/session actions instead of placeholder shell chrome.
- ✅ The current frontend now uses backend branch creation plus upstream-aware publish/push flows instead of leaving those git capabilities stranded behind IPC only.
- ✅ The current frontend now uses backend whole-tree git diff reads and backend terminal scrollback/session metadata for richer dock diagnostics instead of placeholder-only shell state.
- ✅ The backend now persists canonical Codex per-thread message history in SQLite, exposes it through `codex_thread_messages_list`, and emits live `messageUpserted` events that the frontend uses for real multi-turn conversation rendering.
- ✅ Approval payload context now stays structured through the frontend boundary, and the shared Codex conversation renderer uses that canonical data for richer live-stream and approval-detail presentation instead of flattening approval context into lossy strings.

### Terminal

- ✅ PTY-backed terminal sessions are created natively through `portable-pty` in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/terminal/service.rs).
- ✅ Terminal sessions emit stream events through `app://terminal`.
- ✅ Terminal resize, write, close, list, and rename commands are implemented.
- ✅ Terminal project cleanup removes both live handles and persisted metadata.
- ✅ Terminal sessions now persist bounded scrollback, startup commands, environment overrides, restore state, and exit diagnostics in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/terminal/service.rs) and [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Terminal sessions can now be respawned from persisted metadata, and app shutdown / crash recovery marks live sessions as restorable instead of leaving ghost running state.
- ✅ Terminal backend actions now also include interrupt, EOF, and explicit scrollback clear flows, with frontend wiring for operational diagnostics controls in the dock and terminal surface.
- ✅ Terminal diagnostics now also have a typed backend `terminal_diagnostics_read` contract that joins persisted session metadata with recent scrollback context for operator-facing shell diagnostics.
- ✅ The current frontend now also routes dedicated keyboard shortcuts through backend terminal create, interrupt, EOF, clear-history, and respawn commands instead of limiting those operations to click-only controls.

### Codex / Agent Runtime

- ✅ Codex integration uses `codex app-server` over `stdio` from the Rust backend in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/codex/service.rs).
- ✅ `CODEX_HOME` is forced to `~/.ice/codex`.
- ✅ Implemented Codex commands include status, model list, auth read, login start, thread create, turn start, server-request response, and thread list.
- ✅ Implemented Codex commands include status, model list, auth read, restart, login start, thread create, turn start, server-request response, and thread list.
- ✅ Server requests are captured as pending approvals and emitted as backend events.
- ✅ Codex notifications now update typed thread state for running, waiting approval, idle, error, and disconnected flows instead of only passing raw payloads through.
- ✅ Codex thread persistence now includes last assistant message snippets and unread state for sidebar/chat previews.
- ✅ Approval records now include classified category and risk level metadata so the frontend can render intent-specific approval UI.
- ✅ The backend now supports explicit `codex app-server` restarts with thread state recovery to `disconnected` plus automatic dead-process detection.
- ✅ The backend now captures installed Codex runtime contract details, including CLI version, app-server default transport, schema support, and JSON Schema fingerprinting.

### Security / Approvals

- ✅ Pending approval records are loaded from SQLite at startup through [approvals.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/security/approvals.rs).
- ✅ Approval list, upsert, resolve, and project cleanup flows are implemented.
- ✅ Approval audit records are now persisted for request, approve, and deny decisions, with IPC access for diagnostics and compliance surfaces.
- ✅ Approval policy is now classified by action type and risk, with destructive shell and git requests blocked automatically at the backend boundary.
- ✅ Guardrails now block clearly destructive local agent actions before execution instead of relying only on generic prompt handling.

### Projects / Multi-Project Support

- ✅ Multiple projects can be registered and listed from the backend.
- ✅ Project removal now clears browser, terminal, Codex thread, and approval state for that project.
- ✅ The current frontend now uses backend project add, remove, and reorder commands directly from the stacked sidebar instead of treating multi-project lifecycle as bootstrap-only state.
- ✅ Backend state is organized around per-project context rather than a hidden singleton project.

### Workspace / Workbench

- ✅ Workspace shell chrome state is persisted canonically through the backend.
- ✅ Workspace session state now persists active pane, pane tree, and tab metadata as first-class SQLite-backed backend state in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/workspace/service.rs).
- ✅ Workspace session writes are validated server-side so invalid pane trees and unknown tab references are rejected before persistence.

### IPC / Tauri Commands

- ✅ Thin command routing exists in [commands.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/ipc/commands.rs).
- ✅ Commands now cover health, config read, project lifecycle, tree/file operations, workspace layout/session/chrome, git actions, browser actions, terminal actions, Codex actions, and approval listing.
- ✅ Backend sidebar projection commands now exist for project-scoped browser tab summaries and Codex thread summaries tailored to sidebar rendering.
- ✅ The current frontend can now hydrate projects, workspace state, nested file trees, and git state directly from the backend through `app_bootstrap`, `project_tree_read_nested`, `git_status_read`, `workspace_chrome_set`, and `workspace_session_set`.
- ✅ The current frontend can now hydrate browser tabs directly from backend IPC and live `app://browser` events, including tab creation, navigation, back/forward, reload, and close flows.
- ✅ The current frontend can now hydrate terminal sessions, terminal scrollback, Codex threads, and Codex approvals directly from backend IPC and live `app://terminal` / `app://codex` events.
- ✅ The current frontend now also uses backend project-scoped browser and Codex sidebar projections instead of recomputing sidebar rows from the full tab and thread stores.

### Verification

- ✅ `cargo fmt` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ `cargo check` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ `cargo test` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ Persistence tests cover workspace, browser tab/history, terminal session, Codex thread, approval, and config storage in [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Fozzy coverage exists with [backend.production_gate.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.production_gate.fozzy.json) and [backend.topology.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.topology.fozzy.json).
- ✅ Feature-focused Fozzy scenarios now exist for approval policy and FS/editor contracts in [backend.approval_policy.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.approval_policy.fozzy.json) and [backend.fs_editor.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.fs_editor.fozzy.json).
- ✅ Feature-focused Fozzy coverage now also exists for nested filesystem tree contracts in [backend.fs_tree.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.fs_tree.fozzy.json).
- ✅ Feature-focused Fozzy coverage now also exists for terminal lifecycle and persistence contracts in [backend.terminal_lifecycle.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.terminal_lifecycle.fozzy.json).
- ✅ Focused Fozzy coverage now also exists for terminal diagnostics in [backend.terminal_diagnostics.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.terminal_diagnostics.fozzy.json).
- ✅ Feature-focused Fozzy coverage now also exists for persistence schema-version contracts in [backend.persistence_schema.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.persistence_schema.fozzy.json).
- ✅ Feature-focused Fozzy coverage now also exists for git mutation and commit-readiness contracts in [backend.git_mutation.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.git_mutation.fozzy.json).
- ✅ Feature-focused Fozzy coverage now also exists for structured git event contracts in [backend.git_events.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.git_events.fozzy.json).
- ✅ Feature-focused Fozzy coverage now also exists for browser metadata and renderer-sync contracts in [backend.browser_contract.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.browser_contract.fozzy.json).
- ✅ Feature-focused Fozzy coverage now also exists for browser renderer bridge contracts in [backend.browser_bridge.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.browser_bridge.fozzy.json).
- ✅ Feature-focused Fozzy coverage now also exists for project sidebar and browser restore-policy contracts in [backend.project_sidebar.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.project_sidebar.fozzy.json).
- ✅ Frontend-side verification now also includes Vitest coverage for shared backend mappers and workbench stores plus a no-bundle Tauri smoke build through `npm run verify:tauri`.
