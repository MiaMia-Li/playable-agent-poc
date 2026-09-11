export const playableModeIds = ['center_collision', 'top_rack', 'gravity_fill', 'perspective_3d'] as const

export type PlayableModeId = (typeof playableModeIds)[number]

export interface PlayableMode {
  id: PlayableModeId
  label: string
  description: string
  configPath: string
  referencePath: string
  pluginId: string
  pluginVersion: string
  runtimeVersion: string
}

export const sourceTemplateIds = ['dragon_slots', 'dragon_reward_wheel', 'zeus_scatter', 'balloon_master'] as const
export type SourceTemplateId = (typeof sourceTemplateIds)[number]
