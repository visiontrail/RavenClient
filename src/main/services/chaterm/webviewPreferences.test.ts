import { pathToFileURL } from 'node:url'

import type { WebPreferences } from 'electron'
import { describe, expect, it } from 'vitest'

import { configureChatermWebview } from './webviewPreferences'

const preload = '/Applications/Raven.app/Contents/Resources/chaterm/preload.js'
const params = { partition: 'persist:chaterm', src: 'about:blank', preload: pathToFileURL(preload).href }

describe('trusted embedded Terminal preload', () => {
  it('enables the packaged preload without giving the renderer Node integration', () => {
    const preferences: WebPreferences = { sandbox: true }
    expect(configureChatermWebview(preferences, params, preload)).toBe(true)
    expect(preferences).toEqual({
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--chaterm-embedded=1']
    })
  })

  it('accepts the local terminal URL and an absolute preload path', () => {
    expect(configureChatermWebview({}, { ...params, src: 'raven-chaterm://app/index.html', preload }, preload)).toBe(
      true
    )
  })

  it('recognizes the preloadURL shape used by Electron during attachment', () => {
    const preferences = { sandbox: true, preloadURL: pathToFileURL(preload).href }
    expect(configureChatermWebview(preferences, { ...params, preload: undefined }, preload)).toBe(true)
    expect(preferences.sandbox).toBe(false)
  })

  it('keeps existing process arguments and adds the embedded bridge flag only once', () => {
    const preferences: WebPreferences = { additionalArguments: ['--custom', '--chaterm-embedded=1'] }
    configureChatermWebview(preferences, params, preload)
    expect(preferences.additionalArguments).toEqual(['--custom', '--chaterm-embedded=1'])
  })

  it.each([
    { partition: 'persist:external' },
    { src: 'https://example.com/' },
    { src: 'raven-chaterm://app.example.com/index.html' },
    { preload: '/tmp/chaterm/preload.js' },
    { preload: undefined }
  ])('leaves unrelated or untrusted webviews unchanged: %j', (override) => {
    const preferences: WebPreferences = { sandbox: true, nodeIntegration: false }
    expect(configureChatermWebview(preferences, { ...params, ...override }, preload)).toBe(false)
    expect(preferences).toEqual({ sandbox: true, nodeIntegration: false })
  })
})
