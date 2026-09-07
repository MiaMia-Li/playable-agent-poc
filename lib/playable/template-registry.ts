import type { PlayableMode } from './types'

const skillRoot = 'skills/mahjong-pair-match-playable'

export const PLAYABLE_MODES: readonly PlayableMode[] = [
  {
    id: 'center_collision',
    label: '中心碰撞',
    description: '相同牌向中心碰撞、破碎并计分',
    configPath: `${skillRoot}/assets/templates/center_collision/config.json`,
    referencePath: `${skillRoot}/references/modes/center_collision.md`,
  },
  {
    id: 'top_rack',
    label: '上方牌架',
    description: '可见牌进入四槽牌架，配对后清除',
    configPath: `${skillRoot}/assets/templates/top_rack/config.json`,
    referencePath: `${skillRoot}/references/modes/top_rack.md`,
  },
  {
    id: 'gravity_fill',
    label: '下落补位',
    description: '网格配对消除后列下落并从上方补位',
    configPath: `${skillRoot}/assets/templates/gravity_fill/config.json`,
    referencePath: `${skillRoot}/references/modes/gravity_fill.md`,
  },
  {
    id: 'perspective_3d',
    label: '3D 纵深',
    description: '移除立体牌墙顶面并揭示下层',
    configPath: `${skillRoot}/assets/templates/perspective_3d/config.json`,
    referencePath: `${skillRoot}/references/modes/perspective_3d.md`,
  },
]

export function getPlayableMode(value: string): PlayableMode {
  const mode = PLAYABLE_MODES.find((candidate) => candidate.id === value)
  if (!mode) throw new Error(`Unsupported playable mode: ${value}`)
  return mode
}
