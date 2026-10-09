// don't reorder this file, it's used to initialize the app data dir and
// other which should be run before the main process is ready
// eslint-disable-next-line
import './bootstrap'

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import '@main/config'

import { loggerService } from '@logger'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { replaceDevtoolsFont } from '@main/utils/windowUtil'
import { IpcChannel } from '@shared/IpcChannel'
import { app, ipcMain, webContents } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'

import { isDev, isLinux, isWin } from './constant'
import { registerIpc } from './ipc'
import { ChatermProcessService, type ChatermMountFn, type ChatermUnmountFn } from './services/ChatermProcessService'
import { registerChatermProtocolScheme } from './services/chaterm/protocol'
import { configManager } from './services/ConfigManager'
import mcpService from './services/MCPService'
import { nodeTraceService } from './services/NodeTraceService'
import { packagingService } from './services/packagingService'
import {
  CHERRY_STUDIO_PROTOCOL,
  handleProtocolUrl,
  registerProtocolClient,
  setupAppImageDeepLink
} from './services/ProtocolClient'
import { RendererBridgeProvider } from './services/raven-llm-bridge/RendererBridgeProvider'
import { RavenLLMBridgeService } from './services/RavenLLMBridgeService'
import selectionService, { initSelectionService } from './services/SelectionService'
import { registerShortcuts } from './services/ShortcutService'
import { TrayService } from './services/TrayService'
import { windowService } from './services/WindowService'
import deviceLinkClient from './services/DeviceLinkClient'
import { getResourcePath } from './utils'

const logger = loggerService.withContext('MainEntry')
const chatermMainLogger = loggerService.withContext('main')
const dynamicRequire = createRequire(import.meta.url)
const nodeModule = dynamicRequire('node:module') as typeof import('node:module') & {
  Module: { _initPaths(): void }
}

interface ChatermMainModule {
  mountChaterm?: ChatermMountFn
  unmountChaterm?: ChatermUnmountFn
}

type ChatermEdition = 'cn' | 'global'

function resolveChatermEmbeddedEdition(): ChatermEdition {
  const explicitEdition = process.env.CHATERM_EMBEDDED_EDITION || process.env.APP_EDITION
  return explicitEdition === 'global' ? 'global' : 'cn'
}

function configureChatermEmbeddedEnv(): ChatermEdition {
  const edition = resolveChatermEmbeddedEdition()
  process.env.CHATERM_EMBEDDED = '1'
  process.env.CHATERM_EMBEDDED_EDITION = edition
  process.env.APP_EDITION = edition
  return edition
}

function appendNodePath(modulePath: string): void {
  if (!existsSync(modulePath)) return

  const paths = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter).filter(Boolean) : []
  if (paths.includes(modulePath)) return

  process.env.NODE_PATH = [...paths, modulePath].join(path.delimiter)
  nodeModule.Module._initPaths()
  logger.info('Chaterm module resolution path added', { path: modulePath })
}

function appendChatermDependencyPaths(): void {
  if (app.isPackaged) {
    appendNodePath(path.join(process.resourcesPath, 'chaterm', 'node_modules'))
    appendNodePath(path.join(process.resourcesPath, 'app.asar', 'third_party', 'ChatermForRaven', 'node_modules'))
    appendNodePath(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'third_party', 'ChatermForRaven', 'node_modules')
    )
    return
  }

  appendNodePath(path.join(app.getAppPath(), 'third_party', 'ChatermForRaven', 'node_modules'))
}

function loadChatermMainEntry(
  entry: string,
  cwd?: string
): { mountChaterm: ChatermMountFn; unmountChaterm: ChatermUnmountFn } | null {
  try {
    if (!existsSync(entry)) {
      chatermMainLogger.warn('chaterm.main.load.skipped', {
        path: entry,
        error: 'Chaterm main bundle not found'
      })
      return null
    }

    const previousCwd = process.cwd()
    const shouldSwitchCwd = !!cwd && existsSync(cwd) && previousCwd !== cwd
    let mod: ChatermMainModule
    try {
      if (shouldSwitchCwd) {
        process.chdir(cwd)
      }
      mod = dynamicRequire(entry) as ChatermMainModule
    } finally {
      if (shouldSwitchCwd) {
        process.chdir(previousCwd)
      }
    }
    if (typeof mod.mountChaterm !== 'function' || typeof mod.unmountChaterm !== 'function') {
      chatermMainLogger.error(
        'chaterm.main.load.failed',
        new Error('Chaterm main bundle does not export mountChaterm/unmountChaterm'),
        {
          path: entry,
          error: 'Chaterm main bundle does not export mountChaterm/unmountChaterm'
        }
      )
      return null
    }

    logger.info('Chaterm main bundle loaded', { path: entry, cwd })
    return { mountChaterm: mod.mountChaterm, unmountChaterm: mod.unmountChaterm }
  } catch (err) {
    chatermMainLogger.error('chaterm.main.load.failed', err as Error, {
      path: entry,
      error: (err as Error).message
    })
    return null
  }
}

