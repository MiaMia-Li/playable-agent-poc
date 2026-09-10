# Playable Agent 技术链路与持久化设计

本文说明从用户在首页点击“新建试玩”开始，需求 Agent、素材分析工具、构建 Agent、数据库和 Blob 存储如何协作。

## 整体职责

系统包含三个协作 Agent：

- **需求 Agent**：理解用户对话和参考素材，维护结构化需求，并产出待用户确认的首次构建方案或 Revision 方案。
- **市场研究 Agent**：仅在显式搜索意图或用户确认建议后，检索受控公开来源并返回结构化候选方向。
- **构建 Agent**：根据用户确认的方案，在 Sandbox 中生成、修改并验证最终 Playable HTML。

二者共享 `lib/playable/playable-agent-adapter.ts` 中的 `PlayableAgentAdapter` 接口：

- `proposeConfirmation()`：运行需求 Agent。
- `build()`：运行构建 Agent。
- `cancel()`：取消当前 Agent 执行。

不同运行模式的具体 Adapter 在 `lib/playable/task-route-handlers.ts` 中装配：

- `CodexPlayableAgent`：线上 OpenAI Responses 实现。
- `CodexCliPlayableAgent`：本地 Codex CLI 实现。
- `LocalDemoAgent`：不调用真实模型的本地演示实现。

## 从首页创建任务

首页交互位于 `components/playable/playable-workspace.tsx`。

用户填写需求并选择图片或视频后，点击“新建试玩”：

1. 前端调用 `POST /api/playable-tasks`。
2. `lib/playable/task-api.ts` 创建任务。
3. 数据库写入一条初始 `phase = draft` 的 `tasks` 记录。
4. 前端逐个上传本轮选择的素材。
5. 所有素材上传成功后跳转到 `/tasks/:taskId`。

素材选择时只保存在浏览器本地；只有用户点击发送后才会真正上传。上传部分失败时，重试会复用已创建的任务，并跳过已经成功的文件。

### 素材存储

上传处理位于 `lib/playable/task-assets.ts`：

- 图片、音频和视频二进制写入 Vercel Private Blob。
- `playable_task_assets` 只保存素材元数据和 Blob `storageKey`。
- 数据库不保存原始文件字节。

## 任务页自动提交初始需求

任务页入口为 `app/tasks/[taskId]/page.tsx`，负责加载：

- 任务状态
- 历史消息
- 已上传素材
- 最新视频分析
- 历史构建版本
- 历史市场研究选择

页面随后渲染：

- 左侧 `ChatWorkspace`
- 右侧 `PlayablePreview`

如果任务尚无历史消息，`ChatWorkspace` 会把首页 prompt 和本轮附件 ID 自动提交到：

```text
POST /api/playable-tasks/:taskId/messages
```

该接口返回 NDJSON 流。前端持续处理：

- `assistant_progress`
- `tool_started`
- `tool_completed`
- `tool_failed`
- `research_progress`
- `research`
- `informational`
- `clarification`
- `confirmation`
- `revision`
- `error`

## 需求 Agent

需求 Agent 的主要实现位于：

- `lib/playable/codex-playable-agent.ts`
- `lib/playable/codex-cli-playable-agent.ts`
- `lib/playable/local-demo-prototype.ts`
- `lib/playable/requirement-tools.ts`

其中 `lib/playable/requirement-tools.ts` 定义：

- Agent 系统指令
- Structured Output Schema
- Requirement Brief 初始化
- 需求业务工具
- 素材分析工具循环
- 工具执行顺序与终态校验

### Agent 输入

需求 Agent 每轮可以获得：

- 当前用户消息
- 历史对话
- 当前 `requirementBrief`
- 当前确认方案
- 待确认 Revision
- 已上传素材元数据
- 当前消息附件 ID
- 是否已有成功产物
- 与最新参考视频匹配的 Gameplay Blueprint
- 本轮已采用并由服务端解析的市场参考方向

### Agent 工具

需求 Agent 可以主动调用：

- `inspect_reference_images`：理解本轮参考图片。
- `analyze_reference_video`：运行 QDAI 视频玩法分析。
- `search_market_references`：按结构化 Search Brief 检索并分析公开市场参考。
- `inspect_uploaded_assets`：检查素材元数据。
- `update_requirement_brief`：更新结构化需求。
- `list_playable_capabilities`：读取可用 Playable 能力。
- `validate_implementation_route`：校验实现路由。
- `ask_user`：请求补充信息。
- `submit_confirmation`：提交首次构建方案。
- `submit_revision`：提交已有 Playable 的修改方案。
- `respond_to_user`：处理普通问答。

