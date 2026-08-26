import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const iconsRoot = path.resolve(frontendRoot, '../src-tauri/icons')
const svgSource = path.join(iconsRoot, 'app-icon.svg')
const iconPng = path.join(iconsRoot, 'icon.png')
const iconIcns = path.join(iconsRoot, 'icon.icns')
const iconsetDir = path.join(iconsRoot, 'icon.iconset')

if (!fs.existsSync(svgSource)) {
  throw new Error(`Missing canonical icon source: ${svgSource}`)
}

fs.mkdirSync(iconsRoot, { recursive: true })
fs.rmSync(iconsetDir, { recursive: true, force: true })
fs.mkdirSync(iconsetDir, { recursive: true })

execFileSync('rsvg-convert', ['-w', '1024', '-h', '1024', '-o', iconPng, svgSource], {
  stdio: 'inherit',
})

const pngSizes = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
]

for (const [filename, size] of pngSizes) {
  execFileSync('sips', ['-z', String(size), String(size), iconPng, '--out', path.join(iconsRoot, filename)], {
    stdio: 'ignore',
  })
}

const iconsetSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

for (const [filename, size] of iconsetSizes) {
  execFileSync('sips', ['-z', String(size), String(size), iconPng, '--out', path.join(iconsetDir, filename)], {
    stdio: 'ignore',
  })
}

execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', iconIcns], {
  stdio: 'inherit',
})
