import { playableModeIds, type PlayableMode, type PlayableModeId } from './types'
import pluginManifest from '@/skills/mahjong-pair-match-playable/plugin.json'
import { z } from 'zod'

export interface PlayablePluginManifest {
  id: string
  name: string
  version: string
  runtimeVersion: string
  skillRoot: string
  modes: PlayableModeId[]
  assetSlots: string[]
  capabilities: {
    localUpload: boolean
    aiMediaGeneration: boolean
  }
  delivery: {
    networks: string[]
    entrypoint: 'playable.html'
    maxBytes: number
  }
  commands: {
    build: string
    validate: string
    validateFreeform: string
  }
  exploration: string[]
  freeformFallback: string[]
}

const playablePluginManifestSchema = z.strictObject({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  runtimeVersion: z.string().trim().min(1),
  skillRoot: z.string().trim().min(1),
  modes: z.array(z.enum(playableModeIds)).min(1),
  assetSlots: z.array(z.string().trim().min(1)).min(1),
  capabilities: z.strictObject({
    localUpload: z.boolean(),
    aiMediaGeneration: z.boolean(),
  }),
  delivery: z.strictObject({
    networks: z.array(z.string().trim().min(1)).min(1),
    entrypoint: z.literal('playable.html'),
    maxBytes: z.number().int().positive(),
  }),
  commands: z.strictObject({
    build: z.string().trim().min(1),
    validate: z.string().trim().min(1),
    validateFreeform: z.string().trim().min(1),
  }),
  exploration: z.array(z.string().trim().min(1)),
  freeformFallback: z.array(z.string().trim().min(1)),
})

export const MAHJONG_PLAYABLE_PLUGIN: PlayablePluginManifest = playablePluginManifestSchema.parse(pluginManifest)

const skillRoot = MAHJONG_PLAYABLE_PLUGIN.skillRoot

const playableModeDefinitions = {
  center_collision: {
    label: '中心碰撞',
    description: '相同牌向中心碰撞、破碎并计分',
    configPath: `${skillRoot}/assets/templates/center_collision/config.json`,
    referencePath: `${skillRoot}/references/modes/center_collision.md`,
  },
  top_rack: {
    label: '上方牌架',
    description: '可见牌进入四槽牌架，配对后清除',
    configPath: `${skillRoot}/assets/templates/top_rack/config.json`,
    referencePath: `${skillRoot}/references/modes/top_rack.md`,
  },
  gravity_fill: {
    label: '下落补位',
    description: '网格配对消除后列下落并从上方补位',
    configPath: `${skillRoot}/assets/templates/gravity_fill/config.json`,
    referencePath: `${skillRoot}/references/modes/gravity_fill.md`,
  },
  perspective_3d: {
    label: '3D 纵深',
    description: '移除立体牌墙顶面并揭示下层',
    configPath: `${skillRoot}/assets/templates/perspective_3d/config.json`,
    referencePath: `${skillRoot}/references/modes/perspective_3d.md`,
  },
} satisfies Record<PlayableModeId, Omit<PlayableMode, 'id' | 'pluginId' | 'pluginVersion' | 'runtimeVersion'>>

export const PLAYABLE_MODES: readonly PlayableMode[] = playableModeIds.map((id) => ({
  id,
  ...playableModeDefinitions[id],
  pluginId: MAHJONG_PLAYABLE_PLUGIN.id,
  pluginVersion: MAHJONG_PLAYABLE_PLUGIN.version,
  runtimeVersion: MAHJONG_PLAYABLE_PLUGIN.runtimeVersion,
}))

export function getPlayableMode(value: string): PlayableMode {
  const mode = PLAYABLE_MODES.find((candidate) => candidate.id === value)
  if (!mode) throw new Error(`Unsupported playable mode: ${value}`)
  return mode
}

export function getPlayablePlugin(pluginId: string): PlayablePluginManifest {
  if (pluginId !== MAHJONG_PLAYABLE_PLUGIN.id) throw new Error('Unsupported playable Plugin')
  return MAHJONG_PLAYABLE_PLUGIN
}
