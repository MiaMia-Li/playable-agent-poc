import type { ConfirmationProposal } from './schemas'
import type { PlayableAssetSlot } from './task-assets'

export interface PlayableBuildAsset {
  id: string
  slot: PlayableAssetSlot
  filename: string
  mimeType: string
  size: number
  bytes: Uint8Array
}

export interface PlayableAssetManifest {
  assets: Array<Omit<PlayableBuildAsset, 'bytes'> & { workspacePath: string }>
  entrypoint: 'playable.html'
}

export interface AgentInput {
  taskId: string
  prompt: string
  apiKey: string
}

export interface ConfirmedBuildInput {
  taskId: string
  apiKey: string
  confirmation: ConfirmationProposal
  assets?: PlayableBuildAsset[]
}

export interface BuildResult {
  html: string
  assetManifest?: PlayableAssetManifest
  validation: {
    behavior: 'passed'
    bytes: number
  }
}

export interface PlayableAgentAdapter {
  proposeConfirmation(input: AgentInput): Promise<ConfirmationProposal>
  build(input: ConfirmedBuildInput): Promise<BuildResult>
  cancel(taskId: string): Promise<void>
}
