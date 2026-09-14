# Playable Studio

用户描述想要的互动广告（playable ad），系统通过对话厘清需求，产出可交付的单文件 HTML 游戏。

## Language

### 参考素材与分析

**Reference Video**:
用户上传、用来示范想要什么玩法的既有游戏录像。它是证据来源，不是交付物的一部分。
_Avoid_: 范例视频、demo video、样片

**Active Reference Video**:
一个 task 上众多 Reference Video 中，唯一一支正在驱动 Gameplay Blueprint 的。只有它会被分析，也只有它的时间轴能被 Gameplay Annotation 引用。
_Avoid_: 主视频、primary video、selected video

**Video Analysis**:
把一支 Reference Video 转成 Gameplay Blueprint 的一次执行。
_Avoid_: 解析、parsing、extraction

**Verification Pass**:
由用户发起的 Video Analysis，只重看既有 Gameplay Annotation 所指的时间区间，且模型有权得出与标注不同的结论。它的产出是一份新的模型推论层，不会覆写标注层。当前 AI 网关不支持区间裁剪与帧率控制，因此这一概念已定义但尚未实现。
_Avoid_: 重新分析、re-analysis、refresh

**Gameplay Blueprint**:
对一支 Reference Video 的客观观察文档——视频里「发生了什么」。每条推论都必须附时间区间证据。它不是规格书，不预设要用哪个模板。
_Avoid_: 玩法规格、game spec、analysis result

**Gameplay Annotation**:
用户对 Reference Video 中某个时间区间「客观发生了什么」的权威陈述。判准是语义意图——陈述观察才算标注，表达意图则属 Requirement Brief；带时间区间是必要条件而非充分条件。同一句话可以同时产出一条标注与一条需求。
_Avoid_: 附加说明、注解、comment、hint、correction

**Intent Divergence**:
Gameplay Blueprint 上的一段陈述，指出 Reference Video 实际呈现的玩法与用户自述意图之间的落差。它存在的理由是让确认偏误变成可见的，而不是静静地被写进推论里。
_Avoid_: 差异、gap、mismatch、conflict

### 需求与交付

**Requirement Brief**:
用户想要什么的实时需求文档。与 Gameplay Blueprint 互斥：blueprint 讲视频是什么，brief 讲用户要什么。
_Avoid_: 需求说明、spec、PRD

**Confirmation Proposal**:
送交用户逐项确认的构建规格，确认后才会触发 build。
_Avoid_: 方案、plan、proposal
