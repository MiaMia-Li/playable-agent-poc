# Sandbox 失败诊断

构建抛出 `PlayableBuildExecutionError` 时，服务端将诊断保存到现有 Private Blob：

`users/<userId>/tasks/<taskId>/<buildId>/sandbox-diagnostics.json`

平台 Logs 出现 `Sandbox failure diagnostics saved to private storage` 表示保存成功。
出现 `Unable to save Sandbox failure diagnostics` 表示写入失败；原始构建失败仍正常记录。
此文件不挂到公开任务事件或产物下载接口；需要 Blob 管理权限读取。

## 一键下载

在项目根目录运行：

```bash
pnpm sandbox:logs <taskId>
```

命令自动加载 `.env.local`（已有环境变量优先），需要 `POSTGRES_URL` 和
`BLOB_READ_WRITE_TOKEN` 指向同一环境。它查找该任务最近一次失败的构建，下载诊断到
`.sandbox-logs/<taskId>.json`；重复运行会原子替换该文件，下载失败不会覆盖已有文件。
本地诊断目录已加入 `.gitignore`，新文件权限为 `0600`。

这不是通用 Sandbox 日志命令：成功构建和进行中的构建不会通过此命令导出运行日志。
若任务不存在、尚无构建、最近构建成功但没有失败记录、构建仍标记为进行中但没有失败记录，
或最新失败构建没有诊断文件，命令会分别给出明确提示并非零退出。
任务不存在时，请核对任务页面 URL 中的 task ID（不是 Sandbox ID），以及 `POSTGRES_URL` 是否指向该任务所在环境。
不会静默回退到较早构建，以免拿到旧日志误判当前故障。历史构建不会自动补生成诊断。

## 按 Blob 路径下载

在 Vercel Storage 的对应 Private Blob 中查找 `sandbox-diagnostics.json`，或使用具有
`BLOB_READ_WRITE_TOKEN` 的本地环境下载（目标文件必须不存在）：

```bash
node --env-file=.env.local --import tsx scripts/read-sandbox-diagnostics.ts \
  'users/<userId>/tasks/<taskId>/<buildId>/sandbox-diagnostics.json' \
  /tmp/sandbox-diagnostics.json
```

诊断包含 Sandbox 标识、最终失败阶段、异常 cause 链和 stack，以及该次 Sandbox 执行中
最近 8 条失败命令的命令文本、退出码、耗时、stdout/stderr。命令输出在 Sandbox 销毁前收集到内存，
由构建错误携带至宿主保存。文件也可能包含后来已恢复的命令失败，应结合最终异常链判断。

已知服务端凭据、命令环境变量值和常见 token 格式在保存前脱敏，每个文本字段最多保留末尾
16,000 字符（另附截断标记），异常链最多 6 层。诊断仍属私有运维数据，不应发布到公开页面。

限制：不收集成功命令输出；Agent 内部未经过 `PlayableSandbox.run()` 的工具输出不在命令列表内；
进程被强制终止、宿主超时或写入 Blob 失败时可能没有文件。重试最终失败时保存最后一次尝试的诊断。
