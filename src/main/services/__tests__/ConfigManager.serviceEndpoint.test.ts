import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigKeys, ConfigManager } from '../ConfigManager'

const values = vi.hoisted(() => new Map<string, unknown>())

vi.mock('electron-store', () => ({
  default: class {
    get(key: string, fallback?: unknown) {
      return values.has(key) ? values.get(key) : fallback
    }

    set(key: string, value: unknown) {
      values.set(key, value)
    }
  }
}))

describe('RavenAIService endpoint resolution', () => {
  beforeEach(() => {
    values.clear()
    vi.stubEnv('RAVEN_AI_SERVICE_BASE_URL', '')
    vi.stubEnv('RAVEN_AI_SERVICE_HOST', '')
    vi.stubEnv('RAVEN_AI_SERVICE_PORT', '')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('connects a fresh install to nr-test without shell environment variables', () => {
    expect(new ConfigManager().getRavenAIServiceBaseUrl()).toBe('http://10.60.11.3:8085')
  })

  it('preserves an explicitly configured local development endpoint', () => {
    values.set(ConfigKeys.RavenAIServiceHost, '127.0.0.1')
    values.set(ConfigKeys.RavenAIServicePort, 8090)
    expect(new ConfigManager().getRavenAIServiceBaseUrl()).toBe('http://127.0.0.1:8090')
  })

  it('ignores a blank stored host', () => {
    values.set(ConfigKeys.RavenAIServiceHost, '  ')
    expect(new ConfigManager().getRavenAIServiceBaseUrl()).toBe('http://10.60.11.3:8085')
  })

  it('allows host and port environment overrides', () => {
    vi.stubEnv('RAVEN_AI_SERVICE_HOST', '  example.internal  ')
    vi.stubEnv('RAVEN_AI_SERVICE_PORT', '8091')
    expect(new ConfigManager().getRavenAIServiceBaseUrl()).toBe('http://example.internal:8091')
  })

  it('gives a full URL override precedence over host and port', () => {
    vi.stubEnv('RAVEN_AI_SERVICE_BASE_URL', ' https://raven.example.test/ ')
    vi.stubEnv('RAVEN_AI_SERVICE_HOST', 'ignored.internal')
    expect(new ConfigManager().getRavenAIServiceBaseUrl()).toBe('https://raven.example.test')
  })

  it('rejects invalid environment ports and keeps the stored port', () => {
    values.set(ConfigKeys.RavenAIServicePort, 8090)
    vi.stubEnv('RAVEN_AI_SERVICE_PORT', '70000')
    expect(new ConfigManager().getRavenAIServiceBaseUrl()).toBe('http://10.60.11.3:8090')
  })
})
