export const playableModeIds = ['center_collision', 'top_rack', 'gravity_fill', 'perspective_3d'] as const

export type PlayableModeId = (typeof playableModeIds)[number]

export interface PlayableMode {
  id: PlayableModeId
  label: string
  description: string
  configPath: string
  referencePath: string
}
