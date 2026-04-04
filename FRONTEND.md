# Frontend Porting Guide: Glass UI Parity in Vite + Tauri

## 1. Purpose

This document is for the frontend implementation agent.

The job is not to invent a new UI language.
The job is to recreate the Glass UI as faithfully as possible in a Vite-based frontend running inside Tauri, while making one major product change:

- Glass-style integrated IDE/browser/terminal shell remains
- multi-project switching becomes multi-project stacking

This should feel like a clean native desktop product, not a web dashboard.

We want near-1:1 parity in:

- overall workbench structure
- sidebar behavior
- browser/IDE/terminal coexistence
- dock and pane composition
- tab affordances
- git and project navigation placement
- information density
- focus behavior
- workflow pacing

We do not want:

- generic SaaS styling
- oversized spacing
- obvious Electron-app visual language
- toy panel implementations
- frontend architecture that treats each pane as unrelated

## 2. Core Product Read

Glass works because the whole product feels like one integrated operating surface.

The UI is good because:

- the sidebar is useful
- the main canvas is multi-modal
- browser, terminal, and editor feel equally first-class
- the app minimizes context switching
- dense information stays readable

The rebuild must preserve that.

## 3. What We Are Recreating

From Glass, we want to preserve the following visual/system ideas:

- left-oriented workspace navigation
- project panel
- git access
- browser tab access
- terminal access
- central pane area that can host multiple content types
- integrated browser + editor + terminal workbench
- desktop-grade tab rows and pane affordances
- compact controls
- minimal but polished chrome
- app-wide focus on speed and low latency

## 4. What Changes

### 4.1 Major product change

Glass effectively behaves like one project at a time.

We want:

- multiple projects stacked in the sidebar
- all projects visible without switching out the current one
- each project retaining its own context
- project-local terminals, git state, browser grouping metadata, and Codex threads

This is not a small visual tweak. It changes the primary navigation model.

### 4.2 Implementation change

Do not mirror the Zed/GPUI component hierarchy.

Build a clean React frontend with deliberate layout primitives and a serious state model.

## 5. Non-Negotiable UX Requirements

### 5.1 It must feel native

That means:

- compact density
- precise hover states
- strong keyboardability
- deterministic focus transitions
- no laggy panel animations
- no mushy web-app feel
- no bloated top-level rerenders

### 5.2 It must feel like one environment

The browser panel, editor panel, terminal panel, git panel, and Codex panel must feel like they all belong to the same desktop shell.

### 5.3 It must be visually disciplined

Typography, spacing, icon rhythm, separators, and active states need to be consistent.

This should read more like:

- a professional desktop IDE

and less like:

- a component-library demo

## 6. Source Areas in Glass Worth Studying

These files are useful for understanding the original product composition:

- `/Users/deepsaint/Desktop/Glass/crates/workspace/src/workspace.rs`
- `/Users/deepsaint/Desktop/Glass/crates/workspace/src/multi_workspace.rs`
- `/Users/deepsaint/Desktop/Glass/crates/workspace_chrome/src/workspace_chrome.rs`
- `/Users/deepsaint/Desktop/Glass/crates/browser/src/browser_view.rs`
- `/Users/deepsaint/Desktop/Glass/crates/project_panel/src/project_panel.rs`
- `/Users/deepsaint/Desktop/Glass/crates/terminal_view/src/terminal_panel.rs`
- `/Users/deepsaint/Desktop/Glass/crates/git_ui/src/git_panel.rs`

Read those for product behavior and information architecture, not for framework translation.

## 7. Frontend Architecture Requirements

## 7.1 Suggested stack

- React
- TypeScript
- Vite
- Tauri
- Zustand, Jotai, or another lightweight desktop-friendly state solution
- TanStack Query only where async cache semantics actually help
- `xterm.js` for terminal rendering
- a pane splitter/layout system that you fully control or can heavily adapt

Do not over-centralize everything into one mega store, but also do not fragment state into dozens of unrelated component-local islands.

## 7.2 State domains

Create separate frontend state domains:

- app shell state
- projects state
- workspace layout state
- file tree state
- git state
- browser state
- terminal state
- Codex state
- selection/focus state
- transient UI state

### 7.3 Required state shape

Everything important must be keyed by `projectId`.

This is mandatory for:

- file trees
- git summaries
- terminal sessions
- browser groups/tabs metadata
- Codex threads
- pending approvals

