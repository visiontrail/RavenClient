<h1 align="center">
  <img src="./build/icon.png" width="120" height="120" alt="Raven logo" /><br>
  RavenClient
</h1>

<p align="center">
  The native desktop workspace for the Raven intelligent testing platform
</p>

<p align="center">
  English | <a href="./docs/README.zh.md">简体中文</a> | <a href="./docs/dev.md">Development</a>
</p>

## Overview

RavenClient is the cross-platform desktop workspace for the Raven intelligent testing platform, whose core service repository is **[RavenAIService](https://github.com/visiontrail/RavenAIService)**. RavenAIService brings project context, specialized Agents, logs, connected devices, code repositories, software packages, and release assets into one testing workflow. RavenClient provides a native Windows, macOS, and Linux entry point to that platform, combining its server-backed capabilities with local chat, knowledge, file, and terminal experiences.

RavenAIService is more than an API backend. Its repository contains the FastAPI business service, a Vue web console, a multi-Agent engine, and Celery/Redis workers for asynchronous log processing and AI analysis. Projects are the organizing unit: each project can bring together logs, repositories, Agent skills, analysis results, packages, and device operations. RavenClient consumes the relevant APIs and streaming Agent workflows rather than duplicating that platform logic locally.

RavenClient is therefore not designed as a standalone, general-purpose multi-provider client. A compatible and reachable RavenAIService deployment is required to sign in and use AI features. Model providers and credentials are managed centrally instead of being configured in the desktop application.

The two repositories are developed as a paired system:

- **[RavenAIService](https://github.com/visiontrail/RavenAIService)** is the platform core. It owns identity and model routing; project-scoped logs, repositories, and Agent skills; multi-Agent execution and conversation state; device links; package and release assets; and centralized usage data.
- **RavenClient** is a native platform client. It owns the Electron shell, local workspace and knowledge capabilities, desktop interaction, operating-system integration, and the embedded Chaterm terminal.
- RavenClient exposes selected RavenAIService workflows—including Project Expert, Log Analysis, Package Search, log and package views, and managed model execution—through authenticated REST APIs, SSE event streams, and the RavenClient AI capability contract. Client and service versions should therefore remain API-compatible.

## Client–Service Architecture

```text
RavenClient
├── Raven account login and registration ───────┐
├── Assistant chat and model execution ─────────┤
├── Server-backed Agent workbench ──────────────┤── RavenAIService
├── Project, package, and log views ────────────┤   (identity, models,
└── Embedded Chaterm AI bridge ─────────────────┘    project context, Agents,
                                                      logs, devices, assets)

Local desktop capabilities: UI state, local files and knowledge bases,
native OS integration, SSH sessions, and embedded Chaterm runtime.
```

RavenAIService also has its own browser-based console and additional platform workflows, such as general Agent routing, device operations, bug-fix assistance, administration, and release management. RavenClient is a complementary desktop surface, not a replacement for the service or its web console.

After authentication, RavenClient fetches a time-limited model capability snapshot from RavenAIService. The snapshot defines the primary and backup routes, model capabilities, and fast model. Provider credentials are kept in memory, refreshed automatically, cleared on logout or expiry, and never exposed in the public Redux provider state. Assistant and Terminal usage is reported back to the service.

## Features

### Unified Raven Account

- Application-wide login and registration gate backed by RavenAIService.
- Persisted session restoration, explicit logout, expired-session handling, and connection retry.
- One account and one service endpoint shared by Assistant chat, Agents, files, logs, packages, and Terminal AI.

### Centrally Managed AI

- Assistant models and capabilities are synchronized from RavenAIService after login.
- Automatic capability refresh on a schedule and when the application regains focus.
- Primary/backup route failover before response output begins.
- Centralized usage and failure reporting without local provider configuration.

### RavenAIService Agent Workbench

- **Project Expert** for repository-aware technical questions.
- **Log Analysis** with optional project context and log/archive upload.
- **Package Search** for project package discovery.
- Server-Sent Events (SSE) streaming for answers, reasoning, plans, tool activity, and execution traces.
- Server-backed conversation history with multi-turn continuation, rename, pin, delete, cancel, and active-run resume.

### AI-Powered Terminal

- Embedded [Chaterm](https://github.com/visiontrail/ChatermForRaven) with SSH/SFTP, jump hosts, Kubernetes exec, and multi-panel sessions.
- AI command generation, explanation, troubleshooting, and Agent actions use RavenAIService-managed models through Raven's guarded LLM bridge.
- The model selector includes primary and backup models, including their fast models. Requests try the selected model first and can fall back before any response or tool call starts.
- Agent commands run in the visible terminal; reasoning streams and OpenAI-compatible content-part streams are normalized for display.
- Terminal sessions remain alive while switching tabs, and the embedded UI follows Raven's theme.

See [Terminal documentation](./docs/terminal-tab.md) for implementation and usage details.

### Desktop Engineering Workspace

- Assistant chat with multimodal input, local knowledge bases, document parsing, OCR, web search, memory, and MCP tools.
- File management plus RavenAIService-backed log, package, and refactoring views that follow the configured service endpoint.
- Product-specific package-building workflows and native desktop integrations.

## Requirements

- A compatible RavenAIService instance and a valid Raven account.
- Node.js 22 or later.
- Yarn 4.9.1.
- Git submodules for the embedded Chaterm runtime.

## Development Setup

```bash
git clone --recurse-submodules git@github.com:visiontrail/RavenClient.git
cd RavenClient
corepack enable
corepack prepare yarn@4.9.1 --activate
yarn install
```

RavenClient connects to `http://127.0.0.1:8085` by default. Point it to another RavenAIService deployment with one of these configurations before starting the app:

```bash
# Complete URL (takes precedence)
export RAVEN_AI_SERVICE_BASE_URL=http://your-raven-service:8085

# Or configure host and port separately
export RAVEN_AI_SERVICE_HOST=your-raven-service
export RAVEN_AI_SERVICE_PORT=8085

yarn dev
```

The service URL is resolved centrally, so Agent, log, package, and embedded service pages all switch together.

`yarn dev` and `yarn debug` rebuild the embedded ChaTerm and copy its output into `resources/chaterm` before starting Electron. After changing ChaTerm source, stop and rerun the command to refresh the embedded terminal; reloading the window alone does not rebuild it.

## Common Commands

| Command | Purpose |
| --- | --- |
| `yarn dev` | Start Electron in development mode |
| `yarn debug` | Start with debugging enabled |
| `yarn test` | Run Vitest tests |
| `yarn test:e2e` | Run Playwright end-to-end tests |
| `yarn typecheck` | Type-check main and renderer processes |
| `yarn lint` | Lint, type-check, and validate translations |
| `yarn build` | Build the application |
| `yarn build:win` | Package for Windows |
| `yarn build:mac` | Package for macOS |
| `yarn build:linux` | Package for Linux |

Production builds compile and package the Chaterm submodule automatically. If the submodule is missing, initialize it with `git submodule update --init --recursive`.

## Technology

- Electron 41, React 19, and TypeScript.
- Electron Vite, Redux Toolkit, Redux Persist, and styled-components.
- Vitest and Playwright.
- Embedded Vue-based Chaterm runtime connected through sender-validated Electron IPC.
- RavenAIService REST APIs and SSE streams.

## Contributing

Changes should preserve the RavenClient–RavenAIService contract and keep account, model, Agent, and service-endpoint behavior aligned with the backend. See [Development](./docs/dev.md) and [AGENTS.md](./AGENTS.md) before submitting a pull request.

## License

This project is licensed under the [GPL-3.0 License](./LICENSE).
