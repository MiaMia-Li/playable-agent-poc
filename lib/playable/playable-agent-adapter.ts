import type { ConfirmationProposal, PlayableAgentReply, RequirementBrief } from './schemas'
import type { PlayableResourceAssetSlot } from './asset-policy'
import type { SafePlayableAsset } from './task-assets'

export interface AgentConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface PlayableBuildAsset {
  id: string
  slot: PlayableResourceAssetSlot
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
    slot: PlayableResourceAssetSlot
    status: ConfirmationProposal['resources'][PlayableResourceAssetSlot]['status']
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
  brief?: RequirementBrief | null
  assets?: SafePlayableAsset[]
}

export interface AgentReplyProgress {
  message?: string
  reasoning?: string
}

export interface AgentReplyOptions {
  onProgress?: (progress: AgentReplyProgress) => void
}

export type PlayableAgentErrorCode =
  | 'sandbox_configuration'
  | 'session_start_failed'
  | 'stream_failed'
  | 'output_invalid'

export class PlayableAgentError extends Error {
  constructor(readonly code: PlayableAgentErrorCode) {
    super('Playable agent operation failed')
    this.name = 'PlayableAgentError'
  }
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
  proposeConfirmation(input: AgentInput, options?: AgentReplyOptions): Promise<PlayableAgentReply>
  build(input: ConfirmedBuildInput): Promise<BuildResult>
  cancel(taskId: string): Promise<void>
}