图片和视频分析不是由前端自动启动。Agent 必须明确请求工具，服务端执行后再把结构化结果传回 Agent，由 Agent 继续决定是追问用户、提交方案还是提交 Revision。

每轮限制最多执行一次图片分析批次和一次视频分析，且只能分析当前消息明确附带的素材。相同调用会复用本轮缓存，视频分析还通过数据库原子 claim 防止重复执行。

市场搜索同样不是每轮自动运行：用户明确要求搜索时立即执行；仅判断“可能有帮助”时先返回一键审批；需求已经明确、有强参考素材、正在修改已有版本或普通闲聊时跳过。搜索只允许 TikTok Creative Center、Google Ads Transparency、Meta、AppLovin 和 Liftoff 的受控公开域名，24 小时内相同 Search Brief 可复用缓存。

研究结果作为 `research` 消息保存在当前对话中，包含 3–5 个带来源、证据强度、局限和可借鉴亮点的候选。公开趋势不能声称 CTR、CVR、IPM 或 ROAS。研究本身不修改 Requirement Brief；只有用户提交“采用此方向”后，服务端才会根据持久化候选 ID 校验选择，并把解析后的方向交给下一轮需求 Agent。

### 需求 Agent 输出

最终结果有五类：

- `informational`：普通回答，不改变需求阶段。
- `clarification`：向用户追问。
- `research`：返回市场参考分析，不改变 Requirement Brief 或任务阶段。
- `confirmation`：提交首次构建方案。
- `revision`：提交已有 Playable 的修改方案。

服务端会校验 Agent 输出、更新 Requirement Brief、保存 Agent 消息，并执行对应的任务状态迁移。

## Requirement Brief 与 Confirmation

### Requirement Brief

`requirementBrief` 是 Agent 对当前需求的结构化理解，主要包含：

- 玩法概念、核心循环、控制和目标
- 视觉主题、语气和镜头
- 素材情况
- 标题、CTA、语言和商店链接
- 实现约束
- 未解决问题
- exact / approximate / freeform 路由判断

每次有效的需求对话后都会更新。

### Confirmation

`confirmation` 是用户最终确认的可执行构建契约，包含：

- Playable mode
- 素材策略
- 文案和 CTA
- 跳转地址
- 屏幕尺寸
- 网络和交付限制
- 实现路由

简而言之：

- Requirement Brief 表示“Agent 当前如何理解需求”。
- Confirmation 表示“构建 Agent 应按什么配置执行”。

## 视频分析与 QDAI

视频分析实现位于：

- `lib/playable/video-analysis-service.ts`
- `lib/playable/video-gameplay-analyst.ts`
- `lib/playable/video-preprocessor.ts`

处理过程：

1. Agent 请求 `analyze_reference_video`。
2. 服务端验证视频属于当前用户、当前任务和当前消息。
3. 创建或认领 `playable_video_analyses` 记录。
4. ffmpeg 对视频进行抽帧。
5. QDAI 根据按时间排序的帧推断玩法。
6. 生成带时间证据和置信度的 Gameplay Blueprint。
7. Blueprint 写入数据库。
8. 分析结果回到需求 Agent。

视频分析状态：

```text
pending → preprocessing → analyzing → succeeded
                                      └→ failed
```

Gameplay Blueprint 只会在其 `assetId` 与当前最新参考视频匹配时传给需求 Agent和构建 Agent，避免新视频错误复用旧视频结论。

## 用户确认并启动构建

需求 Agent 返回 `confirmation` 后：

```text
draft → awaiting_confirmation
```

用户可以在确认表中修改方案。点击确认后调用：

```text
POST /api/playable-tasks/:taskId/confirm
```

服务端会：

1. 校验 Confirmation Schema。
2. 检查是否存在凭据泄漏。
3. 检查必需素材是否已上传。
4. 创建 `playable_task_builds` 构建记录。
5. 将任务状态改为 `building`。
6. 调度后台 `runConfirmedBuild()`。
7. 立即返回 HTTP 202。

## 构建 Agent

构建主流程位于 `lib/playable/task-api.ts` 的 `runConfirmedBuild()`。