Do not build the UI around a hidden singleton current project.

## 8. Layout Model

## 8.1 High-level shell

The app shell should have:

- title/top chrome region
- left global/sidebar region
- central workbench region
- optional bottom dock region
- optional right-side detail/assistant region if needed later

### 8.2 Left side structure

The left side should combine:

- global mode/navigation affordances
- stacked project sections
- section-level views for project tree, git, browser tabs, terminal sessions, and Codex threads if needed

### 8.3 Main workbench

The center must support:

- multiple panes
- split views
- tabs per pane
- content-type-aware tab rendering
- active pane focus state

Supported content types:

- editor
- browser tab
- terminal session
- git diff/detail
- Codex thread view
- settings/utility views

### 8.4 Bottom dock

Bottom dock should support:

- terminal-heavy workflows
- logs or agent output later if desired
- resizing
- collapse/expand

## 9. The Most Important UI Change: Multi-Project Sidebar

This is the defining product customization.

## 9.1 Desired behavior

The sidebar should allow a vertical stack of active projects.

Each project section should show:

- project icon/color
- project name
- repo/branch summary
- unread or active indicators if relevant
- collapsible subsections

Suggested subsections:

- Files
- Git
- Browser
- Terminal
- Codex

### 9.2 Interaction requirements

- expanding one project must not collapse all others automatically
- project sections can remain open simultaneously
- active pane focus should sync visual emphasis to the owning project
- opening a file/browser tab/terminal from a project should preserve project association

### 9.3 Visual requirements

This must still feel compact.

Do not let the multi-project model become an accordion mess.

Design pattern:

- each project feels like a dense nav cluster
- shared global sidebar chrome remains consistent
- nested content is visually structured but not overly indented

## 10. Browser UI Requirements

## 10.1 Preserve the Glass idea

The browser is a first-class citizen in the workbench.

Requirements:

- browser tabs exist in the same general tab/pane system as the rest of the app
- there is a browser-specific toolbar and address field
- browser tabs can be surfaced from the sidebar
- browser tabs can coexist next to editors and terminals

### 10.2 Desktop feel

The browser chrome must not look like a random website header.

It should feel like app chrome:

- compact tab strip
- integrated nav controls
- dense spacing
- proper active/inactive tab behavior
- strong title truncation rules

### 10.3 Important implementation note

You are preserving browser UX and layout parity, not re-implementing CEF-specific rendering semantics in the UI layer.

## 11. Terminal UI Requirements

The terminal must feel serious.

Requirements:

- multiple sessions
- tabs
- split panes
- project association
- quick creation
- rename/close
- visible active/inactive state
- zero-jank resize behavior

Terminal tabs should use the same visual language as editor/browser tabs, but still communicate terminal identity clearly.

## 12. Project Tree UI Requirements

The project tree should feel close to Glass/Zed density:

- compact row height
- clear nesting
- strong selected/hover states
- git decoration support
- diagnostic decoration support
- good truncation behavior

Do not implement a generic enterprise tree view.

Key requirements:

- smooth expand/collapse
- lazy loading for large trees
- keyboard navigation
- context menus
- inline rename/create affordances later

## 13. Git UI Requirements

Git needs to stay first-class.

At minimum:

- branch display
- changed files summary
- staged/unstaged grouping if backend supports it
- diff entry navigation
- clickable file entries that open diff/editor views

Git should be visible from the same workspace shell, not hidden in a settings-like route.

## 14. Codex UI Requirements

Codex is not a modal popup feature. It is a first-class part of the product.

The UI must support:

- project-scoped thread list
- thread view
- turn streaming
- tool and command events
- approval prompts
- auth/account state

### 14.1 Approval UX

Approval prompts should feel high-signal and contextual.

They must show:

- project
- thread
- action type
- command or file change context
- decision buttons

Do not make approvals feel like random toast spam.

### 14.2 Thread UX

Thread view must handle:

- streaming message updates
- intermediate agent events
- command/file/tool items
- resumable conversations

## 15. Focus and Keyboard Model

This app will live or die on focus behavior.

Requirements:

- active pane is always visually obvious
- sidebar focus is obvious
- keyboard switching between panes works cleanly
- switching tabs never loses project context silently
- opening an item should focus the correct pane deterministically

Do not leave focus styling until later.