function loadChatermMain(): { mountChaterm: ChatermMountFn; unmountChaterm: ChatermUnmountFn } | null {
  const edition = configureChatermEmbeddedEnv()
  appendChatermDependencyPaths()

  const entry = app.isPackaged
    ? path.join(process.resourcesPath, 'chaterm', 'main', 'index.js')
    : path.join(getResourcePath(), 'chaterm', 'main', 'index.js')
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'chaterm')
    : path.join(getResourcePath(), 'chaterm')
  process.env.CHATERM_EMBEDDED_RESOURCES_PATH = resourcesPath

  logger.info('Chaterm embedded environment configured', { edition, resourcesPath })

  if (!app.isPackaged) {
    const chatermProjectPath = path.join(app.getAppPath(), 'third_party', 'ChatermForRaven')

    const embeddedResources = loadChatermMainEntry(entry, chatermProjectPath)
    if (embeddedResources) {
      return embeddedResources
    }

    const devEntry = path.join(chatermProjectPath, 'out', 'main', 'index.js')
    const loaded = loadChatermMainEntry(devEntry, chatermProjectPath)
    if (loaded) {
      return loaded
    }
  }

  return loadChatermMainEntry(entry)
}

/**
 * Disable hardware acceleration if setting is enabled
 */
const disableHardwareAcceleration = configManager.getDisableHardwareAcceleration()
if (disableHardwareAcceleration) {
  app.disableHardwareAcceleration()
}

/**
 * Disable chromium's window animations
 * main purpose for this is to avoid the transparent window flashing when it is shown
 * (especially on Windows for SelectionAssistant Toolbar)
 * Know Issue: https://github.com/electron/electron/issues/12130#issuecomment-627198990
 */
if (isWin) {
  app.commandLine.appendSwitch('wm-window-animations-disabled')
}

/**
 * Enable GlobalShortcutsPortal for Linux Wayland Protocol
 * see: https://www.electronjs.org/docs/latest/api/global-shortcut
 */
if (isLinux && process.env.XDG_SESSION_TYPE === 'wayland') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}

// DocumentPolicyIncludeJSCallStacksInCrashReports: Enable features for unresponsive renderer js call stacks
// EarlyEstablishGpuChannel,EstablishGpuChannelAsync: Enable features for early establish gpu channel
// speed up the startup time
// https://github.com/microsoft/vscode/pull/241640/files
app.commandLine.appendSwitch(
  'enable-features',
  'DocumentPolicyIncludeJSCallStacksInCrashReports,EarlyEstablishGpuChannel,EstablishGpuChannelAsync'
)
app.on('web-contents-created', (_, webContents) => {
  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Document-Policy': ['include-js-call-stacks-in-crash-reports']
      }
    })
  })

  webContents.on('unresponsive', async () => {
    // Interrupt execution and collect call stack from unresponsive renderer
    logger.error('Renderer unresponsive start')
    const callStack = await webContents.mainFrame.collectJavaScriptCallStack()
    logger.error(`Renderer unresponsive js call stack\n ${callStack}`)
  })
})

