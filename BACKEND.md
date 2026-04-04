# Backend Production Checklist

This file is now the implementation checklist for the Rust/Tauri backend in `/Users/deepsaint/Desktop/ice/src-tauri`.

Rules for this checklist:

- Unfinished work stays at the top.
- Verified work stays at the bottom.
- Sections are grouped by concern.
- Only items that are implemented and verified should use `✅`.

## Highest Priority Remaining

### Filesystem / IDE

- [ ] Add nested tree snapshot support so the frontend does not have to reconstruct deep directory structure from flat rows.

### Git

- [ ] Add discard / restore workflows with explicit safety rules and approval gating.
- [ ] Add diff payload endpoints for whole-tree staged and unstaged views in addition to per-file diff reads.
- [ ] Add commit metadata validation and better error surfaces for missing author config and hooks.

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

### Security / Approvals

### Persistence / State

- [ ] Add dedicated persistence for dock session contents beyond shell chrome dimensions and open/closed flags.
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

- ✅ SQLite persistence exists for projects, workspace layouts, workspace sessions, browser tabs, browser history, terminal sessions, Codex threads, Codex approvals, and app config in [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Browser tab metadata and navigation history are persisted locally.
- ✅ Terminal session metadata is persisted locally, including `is_running`.
- ✅ Codex thread bindings are persisted locally.
- ✅ Pending Codex approvals are persisted locally.

### Filesystem / IDE

- ✅ Project-root-scoped path resolution prevents escapes outside the project root in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/fs/service.rs).
- ✅ Tree reads, text file reads, and text writes exist.
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
- ✅ Backend state is organized around per-project context rather than a hidden singleton project.

### Workspace / Workbench

- ✅ Workspace shell chrome state is persisted canonically through the backend.
- ✅ Workspace session state now persists active pane, pane tree, and tab metadata as first-class SQLite-backed backend state in [service.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/workspace/service.rs).
- ✅ Workspace session writes are validated server-side so invalid pane trees and unknown tab references are rejected before persistence.

### IPC / Tauri Commands

- ✅ Thin command routing exists in [commands.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/ipc/commands.rs).
- ✅ Commands now cover health, config read, project lifecycle, tree/file operations, workspace layout/session/chrome, git actions, browser actions, terminal actions, Codex actions, and approval listing.

### Verification

- ✅ `cargo fmt` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ `cargo check` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ `cargo test` passes in `/Users/deepsaint/Desktop/ice/src-tauri`.
- ✅ Persistence tests cover workspace, browser tab/history, terminal session, Codex thread, approval, and config storage in [db.rs](/Users/deepsaint/Desktop/ice/src-tauri/src/persistence/db.rs).
- ✅ Fozzy coverage exists with [backend.production_gate.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.production_gate.fozzy.json) and [backend.topology.fozzy.json](/Users/deepsaint/Desktop/ice/tests/backend.topology.fozzy.json).
