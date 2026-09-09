import type {
  ConfirmationProposal,
  GameplayBlueprint,
  PlayableAgentReply,
  RequirementBrief,
  RevisionProposal,
} from './schemas'
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

export interface PlayableValidationSummary {
  buildPassed: boolean
  deliveryCompliant: boolean
  bytes: number
  delivery: {
    profileId: 'applovin' | 'generic_single_html'
    label: string
    maxBytes: number | null
  }
}

export interface PlayableValidationReport extends PlayableValidationSummary {
  passed: boolean
  behavior: 'passed'
  plugin: {
    id: string
    version: string
    runtimeVersion: string
  }
  gates: {
    schema: 'passed'
    behavior: 'passed'
    packageSize: 'passed' | 'failed' | 'not_applicable'
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
  attachedAssetIds?: string[]
  gameplayBlueprint?: GameplayBlueprint
  hasArtifact?: boolean
  pendingRevision?: RevisionProposal | null
}

export interface AgentReplyProgress {
  message?: string
  reasoning?: string
}

export type ReferenceAnalysisToolCall =
  | {
      name: 'inspect_reference_images'
      assetIds: string[]
      assetId: null
    }
  | {
      name: 'analyze_reference_video'
      assetIds: []
      assetId: string
    }

export type AgentToolProgress = AgentReplyProgress &
  (
    | { type: 'tool_started'; toolCall: ReferenceAnalysisToolCall }
    | { type: 'tool_completed'; toolCall: ReferenceAnalysisToolCall }
    | { type: 'tool_failed'; toolCall: ReferenceAnalysisToolCall }
  )

export interface AgentReplyOptions {
  onProgress?: (progress: AgentReplyProgress | AgentToolProgress) => void
  abortSignal?: AbortSignal
  executeTool?: (toolCall: ReferenceAnalysisToolCall, options?: { abortSignal?: AbortSignal }) => Promise<unknown>
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
  gameplayBlueprint?: GameplayBlueprint
  revision?: RevisionProposal
  baseHtml?: string
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
