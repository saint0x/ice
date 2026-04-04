# Backend Production Checklist

This file is now the implementation checklist for the Rust/Tauri backend in `/Users/deepsaint/Desktop/ice/src-tauri`.

Rules for this checklist:

- Unfinished work stays at the top.
- Verified work stays at the bottom.
- Sections are grouped by concern.
- Only items that are implemented and verified should use `✅`.

## Highest Priority Remaining

### Filesystem / IDE

- [ ] Add file watching so project trees, open editors, and git decorations update without manual refresh.
- [ ] Add nested tree snapshot support so the frontend does not have to reconstruct deep directory structure from flat rows.
- [ ] Add binary-file detection and safe read behavior for non-text files.
- [ ] Add search primitives for filename and content search scoped by `projectId`.
- [ ] Add save conflict handling for files changed externally after open.
- [ ] Add ignore-aware traversal controls for `.gitignore`, hidden files, and large directory suppression.

### Git

- [ ] Add branch checkout / branch list / fetch / pull / push flows behind typed commands.
- [ ] Add discard / restore workflows with explicit safety rules and approval gating.
- [ ] Add diff payload endpoints for staged, unstaged, and per-file views.
- [ ] Add commit metadata validation and better error surfaces for missing author config and hooks.
- [ ] Add git refresh events or watchers so sidebar counts and git surfaces stay hot.

### Browser

- [ ] Replace metadata-only browser state with the production rendering bridge the frontend will use for real in-pane browsing.
- [ ] Decide and implement the final Tauri-native browser container strategy for pane-hosted browsing.
- [ ] Add per-tab loading state, favicon state, TLS/security metadata, and title updates from the real renderer.
- [ ] Add download events, find-in-page hooks, and open-in-external-browser actions.
- [ ] Add browser persistence for pinned tabs and project-level startup restore policy.

### Terminal

- [ ] Add terminal output buffering and scrollback persistence strategy.
- [ ] Add per-session environment overrides and startup command support.
- [ ] Add restore semantics that distinguish persisted metadata from respawnable sessions.
- [ ] Add stronger PTY lifecycle management for app shutdown and crash recovery.
- [ ] Add shell exit codes and richer session diagnostics into emitted events.

### Codex / Agent Runtime

- [ ] Normalize more App Server notifications into typed backend events instead of raw pass-through payloads.
- [ ] Add richer thread state updates so running / idle / waiting approval status stays exact across notifications.
- [ ] Add persisted turn summaries / last assistant message snippets for sidebar and chat previews.
- [ ] Add reconnect / restart handling for `codex app-server` with state recovery.
- [ ] Add stronger approval classification so frontend approvals can render intent-specific UI.
- [ ] Add schema/version capture against the installed Codex binary for stricter contract management.

### Security / Approvals

- [ ] Define approval policy rules by action type instead of treating all server requests as the same class.
- [ ] Add explicit audit logging for approvals and denials.
- [ ] Add guardrails for destructive local actions initiated through agent flows.

### Persistence / State

- [ ] Add dedicated tables for workspace tabs, pane metadata, and dock layout snapshots rather than only raw workspace JSON blobs.
- [ ] Add migrations versioning beyond opportunistic `CREATE TABLE IF NOT EXISTS`.
- [ ] Add periodic integrity checks and repair tooling for `~/.ice/ice.db`.
- [ ] Add cleanup policies for stale sessions, stale browser history, and stale diagnostics artifacts.

### Frontend Contract Support

- [ ] Replace the frontend’s demo Zustand seeds with real IPC-backed loaders and event sync.
- [ ] Publish a typed shared contract for project, tree, git, browser, terminal, Codex, and approval payloads.
- [ ] Add backend commands for browser tab listing by project section and Codex thread summaries tailored to sidebar rendering.

### Testing / Release

- [ ] Expand Fozzy scenarios from backend gates into feature-focused flows for filesystem mutation, git mutation, terminal lifecycle, browser navigation, and approval handling.
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

- ✅ SQLite persistence exists for projects, workspace layouts, browser tabs, browser history, terminal sessions, Codex threads, Codex approvals, and app config in [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Browser tab metadata and navigation history are persisted locally.
- ✅ Terminal session metadata is persisted locally, including `is_running`.
- ✅ Codex thread bindings are persisted locally.
- ✅ Pending Codex approvals are persisted locally.

### Filesystem / IDE

- ✅ Project-root-scoped path resolution prevents escapes outside the project root in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/fs/service.rs).
- ✅ Tree reads, text file reads, and text writes exist.
- ✅ Directory creation, entry deletion, and entry rename commands are implemented.
- ✅ File tree rows can include git status annotations from the native git service.

### Git

- ✅ Native git status reads use `git status --porcelain=2 --branch --untracked-files=all` in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/git/service.rs).
- ✅ Git status payloads now include branch, ahead/behind counts, staged/modified/untracked/conflicted counts, and per-file change rows.
- ✅ Native git stage, unstage, and commit commands are implemented.

### Browser

- ✅ Browser tabs are project-scoped and persistent.
- ✅ Browser navigation state supports navigate, back, forward, reload, close, list, and history retrieval in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/browser/service.rs).
- ✅ Browser events are emitted through `app://browser`.

### Terminal

- ✅ PTY-backed terminal sessions are created natively through `portable-pty` in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/terminal/service.rs).
- ✅ Terminal sessions emit stream events through `app://terminal`.
- ✅ Terminal resize, write, close, list, and rename commands are implemented.
- ✅ Terminal project cleanup removes both live handles and persisted metadata.

### Codex / Agent Runtime

- ✅ Codex integration uses `codex app-server` over `stdio` from the Rust backend in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/codex/service.rs).
- ✅ `CODEX_HOME` is forced to `~/.ice/codex`.
- ✅ Implemented Codex commands include status, model list, auth read, login start, thread create, turn start, server-request response, and thread list.
- ✅ Server requests are captured as pending approvals and emitted as backend events.

### Security / Approvals

- ✅ Pending approval records are loaded from SQLite at startup through [approvals.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/security/approvals.rs).
- ✅ Approval list, upsert, resolve, and project cleanup flows are implemented.

### Projects / Multi-Project Support

- ✅ Multiple projects can be registered and listed from the backend.
- ✅ Project removal now clears browser, terminal, Codex thread, and approval state for that project.
- ✅ Backend state is organized around per-project context rather than a hidden singleton project.

### IPC / Tauri Commands

- ✅ Thin command routing exists in [commands.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/ipc/commands.rs).
- ✅ Commands now cover health, config read, project lifecycle, tree/file operations, workspace layout, git actions, browser actions, terminal actions, Codex actions, and approval listing.

### Verification

- ✅ `cargo fmt` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ `cargo check` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ `cargo test` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ Persistence tests cover workspace, browser tab/history, terminal session, Codex thread, approval, and config storage in [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Fozzy coverage exists with [backend.production_gate.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.production_gate.fozzy.json) and [backend.topology.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.topology.fozzy.json).
