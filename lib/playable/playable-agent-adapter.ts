import type { ConfirmationProposal, PlayableAgentReply } from './schemas'
import type { PlayableAssetSlot, SafePlayableAsset } from './task-assets'

export interface AgentConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface PlayableBuildAsset {
  id: string
  slot: PlayableAssetSlot
  filename: string
  mimeType: string
  size: number
  bytes: Uint8Array
}

export interface PlayableAssetManifest {
  plugin: {
    id: string
    version: string
    runtimeVersion: string
  }
  sources: Array<{
    slot: PlayableAssetSlot
    status: ConfirmationProposal['resources'][PlayableAssetSlot]['status']
    treatment: string
    origin: string
    files: string[]
  }>
  assets: Array<Omit<PlayableBuildAsset, 'bytes'> & { workspacePath: string }>
  entrypoint: 'playable.html'
}

export interface PlayableValidationReport {
  passed: boolean
  behavior: 'passed'
  bytes: number
  plugin: {
    id: string
    version: string
    runtimeVersion: string
  }
  gates: {
    schema: 'passed'
    behavior: 'passed'
    packageSize: 'passed' | 'failed'
    offlineResources: 'passed' | 'failed'
    responsiveViewport: 'passed' | 'failed'
    initialMute: 'passed'
    firstInteractionNavigation: 'passed'
    credentialScan: 'passed'
  }
}

export interface AgentInput {
  taskId: string
  prompt: string
  apiKey: string
  history?: AgentConversationTurn[]
  confirmation?: ConfirmationProposal | null
  assets?: SafePlayableAsset[]
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
  validation: PlayableValidationReport
}

export interface PlayableAgentAdapter {
  proposeConfirmation(input: AgentInput): Promise<PlayableAgentReply>
  build(input: ConfirmedBuildInput): Promise<BuildResult>
  cancel(taskId: string): Promise<void>
}
