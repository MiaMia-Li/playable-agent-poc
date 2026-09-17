import type { BuildActivityCallback } from './build-activity'
import type {
  ConfirmationProposal,
  ReferenceImageEvidence,
  GameplayAnnotation,
  GameplayBlueprintDocument,
  PlayableAgentReply,
  RequirementBrief,
  RevisionProposal,
} from './schemas'
import type { PlayableResourceAssetSlot } from './asset-policy'
import type { ReferenceKeyframeBuildInput, VisualComparison } from './reference-keyframes-build'
import type { ResolvedReferenceSelection, SearchBrief } from './research/schemas'
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
  rendering?: { renderer: 'threejs'; physics: 'none' | 'rapier'; passed: true | null; status?: 'passed' | 'not_run' }
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
  referenceImages?: ReferenceImageEvidence[]
  gameplayBlueprint?: GameplayBlueprintDocument
  annotations?: GameplayAnnotation[]
  hasArtifact?: boolean
  // 服务端锁定的真实历史产物优先于模型推断；html 可能裁剪，仅供需求分析。
  lockedRevisionBase?: { buildId: string; version: number; html: string; truncated: boolean }
  versions?: { version: number; buildId: string; isLatest: boolean; acceptance?: 'passed' | 'pending' | 'failed' }[]
  pendingRevision?: RevisionProposal | null
  referenceSelection?: ResolvedReferenceSelection
}

export interface AgentReplyProgress {
  message?: string
  reasoning?: string
}

export type RequirementAnalysisToolCall =
  | {
      name: 'read_playable_version'
      version: number
      assetIds: []
      assetId: null
      searchBrief?: null
    }
  | {
      name: 'inspect_reference_images'
      assetIds: string[]
      assetId: null
      searchBrief?: null
    }
  | {
      name: 'analyze_reference_video'
      assetIds: []
      assetId: string
      searchBrief?: null
    }
  | {
      name: 'search_market_references'
      assetIds: []
      assetId: null
      searchBrief: SearchBrief
    }

export type AgentToolProgress = AgentReplyProgress &
  (
    | { type: 'tool_started'; toolCall: RequirementAnalysisToolCall }
    | { type: 'tool_completed'; toolCall: RequirementAnalysisToolCall }
    | { type: 'tool_pending'; toolCall: RequirementAnalysisToolCall }
    | { type: 'tool_failed'; toolCall: RequirementAnalysisToolCall }
  )

export interface AgentReplyOptions {
  onProgress?: (progress: AgentReplyProgress | AgentToolProgress) => void
  abortSignal?: AbortSignal
  executeTool?: (toolCall: RequirementAnalysisToolCall, options?: { abortSignal?: AbortSignal }) => Promise<unknown>
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
  /** 基础安全检查通过后交给宿主保存为待验收版本；浏览器检查失败也保留产物。 */
  onPreview?: (html: string) => Promise<void>
  baseConfirmation?: ConfirmationProposal
  reusableScenarios?: { preview: string; full: string }
  /** 上报步骤及公开详情；由宿主脱敏后落库，回调不序列化进 Agent 配置。 */
  onActivity?: BuildActivityCallback
  taskId: string
  apiKey: string
  confirmation: ConfirmationProposal
  assets?: PlayableBuildAsset[]
  referenceImages?: (ReferenceImageEvidence & { mimeType: string; bytes: Uint8Array })[]
  gameplayBlueprint?: GameplayBlueprintDocument
  /** Only when the confirmation matches the reference's look (spec §5). */
  referenceKeyframes?: ReferenceKeyframeBuildInput[]
  revision?: RevisionProposal
  baseHtml?: string
}

export interface BuildResult {
  reusableScenarios?: { preview: string; full: string }
  /** The build agent's own comparison against the keyframes; a record, never a gate. */
  visualComparison?: VisualComparison
  html: string
  assetManifest?: PlayableAssetManifest
  validation: PlayableValidationReport
}

export interface PlayableAgentAdapter {
  proposeConfirmation(input: AgentInput, options?: AgentReplyOptions): Promise<PlayableAgentReply>
  build(input: ConfirmedBuildInput): Promise<BuildResult>
  cancel(taskId: string): Promise<void>
}
