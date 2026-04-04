# Backend Design: Tauri + Codex-Only Glass Rebuild

## 1. Purpose

This document defines the backend architecture for rebuilding the Glass application as a Tauri app with a Vite frontend and a Rust-native backend.

This is not a direct source port of Glass or Zed.

The goal is to preserve the product shape that makes Glass compelling:

- a single app that combines IDE, browser, terminal, git, and agent workflows
- a docked workspace shell with low-friction navigation
- project-aware state and persistence
- native-feeling agentic workflows

But the implementation must be re-authored cleanly for Tauri, with a much smaller and more modular runtime surface.

We are explicitly rejecting the Glass/Zed inheritance model where large upstream subsystems are dragged in wholesale. We want a fresh architecture that:

- feels native and fast
- is easy to reason about
- is easy to extend
- isolates domains cleanly
- supports production hardening
- uses only Codex as the agent backend

## 2. Non-Negotiable Product Direction

### Keep from Glass

- Integrated shell: editor, browser, terminal, git, and agent UX in one app
- Sidebar-driven navigation model
- Pane/dock/tab workspace composition
- Project-scoped terminal and git behavior
- Rich session persistence
- Streaming agent event model
- Approval-aware agent actions

### Change from Glass

- Replace Swift/macOS-native UI path with Tauri + Vite
- Replace GPUI/Zed-heavy inheritance with clean domain modules
- Replace CEF-heavy browser implementation with a Tauri-native browsing strategy
- Replace multi-provider model/backend matrix with Codex-only integration
- Replace “one active project, switch between projects” mental model with stacked multi-project navigation
- Replace ad hoc app-wide coupling with explicit service boundaries

## 3. Key Findings From Glass Source

These findings should shape the port.

### 3.1 Workspace shell

Glass already centralizes the shell around a `Workspace` and `MultiWorkspace` model.

Relevant files:

- `/Users/deepsaint/Desktop/Glass/crates/workspace/src/workspace.rs`
- `/Users/deepsaint/Desktop/Glass/crates/workspace/src/multi_workspace.rs`

Important takeaways:

- Glass models a workspace as the host for panes, docks, toolbar, persistence, and project attachment.
- `MultiWorkspace` already supports multiple workspaces in a window, but the product presentation still behaves like a project switcher more than a stacked project system.
- The sidebar is section-based and currently oriented around a limited set of workspace sections such as project, git, browser tabs, and terminal.

### 3.2 Browser

Relevant files:

- `/Users/deepsaint/Desktop/Glass/crates/browser/src/browser.rs`
- `/Users/deepsaint/Desktop/Glass/crates/browser/src/browser_view.rs`

Important takeaways:

- Glass browser mode is deeply tied to CEF.
- Browser state includes tabs, history, downloads, find-in-page, sidebar tab mode, and toolbar sync.
- The browser is treated as a first-class workspace surface, not a bolt-on webview.

### 3.3 Terminal

Relevant files:

- `/Users/deepsaint/Desktop/Glass/crates/terminal_view/src/terminal_panel.rs`
- `/Users/deepsaint/Desktop/Glass/crates/terminal/src/terminal.rs`
- `/Users/deepsaint/Desktop/Glass/crates/project/src/terminals.rs`

Important takeaways:

- Glass treats terminal sessions as project-aware, pane-aware, and persistable.
- Terminal state is not just “spawn shell in tab”; it includes navigation, grouping, session restore, and workspace coupling.

### 3.4 Project panel and git

Relevant files:

- `/Users/deepsaint/Desktop/Glass/crates/project_panel/src/project_panel.rs`
- `/Users/deepsaint/Desktop/Glass/crates/git_ui/src/git_panel.rs`
- `/Users/deepsaint/Desktop/Glass/crates/project/src/git_store.rs`

Important takeaways:

- File tree and git are not independent toys. They are first-class views over project state.
- Project state is worktree-driven and should stay project-scoped in the rebuild.

### 3.5 Agent abstraction

Relevant files:

