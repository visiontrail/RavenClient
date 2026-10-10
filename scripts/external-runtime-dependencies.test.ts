import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { findExternalRuntimeDependencies } = require('./external-runtime-dependencies.js')

describe('embedded runtime dependency staging', () => {
  it('includes lazy serialization and encryption imports from compiled bundles', () => {
    const source = `
      const sqlite = require('better-sqlite3')
      const serializer = await import("superjson").catch(() => dynamicRequire("superjson"))
      const encryption = await import('@aws-crypto/client-node')
    `
    expect(findExternalRuntimeDependencies(source)).toEqual(['better-sqlite3', 'superjson', '@aws-crypto/client-node'])
  })

  it('ignores builtins, Electron and relative preload files', () => {
    expect(
      findExternalRuntimeDependencies(`require('node:fs'); import('path'); require('electron'); require('./index.js')`)
    ).toEqual([])
  })

  it('normalizes scoped and unscoped subpath imports to package names', () => {
    expect(findExternalRuntimeDependencies(`import('@scope/pkg/feature'); require('pkg/feature')`)).toEqual([
      '@scope/pkg',
      'pkg'
    ])
  })

  it('deduplicates packages and accepts whitespace around imports', () => {
    expect(
      findExternalRuntimeDependencies(`import ( 'superjson' ); require("superjson"); dynamicRequire('superjson')`)
    ).toEqual(['superjson'])
  })
})