// in production mode, handle uncaught exception and unhandled rejection globally
if (!isDev) {
  // handle uncaught exception
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error)
  })

  // handle unhandled rejection
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`)
  })
}

// Privileged scheme registration MUST happen before app.whenReady() — Electron
// freezes the scheme list at ready time.
registerChatermProtocolScheme()

// Long-lived services. Constructed before whenReady so quit hooks can reach them
// even on a failure during initialization.
const ravenLLMBridgeService = new RavenLLMBridgeService()
let ravenRendererBridgeProvider: RendererBridgeProvider | null = null
let chatermProcessService = new ChatermProcessService({ bridge: ravenLLMBridgeService })

// Check for single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
} else {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.

  app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.kangfenmao.CherryStudio')

    // Mac: Hide dock icon before window creation when launch to tray is set
    const isLaunchToTray = configManager.getLaunchToTray()
    if (isLaunchToTray) {
      app.dock?.hide()
    }

    const mainWindow = windowService.createMainWindow()
    new TrayService()

    nodeTraceService.init()

    app.on('activate', function () {
      const mainWindow = windowService.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        windowService.createMainWindow()
      } else {
        windowService.showMainWindow()
      }
    })

    registerShortcuts(mainWindow)

    registerIpc(mainWindow, app)
    deviceLinkClient.start(mainWindow)

    replaceDevtoolsFont(mainWindow)

    // Setup deep link for AppImage on Linux
    await setupAppImageDeepLink()

    // Enable devtools extensions only when explicitly allowed
    if (isDev && process.env.ENABLE_DEVTOOLS_EXTENSIONS === '1') {
      installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
        .then((name) => logger.info(`Added Extension:  ${name}`))
        .catch((err) => logger.error('An error occurred: ', err))
    }

    //start selection assistant service
    initSelectionService()

    // Initialize packaging service
    try {
      await packagingService.initialize()
      logger.info('Packaging service initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize packaging service:', error as Error)
    }

    // Initialize Raven LLM bridge & Chaterm process service (no-op if Chaterm
    // assets are missing). Per spec §D9 a missing resources/chaterm/ MUST NOT
    // crash Raven — assets check inside start() handles that.
    try {
      ravenRendererBridgeProvider?.destroy()
      ravenRendererBridgeProvider = new RendererBridgeProvider(() => {
        const currentWindow = windowService.getMainWindow()
        if (currentWindow && !currentWindow.isDestroyed()) {
          return currentWindow.webContents
        }
        if (!mainWindow.isDestroyed()) {
          return mainWindow.webContents
        }
        return null
      })
      ravenRendererBridgeProvider.start()
      ravenLLMBridgeService.setProvider(ravenRendererBridgeProvider)
      logger.info('Raven LLM bridge renderer provider configured')

      const chatermMain = loadChatermMain()
      chatermProcessService = new ChatermProcessService({
        bridge: ravenLLMBridgeService,
        mount: chatermMain?.mountChaterm,
        unmount: chatermMain?.unmountChaterm
      })
      ravenLLMBridgeService.start()
      await chatermProcessService.start()
      logger.info('Chaterm process service started', { enabled: chatermProcessService.isEnabled() })
    } catch (error) {
      logger.error('Failed to start Chaterm process service:', error as Error)
    }

    // §6: Chaterm renderer↔main IPC handlers (called from Raven renderer, not from the webview)
    ipcMain.handle(IpcChannel.Chaterm_GetStatus, () => ({
      isEnabled: chatermProcessService.isEnabled(),
      hasAssets: chatermProcessService.hasAssets(),
      preloadPath: chatermProcessService.getPreloadPath()
    }))

    ipcMain.handle(IpcChannel.Chaterm_AttachWebview, async (_event, webContentsId: number) => {
      const wc = webContents.fromId(webContentsId)
      if (!wc) {
        throw new Error(`No webContents found for id=${webContentsId}`)
      }
      await chatermProcessService.attachWebview(wc, {
        onCrashed: (details) => {
          // Forward crash notification to the Raven renderer so TerminalPage can show the crash UI
          mainWindow.webContents.send('chaterm:webview-crashed', details)
        }
      })
    })

    ipcMain.handle(IpcChannel.Chaterm_DetachWebview, async () => {
      await chatermProcessService.detachWebview('renderer-requested')
    })

    // Forward raven:ui:navigate from Chaterm webview → Raven renderer.
    // Chaterm preload calls ipcRenderer.send('raven:ui:navigate', path) which
    // arrives here via the main process; we relay it to the host window.
    ipcMain.on(IpcChannel.Raven_UI_Navigate, (_event, path: string) => {
      mainWindow.webContents.send(IpcChannel.Raven_UI_Navigate, path)
    })
  })

  registerProtocolClient(app)

  // macOS specific: handle protocol when app is already running

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolUrl(url)
  })

  const handleOpenUrl = (args: string[]) => {
    const url = args.find((arg) => arg.startsWith(CHERRY_STUDIO_PROTOCOL + '://'))
    if (url) handleProtocolUrl(url)
  }

  // for windows to start with url
  handleOpenUrl(process.argv)

  // Listen for second instance
  app.on('second-instance', (_event, argv) => {
    windowService.showMainWindow()

    // Protocol handler for Windows/Linux
    // The commandLine is an array of strings where the last item might be the URL
    handleOpenUrl(argv)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('before-quit', () => {
    app.isQuitting = true

    // quit selection service
    if (selectionService) {
      selectionService.quit()
    }

    deviceLinkClient.stop()
  })

  app.on('will-quit', async () => {
    // 简单的资源清理，不阻塞退出流程
    try {
      await mcpService.cleanup()
      packagingService.cleanup()
    } catch (error) {
      logger.warn('Error cleaning up MCP service:', error as Error)
    }
    // Chaterm cleanup is capped at 3s (spec §5.6) so it never blocks quit.
    try {
      await chatermProcessService.destroy()
      ravenRendererBridgeProvider?.destroy()
      ravenRendererBridgeProvider = null
      ravenLLMBridgeService.destroy()
    } catch (error) {
      logger.warn('Error cleaning up Chaterm services:', error as Error)
    }
    // finish the logger
    logger.finish()
  })

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.
}
