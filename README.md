# ice

My custom dev environment.

## What This Is

`ice` is a Tauri desktop app that rebuilds the Glass-style development environment around:

- a native-feeling multi-project workspace
- an IDE surface
- a browser surface
- terminal sessions
- git tooling
- Codex App Server integration

The backend lives in Rust under `src-tauri/`.
The frontend lives in Vite/React under `frontend/`.

## Current Shape

- Multi-project sidebar model instead of single-project switching
- Canonical local storage under `~/.ice/`
- SQLite state at `~/.ice/ice.db`
- Native PTY terminal backend
- Native git command integration
- Codex App Server backend wiring
- Fozzy-first backend verification

## How To Run

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Tauri Backend / App

```bash
cd src-tauri
cargo check
cargo test
```

When the frontend and Tauri shell are wired together for local app runs, use the project’s Tauri run flow from the repo root.

## Project Structure

```text
frontend/     Vite + React UI
src-tauri/    Rust backend and Tauri host
tests/        Fozzy scenarios
BACKEND.md    Backend production checklist
FRONTEND.md   Frontend production checklist
```

## Verification

Rust verification:

```bash
cd src-tauri
cargo fmt
cargo check
cargo test
```

Fozzy verification examples:

```bash
/Users/deepsaint/Desktop/fozzy/target/debug/fozzy validate tests/backend.production_gate.fozzy.json --json
/Users/deepsaint/Desktop/fozzy/target/debug/fozzy doctor --deep --scenario tests/backend.production_gate.fozzy.json --runs 5 --seed 424242 --proc-backend host --fs-backend host --json
/Users/deepsaint/Desktop/fozzy/target/debug/fozzy test --det --strict tests/backend.production_gate.fozzy.json tests/backend.topology.fozzy.json --proc-backend host --fs-backend host --json
```

## Storage

- Root: `~/.ice`
- Database: `~/.ice/ice.db`
- Concern directories:
  - `~/.ice/projects`
  - `~/.ice/workspace`
  - `~/.ice/browser`
  - `~/.ice/terminal`
  - `~/.ice/codex`
  - `~/.ice/diagnostics`
