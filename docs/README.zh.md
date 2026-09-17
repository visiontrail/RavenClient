<h1 align="center">
  <img src="../build/icon.png" width="120" height="120" alt="Raven 图标" /><br>
  RavenClient
</h1>

<p align="center">
  Raven 智能测试平台的原生桌面工作台
</p>

<p align="center">
  <a href="../README.md">English</a> | 简体中文 | <a href="./dev.md">开发文档</a>
</p>

## 项目定位

RavenClient 是 Raven 智能测试平台的跨平台桌面工作台，**[RavenAIService](https://github.com/visiontrail/RavenAIService)** 则是该平台的核心服务仓库。RavenAIService 以项目为主线，将专业 Agent、日志、连接设备、代码仓库、软件包与发布资产串联为完整的智能测试流程；RavenClient 为 Windows、macOS 和 Linux 用户提供原生入口，并把平台的服务端能力与本地对话、知识库、文件和终端体验结合起来。

RavenAIService 不只是一个 API 后端。其仓库同时包含 FastAPI 业务服务、Vue Web 控制台、多 Agent 引擎，以及用于异步日志处理和 AI 分析的 Celery/Redis 任务体系。平台以项目作为组织单元，将日志、代码仓库、Agent 技能、分析结论、软件包和设备操作纳入统一上下文；RavenClient 通过接口和流式 Agent 工作流使用这些能力，不在本地重复实现平台逻辑。

因此，RavenClient 不定位为可独立运行的通用多模型客户端。登录和使用 AI 功能必须连接兼容且可访问的 RavenAIService，模型服务商与凭据由平台集中管理，无需在桌面端自行配置。

两个仓库共同组成一套配套系统：

- **[RavenAIService](https://github.com/visiontrail/RavenAIService)** 是平台核心，负责身份与模型路由、项目级日志/仓库/Agent 技能、多 Agent 执行与会话状态、设备连接、软件包与发布资产，以及集中用量数据。
- **RavenClient** 是平台的原生客户端，负责 Electron 桌面外壳、本地工作区与知识能力、桌面交互、操作系统集成和内嵌 Chaterm 终端。
- RavenClient 通过认证 REST API、SSE 事件流和 RavenClient AI 能力契约，呈现代码专家、日志分析、包检索、日志与软件包页面及托管模型调用等 RavenAIService 工作流，因此客户端与服务端版本应保持接口兼容。

## 客户端与服务端架构

```text
RavenClient
├── Raven 账号登录与注册 ─────────────────────┐
├── 助手对话与模型调用 ───────────────────────┤
├── 服务端智能体工作台 ───────────────────────┤── RavenAIService
├── 项目、软件包与日志页面 ───────────────────┤   （身份、模型、
└── 内嵌 Chaterm AI 桥接 ─────────────────────┘    项目上下文、Agent、
                                                    日志、设备与资产）

本地桌面能力：界面状态、本地文件与知识库、操作系统集成、
SSH 会话以及内嵌 Chaterm 运行时。
```

RavenAIService 还提供独立的浏览器控制台，以及通用 Agent 路由、设备操作、Bug 修复辅助、平台管理和发布管理等更多工作流。RavenClient 是与其互补的桌面入口，并不替代 RavenAIService 或它的 Web 控制台。

认证成功后，RavenClient 会从 RavenAIService 获取带有效期的模型能力快照，其中包含主备路由、模型能力和快速模型。服务商凭据仅保存在内存中，客户端会自动刷新，并在退出登录或凭据过期时清除；公开的 Redux 服务商状态中不会保存密钥。助手与终端的 AI 用量会统一回报给服务端。

## 核心功能

### 统一 Raven 账号

- 由 RavenAIService 支持的全局登录与注册门禁。
- 支持会话恢复、主动退出、登录过期处理和连接重试。
- 助手、智能体、文件、日志、软件包和终端 AI 共用同一账号与服务地址。

### 服务端统一管理 AI

- 登录后从 RavenAIService 同步助手模型及其能力。
- 定时刷新能力配置，并在应用重新获得焦点时主动刷新。
- 在尚未输出回答时支持主路由失败后自动切换备用路由。
- 无需本地配置模型服务商，调用用量与故障结果由服务端集中记录。

### RavenAIService 智能体工作台

- **项目专家**：结合指定代码仓库回答技术问题。
- **日志分析**：支持可选项目上下文以及日志或压缩包上传。
- **软件包搜索**：面向项目的软件包检索。
- 通过 SSE 实时展示回答、推理、计划、工具活动和执行轨迹。
- 服务端会话历史支持多轮续聊、重命名、置顶、删除、取消及活跃任务恢复。

### AI 集成终端

- 内嵌 [Chaterm](https://github.com/visiontrail/ChatermForRaven)，支持 SSH/SFTP、跳板机、Kubernetes exec 和多面板会话。
- AI 命令生成、解释、故障排查和智能体操作均通过受保护的 Raven LLM 桥接复用 RavenAIService 管理的模型。
- 模型列表包含服务端的主模型、备用模型及其快速模型；请求优先使用所选模型，尚未开始输出内容或工具调用时可切换到其他路由。
- 智能体命令会在可见终端中执行；推理流和 OpenAI 兼容的内容分片流会在展示前自动规范化。
- 切换 Raven 页面时终端会话保持在线，内嵌界面会跟随 Raven 主题。

更多实现与使用说明见[终端文档](./terminal-tab.md)。

### 桌面工程工作台

- 助手对话支持多模态输入、本地知识库、文档解析、OCR、联网搜索、记忆和 MCP 工具。
- 提供文件管理，以及跟随统一服务地址的 RavenAIService 日志、软件包和重构页面。
- 提供面向具体产品的软件包构建流程和原生桌面集成。

## 环境要求

- 可用且兼容的 RavenAIService 实例，以及有效的 Raven 账号。
- Node.js 22 或更高版本。
- Yarn 4.9.1。
- 用于内嵌 Chaterm 运行时的 Git 子模块。

## 开发环境搭建

```bash
git clone --recurse-submodules git@github.com:visiontrail/RavenClient.git
cd RavenClient
corepack enable
corepack prepare yarn@4.9.1 --activate
yarn install
```

RavenClient 默认连接 `http://127.0.0.1:8085`。启动前可以通过以下任一方式连接其他 RavenAIService 部署：

```bash
# 完整 URL，优先级最高
export RAVEN_AI_SERVICE_BASE_URL=http://your-raven-service:8085

# 或分别配置主机和端口
export RAVEN_AI_SERVICE_HOST=your-raven-service
export RAVEN_AI_SERVICE_PORT=8085

yarn dev
```

服务地址由客户端统一解析，因此智能体、日志、软件包和内嵌服务页面会一起切换。

`yarn dev` 和 `yarn debug` 会先重新构建内嵌 ChaTerm，并将产物复制到 `resources/chaterm`，再启动 Electron。修改 ChaTerm 源码后，请停止并重新运行启动命令；仅刷新窗口不会重新构建内嵌终端。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `yarn dev` | 以开发模式启动 Electron |
| `yarn debug` | 以调试模式启动 |
| `yarn test` | 运行 Vitest 测试 |
| `yarn test:e2e` | 运行 Playwright 端到端测试 |
| `yarn typecheck` | 检查主进程与渲染进程的类型 |
| `yarn lint` | 执行代码检查、类型检查和翻译校验 |
| `yarn build` | 构建应用 |
| `yarn build:win` | 打包 Windows 版本 |
| `yarn build:mac` | 打包 macOS 版本 |
| `yarn build:linux` | 打包 Linux 版本 |

生产构建会自动编译并打包 Chaterm 子模块。如果子模块缺失，请执行 `git submodule update --init --recursive`。

## 技术栈

- Electron 41、React 19 与 TypeScript。
- Electron Vite、Redux Toolkit、Redux Persist 与 styled-components。
- Vitest 与 Playwright。
- 内嵌 Vue Chaterm 运行时，并通过校验消息发送方的 Electron IPC 通信。
- RavenAIService REST API 与 SSE 数据流。

## 参与贡献

所有修改都应维护 RavenClient 与 RavenAIService 的接口契约，确保账号、模型、智能体及服务地址行为与后端保持一致。提交 Pull Request 前请阅读[开发文档](./dev.md)和 [AGENTS.md](../AGENTS.md)。

## 开源协议

本项目采用 [GPL-3.0 License](../LICENSE)。
