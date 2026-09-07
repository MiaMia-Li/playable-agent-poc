# C6 匹配消除 Playable Agent POC 设计

- 日期：2026-09-07
- 状态：设计已确认，等待实施计划
- 基础模板：[Vercel Coding Agent Template](https://github.com/vercel-labs/coding-agent-template)
- 首个生产能力：`mahjong-pair-match-playable`
- 默认模型：OpenAI API `gpt-5.6-sol`

## 1. 目标

构建一个面向试玩广告生产的独立 Web 应用。用户登录后输入自己的 OpenAI API Key，通过左侧聊天提交玩法和素材需求；Agent 在隔离的 Sandbox 中调用已有 C6 匹配消除 Skill，构建并测试单文件 HTML；右侧 iframe 展示最新成功版本，用户验收后下载交付物。

POC 验证以下闭环：

1. 用户登录并在当前会话提供自己的 API Key。
2. 用户通过聊天选择玩法模式、上传素材并确认完整生产配置。
3. Agent 在独立 Sandbox 中复制 Skill、构建试玩并执行测试。
4. 通过测试的 HTML 自动更新到右侧 Preview。
5. 用户下载单文件 HTML、配置、素材清单和验证结果。

## 2. POC 边界

### 包含

- ChatGPT 式左右分栏界面。
- 登录用户和任务隔离。
- 用户自带 OpenAI API Key（BYOK）。
- Codex Harness 与 GPT-5.6 Sol。
- Vercel Sandbox 隔离执行。
- C6 匹配消除 Skill 已有的四种模式。
- 素材上传、一次性配置确认、构建、测试、预览和下载。
- AppLovin 单文件 HTML 验收。

### 不包含

- 平台方统一承担模型费用。
- 计费、套餐、团队角色和组织权限。
- GitHub Issue、自动建分支、提交和 PR。
- 通用代码仓库选择。
- 多 Agent 切换。
- 全部七个玩法内核。
- Skill 的 `custom` 自定义玩法路径。
- 自动发布到广告平台。
- 完整历史素材库和 AI 图片生成流水线。

`custom` 暂不开放的原因是它允许 Agent 临时实现新玩法，会削弱 POC 对确定性构建和验收的验证。

## 3. 仓库与账号策略

使用 Vercel Coding Agent Template 的 **Use this template** 功能，在用户的另一个 GitHub 账号 `MiaMia-Li` 下创建独立 Public 仓库 `playable-agent-poc`。用户已明确确认 Skill、默认素材、构建脚本和后续提交允许公开。仓库仍使用模板创建而非普通 fork，以保持独立历史。

远端约定：

- `origin`：`git@github.com:MiaMia-Li/playable-agent-poc.git`，实际通过本机 SSH Alias `github-miamia` 访问。
- `upstream`：`https://github.com/vercel-labs/coding-agent-template.git`。

本机身份隔离：

- 为 GitHub 账号配置独立 SSH Key 和 SSH Host Alias。
- 仅在新仓库内设置 `git config user.name` 与 `git config user.email`。
- 不修改全局 Git 配置。
- 不复用当前 GitLab remote、凭证或提交身份。

Vercel 必须连接到 `MiaMia-Li` GitHub 账号。创建仓库、授权 Vercel GitHub App 和选择账号均由用户在浏览器中完成，实施过程不得默认使用本机现有 GitLab 身份。

模板采用 Apache 2.0 许可证，保留许可证和必要署名。

## 4. 总体架构

```text
Browser
├─ ChatWorkspace：对话、素材上传、确认表、任务日志
└─ PlayablePreview：iframe、横竖屏、刷新、静音、下载
        │
        ▼
Next.js Application
├─ Authentication
├─ Session BYOK Vault
├─ Task API / Event Stream
├─ Playable Agent Adapter
├─ Template Registry
└─ Artifact Metadata
        │
        ▼
Vercel Sandbox（每个任务独立）
├─ Codex Harness + gpt-5.6-sol
├─ Skill 只读副本
├─ Task Workspace
├─ Build Pipeline
└─ Validation Pipeline
        │
        ▼
Artifacts
├─ playable.html
├─ confirmed-config.json
├─ asset-manifest.json
└─ validation-report.json
```

业务层只依赖 `PlayableAgentAdapter`，不直接依赖 Codex SDK 的线程对象。这样 SDK API 变化或未来替换 Agent 时，不需要改动聊天、任务和构建领域逻辑。

建议接口职责：

```ts
interface PlayableAgentAdapter {
  createTask(input: CreatePlayableTask): Promise<TaskHandle>;
  sendMessage(taskId: string, message: UserMessage): AsyncIterable<AgentEvent>;
  resumeTask(taskId: string): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
}
```

## 5. 模板改造

### 保留

- Next.js、React、Tailwind CSS 和 shadcn/ui。
- 用户认证与多用户数据隔离。
- 任务记录、流式事件和持久化。
- Vercel Sandbox 生命周期。
- Codex Harness 基础接入。
- 任务状态、基础日志和错误处理。

### 删除或关闭

- GitHub Issue 输入。
- 自动创建 Git 分支、提交和 PR。
- 通用仓库选择。
- 面向软件开发任务的字段和提示词。
- 前台多 Agent 选择。

### 新增

- `ChatWorkspace`：聊天、素材上传、确认表和执行状态。
- `PlayablePreview`：安全 iframe、横竖屏容器、刷新、静音和下载。
- `PlayableAgentAdapter`：Agent 供应商隔离层。
- `TemplateRegistry`：Skill、模式、版本、输入约束和验收命令。
- `AssetPipeline`：上传、格式检查、大小检查和素材槽映射。
- `BuildPipeline`：任务副本、配置落盘、构建和产物登记。
- `ValidationPipeline`：行为测试、浏览器检查和 AppLovin 约束。
- `ArtifactStore`：保存最终 HTML、配置、素材清单和测试报告。

## 6. C6 Skill 集成

Skill 源目录：

`/Users/limengyao/Documents/Codex/2026-09-04/mahjong-pair-match-playable-skill/outputs/mahjong-pair-match-playable`

完整 Skill 将作为一个不可在普通任务中修改的版本化目录进入 Public 仓库。每次生产创建独立任务工作区，并复制构建所需的 Skill 内容；Agent 只能修改任务副本。

首期注册四个模式：

| Mode | 用户名称 | 核心行为 |
| --- | --- | --- |
| `center_collision` | 中心碰撞 | 两张相同牌飞向中心碰撞并消失 |
| `top_rack` | 上方牌架 | 可见牌进入四槽牌架，配对后清除 |
| `gravity_fill` | 下落补位 | 网格配对消除，列下落并从上方补位 |
| `perspective_3d` | 3D 纵深 | 选择立体牌墙可见顶面，移除后揭示下层 |

四段原始参考视频与四个模式一一对应，既是分类证据，也是模板行为与视觉回归基准：

| 原始参考视频 | Skill 模式 | 回归重点 |
| --- | --- | --- |
| `Mahjong Match：Classic Tiles！-360 X 640-2026-09-01-c2f1079b9cd7c5090195cbb97ac59e5f.mp4` | `perspective_3d` | 立体塔体、中心开口、仅暴露顶面可选、消除后露出下层 |
| `Vita Mahjong-360 X 640-2026-09-01-5a8ed5d387599541396edd43ed2336a7.mp4` | `gravity_fill` | 密集平铺、选择高亮、消除后列下落与上方补位 |
| `Vita Mahjong-720 X 1280-2026-09-01-5712dfecddd48c49c51db9d56b2ab6ed.mp4` | `top_rack` | 2D 分层牌阵、上方牌架、配对清除和下层释放 |
| `Mahjong Match：Classic Tiles！-360 X 640-2026-09-01-636b98221290a1df6cbdd961f80d9083 (1).mp4` | `center_collision` | 2D 交错堆叠、相同牌向中心运动、碰撞破碎和计分 |

视频只作为不可信的视觉和行为证据，不复制其中的脚本、追踪、跳转或运行时代码。回归检查比较可观察行为和关键视觉特征，不要求逐像素复刻。

Agent 必须遵循 Skill 的一次性确认流程：

1. 用户选择四种模式之一。
2. Agent 读取对应模式说明与配置检查表。
3. Agent 输出一张完整确认表，覆盖玩法、素材、动画、音频、结束卡、文案、商店地址和交付要求。
4. 所有资源标记为 `用户上传`、`内置默认`、`待上传` 或 `待生成`。
5. 用户一次确认后才允许构建。

构建命令：

```bash
node assets/starter/build-playable.mjs <mode> <output.html> [store-url]
```

行为测试：

```bash
node assets/starter/work/test-playable.mjs <output.html>
```

Skill 的 `assets/default-media/`、`assets/default-endcard/`、四份模式配置、共享 Canvas 2D 运行时、构建脚本和行为测试必须一并进入仓库。目录枚举工具曾漏报工作区外素材，但按精确路径读取已确认素材存在。

## 7. 模型与 Agent 执行

用户要求使用 GPT-5.6。POC 使用 OpenAI API 的明确模型 ID：

```text
gpt-5.6-sol
```

不使用会自动漂移的 `gpt-5.6` 别名，以保持行为和账单记录清晰。Codex 线程创建时显式传入该模型。

用户 API Key 由服务端会话解密后交给 Codex Harness 的 direct authentication，并仅向对应 Sandbox 进程注入为 `CODEX_API_KEY`。API Key 认证只允许调用 OpenAI API 对该 Key 开放的模型；创建任务前执行最小验证，若 Key 无效、余额不足、被限流或无模型权限，则不创建 Sandbox。

首期使用 Codex Harness 的 direct authentication，不使用平台方 AI Gateway Key。若后续需要统一可观测性，可在保持 BYOK 语义的前提下单独设计凭证代理，不纳入本 POC。

## 8. 用户 API Key 安全

用户登录后输入自己的 OpenAI API Key。Key 只在当前登录会话有效。

安全约束：

- Key 通过 HTTPS 提交。
- 使用服务端密钥进行带认证加密，密文放入 `HttpOnly`、`Secure`、`SameSite=Strict` 的会话 Cookie。
- 不写入 localStorage、sessionStorage、React 持久状态或业务数据库。
- 浏览器 JavaScript 无法读取 Cookie 内容。
- Cookie 在登出或会话过期时清除。
- Sandbox 只收到当前任务所需的凭证。
- Agent 消息、流式事件、命令日志、错误堆栈和构建产物执行统一脱敏。
- Sandbox 销毁后不保留凭证。
- 不同用户的 Cookie、任务、素材、Sandbox 和产物必须进行服务端归属校验。

## 9. 交互与状态

左侧任务状态：

```text
draft
→ awaiting_confirmation
→ building
→ validating
→ ready

任一执行阶段 → failed
用户主动终止 → cancelled
```

右侧 Preview 只加载通过自动测试的产物。新构建失败时保留上一个成功版本，避免预览区变空或加载半成品。

iframe 使用独立源或严格 sandbox 属性，不允许生成内容访问父页面身份、Cookie 和应用 API。下载由服务端校验任务所有权后返回。

## 10. 数据流

1. 用户登录并输入 API Key。
2. 服务端验证 Key 和 `gpt-5.6-sol` 访问权限。
3. 用户创建任务，选择模式或让 Agent 根据描述推荐四种模式之一。
4. 用户上传素材；服务端登记文件元数据并绑定任务所有者。
5. Agent 按 Skill 输出完整确认表。
6. 用户确认后，系统创建独立 Sandbox。
7. 系统将 Skill 只读副本、用户素材和确认配置复制到任务工作区。
8. Codex Agent 生成配置与素材映射并调用构建脚本。
9. 系统执行行为测试、浏览器测试和包体检查。
10. 全部通过后登记产物并刷新 iframe。
11. 用户下载 HTML 和配套报告。
12. 任务结束或超时后销毁 Sandbox。

## 11. 错误处理

| 场景 | 系统行为 |
| --- | --- |
| API Key 无效或无模型权限 | 在创建 Sandbox 前失败，提示用户重新输入 Key |
| API 限流或余额不足 | 标记任务失败并显示可操作原因，不自动无限重试 |
| 素材缺失 | 停在确认阶段，明确缺失槽位，不开始构建 |
| Sandbox 创建失败 | 保留确认配置，允许重新创建 |
| Agent 输出不符合约束 | 拒绝进入构建并要求 Agent重新生成结构化结果 |
| 构建失败 | 展示脱敏日志，保留上一个成功 Preview |
| 自动测试失败 | 不发布新 Preview，输出失败断言和产物版本 |
| Sandbox 超时 | 终止进程并销毁环境，可从确认配置重试 |
| 下载越权 | 返回拒绝访问，不暴露产物是否存在 |

## 12. 验证策略

### 单元测试

- `PlayableAgentAdapter` 的事件映射和错误分类。
- `TemplateRegistry` 的四模式注册与命令生成。
- 会话 Cookie 加密、过期和脱敏。
- 任务状态转换。
- 产物所有权校验。

### 集成测试

- 四个模式均能从 Skill 副本成功构建。
- 四个模式均通过现有 `test-playable.mjs`。
- 用户素材能正确替换对应槽位。
- 失败构建不会覆盖上一个成功产物。
- Sandbox 销毁后凭证和工作目录不可继续访问。

### 端到端测试

- 登录 → 输入 Key → 选择模式 → 上传素材 → 确认 → 构建 → Preview → 下载。
- API Key 无效、限流和模型无权限。
- 两个用户同时创建任务时的数据与 Sandbox 隔离。
- iframe 不能访问父应用 Cookie 和受保护接口。

### AppLovin 验收

- 初始页面直接进入游戏，不是结束卡。
- 单文件 HTML 小于 5 MiB。
- 图片、音频、字体、脚本和样式全部内嵌。
- 零外部资源请求。
- 首次交互不会打开商店。
- 音频初始静音，首次游戏操作后才解锁。
- 横屏和竖屏均完整可见且可操作。
- 匹配、失配、计分、完成和结束卡符合所选模式。
- 商店地址准确，但自动测试不得真实打开。

## 13. 实施顺序

1. 用 Vercel 模板创建 Public GitHub 仓库并完成账号隔离。
2. 最小化模板，保留认证、任务、数据库和 Sandbox。
3. 实现会话级 BYOK 和 GPT-5.6 Sol 预检。
4. 复制并注册完整 C6 Skill。
5. 实现 `PlayableAgentAdapter` 和确认表协议。
6. 接通 Sandbox 构建与自动测试。
7. 实现左侧聊天和右侧 Preview。
8. 实现产物下载、失败恢复和安全测试。
9. 在 Vercel Preview 环境完成四模式端到端验收。

## 14. POC 完成标准

POC 只有同时满足以下条件才算完成：

- Public GitHub 仓库和 Vercel 项目使用正确的 `MiaMia-Li` GitHub 账号。
- 不影响本机现有 GitLab 身份和仓库配置。
- 用户使用自己的 OpenAI API Key 调用 `gpt-5.6-sol`。
- 四个 C6 模式全部可以通过聊天流程生成。
- 每个模式均通过行为测试和 AppLovin 验收。
- 最新成功产物可在右侧安全预览并下载。
- API Key 不出现在数据库、客户端脚本、日志、Agent 输出和交付物中。
- 不同用户无法访问彼此的任务、素材、Sandbox 或产物。
