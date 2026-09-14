# 参考视频分析走公司网关的 Gemini 而非 OpenRouter

Playable Studio 其余所有 AI 调用都走同一把共享 OpenRouter Key（`createPlayableAIProvider`），只有 Video Analysis 使用 `@google/genai` 配合 `GEMINI_API_KEY` 访问公司 AI 网关的 Gemini 端点。

## 2026-09-14 修订：原始理由已被网关实测推翻

本 ADR 初版给的两条理由分别是「OpenRouter 拿不到 `videoMetadata`」和「100 MiB 视频内联会超过 Google 约 100MB 的内联上限」。[网关实测](../gateway-gemini-api-requests.md)显示两条都不成立：网关同样会随机丢弃 `parts[].videoMetadata`，而内联实测可用到 122MB base64（91MB 原始视频）。

**决策维持不变，但理由换了：**

- 参考视频可能是客户或竞品素材，走公司网关意味着数据处理路径在内部可控，OpenRouter 是外部公共服务。这条理由与参数能力无关，因此也不会被网关的能力变化推翻。
- 网关稳定支持 `generationConfig.mediaResolution` 与视频音轨处理，这是 v2 Blueprint 的 `audio` 字段和 §6.2 的分辨率选择所依赖的。
- 网关已受理 `videoMetadata` 透传的修复申请。修好之后原始理由重新成立，届时这条路径是唯一能拿到 `fps` / `startOffset` / `endOffset` 的选项。

## 后果

- 系统引入第二个 AI 供应商和密钥；「单一共享 Key」这个不变式从此有且仅有一个有据可查的例外。
- 不使用 Files API（网关未实现），改为 `inlineData` 内联。每次分析都要重传整个文件，没有跨请求复用。
- 在网关放通 `videoMetadata` 之前，依赖该字段的 Verification Pass 无法实现，已在 spec §7.5 标记暂缓。
