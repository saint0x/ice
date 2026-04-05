import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const appBundle = path.resolve(frontendRoot, '../src-tauri/target/release/bundle/macos/Ice.app')
const appInfoPlist = path.join(appBundle, 'Contents/Info.plist')

for (const requiredPath of [appBundle, appInfoPlist]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Missing packaged release artifact: ${requiredPath}`)
  }
}

const plist = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', appInfoPlist], {
  encoding: 'utf8',
}).trim()
const appExecutable = path.join(appBundle, 'Contents/MacOS', plist)

if (!fs.existsSync(appExecutable)) {
  throw new Error(`Missing packaged release artifact: ${appExecutable}`)
}

const stats = fs.statSync(appExecutable)
if (!stats.isFile()) {
  throw new Error(`Packaged app executable is not a file: ${appExecutable}`)
}
