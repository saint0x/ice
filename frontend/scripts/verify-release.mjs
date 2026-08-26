import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const tauriTarget = 'aarch64-apple-darwin'
const packagedBundle = path.resolve(
  frontendRoot,
  `../src-tauri/target/${tauriTarget}/release/bundle/macos/Ice.app`,
)
const canonicalBundle = path.resolve(frontendRoot, '../src-tauri/target/release/bundle/macos/Ice.app')
const sourceIcns = path.resolve(frontendRoot, '../src-tauri/icons/icon.icns')
const publishedCandidates = [
  path.join('/Applications', 'Ice.app'),
  path.join(os.homedir(), 'Applications', 'Ice.app'),
]

for (const requiredPath of [packagedBundle, canonicalBundle, sourceIcns]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Missing packaged release artifact: ${requiredPath}`)
  }
}

function verifyLocalBundle(bundlePath) {
  const appInfoPlist = path.join(bundlePath, 'Contents/Info.plist')
  const bundledIcns = path.join(bundlePath, 'Contents/Resources/icon.icns')

  for (const requiredPath of [appInfoPlist, bundledIcns]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Missing packaged release artifact: ${requiredPath}`)
    }
  }

  const plist = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', appInfoPlist], {
    encoding: 'utf8',
  }).trim()
  const appExecutable = path.join(bundlePath, 'Contents/MacOS', plist)

  if (!fs.existsSync(appExecutable)) {
    throw new Error(`Missing packaged release artifact: ${appExecutable}`)
  }

  const stats = fs.statSync(appExecutable)
  if (!stats.isFile()) {
    throw new Error(`Packaged app executable is not a file: ${appExecutable}`)
  }

  if (!fs.readFileSync(sourceIcns).equals(fs.readFileSync(bundledIcns))) {
    throw new Error(`Packaged app icon does not match src-tauri/icons/icon.icns: ${bundlePath}`)
  }

  return { plist, bundledIcns }
}

const packagedInfo = verifyLocalBundle(packagedBundle)
const canonicalInfo = verifyLocalBundle(canonicalBundle)

if (packagedInfo.plist !== canonicalInfo.plist) {
  throw new Error('Canonical release bundle executable does not match packaged bundle executable')
}

if (
  !fs
    .readFileSync(packagedInfo.bundledIcns)
    .equals(fs.readFileSync(canonicalInfo.bundledIcns))
) {
  throw new Error('Canonical release bundle icon does not match packaged bundle icon')
}

const publishedBundles = publishedCandidates.filter((candidate) => fs.existsSync(candidate))
if (publishedBundles.length === 0) {
  throw new Error('Packaged release was not published to /Applications/Ice.app or ~/Applications/Ice.app')
}

for (const publishedBundle of publishedBundles) {
  const publishedExecutable = path.join(
    publishedBundle,
    'Contents/MacOS',
    packagedInfo.plist,
  )
  if (!fs.existsSync(publishedExecutable)) {
    throw new Error(`Published app executable is missing: ${publishedExecutable}`)
  }
  const publishedIcon = path.join(publishedBundle, 'Contents/Resources/icon.icns')
  if (!fs.existsSync(publishedIcon)) {
    throw new Error(`Published app icon is missing: ${publishedIcon}`)
  }
  if (!fs.readFileSync(packagedInfo.bundledIcns).equals(fs.readFileSync(publishedIcon))) {
    throw new Error(`Published app icon does not match packaged bundle: ${publishedBundle}`)
  }
}
