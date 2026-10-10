import { pathToFileURL } from 'node:url'

import type { WebPreferences } from 'electron'

/** 仅为使用本地指定预加载的内嵌终端启用 Node 预加载环境。 */
export function configureChatermWebview(
  preferences: WebPreferences,
  params: { partition?: string; src?: string; preload?: string },
  expectedPreloadPath: string
): boolean {
  // will-attach-webview 会将 preload 规范化为 webPreferences.preloadURL。
  const preload =
    params.preload || (preferences as WebPreferences & { preloadURL?: string }).preloadURL || preferences.preload
  const trustedPreload = preload === expectedPreloadPath || preload === pathToFileURL(expectedPreloadPath).href
  const trustedSource = params.src === 'about:blank' || params.src?.startsWith('raven-chaterm://app/')
  if (params.partition !== 'persist:chaterm' || !trustedPreload || !trustedSource) return false

  preferences.contextIsolation = true
  preferences.nodeIntegration = false
  preferences.sandbox = false
  const argumentsList = Array.isArray(preferences.additionalArguments) ? preferences.additionalArguments : []
  preferences.additionalArguments = [...new Set([...argumentsList, '--chaterm-embedded=1'])]
  return true
}
