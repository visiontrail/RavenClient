#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const DEFAULT_DIST_DIR = path.resolve(__dirname, '..', 'dist')

const MACHO_MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'])

function walk(dir, visit) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, visit)
    } else if (entry.isFile()) {
      visit(fullPath)
    }
  }
}

function isMachOBinary(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(4)
    const bytesRead = fs.readSync(fd, buffer, 0, 4, 0)
    if (bytesRead < 4) return false
    return MACHO_MAGICS.has(buffer.toString('hex'))
  } finally {
    fs.closeSync(fd)
  }
}

function findAppBundles(searchRoot) {
  const apps = []
  if (!fs.existsSync(searchRoot)) return apps

  const stat = fs.statSync(searchRoot)
  if (stat.isDirectory() && searchRoot.endsWith('.app')) {
    return [searchRoot]
  }

  walk(searchRoot, (filePath) => {
    // `walk` only visits files; detect app bundles from the parent chain.
    const parts = filePath.split(path.sep)
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i].endsWith('.app')) {
        const appPath = parts.slice(0, i + 1).join(path.sep)
        if (!apps.includes(appPath)) apps.push(appPath)
        break
      }
    }
  })

  return apps
}

function collectChatermNativeBinaries(appPath) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources')
  const candidateRoots = [
    path.join(resourcesDir, 'chaterm'),
    path.join(resourcesDir, 'app.asar.unpacked', 'resources', 'chaterm'),
    path.join(resourcesDir, 'app.asar.unpacked')
  ]

  const binaries = new Set()

  for (const root of candidateRoots) {
    walk(root, (filePath) => {
      const ext = path.extname(filePath)
      const inNodePty = filePath.split(path.sep).includes('node-pty')
      if (ext === '.node' || (inNodePty && isMachOBinary(filePath))) {
        binaries.add(filePath)
      }
    })
  }

  return [...binaries].sort()
}

function verifySignature(filePath) {
  const result = spawnSync('codesign', ['--verify', '--strict', '--verbose=2', filePath], {
    encoding: 'utf8'
  })

  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  }
}

function verifySignedBinaries(appPath, options = {}) {
  const log = options.log ?? console.log
  const binaries = collectChatermNativeBinaries(appPath)

  if (binaries.length === 0) {
    log(`[verify-notarization] No Chaterm native binaries found in ${appPath}`)
    return { checked: 0, failures: [] }
  }

  const failures = []
  for (const filePath of binaries) {
    const result = verifySignature(filePath)
    if (!result.ok) {
      failures.push({ filePath, output: result.output })
    }
  }

  if (failures.length === 0) {
    log(`[verify-notarization] OK: ${binaries.length} Chaterm native binaries are signed`)
  }

  return { checked: binaries.length, failures }
}

function printUsage() {
  console.log(`Usage: node scripts/verify-notarization.js [path ...]

Verifies codesign signatures for embedded Chaterm native binaries inside macOS
.app bundles. Paths may point to .app bundles or directories that contain them.
Defaults to ./dist.
`)
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage()
    return
  }

  if (process.platform !== 'darwin') {
    console.log('[verify-notarization] Skipping: codesign verification only runs on macOS')
    return
  }

  const roots = process.argv.slice(2)
  const searchRoots = roots.length > 0 ? roots.map((root) => path.resolve(root)) : [DEFAULT_DIST_DIR]
  const apps = [...new Set(searchRoots.flatMap(findAppBundles))]

  if (apps.length === 0) {
    console.error(`[verify-notarization] No .app bundles found under: ${searchRoots.join(', ')}`)
    process.exit(1)
  }

  let checked = 0
  const failures = []
  for (const appPath of apps) {
    const result = verifySignedBinaries(appPath)
    checked += result.checked
    failures.push(...result.failures)
  }

  if (failures.length > 0) {
    console.error(`[verify-notarization] ${failures.length} unsigned Chaterm native binaries found`)
    for (const failure of failures) {
      console.error(`- ${failure.filePath}`)
      if (failure.output) console.error(failure.output)
    }
    process.exit(1)
  }

  console.log(
    `[verify-notarization] Complete: checked ${checked} Chaterm native binaries across ${apps.length} app bundle(s)`
  )
}

if (require.main === module) {
  main()
}

module.exports = {
  collectChatermNativeBinaries,
  findAppBundles,
  verifySignedBinaries,
  verifySignature
}
