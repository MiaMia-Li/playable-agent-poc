# 模板生成与修改规则

模板约束和校验命令统一由 `lib/playable/build-template-policy.ts` 决定，Codex Harness、CLI 和 Sandbox 验收共用规则。

| 模板类型 | 首次生成与重新生成 | 局部修改 | 校验 |
| --- | --- | --- | --- |
| 独立 HTML 模板 | 使用已选模板源码 | 使用当前已发布 HTML，保留已有修改 | 通用 HTML 校验与模板要求的浏览器行为检查 |
| 内置玩法，完全匹配 | 构建已选玩法基线 | 使用当前已发布 HTML | 注册玩法校验 |
| 内置玩法，部分匹配 | 构建已选玩法后适配 | 使用当前已发布 HTML | 通用 HTML 校验 |
| 自由生成 | 按确认需求创建 | 使用当前已发布 HTML | 通用 HTML 校验 |

独立 HTML 模板包括 `dragon_slots`、`dragon_reward_wheel`、`zeus_scatter`、`balloon_master`，均以 `sourceTemplateId` 为准。旧 `mode` 不能改变它们的游戏引擎或玩法。

内置玩法包括 `center_collision`、`top_rack`、`gravity_fill`、`perspective_3d`。只有实际使用内置三维玩法且不是自由生成时，才要求保留 Three.js 骨架。

补丁任务在 Agent 执行前将当前版本写入 `current-playable.html` 和 `output.html`，不会用模板构建命令覆盖当前版本。切换模板应采用重新生成流程。

## 验证范围

自动测试覆盖全部模板、路由类型和生成策略的提示词优先级、校验选择、CLI 与 Sandbox 基线准备，以及模板源码与适配说明是否存在。测试使用可验证的 HTML 作为编排样本，不调用真实模型。

这些检查能防止模板串用和校验命令分歧，不能保证模型每次都正确实现游戏需求。具体交互仍需对生成产物执行浏览器验证；模型输出 PASS 不等于应用已成功发布。