构建 Agent 和 Sandbox 相关代码位于：

- `lib/playable/codex-playable-agent.ts`
- `lib/playable/codex-cli-playable-agent.ts`
- `lib/playable/sandbox-runner.ts`
- `skills/mahjong-pair-match-playable/SKILL.md`

后台构建过程：

1. 读取最终 Confirmation。
2. 从 Blob 加载上传素材。
3. Patch Revision 时读取上一版 HTML。
4. 把配置、素材和 Skill 写入 Sandbox。
5. 构建 Agent 生成或修改 Playable。
6. 执行构建脚本和行为测试。
7. 检查产物大小、离线资源、响应式、静音、交互跳转和凭据泄漏。
8. 将任务状态从 `building` 切换为 `validating`。
9. 验证成功后把产物写入 Blob。
10. 更新数据库状态为 `ready`。

主状态链：

```text
draft
→ awaiting_confirmation
→ building
→ validating
→ ready
```

已有 Playable 的 Revision 状态链：

```text
ready
→ awaiting_revision_confirmation
→ building
→ validating
→ ready
```

任何构建阶段失败都会进入 `failed`，但会保留上一版成功产物，用户仍然可以预览旧版本并重试。

## 数据库保存的信息

Playable 数据模型定义在 `lib/db/schema.ts`，Repository 实现在 `lib/playable/task-repository.ts`。

### `tasks`

保存任务当前状态和最新业务快照：

- 原始 prompt
- `phase`
- `playableMode`
- `requirementBrief` JSONB
- `confirmation` JSONB
- `pendingRevision` JSONB
- `latestArtifactKey`
- `latestValidation` JSONB
- 创建、更新和完成时间

### `task_messages`

保存对话历史：

- 用户消息以纯文本保存。
- Agent 完整回复序列化为 JSON 字符串保存。

### `playable_task_assets`

保存素材元数据：

- taskId / userId
- slot
- filename
- mimeType
- size
- Blob storageKey

不保存文件二进制。

### `playable_video_analyses`

保存视频分析：

- assetId
- status
- Pipeline 版本
- 模型
- Gameplay Blueprint JSONB
- errorCode
- 创建和完成时间

`assetId + pipelineVersion + model` 具有唯一约束，用于避免重复分析和重复计费。

### `playable_task_builds`

保存每次构建的独立版本快照：

- 构建状态
- Confirmation JSONB
- Revision JSONB
- artifactKey
- Validation JSONB
- 创建和完成时间

版本号不是独立数据库字段，而是根据成功 Build 的顺序计算。

### `playable_task_events`

保存追加式过程事件，例如：

- clarification requested
- confirmation proposed
- revision proposed
- video analysis queued / started / succeeded / failed
- build started / succeeded / failed

前端在构建阶段通过事件接口轮询任务状态。

## Blob 保存的信息

`lib/playable/artifact-store.ts` 封装 Private Blob。

Blob 中保存：

- 用户上传的图片、音频和视频
- `playable.html`
- `production-config.json`
- `asset-manifest.json`
- `validation-report.json`
- 可选 `gameplay-blueprint.json`

数据库只保存 Blob 路径和结构化状态，不保存大型二进制或 HTML 全文。

## 预览、下载与版本

右侧预览由 `components/playable/playable-preview.tsx` 管理。

预览和下载统一通过：

```text
GET /api/playable-tasks/:taskId/artifact
```

支持：

- 当前 Playable HTML
- 指定历史 Build
- Production Config
- Asset Manifest
- Validation Report

历史版本来自 `playable_task_builds`。`tasks.latestArtifactKey` 指向当前成功版本。

## 完整链路摘要

```text
用户输入需求并选择素材
→ 创建 tasks 记录
→ 素材二进制上传到 Private Blob
→ 任务页提交 prompt 和当前附件 ID
→ 需求 Agent 理解需求
→ Agent 按需调用图片或 QDAI 视频分析
→ 工具结果回到需求 Agent
→ 更新 Requirement Brief
→ 生成 Confirmation 或 Revision
→ 用户确认
→ 创建 Build 记录
→ 构建 Agent 在 Sandbox 生成 HTML
→ 自动验证
→ HTML 和侧车文件写入 Blob
→ 数据库更新 latestArtifactKey 和 ready 状态
→ 用户预览、切换版本或下载
```
