import { describe, expect, it } from 'vitest'
import { REFERENCE_VIDEOS } from '@/lib/playable/reference-videos'
import { getPlayableMode, PLAYABLE_MODES } from '@/lib/playable/template-registry'
import { playableModeIds } from '@/lib/playable/types'

describe('template registry', () => {
  it('registers every approved C6 mode with its exact metadata', () => {
    expect(PLAYABLE_MODES).toEqual([
      {
        id: 'center_collision',
        label: '中心碰撞',
        pluginId: 'mahjong-pair-match-playable',
        pluginVersion: '1.0.0',
        runtimeVersion: '2',
        description: '相同牌向中心碰撞、破碎并计分',
        configPath: 'skills/mahjong-pair-match-playable/assets/templates/center_collision/config.json',
        referencePath: 'skills/mahjong-pair-match-playable/references/modes/center_collision.md',
      },
      {
        id: 'top_rack',
        label: '上方牌架',
        pluginId: 'mahjong-pair-match-playable',
        pluginVersion: '1.0.0',
        runtimeVersion: '2',
        description: '可见牌进入四槽牌架，配对后清除',
        configPath: 'skills/mahjong-pair-match-playable/assets/templates/top_rack/config.json',
        referencePath: 'skills/mahjong-pair-match-playable/references/modes/top_rack.md',
      },
      {
        id: 'gravity_fill',
        label: '下落补位',
        pluginId: 'mahjong-pair-match-playable',
        pluginVersion: '1.0.0',
        runtimeVersion: '2',
        description: '网格配对消除后列下落并从上方补位',
        configPath: 'skills/mahjong-pair-match-playable/assets/templates/gravity_fill/config.json',
        referencePath: 'skills/mahjong-pair-match-playable/references/modes/gravity_fill.md',
      },
      {
        id: 'perspective_3d',
        label: '3D 纵深',
        pluginId: 'mahjong-pair-match-playable',
        pluginVersion: '1.0.0',
        runtimeVersion: '2',
        description: '移除立体牌墙顶面并揭示下层',
        configPath: 'skills/mahjong-pair-match-playable/assets/templates/perspective_3d/config.json',
        referencePath: 'skills/mahjong-pair-match-playable/references/modes/perspective_3d.md',
      },
    ])
  })

  it('derives the registry from the authoritative playable mode IDs', () => {
    expect(PLAYABLE_MODES.map(({ id }) => id)).toEqual(playableModeIds)
  })

  it('looks up every approved mode', () => {
    for (const mode of PLAYABLE_MODES) {
      expect(getPlayableMode(mode.id)).toBe(mode)
    }
  })

  it('rejects custom generation in the POC', () => {
    expect(() => getPlayableMode('custom')).toThrow('Unsupported playable mode: custom')
  })
})

describe('reference video provenance', () => {
  it('preserves every exact filename, mode, and regression focus mapping', () => {
    expect(REFERENCE_VIDEOS).toEqual([
      {
        filename: 'Mahjong Match：Classic Tiles！-360 X 640-2026-09-01-c2f1079b9cd7c5090195cbb97ac59e5f.mp4',
        mode: 'perspective_3d',
        regressionFocus: '立体塔体、中心开口、暴露顶面和下层揭示',
      },
      {
        filename: 'Vita Mahjong-360 X 640-2026-09-01-5a8ed5d387599541396edd43ed2336a7.mp4',
        mode: 'gravity_fill',
        regressionFocus: '密集平铺、选择高亮、列下落和补位',
      },
      {
        filename: 'Vita Mahjong-720 X 1280-2026-09-01-5712dfecddd48c49c51db9d56b2ab6ed.mp4',
        mode: 'top_rack',
        regressionFocus: '分层牌阵、上方牌架、配对清除和下层释放',
      },
      {
        filename: 'Mahjong Match：Classic Tiles！-360 X 640-2026-09-01-636b98221290a1df6cbdd961f80d9083 (1).mp4',
        mode: 'center_collision',
        regressionFocus: '交错堆叠、中心运动、碰撞破碎和计分',
      },
    ])
  })
})
