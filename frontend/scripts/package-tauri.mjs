import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const tauriRoot = path.resolve(frontendRoot, '../src-tauri')
const tauriBin = path.resolve(frontendRoot, 'node_modules/.bin/tauri')
const tauriTarget = 'aarch64-apple-darwin'
const appBundle = path.resolve(tauriRoot, `target/${tauriTarget}/release/bundle/macos/Ice.app`)
const canonicalBundle = path.resolve(tauriRoot, 'target/release/bundle/macos/Ice.app')

fs.rmSync(appBundle, { recursive: true, force: true })
fs.rmSync(canonicalBundle, { recursive: true, force: true })

execFileSync(
  tauriBin,
  [
    'build',
    '--target',
    tauriTarget,
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

fs.mkdirSync(path.dirname(canonicalBundle), { recursive: true })
execFileSync('ditto', [appBundle, canonicalBundle], {
  cwd: tauriRoot,
  stdio: 'inherit',
  env: process.env,
})

execFileSync('node', [path.resolve(frontendRoot, 'scripts/publish-tauri-app.mjs')], {
  cwd: frontendRoot,
  stdio: 'inherit',
  env: process.env,
})
