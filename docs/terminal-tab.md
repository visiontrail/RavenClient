# Terminal Tab (Chaterm Integration)

Raven embeds [Chaterm](https://github.com/visiontrail/ChatermForRaven) — an AI-native SSH terminal — as a first-class tab in the main sidebar.

## Features

- **SSH / SFTP connections**: Create and manage remote server connections with key or password authentication
- **Bastion / Jump-host support**: Multi-hop SSH through bastion hosts
- **Kubernetes exec**: Connect to running pods via `kubectl exec`
- **AI-powered terminal**: Ask questions, generate commands, and debug issues using Raven's configured AI models — no separate API key setup needed
- **Multi-panel layout**: Open multiple terminal sessions side-by-side (Dockview)
- **Session persistence**: SSH sessions remain alive when you switch to another Raven tab

## How AI Works in Terminal

Chaterm's AI features (command generation, error explanation, agent actions) all use the LLM provider you configure in **Raven Settings → Models**. You do not need to configure any AI keys inside the Terminal tab.

Token usage from Terminal AI calls appears in Raven's usage statistics with `source = "chaterm"`.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `terminal.enabled` | `true` | Show/hide the Terminal tab in the sidebar. Disabling also disconnects active SSH sessions. |

To access settings: **Raven Settings → Display → Sidebar icons** (drag Terminal to visible/hidden).

## Known Limitations

- Models without tool-calling support (e.g. some Gemini variants) cannot run Chaterm's agent loop. An in-app notice will appear if your default model lacks this capability.
- The Terminal tab requires Chaterm build artifacts in `resources/chaterm/`. In development builds without a Chaterm build, the tab displays a "Coming soon" placeholder.
- Chaterm's own theme/language controls are hidden in embedded mode — appearance follows Raven's settings.
- MCP server configurations from Raven are not shared with Chaterm in this release; Chaterm maintains its own MCP config.

## Architecture Notes (for developers)

- Chaterm renders in an Electron `<webview>` at `raven-chaterm://app/index.html`; it is a separate renderer process and its crash does not affect Raven's main window
- IPC channels: `raven:llm:*` (LLM bridge), `raven:ui:*` (theme/locale/navigate), `chaterm:*` (Chaterm internals — sender-validated)
- Main process services: `RavenLLMBridgeService`, `ChatermProcessService`
- Source: `src/renderer/src/pages/terminal/`, `src/main/services/RavenLLMBridgeService.ts`, `src/main/services/ChatermProcessService.ts`
- Chaterm submodule: `third_party/ChatermForRaven/` (branch `raven-embed`)

### Terminal scope

The embedded terminal does not expose the Database management workspace or SQL editor. Internal storage for terminal settings and history remains enabled.
