import { type BridgeStreamEvent, type CreateMessageRequest, INTERNAL_CHANNELS } from '@shared/chaterm-bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  providers: [] as any[],
  anthropicStreamFactory: vi.fn(),
  openAIStreamFactory: vi.fn(),
  reportUsage: vi.fn().mockResolvedValue(undefined),
  refreshRoutes: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({
      llm: {
        providers: mocks.providers
      }
    }))
  }
}))

vi.mock('@renderer/services/RavenClientAIRuntime', () => ({
  ravenClientAIRuntime: {
    ensureFresh: vi.fn().mockResolvedValue(undefined),
    getRoutes: vi.fn(() =>
      mocks.providers.map((provider, index) => ({
        slot: index === 0 ? 'primary' : 'backup',
        provider: provider.name || provider.id,
        base_url: provider.apiHost,
        api_key: provider.apiKey,
        model: provider.models[0].id,
        small_fast_model: provider.models[1]?.id || null,
        capabilities: provider.capabilities || {
          image_input: false,
          document_input: false,
          tool_use: true,
          partial_streaming: true,
          thinking_budget: false
        }
      }))
    ),
    getProvider: vi.fn((route) => mocks.providers[route.slot === 'primary' ? 0 : 1] || mocks.providers[0]),
    reportUsage: mocks.reportUsage,
    refresh: mocks.refreshRoutes
  }
}))

vi.mock('@renderer/config/models', () => ({
  isEmbeddingModel: vi.fn(() => false),
  isFunctionCallingModel: vi.fn(() => true),
  isRerankModel: vi.fn(() => false),
  isVisionModel: vi.fn(() => false)
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((options) => ({
    messages: {
      stream: vi.fn((params) => mocks.anthropicStreamFactory(params, options))
    }
  }))
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((options) => ({
    chat: {
      completions: {
        create: vi.fn((params, requestOptions) => mocks.openAIStreamFactory(params, requestOptions, options))
      }
    }
  }))
}))

import chatermBridgeService from '../ChatermBridgeService'

const anthropicProvider = {
  id: 'anthropic-provider',
  type: 'anthropic',
  enabled: true,
  apiKey: 'anthropic-key',
  apiHost: 'https://api.anthropic.test',
  models: [{ id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' }]
}

const backupAnthropicProvider = {
  ...anthropicProvider,
  id: 'anthropic-backup',
  name: 'backup-provider',
  apiKey: 'backup-key',
  apiHost: 'https://backup.anthropic.test',
  models: [{ id: 'claude-backup', name: 'Claude Backup' }]
}

const openAIProvider = {
  id: 'openai-provider',
  type: 'openai',
  enabled: true,
  apiKey: 'openai-key',
  apiHost: 'https://api.openai.test',
  models: [
    { id: 'gpt-4.1', name: 'GPT 4.1' },
    { id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini' }
  ]
}

type Listener = (event: unknown, payload: any) => void

let listeners: Record<string, Listener>
let send: ReturnType<typeof vi.fn>

const createAnthropicStream = (
  events: any[],
  usage = { input_tokens: 11, output_tokens: 7 }
): AsyncIterable<any> & { finalMessage: ReturnType<typeof vi.fn> } => ({
  async *[Symbol.asyncIterator]() {
    for (const event of events) {
      await Promise.resolve()
      yield event
    }
  },
  finalMessage: vi.fn(async () => ({ usage }))
})

const createOpenAIStream = (chunks: any[]): AsyncIterable<any> => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      await Promise.resolve()
      yield chunk
    }
  }
})

const eventsFor = (requestId: string): BridgeStreamEvent[] =>
  send.mock.calls
    .filter(([channel, payload]) => channel === INTERNAL_CHANNELS.Event && payload.requestId === requestId)
    .map(([, payload]) => payload.event)

const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (predicate()) return
  }
  throw new Error(message)
}

const execute = async (req: CreateMessageRequest): Promise<BridgeStreamEvent[]> => {
  listeners[INTERNAL_CHANNELS.Execute]({}, req)
  await waitFor(() => eventsFor(req.requestId).some((event) => event.type === 'end'), 'expected bridge stream to end')
  return eventsFor(req.requestId)
}

