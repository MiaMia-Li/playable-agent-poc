# AI 网关 Gemini 能力申请

面向网关运维团队。目标是让 `ai.pocketcity.com` 能完整承载 Gemini 原生视频理解，
使 Playable Studio 的参考视频分析不必依赖外网服务。

测试环境：`https://ai.pocketcity.com`，模型 `gemini-3.5-flash`，认证头 `x-goog-api-key: <KEY>`。
以下所有观测都在 2026-09-11 复现过。

---

## 请求一（阻塞性）：`videoMetadata` 透传不稳定

### 涉及端点

```
POST /v1beta/models/{model}:generateContent
```

### 问题

请求体中 `contents[].parts[].videoMetadata` 字段（含 `fps`、`startOffset`、`endOffset`）
**只有部分请求会生效**。同一个请求重复发送，行为在「生效」和「被丢弃」之间随机跳变。

### 已定位的规律：丢失只发生在 `parts[]` 层

对照测试显示，**`generationConfig` 层的字段稳定透传，`parts[]` 层的非标准字段会被丢弃**。

| 配置 | 位置 | 重复三次的 VIDEO token 数 | 结论 |
| --- | --- | --- | --- |
| 基准（6 秒视频，无额外配置） | — | 396, 396, 396 | 稳定 |
| `mediaResolution: MEDIA_RESOLUTION_HIGH` | `generationConfig` | 1584, 1584, 1584 | **稳定生效** |
| `mediaResolution: MEDIA_RESOLUTION_LOW` | `generationConfig` | 396, 396, 396 | 稳定 |
| `mediaResolution: { level: HIGH }` | `parts[]` | 396, 396, 396 | **被丢弃** |
| `videoMetadata: { fps: 4 }` | `parts[]` | 396, 396, 1584, 396, 396 | **随机丢弃** |

推断原因是同一模型挂了多条上游通道轮询，部分通道在重新序列化 `parts[]` 时
只保留了标准字段（`text` / `inlineData`），丢掉了 `videoMetadata`、`mediaResolution` 等扩展字段。
`generationConfig` 因为在请求体顶层，不受影响。

修复方向应集中在 `parts[]` 的序列化环节，或剔除会丢字段的通道。

### 复现方式

对同一段 6 秒视频，用 `inlineData` 内联发送，附带 `videoMetadata: { fps: 4 }`，
连发 5 次，读取响应中 `usageMetadata.promptTokensDetails` 里 `modality: "VIDEO"` 的 `tokenCount`。

预期：6 秒 × 4 fps = 24 帧 × 66 token/帧 = **1584**
实测五次：`396, 396, 1584, 396, 396`

`396` 对应 6 帧，即 `fps` 被丢弃后退回默认的 1 fps。

对 2 秒视频同样测试（预期 `528`）：`132, 132, 528, 132, 528`

### 附带问题

`startOffset` / `endOffset` 在所有观测中都未对视频采样生效（VIDEO token 数不随裁剪区间变化），
但音频 token 数会下降。裁剪似乎只被部分应用。

### 期望

固定使用支持 `videoMetadata` 完整透传的上游通道，或在网关侧剔除不支持该字段的通道。

### 附带观测：延迟差异

同一份 8.5MB 视频（base64 后 11.6MB），不同批次请求耗时在 **19 秒到 137 秒**之间波动。
这与上述通道假设一致，可作为排查佐证。

---

## 请求二（正确性问题，涉及计费）：`:countTokens` 被错误路由到 `:generateContent`

### 涉及端点

```
POST /v1beta/models/{model}:countTokens
```

### 问题

该端点返回 `200`，但响应体是一次**完整生成**的结果（含 `candidates[].content.parts[].text`），
而不是预期的 `{ "totalTokens": N }`。网关似乎忽略了方法名后缀，把请求直接转给了 `generateContent`。

### 影响

调用方的意图是在真正发起生成**之前**估算 token 数以做成本控制，
但实际会被计费执行一次完整生成——恰好与调用目的相反，且无任何错误提示。
在按量计费场景下这是静默的成本泄漏。

### 复现方式

向 `POST /v1beta/models/gemini-3.5-flash:countTokens` 发送一个含 `inlineData` 视频的正常请求体，
观察响应体结构。

---

## 请求三（非阻塞，但能显著降成本）：Files API 未实现

### 涉及端点

| 端点 | 用途 |
| --- | --- |
| `POST /upload/v1beta/files` | 发起可续传上传，需在响应头返回 `x-goog-upload-url` |
| `POST <x-goog-upload-url 返回的地址>` | 上传文件字节 |
| `GET /v1beta/files/{name}` | 轮询文件状态直到 `state: ACTIVE` |
| `DELETE /v1beta/files/{name}` | 删除文件 |

### 当前行为

- `/upload/v1beta/files`：被 nginx 当作前端 SPA 路由处理。`POST` 返回 `405`，`GET` 返回 SPA 的 HTML。
- `/v1beta/files`：进到 API 层，返回 `404`，响应体为 `Invalid URL`。

### 关键要求

若实现该接口，`x-goog-upload-url` 响应头返回的地址**必须指向网关自身域名**。
如果直接透传 Google 返回的 `*.googleapis.com` 地址，客户端第二跳会绕过网关直连外网，
在内网环境下既连不通、也失去了走网关的意义。

### 收益

目前只能用 `inlineData` 内联 base64 传输。实测内联可用到 **122MB base64（91MB 原始视频，耗时 47 秒）**，
已覆盖产品侧绝大多数场景，因此这一项**不阻塞**。注意产品侧 100 MiB 的原始文件上限编码后约为 137MB base64，
仍略高于已测范围，那一段由调用方自行验证，不构成对网关的请求。

Files API 的价值在于免去每次分析重传整个文件，以及支持同一文件在 48 小时内复用做多次分析。
属于优化项。

---

## 参考：网关当前已确认可用的能力

- `POST /v1beta/models/{model}:generateContent` 内联视频（`inlineData`），已验证到 122MB base64
- 采样稳定为 1 帧/秒，token 数严格等于 `时长(秒) × 66`（`HIGH` 解析度下为 `× 264`），可精确预估成本
- 视频**音轨**被稳定处理，token 数约为 `时长(秒) × 25`
- `GET /v1beta/models` 列出 Gemini 系列：2.5-flash、2.5-pro、3-flash-preview、3.1-flash-lite、3.1-pro-preview、3.5-flash
- `GET /v1/models`（OpenAI 协议，`Authorization: Bearer`）返回 109 个模型

### 附带请求四（低优先级）

模型列表中没有 3.6 / 3.7 / 3.8 Flash，因此 `mediaProcessing: AGENTIC`（模型自主决定关键片段采样密度）
无法使用。若上游可提供，希望补充。
