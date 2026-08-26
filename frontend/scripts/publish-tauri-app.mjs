import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const tauriTarget = 'aarch64-apple-darwin'
const appName = 'Ice.app'
const appBundle = path.resolve(
  frontendRoot,
  `../src-tauri/target/${tauriTarget}/release/bundle/macos/${appName}`,
)

if (!fs.existsSync(appBundle)) {
  throw new Error(`Missing packaged app bundle: ${appBundle}`)
}

const homeApplications = path.join(os.homedir(), 'Applications')
const candidateDestinations = [
  path.join('/Applications', appName),
  path.join(homeApplications, appName),
]

const existingDestinations = candidateDestinations.filter((destination) =>
  fs.existsSync(destination),
)
const destinations =
  existingDestinations.length > 0 ? existingDestinations : [candidateDestinations[0]]

const failures = []
const published = []

for (const destination of destinations) {
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.rmSync(destination, { recursive: true, force: true })
    execFileSync('ditto', [appBundle, destination], { stdio: 'inherit' })
    published.push(destination)
  } catch (error) {
    failures.push({
      destination,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

if (published.length === 0) {
  const summary = failures
    .map((failure) => `${failure.destination}: ${failure.error}`)
    .join(' | ')
  throw new Error(`Failed to publish Ice.app to an installed location. ${summary}`)
}

for (const destination of published) {
  console.log(`Published latest Ice.app to ${destination}`)
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.warn(`Skipped publishing to ${failure.destination}: ${failure.error}`)
  }
}
