import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const tauriRoot = path.resolve(frontendRoot, '../src-tauri')
const tauriBin = path.resolve(frontendRoot, 'node_modules/.bin/tauri')

execFileSync(
  tauriBin,
  [
    'build',
    '--bundles',
    'app',
    '--ci',
    '--no-sign',
    '-c',
    '{"build":{"beforeBuildCommand":"","frontendDist":"../frontend/dist"},"bundle":{"active":true}}',
  ],
  {
    cwd: tauriRoot,
    stdio: 'inherit',
    env: process.env,
  },
)
