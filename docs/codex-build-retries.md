# Codex 构建中的重连与失败

`@ai-sdk/harness-codex@1.0.104` 把 Codex JSON 流中的每条 `error` 都转换为终止 Harness 的错误。这类事件也用于 `Reconnecting...` 等恢复通知，会导致底层第一次准备重连时，上层就关闭订阅并销毁会话。

本项目通过 `pnpm-workspace.yaml` 的 `patchedDependencies` 应用 `patches/@ai-sdk__harness-codex@1.0.104.patch`，同时固定该依赖版本。补丁同时修改包内源码和实际传入 Sandbox 的 `dist/bridge/index.mjs`：

- 原生 `error` 作为 `raw` 通知传递，等待本轮最终结果。
- `turn.failed`、SDK 抛异常、取消仍然失败，不输出成功的 `finish`。
- 流结束时必须已经收到 `turn.completed`，否则保留最后一条异常并报错；没有异常消息时报告流提前关闭。

宿主只把重连、重试、连接方式切换和其他异常映射为固定的公开状态，不把原始错误消息写入时间线。最终错误仍进入原有的私有诊断和安全错误分类。

Codex 自己负责请求和流的重试。在它最终失败后，宿主只对模型容量不足、服务过载和连接故障额外重跑一次隔离构建，等待两秒，并遵守取消信号。一旦开始保存预览，不再重跑整次构建，避免影响已保存的结果。额度、鉴权、模型配置错误以及底层已结束的限流不触发额外整次重跑。

另外检查了 `Reconnecting... waiting for network`、`Previous response was not found. Retrying the full request.` 和 WebSocket 转 HTTPS 的通知。它们都不等同于最终失败；不依赖错误文案判断流是否成功，只认终态。

`tests/unit/codex-bridge-retry.test.ts` 执行实际 bootstrap 中的事件转换与运行循环，覆盖重连后成功、最终失败、流提前结束和取消。升级依赖时必须重新核对补丁及该测试，不能只删掉补丁配置。补丁改变 bootstrap 内容，因此 Harness 的 bootstrap 身份也会变化。

项目通过 `package.json` 的 `packageManager` 固定 pnpm 10.28.0，GitHub CI 也读取该版本。pnpm 10 与 11 虽然都写入 `lockfileVersion: '9.0'`，但补丁记录格式不同；用 pnpm 11 更新锁文件会导致 pnpm 10 的冻结安装报 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`。修改补丁后，先确认 `pnpm --version` 为项目固定版本，再运行 `pnpm install --lockfile-only --no-frozen-lockfile` 更新锁文件，并在干净目录中执行 `pnpm install --frozen-lockfile` 和桥接回归测试，验证实际安装的补丁。

官方事件类型见 [Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)，重试层数及永久错误处理参见 [OpenAI 限流说明](https://developers.openai.com/api/docs/guides/rate-limits)。
