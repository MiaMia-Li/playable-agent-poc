import { PLAYABLE_MODES } from './template-registry'
import type { PlayableModeId } from './types'

export type PlayableTemplateId =
  | PlayableModeId
  | 'dragon_slots'
  | 'dragon_reward_wheel'
  | 'zeus_scatter'
  | 'balloon_master'

export interface PlayableTemplate {
  id: PlayableTemplateId
  label: string
  description: string
}

// Imported HTML games use the freeform build route; they are not Mahjong runtime modes.
export const PLAYABLE_TEMPLATES: readonly PlayableTemplate[] = [
  ...PLAYABLE_MODES,
  { id: 'balloon_master', label: '彩球转盘消除', description: '转动各层圆盘对齐同色球列，下滑消除外层并揭开内层' },
  {
    id: 'zeus_scatter',
    label: '宙斯 Scatter 转轴',
    description: '点击停轮触发 Scatter 中奖动画，进入 Mega Win 结算并领取奖励',
  },
  { id: 'dragon_slots', label: '金龙麻将转轴', description: '转动麻将转轴，体验金龙主题和倍数奖励' },
  { id: 'dragon_reward_wheel', label: '金龙转盘集奖', description: '点击转盘抽取奖励，收集进度并解锁宝箱' },
]

export const templatePrompts: Record<PlayableTemplateId, string> = {
  center_collision: '基于「中心碰撞」玩法模板开始迭代：保留相同牌向中心碰撞并消除计分的核心玩法。',
  top_rack: '基于「上方牌架」玩法模板开始迭代：保留可见牌进入四槽牌架并配对清除的核心玩法。',
  gravity_fill: '基于「下落补位」玩法模板开始迭代：保留网格配对消除、列下落和顶部补位的核心玩法。',
  perspective_3d: '基于「3D 纵深」玩法模板开始迭代：保留移除顶层牌面并逐层揭示下方内容的核心玩法。',
  dragon_slots:
    '基于「金龙麻将转轴」HTML 模板开始迭代，保留原始转轴玩法、金龙主题与倍数奖励。基于已选模板修改，源文件已随构建工作区提供：assets/templates/dragon_slots/source.html。先读取并复用原始 HTML，按确认需求修改，不要替换成麻将配对玩法。',
  dragon_reward_wheel:
    '基于「金龙转盘集奖」HTML 模板开始迭代，保留原始转盘抽奖、奖励收集和宝箱进度玩法。基于已选模板修改，源文件已随构建工作区提供：assets/templates/dragon_reward_wheel/source.html。先读取并复用原始 HTML，按确认需求修改，不要替换成麻将配对玩法。',
  zeus_scatter:
    '基于「宙斯 Scatter 转轴」Laya HTML 模板开始迭代，保留最后一列停轮、Scatter 中奖动画、Mega Win 结算和 Collect 领取流程。基于已选模板修改，源文件已随构建工作区提供：assets/templates/zeus_scatter/source.html。先读取并复用原始 HTML，按确认需求修改，保留内嵌资源、默认静音和首次点击仅开始游戏的行为。',
  balloon_master:
    '基于「彩球转盘消除」Balloon Master Laya HTML 模板开始迭代，保留水平拖动圆盘、对齐中央同色球列、向下滑动剥离外层以及完成两层后展示尾板的玩法。基于已选模板修改，源文件已随构建工作区提供：assets/templates/balloon_master/source.html。先读取并复用原始 HTML，按确认需求修改，保留内嵌资源和交互方式。',
}
