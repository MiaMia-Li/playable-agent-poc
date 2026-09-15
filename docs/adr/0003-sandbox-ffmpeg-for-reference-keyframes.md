# Reference Keyframe 在服务器端用 sandbox 加 ffmpeg 截取

Video Analysis 改走 Gemini 原生视频后，ffmpeg 抽帧 sandbox 已被删除（v2 spec §6.6）。为了把 Reference Keyframe 交给构建，这里又在分析成功后另开一个 sandbox 用 ffmpeg 截帧。截哪几秒由模型决定，只能在分析之后做；浏览器端在上传时按固定间隔截帧会给每支视频多加几 MB 上传，而分析完成后再由浏览器截，又依赖页面一直开着；在构建 sandbox 里截则会拉长每一次构建。后台 sandbox 是折衷：不占用户带宽，不在构建的关键路径上。

## 后果

- ffmpeg 装进构建用的快照，但截帧自行检查 `ffmpeg -version`，不提高构建的 `PLAYABLE_SANDBOX_TOOLS_VERSION`，找不到也不临时安装。代码与快照的上线顺序因此不受约束，旧快照只会让关键帧暂时不可用。
- 截帧失败永不阻挡分析或构建。§6.6 想消除的故障面回来了一部分，但只影响关键帧本身。
- 本地 Codex 模式用本机 `PATH` 上的 ffmpeg，本地 demo 模式不截帧。
