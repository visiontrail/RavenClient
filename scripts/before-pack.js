const { Arch } = require('electron-builder')
const fs = require('node:fs')
const { createRequire, isBuiltin } = require('node:module')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { findExternalRuntimeDependencies } = require('./external-runtime-dependencies')

// Chaterm's separately built main bundle externalizes its runtime dependencies.
// electron-builder only collects Raven's dependencies, so stage Chaterm's
// production tree explicitly and rebuild its native modules for each macOS arch.
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return

  const root = path.resolve(__dirname, '..')
  const submodule = path.join(root, 'third_party', 'ChatermForRaven')
  const arch = Arch[context.arch]
  const staging = path.join(root, 'dist', `chaterm-runtime-${arch}`)
  const target = path.join(root, 'resources', 'chaterm', 'node_modules')
  const manifest = JSON.parse(fs.readFileSync(path.join(submodule, 'package.json'), 'utf8'))
  const dependencies = new Set()
  const runtimeDependencies = {}
  function collect(name, from, optional = false) {
    if (name === 'electron' || isBuiltin(name)) return
    const search = createRequire(path.join(from, 'package.json')).resolve.paths(name)
    const dir = search
      .map((base) => path.join(base, name))
      .find((candidate) => fs.existsSync(path.join(candidate, 'package.json')))
    if (!dir) {
      if (optional) return
      throw new Error(`Missing Chaterm runtime dependency: ${name}`)
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const supports = (values, value) =>
      !values ||
      (!values.includes(`!${value}`) && (!values.some((item) => !item.startsWith('!')) || values.includes(value)))
    if (!supports(pkg.os, 'darwin') || !supports(pkg.cpu, arch)) return
    if (dependencies.has(dir)) return
    dependencies.add(dir)
    for (const child of Object.keys(pkg.dependencies || {})) collect(child, dir)
    for (const child of Object.keys(pkg.optionalDependencies || {})) collect(child, dir, true)
    for (const child of Object.keys(pkg.peerDependencies || {})) {
      if (!pkg.peerDependenciesMeta?.[child]?.optional) collect(child, dir)
    }
  }

  // Renderer dependencies are already bundled. Keep only packages required by
  // the built main/preload entries, plus their transitive runtime dependencies.
  const entries = ['main/index.js', 'preload.js', 'index.js']
  for (const entry of entries) {
    const source = fs.readFileSync(path.join(root, 'resources', 'chaterm', entry), 'utf8')
    for (const name of findExternalRuntimeDependencies(source)) {
      collect(name, submodule)
      runtimeDependencies[name] = manifest.dependencies[name]
    }
  }

  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  fs.writeFileSync(
    path.join(staging, 'package.json'),
    JSON.stringify({
      name: 'raven-chaterm-runtime',
      version: manifest.version,
      dependencies: runtimeDependencies
    })
  )
  for (const dir of dependencies) {
    let relative = path.relative(submodule, dir)
    // npm can resolve a dependency from Raven's hoisted node_modules.
    if (!relative.startsWith(`node_modules${path.sep}`)) relative = path.relative(root, dir)
    if (!relative.startsWith(`node_modules${path.sep}`)) {
      throw new Error(`Chaterm dependency outside its node_modules: ${dir}`)
    }
    fs.cpSync(dir, path.join(staging, relative), {
      recursive: true,
      dereference: true,
      // Nested packages are separate entries in npm's production tree.
      filter: (source) => source === dir || path.basename(source) !== 'node_modules'
    })
  }

  const rebuildCli = path.join(path.dirname(require.resolve('@electron/rebuild')), 'cli.js')
  const rebuilt = spawnSync(
    process.execPath,
    [
      rebuildCli,
      '--version',
      context.packager.info.framework.version,
      '--arch',
      arch,
      '--module-dir',
      staging,
      '--force'
    ],
    { cwd: staging, stdio: 'inherit', env: process.env }
  )
  if (rebuilt.status !== 0) throw new Error(`Chaterm native rebuild failed for ${arch}`)

  fs.rmSync(target, { recursive: true, force: true })
  const stagedModules = path.join(staging, 'node_modules')
  fs.cpSync(stagedModules, target, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(stagedModules, source)
      // node-pty uses the newly rebuilt build/Release binaries. Other platform
      // prebuilds and compiler intermediates cannot be signed as runtime code.
      if (relative === path.join('node-pty', 'prebuilds')) return false
      return !/\.(?:o|a|obj|lib|pdb)$/.test(source)
    }
  })
  console.log(`[Before Pack] Staged ${dependencies.size} Chaterm runtime dependencies for ${arch}`)
}
