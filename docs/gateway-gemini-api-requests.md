# AI 网关 Gemini 能力申请

面向网关运维团队。目标是让 `ai.pocketcity.com` 能完整承载 Gemini 原生视频理解，
使 Playable Studio 的参考视频分析不必依赖外网服务。

测试环境：`https://ai.pocketcity.com`，模型 `gemini-3.5-flash`，认证头 `x-goog-api-key: <KEY>`。
以下观测在 2026-09-11 复现过，请求零在 2026-09-14 复现。

---

## 请求零（阻塞性，最高优先）：部分通道整体丢弃 `generationConfig`

### 涉及端点

```
POST /v1beta/models/{model}:generateContent
```

### 问题

网关在多条上游通道间轮询，**其中一部分通道会整体丢弃请求体里的 `generationConfig`**，
而不只是丢弃其中的个别字段。受影响的字段至少包括 `mediaResolution`、`responseMimeType`
与 `responseJsonSchema`。请求仍返回 `200`，没有任何警告。

这比请求一严重：请求一只影响采样密度，本条**直接破坏结构化输出**。
调用方要求返回符合给定 JSON Schema 的结果，实际拿到的是不受约束的自由文本。

### 两类通道可由 `usageMetadata.trafficType` 区分

响应里是否带 `usageMetadata.trafficType` 与 `generationConfig` 是否生效**完全相关**，
10 次连发观测无一例外。带 `thoughtSignature` 的响应同样属于生效那一类。

| 观测项 | 通道 A（响应含 `trafficType`） | 通道 B（响应无 `trafficType`） |
| --- | --- | --- |
| `mediaResolution: MEDIA_RESOLUTION_HIGH` | 生效，6 秒视频 VIDEO token = 1584 | 丢弃，退回默认，VIDEO token = 396 |
| `responseMimeType: application/json` | 生效，返回裸 JSON | 丢弃，返回 ` ```json ` 包裹的文本甚至散文 |
| `responseJsonSchema` | 生效，输出符合 schema | 丢弃，输出结构随机 |
| 命中率 | 约 37%（10 次中 4 次、6 次中 2 次） | 约 63% |

### 复现方式

对同一段 6 秒视频用 `inlineData` 内联发送，`generationConfig` 同时带
`mediaResolution: MEDIA_RESOLUTION_HIGH` 与 `responseMimeType: application/json`，连发 10 次。
读取每次响应的 `usageMetadata.trafficType` 是否存在，以及
`usageMetadata.promptTokensDetails` 里 `modality: "VIDEO"` 的 `tokenCount`。

实测十次（A 表示含 `trafficType`）：

```
b b A b b A b b A A      trafficType
396 396 1584 396 396 1584 396 396 1584 1584   VIDEO token
```

`trafficType` 出现与 `1584` 出现的位置完全重合。

### 与 2026-09-11 观测的差异

上一轮测试中 `mediaResolution` 在 `generationConfig` 层「稳定生效」（三次均为 1584），
据此得出的结论是「`generationConfig` 不受影响，只有 `parts[]` 层会丢字段」。
现在看来那三次只是恰好都落在通道 A 上。**通道配比本身随时间变化**，
因此「某字段稳定透传」这类结论无法靠少量采样建立。

### 期望

固定路由到完整支持 `generationConfig` 的上游通道，或在网关侧剔除会丢弃该字段的通道。

若短期内无法修复，**请至少保证可观测性**：在响应中稳定返回一个标识上游通道的字段，
使调用方能够判断本次请求的配置是否真的生效。目前只能靠 `trafficType` 这个副作用来推断，
它并非为此设计，随时可能变化。

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
| `mediaResolution: MEDIA_RESOLUTION_HIGH` | `generationConfig` | 1584, 1584, 1584 | 当时判为稳定，**已被请求零推翻** |
| `mediaResolution: MEDIA_RESOLUTION_LOW` | `generationConfig` | 396, 396, 396 | 与默认值相同，无法区分生效与丢弃 |
| `mediaResolution: { level: HIGH }` | `parts[]` | 396, 396, 396 | **被丢弃** |
| `videoMetadata: { fps: 4 }` | `parts[]` | 396, 396, 1584, 396, 396 | **随机丢弃** |

当时据此推断丢失只发生在 `parts[]` 层：部分通道在重新序列化 `parts[]` 时只保留标准字段
（`text` / `inlineData`），而 `generationConfig` 位于请求体顶层，不受影响。

**请求零推翻了后半句。** 扩大采样后，`generationConfig` 同样会被部分通道整体丢弃，
上表第二行三次命中只是样本太小。仍然成立的是前半句与多通道这个总体判断：
两处丢弃很可能同源，修复方向同样是剔除或修正会丢字段的通道。

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
- 采样稳定为 1 帧/秒，与通道无关。token 数严格等于 `时长(秒) × 66`；若本次请求落在通道 A
  且 `mediaResolution: HIGH` 生效，则为 `× 264`。两种取值都可精确预估，但**取哪一种由通道决定**，
  只能在响应回来后判定，见请求零
- 视频**音轨**被稳定处理，token 数约为 `时长(秒) × 25`，不受通道影响
- `GET /v1beta/models` 列出 Gemini 系列：2.5-flash、2.5-pro、3-flash-preview、3.1-flash-lite、3.1-pro-preview、3.5-flash
- `GET /v1/models`（OpenAI 协议，`Authorization: Bearer`）返回 109 个模型

### 附带请求四（低优先级）

模型列表中没有 3.6 / 3.7 / 3.8 Flash，因此 `mediaProcessing: AGENTIC`（模型自主决定关键片段采样密度）
无法使用。若上游可提供，希望补充。