describe('ChatermBridgeService', () => {
  beforeEach(() => {
    chatermBridgeService.stop()
    listeners = {}
    send = vi.fn()
    ;(window as any).electron = {
      ipcRenderer: {
        on: vi.fn((channel: string, listener: Listener) => {
          listeners[channel] = listener
          return () => {
            delete listeners[channel]
          }
        }),
        send
      }
    }
    mocks.providers = []
    mocks.anthropicStreamFactory.mockReset()
    mocks.openAIStreamFactory.mockReset()
    mocks.reportUsage.mockClear()
    mocks.refreshRoutes.mockClear()
  })

  afterEach(() => {
    chatermBridgeService.stop()
  })

  it('responds to default model lookup with the renderer default model id', () => {
    mocks.providers = [anthropicProvider]
    chatermBridgeService.start()

    listeners[INTERNAL_CHANNELS.ListModels]({}, { replyChannel: 'reply:default', defaultOnly: true })

    expect(send).toHaveBeenCalledWith('reply:default', { modelId: 'claude-3-5-sonnet' })
  })

  it('lists synced RavenAIService models even though the Redux-safe provider has no API key', () => {
    mocks.providers = [{ ...anthropicProvider, apiKey: '' }]
    chatermBridgeService.start()

    listeners[INTERNAL_CHANNELS.ListModels]({}, { replyChannel: 'reply:models' })

    expect(send).toHaveBeenCalledWith('reply:models', [
      expect.objectContaining({
        providerId: 'raven-service-primary',
        modelId: 'claude-3-5-sonnet',
        displayName: 'claude-3-5-sonnet'
      })
    ])
  })

  it('lists primary and backup models with their own capabilities and no credentials', () => {
    mocks.providers = [
      openAIProvider,
      {
        ...backupAnthropicProvider,
        models: [{ id: 'claude-backup' }, { id: 'claude-backup-fast' }],
        capabilities: { tool_use: false, image_input: true, partial_streaming: false }
      }
    ]
    chatermBridgeService.start()

    listeners[INTERNAL_CHANNELS.ListModels]({}, { replyChannel: 'reply:models' })

    expect(send).toHaveBeenCalledWith(
      'reply:models',
      [
        ['raven-service-primary', 'gpt-4.1', { tools: true, vision: false, streaming: true }],
        ['raven-service-primary', 'gpt-4.1-mini', { tools: true, vision: false, streaming: true }],
        ['raven-service-backup', 'claude-backup', { tools: false, vision: true, streaming: false }],
        ['raven-service-backup', 'claude-backup-fast', { tools: false, vision: true, streaming: false }]
      ].map(([providerId, modelId, capabilities]) => ({ providerId, modelId, displayName: modelId, capabilities }))
    )
  })

  it('deduplicates model IDs within and across routes in server route order', () => {
    mocks.providers = [
      { ...anthropicProvider, models: [{ id: 'shared-model' }, { id: 'shared-model' }] },
      { ...backupAnthropicProvider, models: [{ id: 'shared-model' }, { id: 'backup-fast' }] }
    ]
    chatermBridgeService.start()

    listeners[INTERNAL_CHANNELS.ListModels]({}, { replyChannel: 'reply:models' })

    expect(send).toHaveBeenCalledWith('reply:models', [
      expect.objectContaining({ providerId: 'raven-service-primary', modelId: 'shared-model' }),
      expect.objectContaining({ providerId: 'raven-service-backup', modelId: 'backup-fast' })
    ])
  })

  it.each(['claude-backup', 'claude-backup-fast'])('executes the selected backup model %s first', async (modelId) => {
    mocks.providers = [
      anthropicProvider,
      { ...backupAnthropicProvider, models: [{ id: 'claude-backup' }, { id: 'claude-backup-fast' }] }
    ]
    mocks.anthropicStreamFactory.mockReturnValue(
      createAnthropicStream([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'selected answer' } }])
    )
    chatermBridgeService.start()

    const events = await execute({
      requestId: 'selected-backup',
      modelId,
      messages: [{ role: 'user', content: 'hello' }]
    })

    expect(mocks.anthropicStreamFactory).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ model: modelId }),
      expect.objectContaining({ apiKey: 'backup-key', baseURL: backupAnthropicProvider.apiHost })
    )
    expect(events.filter((event) => event.type === 'start').map((event) => event.modelId)).toEqual([modelId])
    expect(mocks.reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 'backup', model: modelId, status: 'succeeded' })
    )
  })

  it('falls back from a selected backup fast model to the other route fast model before output', async () => {
    mocks.providers = [
      { ...anthropicProvider, models: [{ id: 'primary-model' }, { id: 'primary-fast' }] },
      { ...backupAnthropicProvider, models: [{ id: 'backup-model' }, { id: 'backup-fast' }] }
    ]
    mocks.anthropicStreamFactory.mockImplementation((_params, options) => {
      if (options.apiKey === 'backup-key') throw new Error('backup network unavailable')
      return createAnthropicStream([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'fallback answer' } }
      ])
    })
    chatermBridgeService.start()

    const events = await execute({
      requestId: 'backup-fallback',
      modelId: 'backup-fast',
      messages: [{ role: 'user', content: 'hello' }]
    })

    expect(mocks.anthropicStreamFactory.mock.calls.map(([params]) => params.model)).toEqual([
      'backup-fast',
      'primary-fast'
    ])
    expect(events.filter((event) => event.type === 'start').map((event) => event.modelId)).toEqual([
      'backup-fast',
      'primary-fast'
    ])
    expect(events.at(-1)).toEqual({ type: 'end', finishReason: 'stop' })
    expect(mocks.refreshRoutes).toHaveBeenCalledOnce()
  })

  it('rejects a selected model removed by a capability refresh instead of silently using another model', async () => {
    mocks.providers = [anthropicProvider]
    chatermBridgeService.start()

    const events = await execute({
      requestId: 'removed-model',
      modelId: 'removed-backup',
      messages: [{ role: 'user', content: 'hello' }]
    })

    expect(mocks.anthropicStreamFactory).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'end', finishReason: 'error' }))
  })

  it('maps Anthropic text, tool calls, usage, and finish reason', async () => {
    mocks.providers = [anthropicProvider]
    mocks.anthropicStreamFactory.mockReturnValue(
      createAnthropicStream([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'run_command' }
        },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"cmd"' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"ls"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      ])
    )

    chatermBridgeService.start()
    const events = await execute({
      requestId: 'anthropic-1',
      modelId: 'claude-3-5-sonnet',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'list files' }]
    })

    expect(events).toContainEqual({ type: 'text', delta: 'hello' })
    expect(events).toContainEqual({ type: 'tool_use_start', toolCallId: 'toolu_1', name: 'run_command' })
    expect(events).toContainEqual({ type: 'tool_use_delta', toolCallId: 'toolu_1', inputJsonDelta: '{"cmd"' })
    expect(events).toContainEqual({ type: 'tool_use_end', toolCallId: 'toolu_1', finalInput: { cmd: 'ls' } })
    expect(events).toContainEqual({ type: 'usage', inputTokens: 11, outputTokens: 7 })
    expect(events.at(-1)).toEqual({ type: 'end', finishReason: 'tool_use' })
  })

  it('uses the shared RavenAIService route order and exposes the model that actually answered', async () => {
    mocks.providers = [{ ...anthropicProvider, name: 'primary-provider' }, backupAnthropicProvider]
    mocks.anthropicStreamFactory.mockImplementation((_params, options) => {
      if (options.apiKey === 'anthropic-key') {
        return {
          [Symbol.asyncIterator]: () => ({
            next: vi.fn().mockRejectedValue(new Error('primary network unavailable'))
          }),
          finalMessage: vi.fn()
        }
      }
      return createAnthropicStream([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'backup answer' } }
      ])
    })

    chatermBridgeService.start()
    const events = await execute({
      requestId: 'fallback-1',
      modelId: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'route this' }]
    })

    expect(events.filter((event) => event.type === 'start').map((event) => event.modelId)).toEqual([
      'claude-3-5-sonnet',
      'claude-backup'
    ])
    expect(events).toContainEqual({ type: 'text', delta: 'backup answer' })
    expect(events.at(-1)).toEqual({ type: 'end', finishReason: 'stop' })
    expect(mocks.refreshRoutes).toHaveBeenCalledOnce()
    expect(mocks.reportUsage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ slot: 'backup', model: 'claude-backup', status: 'succeeded' })
    )
  })

  it('maps OpenAI text, tool calls, usage, and finish reason', async () => {
    mocks.providers = [openAIProvider]
    mocks.openAIStreamFactory.mockResolvedValue(
      createOpenAIStream([
        { choices: [{ delta: { content: 'checking' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call_1', function: { name: 'run_command', arguments: '{"cmd"' } }]
              }
            }
          ]
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"pwd"}' } }] } }] },
        {
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 12, completion_tokens: 4 }
        }
      ])
    )

    chatermBridgeService.start()
    const events = await execute({
      requestId: 'openai-1',
      modelId: 'gpt-4.1',
      messages: [{ role: 'user', content: 'pwd' }]
    })

    expect(events).toContainEqual({ type: 'text', delta: 'checking' })
    expect(events).toContainEqual({ type: 'tool_use_start', toolCallId: 'call_1', name: 'run_command' })
    expect(events).toContainEqual({ type: 'tool_use_delta', toolCallId: 'call_1', inputJsonDelta: '{"cmd"' })
    expect(events).toContainEqual({ type: 'tool_use_end', toolCallId: 'call_1', finalInput: { cmd: 'pwd' } })
    expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 4 })
    expect(events.at(-1)).toEqual({ type: 'end', finishReason: 'tool_use' })
  })

  it('forwards reasoning deltas from reasoning models as reasoning events', async () => {
    mocks.providers = [openAIProvider]
    mocks.openAIStreamFactory.mockResolvedValue(
      createOpenAIStream([
        { choices: [{ delta: { content: '', reasoning_content: 'let me think' } }] },
        { choices: [{ delta: { reasoning_content: ' about this' } }] },
        { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }
      ])
    )

    chatermBridgeService.start()
    const events = await execute({
      requestId: 'openai-reasoning-1',
      modelId: 'gpt-4.1',
      messages: [{ role: 'user', content: 'why?' }]
    })

    expect(events).toContainEqual({ type: 'reasoning', delta: 'let me think' })
    expect(events).toContainEqual({ type: 'reasoning', delta: ' about this' })
    expect(events).toContainEqual({ type: 'text', delta: 'answer' })
    expect(events.at(-1)).toEqual({ type: 'end', finishReason: 'stop' })
  })

  const textOf = (events: BridgeStreamEvent[]): string =>
    events
      .filter((event): event is Extract<BridgeStreamEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.delta)
      .join('')

  it('unwraps a JSON-encoded content-parts array returned in one chunk', async () => {
    mocks.providers = [openAIProvider]
    const answer = '当前活跃端口：\n| 端口 | 进程 |\n|------|------|\n| 22 | ssh |'
    const wrapped = JSON.stringify([{ type: 'text', text: answer }])
    mocks.openAIStreamFactory.mockResolvedValue(
      createOpenAIStream([
        { choices: [{ delta: { content: wrapped } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 9 } }
      ])
    )

    chatermBridgeService.start()
    const events = await execute({
      requestId: 'openai-wrapped-1',
      modelId: 'gpt-4.1',
      messages: [{ role: 'user', content: 'ports' }]
    })

    expect(textOf(events)).toBe(answer)
    expect(textOf(events)).not.toContain('"type"')
  })

  it('unwraps a content-parts array streamed across multiple chunks', async () => {
    mocks.providers = [openAIProvider]
    const answer = 'Ports:\n| port | proc |\n|------|------|\n| 22 | ssh |'
    const wrapped = JSON.stringify([{ type: 'text', text: answer }])
    const fragments = [wrapped.slice(0, 5), wrapped.slice(5, 21), wrapped.slice(21)]
    mocks.openAIStreamFactory.mockResolvedValue(
      createOpenAIStream([
        ...fragments.map((content) => ({ choices: [{ delta: { content } }] })),
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
    )

    chatermBridgeService.start()
    const events = await execute({
      requestId: 'openai-wrapped-2',
      modelId: 'gpt-4.1',
      messages: [{ role: 'user', content: 'ports' }]
    })

    expect(textOf(events)).toBe(answer)
  })

  it('extracts text from a structured content-parts array delta', async () => {
    mocks.providers = [openAIProvider]
    mocks.openAIStreamFactory.mockResolvedValue(
      createOpenAIStream([
        {
          choices: [
            {
              delta: {
                content: [
                  { type: 'text', text: 'hello ' },
                  { type: 'text', text: 'world' }
                ]
              }
            }
          ]
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
    )

    chatermBridgeService.start()
    const events = await execute({
      requestId: 'openai-array-1',
      modelId: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }]
    })

    expect(textOf(events)).toBe('hello world')
  })

  it('passes through plain-text answers that begin with a bracket', async () => {
    mocks.providers = [openAIProvider]
    const answer = '[1, 2, 3] is the JSON array example you asked about.'
    mocks.openAIStreamFactory.mockResolvedValue(
      createOpenAIStream([
        { choices: [{ delta: { content: answer } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
    )

    chatermBridgeService.start()
    const events = await execute({
      requestId: 'openai-bracket-1',
      modelId: 'gpt-4.1',
      messages: [{ role: 'user', content: 'json' }]
    })

    expect(textOf(events)).toBe(answer)
  })

  it('keeps concurrent OpenAI request streams isolated by requestId', async () => {
    mocks.providers = [openAIProvider]
    mocks.openAIStreamFactory.mockImplementation((params) =>
      Promise.resolve(
        createOpenAIStream([
          { choices: [{ delta: { content: `${params.model}:` } }] },
          {
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 }
          }
        ])
      )
    )

    chatermBridgeService.start()
    listeners[INTERNAL_CHANNELS.Execute]({}, {
      requestId: 'req-a',
      modelId: 'gpt-4.1',
      messages: [{ role: 'user', content: 'a' }]
    } satisfies CreateMessageRequest)
    listeners[INTERNAL_CHANNELS.Execute]({}, {
      requestId: 'req-b',
      modelId: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'b' }]
    } satisfies CreateMessageRequest)

    await waitFor(() => eventsFor('req-a').some((event) => event.type === 'end'), 'expected req-a to end')
    await waitFor(() => eventsFor('req-b').some((event) => event.type === 'end'), 'expected req-b to end')

    expect(eventsFor('req-a')).toContainEqual({ type: 'text', delta: 'gpt-4.1:' })
    expect(eventsFor('req-b')).toContainEqual({ type: 'text', delta: 'gpt-4.1-mini:' })
    expect(eventsFor('req-a')).not.toContainEqual({ type: 'text', delta: 'gpt-4.1-mini:' })
    expect(eventsFor('req-b')).not.toContainEqual({ type: 'text', delta: 'gpt-4.1:' })
  })

  it('emits abort end immediately and drops later provider events', async () => {
    let resumeStream: (() => void) | undefined
    mocks.providers = [anthropicProvider]
    mocks.anthropicStreamFactory.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'before-abort' } }
        await new Promise<void>((resolve) => {
          resumeStream = resolve
        })
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'after-abort' } }
      },
      finalMessage: vi.fn(async () => ({ usage: { input_tokens: 1, output_tokens: 1 } }))
    })

    chatermBridgeService.start()
    listeners[INTERNAL_CHANNELS.Execute]({}, {
      requestId: 'abort-1',
      modelId: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'stop' }]
    } satisfies CreateMessageRequest)
    await waitFor(
      () => eventsFor('abort-1').some((event) => event.type === 'text' && event.delta === 'before-abort'),
      'expected first text before abort'
    )

    listeners[INTERNAL_CHANNELS.Abort]({}, { requestId: 'abort-1' })
    expect(eventsFor('abort-1').at(-1)).toEqual({ type: 'end', finishReason: 'abort' })

    resumeStream?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(eventsFor('abort-1')).not.toContainEqual({ type: 'text', delta: 'after-abort' })
  })
})