## 16. Component Architecture

## 16.1 Suggested component layers

### App shell layer

- `AppShell`
- `TitleBar`
- `Workbench`
- `Sidebar`
- `BottomDock`

### Navigation/project layer

- `ProjectStack`
- `ProjectSection`
- `ProjectSectionHeader`
- `ProjectFilesTree`
- `ProjectGitSummary`
- `ProjectBrowserList`
- `ProjectTerminalList`
- `ProjectCodexList`

### Pane system

- `PaneGrid`
- `Pane`
- `PaneTabs`
- `TabButton`
- `SplitHandle`

### Content surfaces

- `EditorSurface`
- `BrowserSurface`
- `TerminalSurface`
- `GitSurface`
- `CodexSurface`

### Overlays and transient UI

- `CommandPalette`
- `ApprovalDialog`
- `ContextMenu`
- `ToastHost`

## 16.2 Component design rule

Content surfaces should not own global app behavior.

They receive:

- IDs
- derived state
- event callbacks/actions

They do not reach across the app and mutate unrelated domains directly.

## 17. Styling Direction

## 17.1 Desired look

The look should be:

- restrained
- sharp
- dense
- dark or low-luminance capable if that matches Glass
- desktop-professional

### 17.2 Avoid

- rounded, soft, bubbly SaaS styling
- giant padding
- loud gradients
- trendy glassmorphism
- default Tailwind demo visuals
- “AI chat app” aesthetics

### 17.3 Tokens

Define design tokens up front:

- spacing scale
- row heights
- border colors
- panel backgrounds
- hover/selection states
- accent states
- typography sizes/weights
- icon sizes
- tab heights

### 17.4 Density targets

You should explicitly define compact desktop dimensions such as:

- sidebar row height
- tab strip height
- title bar height
- toolbar height
- tree indentation

If these are not standardized, the UI will drift quickly.

## 18. Motion Rules

Motion should be minimal and purposeful.

Allowed:

- subtle expand/collapse
- pane resize affordance feedback
- active state transitions
- loading indicators

Avoid:

- slow tweening
- floaty transitions
- oversized panel animations

This is a workbench, not a landing page.

## 19. Performance Rules

The frontend must stay fast under heavy state.

Rules:

- virtualize large trees if needed
- avoid rerendering the whole sidebar on one terminal chunk
- avoid rerendering all panes on one tab title change
- isolate streaming surfaces carefully
- use selectors aggressively
- memoize intentionally, not blindly

Project stacks, pane tabs, and streaming Codex/terminal views are the hot zones.

## 20. Persistence Expectations

The frontend should assume the backend persists source-of-truth state, but the frontend still needs strong restore semantics.

On launch, restore:

- project stack ordering
- expanded/collapsed project sections
- active pane layout
- open tabs
- active project/pane focus hints

Do not rebuild the UI as if every launch is first-run.

## 21. Accessibility and Usability

Even though this is a dense desktop app, it still needs:

- keyboard navigability
- readable contrast
- sane hit targets
- visible focus rings or focus states
- informative empty states

Dense does not mean sloppy.

## 22. Recommended Build Order

### Phase 1

- App shell
- title bar
- left sidebar skeleton
- pane grid
- token system

### Phase 2

- stacked project sections
- files tree
- tab system
- basic editor placeholder surface

### Phase 3

- terminal surface
- browser surface
- git surface

### Phase 4

- Codex thread UI
- approvals
- auth/account UI

### Phase 5

- polish
- keyboard model
- performance tuning
- state restoration polish

## 23. Definition of Done for Frontend

Frontend is not done when screenshots look close.

Frontend is done when:

- the app immediately reads as “Glass-style integrated workbench”
- multiple projects can stay open in the sidebar without awkward switching
- browser/editor/terminal all feel equally native to the shell
- compact density is preserved
- focus behavior feels desktop-grade
- streaming terminal and Codex interactions remain smooth
- the implementation is modular enough that more functionality can be added without UI collapse

## 24. Final Instruction

Bias toward product fidelity and desktop usability over clever frontend abstractions.

If a choice appears between:

- “architecturally cute but unlike Glass”
- “boring but faithfully reproduces the workbench feel”

choose faithful.

But if a choice appears between:

- “copy Glass’s implementation shape”
- “rebuild the same UX cleanly for React/Tauri”

choose the clean rebuild every time.
