import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const tauriRoot = path.resolve(frontendRoot, '../src-tauri')
const tauriBin = path.resolve(frontendRoot, 'node_modules/.bin/tauri')
const cargoEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0',
}

execFileSync(
  tauriBin,
  [
    'build',
    '--debug',
    '--no-bundle',
    '--ci',
    '-c',
    '{"build":{"beforeBuildCommand":"","frontendDist":"../frontend/dist"}}',
  ],
  {
    cwd: tauriRoot,
    stdio: 'inherit',
    env: cargoEnv,
  },
)