- `/Users/deepsaint/Desktop/Glass/crates/agent_servers/src/agent_servers.rs`
- `/Users/deepsaint/Desktop/Glass/crates/agent_servers/src/acp.rs`
- `/Users/deepsaint/Desktop/Glass/crates/project/src/agent_server_store.rs`

Important takeaways:

- Glass already separates “agent server” from UI.
- The external agent shape is good and should be preserved conceptually.
- The current implementation supports many providers and external agents. We do not want that matrix.

### 3.6 Codex integration already exists

Relevant file:

- `/Users/deepsaint/Desktop/Glass/crates/language_models/src/provider/codex.rs`

Important takeaways:

- Glass already shells out to `codex`.
- It already uses `codex app-server` for model discovery.
- This confirms the strategic direction: the rebuild should integrate against Codex App Server directly, not through secondary providers.

## 4. Official Codex App Server Constraints

These requirements are based on current OpenAI official docs and should be treated as the source of truth.

Sources:

- [Codex App Server docs](https://developers.openai.com/codex/app-server)
- [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)

Critical facts:

- As of February 4, 2026, OpenAI describes Codex App Server as the supported integration surface for rich Codex clients.
- The protocol is JSON-RPC over `stdio` by default, with newline-delimited JSON framing.
- WebSocket transport exists, but it is explicitly experimental in the docs.
- The standard bootstrap flow is `initialize`, then `initialized`, then thread and turn calls.
- The server exposes threads, turns, auth/account methods, approvals, and streamed agent events.
- Approval prompts are server-initiated JSON-RPC requests and must be answered by the client.
- OpenAI recommends App Server for deep product integration and Codex SDK for automation/CI.

Design consequence:

- Our production integration should use a long-lived local `codex app-server` child process managed by the Tauri backend.
- We should prefer `stdio` transport for local desktop use.
- We should generate and pin TypeScript/JSON schema artifacts from the local Codex version during development so our frontend/backend contracts track the actual installed Codex version.

## 5. Architecture Principles

### 5.1 Product UI parity, implementation independence

We are cloning the interaction model and visual composition of Glass, not its internal inheritance tree.

### 5.2 Domain-first backend

Every major concern must be its own backend domain:

- app/session
- projects/workspaces
- filesystem
- git
- terminal
- browser
- codex
- persistence
- permissions/security
- telemetry/logging

### 5.3 Tauri command layer must stay thin

The Tauri IPC boundary is not the business logic layer.

Commands should:

- validate input
- route requests into domain services
- return typed results
- emit events

Commands should not:

- embed project logic directly
- manage process state inline
- own persistence logic
- contain long procedural workflows

### 5.4 One backend runtime, many project contexts

The app should run a single backend runtime, but each project gets isolated state:

- terminal sessions
- browser session metadata
- git status cache
- Codex thread/session mapping
- approvals
- environment variables
- settings overrides

### 5.5 Event-driven over polling

Everything that streams should be modeled as an event source:

- Codex turn events
- terminal output
- git status refreshes
- filesystem watcher deltas
- browser navigation/download updates

## 6. Proposed Top-Level Backend Modules

Suggested Rust module layout under `src-tauri/src/`:

```text
src-tauri/src/
  main.rs
  lib.rs
  app/
    mod.rs
    state.rs
    startup.rs
    shutdown.rs
    events.rs
  ipc/
    mod.rs
    commands.rs
    dto.rs
    errors.rs
  projects/
    mod.rs
    service.rs
    models.rs
    persistence.rs
    watchers.rs
  workspace/
    mod.rs
    service.rs
    layout.rs
    tabs.rs
    docks.rs
    persistence.rs
  fs/
    mod.rs
    service.rs
    watchers.rs
    paths.rs
  git/
    mod.rs
    service.rs
    models.rs
    cache.rs
  terminal/
    mod.rs
    service.rs
    session.rs
    pty.rs
    persistence.rs
    events.rs
  browser/
    mod.rs
    service.rs
    session.rs
    tabs.rs
    downloads.rs
    navigation.rs
  codex/
    mod.rs
    service.rs
    process.rs
    rpc.rs
    schema.rs
    sessions.rs
    approvals.rs
    auth.rs
    events.rs
  security/
    mod.rs
    approvals.rs
    policies.rs
  persistence/
    mod.rs
    db.rs
    migrations.rs
  diagnostics/
    mod.rs
    logging.rs
    tracing.rs
```

## 7. Core Backend Entities

These entities should exist explicitly and be shared across modules.

### 7.1 `ProjectId`

Stable app-level ID for one mounted project.

Fields:

- `id`
- `name`
- `root_path`
- `created_at`
- `last_opened_at`
- `color_token`
- `icon_hint`
- `is_trusted`

### 7.2 `ProjectRuntime`

In-memory runtime state for a project.

Fields:

- `project_id`
- `env`
- `git_state`
- `terminal_registry`
- `browser_session_registry`
- `codex_context`
- `watch_handles`

### 7.3 `WorkspaceId`

Represents one UI workbench state container. A workspace may reference one or more projects.

### 7.4 `WorkbenchLayout`

Serializable pane/dock/tab state.

### 7.5 `CodexThreadBinding`

Maps app state to Codex thread state.

Fields:

- `project_id`
- `thread_id`
- `title`
- `status`
- `last_turn_id`
- `created_at`
- `updated_at`

### 7.6 `TerminalSessionRecord`

Fields:

- `session_id`
- `project_id`
- `cwd`
- `shell`
- `tab_title`
- `pane_id`
- `is_pinned`
- `restorable`

### 7.7 `BrowserTabRecord`

Fields:

- `tab_id`
- `project_id`
- `url`
- `title`
- `history_index`
- `is_pinned`
- `webview_key`

## 8. Multi-Project Model

This is the most important product change.

Glass behaves like a single-project app with workspace switching. We want stacked multi-project operation.

### 8.1 Required behavior

- Multiple projects can appear in the left sidebar at the same time.
- Each project expands independently.
- Each project maintains its own:
  - file tree state
  - git state
  - terminal sessions
  - browser tabs grouping metadata
  - Codex thread bindings
  - agent approval context
- Users should be able to keep multiple active projects “hot” without replacing one another.

### 8.2 Design decision

Make `Project` the primary context boundary.

Do not make “current project” a singleton inside backend services.

Every backend API that acts on project state should take `project_id` explicitly unless it is truly global.

### 8.3 Sidebar implication

The frontend sidebar will render a stack of project cards/sections, but the backend must expose a project collection API that returns:

- project metadata
- tree summary
- git summary
- active terminals count
- browser tabs count
- active Codex threads count

## 9. Codex Integration Design

## 9.1 High-level decision

Use one app-managed Codex App Server process for the desktop app runtime unless we hit a proven scaling reason to move to one process per project.

Why:

- simpler auth lifecycle
- simpler account/rate-limit integration
- easier version management
- lighter process footprint

Project isolation should be done at the thread/session level first, not by multiplying server processes immediately.

### 9.2 Process manager

Create `CodexProcessManager`.

Responsibilities:

- locate `codex` binary
- validate version availability
- spawn `codex app-server`
- manage stdin/stdout lifecycle
- restart on crash
- expose health state
- surface stderr logs to diagnostics

Recommended spawn shape:

- command: `codex app-server`
- transport: `stdio`
- long-lived child process
- JSONL line reader
- serialized request writer

### 9.3 RPC client

Create `CodexRpcClient`.

Responsibilities:

- monotonic request IDs
- request/response correlation
- notification routing
- server-initiated request handling
- timeout policy
- reconnect strategy

### 9.4 Session service

Create `CodexSessionService`.

Responsibilities:

- initialize app-server session
- map app actions to thread and turn lifecycle
- persist thread bindings
- recover active threads after app restart
- expose current state to frontend

### 9.5 Auth service

Create `CodexAuthService`.

Responsibilities:

- call `account/read`
- start login if needed
- observe `account/updated`
- read rate limits
- expose auth state to frontend

We should support:

- ChatGPT-managed auth first
- API key auth only if the user explicitly wants it later

But initial product direction should bias toward local Codex subscription and ChatGPT-managed auth.

### 9.6 Approvals service

Create `CodexApprovalService`.

Responsibilities:

- receive server-initiated approval requests
- normalize them into app UI payloads
- route them to the correct project/thread/turn
- store pending approval state
- send final user decision back to app-server

This is critical. Approval flows are not optional UI sugar. They are part of the core protocol.

### 9.7 Event normalization

Do not pipe raw protocol events directly into every UI component.

Create a normalized internal event enum:

```rust
enum AppEvent {
    Codex(CodexEvent),
    Terminal(TerminalEvent),
    Git(GitEvent),
    Fs(FsEvent),
    Browser(BrowserEvent),
}
```

Then define a normalized `CodexEvent` family:

- `ThreadCreated`
- `TurnStarted`
- `TurnUpdated`
- `TurnCompleted`
- `ItemStarted`
- `ItemUpdated`
- `ItemCompleted`
- `ApprovalRequested`
- `ApprovalResolved`
- `AuthUpdated`
- `RateLimitsUpdated`
- `ServerDisconnected`

### 9.8 Schema generation workflow

During development, add scripts that run:

```bash
codex app-server generate-ts --out ./generated/codex
codex app-server generate-json-schema --out ./generated/codex
```

Use generated artifacts to:

- type frontend protocol bindings
- validate normalized adapter code
- detect Codex version drift intentionally

## 10. Terminal Architecture

The terminal stack should be first-class and production-ready.

### 10.1 Required properties

- real PTY-backed sessions
- project-scoped default cwd
- split panes
- tab restore
- scrollback retention
- streaming output events
- command status tracking where feasible

### 10.2 Suggested implementation

- Rust backend owns PTY/process handling
- frontend uses a serious terminal renderer such as `xterm.js`
- backend streams terminal chunks through Tauri events or channel APIs

### 10.3 Session model

Terminal sessions belong to projects, not globally.

Support:

- multiple sessions per project
- session groups or pane layouts
- restore metadata on launch
- kill/restart/rename

## 11. Browser Architecture

This needs to be defined carefully because Glass uses CEF and Tauri does not give us a full embedded Chromium browser stack by default.

### 11.1 Product intent

We want browser-in-workbench UX parity, not a literal CEF port.

### 11.2 Native strategy

Use Tauri webview-backed browser surfaces and design the browser module around “embedded browsing sessions” rather than “custom Chromium engine.”

Capabilities we should target:

- tabbed navigation UI
- back/forward/reload
- URL bar
- title updates
- loading state
- find-in-page if supported by platform path
- external-open fallback for sites that do not cooperate

### 11.3 Explicit limitation

Do not promise full Glass CEF parity in backend contracts.

The design doc should state clearly:

- the browser surface is a webview-backed integrated browsing experience
- not every CEF feature should be assumed portable
- browser session state still lives in our app model even if render/runtime capability varies by platform

### 11.4 Clean abstraction

Define `BrowserAdapter` trait so we can swap implementations later:

- `TauriWebviewBrowserAdapter`
- potential future `CustomEngineBrowserAdapter`

This keeps the app from hardwiring platform limitations into business logic.

## 12. Filesystem and Git

### 12.1 Filesystem service

Responsibilities:

- read tree slices lazily
- file read/write/rename/delete
- watch changes
- resolve path metadata
- project trust checks

### 12.2 Git service

Responsibilities:

- repo discovery per project
- status summary
- branch info
- staged/unstaged file lists
- commit/stash/checkout helpers
- diff payload generation

Implementation note:

The git service must be independent from the project tree service even though both are project-scoped.

## 13. Persistence

Use SQLite for app state and JSON blobs only where appropriate.

Persist:

- project registry
- workspace layouts
- panel expansion state
- browser tab metadata
- terminal session metadata
- Codex thread bindings
- recent commands
- UI preferences

Do not persist:

- raw terminal scrollback by default
- entire Codex event streams if not necessary
- giant filesystem tree snapshots

The app should reconstruct from durable identifiers and fresh runtime queries whenever possible.

## 14. IPC Design

Use typed Tauri commands plus event subscriptions.

### 14.1 Command classes

- app commands
- project commands
- workspace commands
- file commands
- git commands
- terminal commands
- browser commands
- codex commands

### 14.2 Example commands

- `project_add`
- `project_remove`
- `project_list`
- `project_tree_read`
- `workspace_layout_get`
- `workspace_layout_set`
- `terminal_create`
- `terminal_write`
- `terminal_resize`
- `terminal_close`
- `browser_tab_create`
- `browser_tab_navigate`
- `browser_tab_close`
- `git_status_read`
- `codex_auth_read`
- `codex_login_start`
- `codex_thread_create`
- `codex_turn_start`
- `codex_approval_respond`

### 14.3 Event channels

- `app://codex`
- `app://terminal`
- `app://git`
- `app://fs`
- `app://browser`
- `app://workspace`

The frontend should subscribe once per domain and fan out via its own state layer.

## 15. Performance Requirements

This rebuild exists partly because Glass feels slow. The backend must enforce performance discipline.

### 15.1 Rules

- no expensive tree recomputes on every UI interaction
- no unbounded JSON payloads over IPC
- no global locks around project-specific hot paths
- no sync disk work on the UI-critical path
- no giant “get all state” calls for panels that only need slices

### 15.2 Strategies

- incremental tree loading
- debounced filesystem refresh
- cached git summaries with targeted invalidation
- append-only event streaming for terminals and Codex turns
- lazy browser session restore
- structured tracing around IPC latency and process event lag

## 16. Security Model

### 16.1 Trust boundary

The Tauri backend is the authority.

The frontend does not directly:

- spawn arbitrary processes
- write arbitrary files
- issue uncontrolled Codex approvals

### 16.2 Approval discipline

All Codex approvals must be mediated by backend state and explicitly tied to:

- project
- thread
- turn
- item

### 16.3 Filesystem discipline

Every file operation must resolve against a known project root or an explicitly approved external path.

## 17. What to Strip From Glass

These categories should not be ported as-is.

- Zed/GPUI workspace inheritance
- Swift/macOS-specific native view plumbing
- provider matrix for Anthropic/OpenRouter/Ollama/etc.
- CEF-specific browser process architecture
- cloud or collab systems unrelated to local Codex-first use
- extension/registry agent complexity unless truly needed later

The abstraction patterns can survive. The implementation bulk should not.

## 18. Suggested Implementation Phases

### Phase 1: App skeleton

- Tauri app boot
- typed IPC scaffold
- SQLite persistence scaffold
- project registry
- workbench layout model

### Phase 2: Multi-project core

- stacked sidebar project model
- filesystem tree service
- project selection/focus semantics
- persistence of project stack

### Phase 3: Terminal

- PTY service
- xterm integration
- session restore
- pane/tab integration

### Phase 4: Git

- repo status
- branch state
- diff data
- sidebar summaries

### Phase 5: Browser

- webview-backed tab model
- navigation events
- URL/title sync
- persistence

### Phase 6: Codex

- app-server process manager
- initialize flow
- auth flow
- thread/turn lifecycle
- event stream
- approvals

### Phase 7: Hardening

- tracing
- crash recovery
- restart handling
- schema pinning
- compatibility checks

## 19. Definition of Done for Backend

Backend is not done when commands merely exist.

Backend is done when:

- multiple projects can remain active simultaneously
- each project preserves independent terminal/browser/git/Codex context
- Codex App Server is managed as a stable local runtime
- approval flows are correct and resumable
- hot UI actions do not rely on heavyweight synchronous backend work
- persistence restores the app into a credible previous state
- the system remains modular enough to add capabilities later without re-architecting everything

## 20. Final Guidance

If a backend decision ever forces us to choose between “match Glass internals” and “build a clean native-feeling Tauri runtime,” choose the clean runtime.

The product should feel like Glass.
The codebase should not feel like a dragged-over Glass/Zed transplant.
