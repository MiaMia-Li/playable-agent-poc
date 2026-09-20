'use client'

import type { BuildTimelineEvent } from '@/lib/playable/build-activity'

import { sourceTemplateIds, type SourceTemplateId } from '@/lib/playable/types'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, Paperclip } from 'lucide-react'
import type { Session } from '@/lib/session/types'
import type {
  ConfirmationProposal,
  GameplayAnnotation,
  GameplayBlueprint,
  PlayableTaskPhase,
  RequirementBrief,
  RevisionProposal,
  TimelineCorrection,
  VideoAnalysisStatus,
} from '@/lib/playable/schemas'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ChatWorkspace } from './chat-workspace'
import type { ConversationMessage } from './chat-workspace'
import { PlayablePreview } from './playable-preview'
import { FolderUploadButton } from './folder-upload-button'
import { AssetPreviewList } from './asset-preview-list'
import {
  MAX_HOME_ATTACHMENTS,
  PLAYABLE_ATTACHMENT_ACCEPT,
  maxAssetBytesForSlot,
  referenceSlotForMimeType,
  attachmentSlotForFile,
  normalizeAttachmentBatch,
  assetSizeError,
  playableFileMimeType,
} from '@/lib/playable/asset-policy'
import type { SafePlayableAsset } from '@/lib/playable/task-assets'
import type { AppliedMediaResolution } from '@/lib/playable/video-gameplay-analyst'
import {
  isReferenceVideoTooLong,
  REFERENCE_VIDEO_TOO_LONG_MESSAGE,
  requestReferenceVideoAnalysis,
  uploadPlayableAsset,
} from '@/lib/playable/reference-video-client'
import type { PlayableValidationSummary } from '@/lib/playable/playable-agent-adapter'
import { PLAYABLE_TEMPLATES, templatePrompts, type PlayableTemplateId } from '@/lib/playable/template-catalog'
import { usePlayableRecentTasks } from './recent-tasks-context'
import { TemplatePreview } from './template-preview'
import { TemplatePreviewDialog } from './template-preview-dialog'

interface PlayableWorkspaceProps {
  taskId: string
  /** @deprecated Shared credentials are configured server-side. */
  initialApiKeyConfigured?: boolean
  initialPrompt?: string
  initialPhase?: PlayableTaskPhase
  initialProposal?: ConfirmationProposal
  initialRevision?: RevisionProposal
  initialBrief?: RequirementBrief
  initialHasArtifact?: boolean
  initialArtifactVersion?: string | null
  initialBuildId?: string
  initialBuildFailureMessage?: string
  initialValidation?: PlayableValidationSummary | null
  localDemo?: boolean
  localCodex?: boolean
  localHarness?: boolean
  publicAccess?: boolean
  initialConversation?: ConversationMessage[]
  initialAssets?: SafePlayableAsset[]
  initialVideoAnalysisStatus?: VideoAnalysisStatus
  initialGameplayBlueprint?: GameplayBlueprint
  initialVideoAnalysisMediaResolution?: AppliedMediaResolution | null
  /** The server's pointer, which analysis and the blueprint are read through. */
  initialActiveReferenceVideoId?: string | null
  /** Already filtered to the active video by the page. */
  initialGameplayAnnotations?: GameplayAnnotation[]
}

interface VideoAnalysisSnapshot {
  assetId?: string
  status: VideoAnalysisStatus
  blueprint: GameplayBlueprint | null
  mediaResolution?: AppliedMediaResolution | null
  intentPending?: boolean
  keyframeStatus?: import('@/lib/playable/schemas').ReferenceKeyframeStatus | null
  keyframes?: import('./gameplay-timeline').ReferenceKeyframeView[]
}

/** Keyframes are cut after the analysis settles, so polling has to outlast it. */
function isKeyframeExtractionInFlight(
  status: import('@/lib/playable/schemas').ReferenceKeyframeStatus | null | undefined,
): boolean {
  return status === 'pending' || status === 'extracting'
}

/**
 * How long to keep checking for an intent comparison after the brief changes.
 * It runs after the turn with no status of its own to poll on, and a failed
 * one leaves the comparison owed, so the wait needs an end.
 */
const INTENT_CHECK_WINDOW_MS = 120_000

function isVideoAnalysisInFlight(status: VideoAnalysisStatus | undefined): boolean {
  return status === 'pending' || status === 'preprocessing' || status === 'analyzing'
}

const phaseRank: Record<PlayableTaskPhase, number> = {
  draft: 0,
  awaiting_confirmation: 1,
  awaiting_revision_confirmation: 1,
  building: 2,
  validating: 3,
  reviewing: 4,
  ready: 5,
  needs_plugin: 5,
  failed: 5,
  cancelled: 5,
}

export function PlayableWorkspace({
  taskId,
  initialPrompt,
  initialPhase = 'draft',
  initialProposal,
  initialRevision,
  initialBrief,
  initialHasArtifact = false,
  initialArtifactVersion = null,
  initialBuildId,
  initialBuildFailureMessage,
  initialValidation = null,
  initialConversation = [],
  initialAssets = [],
  initialVideoAnalysisStatus,
  initialGameplayBlueprint,
  initialVideoAnalysisMediaResolution = null,
  initialActiveReferenceVideoId = null,
  initialGameplayAnnotations = [],
}: PlayableWorkspaceProps) {
  const [buildEvents, setBuildEvents] = useState<BuildTimelineEvent[]>([])
  const [phase, setPhase] = useState<PlayableTaskPhase>(initialPhase)
  const [proposalDraft, setProposalDraft] = useState(initialProposal)
  const [revisionDraft, setRevisionDraft] = useState(initialRevision)
  const [brief, setBrief] = useState(initialBrief)
  const [hasArtifact, setHasArtifact] = useState(initialHasArtifact)
  const [artifactVersion, setArtifactVersion] = useState(initialArtifactVersion)
  const [previewVersion, setPreviewVersion] = useState<string | null>(null)
  const [buildFailureMessage, setBuildFailureMessage] = useState(initialBuildFailureMessage)
  const [validation, setValidation] = useState<PlayableValidationSummary | null>(initialValidation)
  const [videoAnalysisStatus, setVideoAnalysisStatus] = useState<VideoAnalysisStatus | undefined>(
    initialVideoAnalysisStatus,
  )
  // Read synchronously by a message waiting on the analysis: the upload that
  // starts one happens inside the same send, before any re-render.
  const videoAnalysisStatusRef = useRef(initialVideoAnalysisStatus)
  const videoAnalysisWaiters = useRef(new Set<() => void>())
  const updateVideoAnalysisStatus = useCallback((status: VideoAnalysisStatus | undefined) => {
    videoAnalysisStatusRef.current = status
    setVideoAnalysisStatus(status)
    if (isVideoAnalysisInFlight(status)) return
    for (const settle of videoAnalysisWaiters.current) settle()
    videoAnalysisWaiters.current.clear()
  }, [])
  const waitForVideoAnalysis = useCallback((signal: AbortSignal, onWaiting: () => void) => {
    if (!isVideoAnalysisInFlight(videoAnalysisStatusRef.current)) return Promise.resolve()
    onWaiting()
    return new Promise<void>((resolve, reject) => {
      const settle = () => {
        signal.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        videoAnalysisWaiters.current.delete(settle)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      if (signal.aborted) return abort()
      videoAnalysisWaiters.current.add(settle)
      signal.addEventListener('abort', abort, { once: true })
    })
  }, [])
  const [gameplayBlueprint, setGameplayBlueprint] = useState<GameplayBlueprint | undefined>(initialGameplayBlueprint)
  const [referenceKeyframes, setReferenceKeyframes] = useState<import('./gameplay-timeline').ReferenceKeyframeView[]>(
    [],
  )
  // Undefined until the analysis route has been read: the page renders with
  // the blueprint only, so on a reload the keyframes still have to be fetched.
  const [keyframeStatus, setKeyframeStatus] = useState<
    import('@/lib/playable/schemas').ReferenceKeyframeStatus | null | undefined
  >(undefined)
  const [videoAnalysisMediaResolution, setVideoAnalysisMediaResolution] = useState<AppliedMediaResolution | null>(
    initialVideoAnalysisMediaResolution,
  )
  const [videoAnalysisUnavailable, setVideoAnalysisUnavailable] = useState(false)
  const [retryingVideoAnalysis, setRetryingVideoAnalysis] = useState(false)
  const [videoAnalysisIntentPending, setVideoAnalysisIntentPending] = useState(false)
  const [intentCheckRequestedAt, setIntentCheckRequestedAt] = useState<number>()
  const [assets, setAssets] = useState(initialAssets)
  const [activeReferenceVideoId, setActiveReferenceVideoId] = useState(initialActiveReferenceVideoId)
  // Mirrors of state read from async callbacks, which would otherwise see the
  // values from the render that created them.
  const activeReferenceVideoIdRef = useRef(initialActiveReferenceVideoId)
  const assetsRef = useRef(initialAssets)
  const [gameplayAnnotations, setGameplayAnnotations] = useState(initialGameplayAnnotations)
  const [deletingAnnotationId, setDeletingAnnotationId] = useState<string>()

  const refreshAnnotations = useCallback(async () => {
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/annotations`, {
        cache: 'no-store',
      })
      if (!response.ok) return
      const body = (await response.json()) as { annotations?: GameplayAnnotation[] }
      if (body.annotations) setGameplayAnnotations(body.annotations)
    } catch {
      // The list stays as it was; the next agent turn resends it anyway.
    }
  }, [taskId])

  const handleDeleteAnnotation = useCallback(
    async (annotation: GameplayAnnotation) => {
      setDeletingAnnotationId(annotation.id)
      try {
        const response = await fetch(
          `/api/playable-tasks/${encodeURIComponent(taskId)}/annotations?id=${encodeURIComponent(annotation.id)}`,
          { method: 'DELETE' },
        )
        if (!response.ok) return
        const body = (await response.json()) as { annotations?: GameplayAnnotation[] }
        if (body.annotations) setGameplayAnnotations(body.annotations)
      } catch {
        // Left in the list, which is the honest outcome of a delete that failed.
      } finally {
        setDeletingAnnotationId(undefined)
      }
    },
    [taskId],
  )

  // Written straight to the annotation list, not through the agent: the user
  // is stating what the video shows, and the route keeps it out of reach of
  // the agent's whole-list rewrite.
  const handleCorrectTimeline = useCallback(
    async (correction: TimelineCorrection) => {
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(correction),
        })
        if (!response.ok) return false
        const body = (await response.json()) as { annotations?: GameplayAnnotation[] }
        if (body.annotations) setGameplayAnnotations(body.annotations)
        return true
      } catch {
        return false
      }
    },
    [taskId],
  )

  const applyVideoAnalysis = useCallback(
    (analysis: VideoAnalysisSnapshot) => {
      setGameplayBlueprint(analysis.blueprint ?? undefined)
      setReferenceKeyframes(analysis.keyframes ?? [])
      setKeyframeStatus(analysis.keyframeStatus ?? null)
      setVideoAnalysisMediaResolution(analysis.mediaResolution ?? null)
      setVideoAnalysisIntentPending(Boolean(analysis.intentPending))
      updateVideoAnalysisStatus(analysis.status)
    },
    [updateVideoAnalysisStatus],
  )

  const clearVideoAnalysis = useCallback(() => {
    setGameplayBlueprint(undefined)
    setReferenceKeyframes([])
    setKeyframeStatus(null)
    setVideoAnalysisMediaResolution(null)
    setVideoAnalysisIntentPending(false)
    updateVideoAnalysisStatus(undefined)
  }, [updateVideoAnalysisStatus])

  const handleBrief = useCallback((nextBrief: RequirementBrief) => {
    setBrief(nextBrief)
    if (activeReferenceVideoIdRef.current) setIntentCheckRequestedAt(Date.now())
  }, [])

  const activateReferenceVideo = useCallback((assetId: string | null) => {
    activeReferenceVideoIdRef.current = assetId
    setActiveReferenceVideoId(assetId)
    // Annotations are bound to the video they describe; the previous video's
    // must not be shown against this one's timeline.
    setGameplayAnnotations([])
  }, [])

  const startVideoAnalysis = useCallback(
    async (assetId: string, rerun: boolean) => {
      setRetryingVideoAnalysis(true)
      try {
        const response = await requestReferenceVideoAnalysis(taskId, assetId, { rerun })
        // Another upload may have taken over while this was in flight; its own
        // request owns the state now.
        if (activeReferenceVideoIdRef.current !== assetId) return
        if (response.status === 503) {
          clearVideoAnalysis()
          setVideoAnalysisUnavailable(true)
          return
        }
        if (!response.ok) {
          updateVideoAnalysisStatus('failed')
          return
        }
        const body = (await response.json()) as { analysis?: VideoAnalysisSnapshot | null }
        if (body.analysis) applyVideoAnalysis(body.analysis)
      } catch {
        if (activeReferenceVideoIdRef.current === assetId) updateVideoAnalysisStatus('failed')
      } finally {
        setRetryingVideoAnalysis(false)
      }
    },
    [applyVideoAnalysis, clearVideoAnalysis, taskId, updateVideoAnalysisStatus],
  )

  // A reload renders with the blueprint alone; read the keyframes once so the
  // timeline can show them without waiting for another analysis.
  const blueprintHasKeyframes = Boolean(gameplayBlueprint?.keyframes.length)
  useEffect(() => {
    if (!blueprintHasKeyframes || keyframeStatus !== undefined) return
    let active = true
    void fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/analysis`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return
        const body = (await response.json()) as { analysis?: VideoAnalysisSnapshot | null }
        if (active && body.analysis) applyVideoAnalysis(body.analysis)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [applyVideoAnalysis, blueprintHasKeyframes, keyframeStatus, taskId])

  useEffect(() => {
    if (!isVideoAnalysisInFlight(videoAnalysisStatus) && !isKeyframeExtractionInFlight(keyframeStatus)) return
    let active = true
    let timeout: number | undefined
    const poll = async () => {
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/analysis`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as { analysis?: VideoAnalysisSnapshot | null }
        if (!active || !body.analysis) return
        applyVideoAnalysis(body.analysis)
      } catch {
        // Keep polling after transient analysis status failures.
      } finally {
        if (active) timeout = window.setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [applyVideoAnalysis, keyframeStatus, taskId, videoAnalysisStatus])

  useEffect(() => {
    if (intentCheckRequestedAt === undefined) return
    let active = true
    let timeout: number | undefined
    const deadline = intentCheckRequestedAt + INTENT_CHECK_WINDOW_MS
    const poll = async () => {
      let pending = true
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/analysis`, {
          cache: 'no-store',
        })
        if (response.ok) {
          const body = (await response.json()) as { analysis?: VideoAnalysisSnapshot | null }
          if (!active) return
          if (body.analysis) applyVideoAnalysis(body.analysis)
          pending = Boolean(body.analysis?.intentPending)
        }
      } catch {
        // A transient failure keeps the check going until the window closes.
      }
      if (active && pending && Date.now() < deadline) timeout = window.setTimeout(poll, 3000)
    }
    void poll()
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [applyVideoAnalysis, intentCheckRequestedAt, taskId])

  useEffect(() => {
    // 非草稿阶段首次读取历史记录；只有活跃构建持续轮询，待确认时刷新也不能丢失旧构建。
    if (phase === 'draft') return
    let active = true
    let timeout: number | undefined
    const poll = async () => {
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/events`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as {
          task?: {
            phase: PlayableTaskPhase
            hasArtifact: boolean
            artifactVersion: string | null
            previewVersion?: string | null
            latestValidation: PlayableValidationSummary | null
            requirementBrief: RequirementBrief | null
            confirmation: ConfirmationProposal | null
            pendingRevision: RevisionProposal | null
          }
          events?: Array<BuildTimelineEvent & { message?: string }>
        }
        if (!active || !body.task) return
        setBuildEvents(body.events ?? [])
        setPhase((current) => (phaseRank[body.task!.phase] >= phaseRank[current] ? body.task!.phase : current))
        if (body.task.phase === 'failed') {
          setBuildFailureMessage(body.events?.findLast((event) => event.type === 'build_failed')?.message)
        }
        if (body.task.requirementBrief) setBrief(body.task.requirementBrief)
        if (body.task.confirmation) setProposalDraft(body.task.confirmation)
        setRevisionDraft(body.task.pendingRevision ?? undefined)
        setHasArtifact(body.task.hasArtifact)
        setArtifactVersion(body.task.artifactVersion)
        setPreviewVersion(body.task.previewVersion ?? null)
        setValidation(body.task.latestValidation)
      } catch {
        // A transient polling failure must not clear the last successful preview.
      } finally {
        if (active && ['building', 'validating'].includes(phase)) timeout = window.setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [phase, taskId])

  /**
   * Follows the server's active pointer rather than guessing from the asset
   * list: an upload makes its video active and a delete of the active video
   * clears it, so those are the only two transitions mirrored here. A new
   * upload starts analysis straight away, so the user's typing time is spent
   * analysing rather than waiting after they send.
   */
  const handleAssetsChange = useCallback(
    (nextAssets: SafePlayableAsset[]) => {
      const knownIds = new Set(assetsRef.current.map((asset) => asset.id))
      const uploadedVideo = nextAssets
        .filter((asset) => asset.slot === 'referenceVideo' && !knownIds.has(asset.id))
        .at(-1)
      assetsRef.current = nextAssets
      setAssets(nextAssets)
      if (uploadedVideo) {
        activateReferenceVideo(uploadedVideo.id)
        clearVideoAnalysis()
        updateVideoAnalysisStatus('pending')
        void startVideoAnalysis(uploadedVideo.id, false)
        return
      }
      const activeId = activeReferenceVideoIdRef.current
      if (activeId && !nextAssets.some((asset) => asset.id === activeId)) {
        activateReferenceVideo(null)
        clearVideoAnalysis()
      }
    },
    [activateReferenceVideo, clearVideoAnalysis, startVideoAnalysis, updateVideoAnalysisStatus],
  )

  // With no active video — a task from before v2, or after deleting the active
  // one — the newest remaining video is what an explicit start targets. The
  // request names it, and the route makes it active, so this is a choice the
  // user makes by pressing the button rather than one made on their behalf.
  const analysisTargetId =
    activeReferenceVideoId ?? assets.filter((asset) => asset.slot === 'referenceVideo').at(-1)?.id ?? null
  const handleRetryVideoAnalysis = useCallback(
    ({ rerun }: { rerun: boolean }) => {
      if (!analysisTargetId) return
      if (activeReferenceVideoIdRef.current === analysisTargetId) {
        void startVideoAnalysis(analysisTargetId, rerun)
        return
      }
      // An existing video may already have annotations from before it lost
      // the active slot. They can only be read once the route has made it
      // active again, so the refresh waits for that request.
      activateReferenceVideo(analysisTargetId)
      void startVideoAnalysis(analysisTargetId, rerun).then(refreshAnnotations)
    },
    [activateReferenceVideo, analysisTargetId, refreshAnnotations, startVideoAnalysis],
  )
  const handleVideoAnalysisToolStatus = useCallback(
    async (status: 'started' | 'completed' | 'pending' | 'failed') => {
      // The analysis is still running and its own polling reports the outcome.
      if (status === 'pending') return
      if (status === 'started') {
        updateVideoAnalysisStatus('analyzing')
        return
      }
      if (status === 'failed') {
        updateVideoAnalysisStatus('failed')
        return
      }
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/analysis`, {
          cache: 'no-store',
        })
        if (!response.ok) {
          updateVideoAnalysisStatus('failed')
          return
        }
        const body = (await response.json()) as { analysis?: VideoAnalysisSnapshot | null }
        if (!body.analysis) {
          updateVideoAnalysisStatus('failed')
          return
        }
        applyVideoAnalysis(body.analysis)
      } catch {
        updateVideoAnalysisStatus('failed')
      }
    },
    [applyVideoAnalysis, taskId, updateVideoAnalysisStatus],
  )

  return (
    <main className="bg-background flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[2fr_3fr]">
        <ChatWorkspace
          buildEvents={buildEvents}
          taskId={taskId}
          initialPrompt={initialPrompt}
          phase={phase}
          proposal={proposalDraft}
          revision={revisionDraft}
          hasArtifact={hasArtifact}
          brief={brief}
          onProposal={setProposalDraft}
          onRevision={setRevisionDraft}
          onBrief={handleBrief}
          onPhase={setPhase}
          autoSubmitInitialPrompt={initialConversation.length === 0}
          initialConversation={initialConversation}
          initialAssets={assets}
          videoAnalysisStatus={videoAnalysisStatus}
          gameplayBlueprint={gameplayBlueprint}
          referenceKeyframes={referenceKeyframes}
          referenceKeyframeStatus={keyframeStatus}
          onAssetsChange={handleAssetsChange}
          onVideoAnalysisToolStatus={(status) => void handleVideoAnalysisToolStatus(status)}
          waitForVideoAnalysis={waitForVideoAnalysis}
          videoAnalysisMediaResolution={videoAnalysisMediaResolution}
          videoAnalysisUnavailable={videoAnalysisUnavailable}
          videoAnalysisIntentPending={videoAnalysisIntentPending}
          referenceVideoAwaitingAnalysis={Boolean(analysisTargetId) && !videoAnalysisStatus}
          retryingVideoAnalysis={retryingVideoAnalysis}
          onRetryVideoAnalysis={handleRetryVideoAnalysis}
          gameplayAnnotations={gameplayAnnotations}
          onAnnotations={setGameplayAnnotations}
          onDeleteAnnotation={(annotation) => void handleDeleteAnnotation(annotation)}
          deletingAnnotationId={deletingAnnotationId}
          referenceVideoUrl={
            activeReferenceVideoId
              ? `/api/playable-tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(activeReferenceVideoId)}`
              : undefined
          }
          onCorrectTimeline={handleCorrectTimeline}
        />
        <PlayablePreview
          taskId={taskId}
          phase={phase}
          hasArtifact={hasArtifact}
          artifactVersion={artifactVersion}
          previewVersion={previewVersion}
          initialBuildId={initialBuildId}
          confirmation={proposalDraft}
          revision={revisionDraft}
          onPhase={setPhase}
          failureMessage={buildFailureMessage}
          initialValidation={validation}
        />
      </div>
    </main>
  )
}

interface HomeAttachment {
  id: string
  file: File
  previewUrl?: string
}

interface PlayableHomeProps {
  user: Session['user'] | null
  authProvider: Session['authProvider'] | null
  localDemo?: boolean
  localCodex?: boolean
  localHarness?: boolean
  publicAccess?: boolean
}

export function PlayableHome({
  user,
  localDemo = false,
  localCodex = false,
  localHarness = false,
  publicAccess = false,
}: PlayableHomeProps) {
  const router = useRouter()
  const recentTasks = usePlayableRecentTasks()
  const attachmentInput = useRef<HTMLInputElement>(null)
  const attachmentSequence = useRef(0)
  const attachmentUrls = useRef(new Set<string>())
  const attachmentsRef = useRef<HomeAttachment[]>([])
  const creatingRef = useRef(false)
  const retryRef = useRef<
    | {
        fingerprint: string
        taskId: string
        uploadedIds: Set<string>
        /** Kept across a retry so a video uploaded on the first try still gets analysed. */
        referenceVideoAssetId?: string
      }
    | undefined
  >(undefined)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<HomeAttachment[]>([])
  const [creating, setCreating] = useState(false)
  const [creatingTemplate, setCreatingTemplate] = useState<PlayableTemplateId>()
  const [previewMode, setPreviewMode] = useState<PlayableTemplateId>()
  const [error, setError] = useState('')
  const [packingFolder, setPackingFolder] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  // dragenter/dragleave also fire for every child crossed, so only the outermost
  // pair toggles the drop highlight.
  const dragDepth = useRef(0)
  const canDropAttachments = Boolean(user) && !creating && !creatingTemplate && !packingFolder

  useEffect(
    () => () => {
      for (const url of attachmentUrls.current) URL.revokeObjectURL(url)
    },
    [],
  )

  async function createPlayable() {
    const content = prompt.trim() || '请根据上传的参考素材制作试玩'
    const attachmentSnapshot = attachmentsRef.current
    // 点击和键盘提交都经过此处，打包未完成时不能生成缺少文件夹附件的需求。
    if ((!prompt.trim() && attachmentSnapshot.length === 0) || creatingRef.current || packingFolder) return
    const fingerprint = JSON.stringify({
      content,
      attachments: attachmentSnapshot.map(({ id, file }) => ({
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
    })
    creatingRef.current = true
    setCreating(true)
    setError('')
    try {
      let retry = retryRef.current
      if (!retry || retry.fingerprint !== fingerprint) {
        const response = await fetch('/api/playable-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: content }),
        })
        if (!response.ok) throw new Error('创建试玩失败')
        const body = (await response.json()) as { task: { id: string } }
        retry = { fingerprint, taskId: body.task.id, uploadedIds: new Set() }
        retryRef.current = retry
        recentTasks?.addTask({
          id: body.task.id,
          prompt: content,
          title: null,
          phase: 'draft',
          createdAt: new Date().toISOString(),
        })
      }
      for (const { id, file } of attachmentSnapshot) {
        if (retry.uploadedIds.has(id)) continue
        const slot = attachmentSlotForFile(file)
        if (!slot) throw new Error('参考素材格式不受支持')
        const uploadedAsset = await uploadPlayableAsset(retry.taskId, slot, file, {
          fallbackMessage: '参考素材上传失败',
        })
        if (slot === 'referenceVideo') retry.referenceVideoAssetId = uploadedAsset.id
        retry.uploadedIds.add(id)
      }
      // Started before navigating so the task page opens on an analysis that
      // is already under way. Not awaited past the 202: the run itself is in
      // the background, and a refusal here only means the task page will offer
      // to start it instead.
      if (retry.referenceVideoAssetId) {
        await requestReferenceVideoAnalysis(retry.taskId, retry.referenceVideoAssetId).catch(() => undefined)
      }
      retryRef.current = undefined
      router.push(`/tasks/${retry.taskId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建试玩失败')
      setCreating(false)
    } finally {
      creatingRef.current = false
    }
  }

  async function createFromTemplate(mode: PlayableTemplateId) {
    if (creatingRef.current || packingFolder) return
    creatingRef.current = true
    setCreatingTemplate(mode)
    setError('')
    try {
      const response = await fetch('/api/playable-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: templatePrompts[mode],
          ...(sourceTemplateIds.includes(mode as SourceTemplateId) ? { sourceTemplateId: mode } : {}),
        }),
      })
      if (!response.ok) throw new Error('无法从模板创建试玩')
      const body = (await response.json()) as { task: { id: string } }
      recentTasks?.addTask({
        id: body.task.id,
        prompt: templatePrompts[mode],
        title: null,
        phase: 'draft',
        createdAt: new Date().toISOString(),
      })
      router.push(`/tasks/${body.task.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法从模板创建试玩')
      setCreatingTemplate(undefined)
    } finally {
      creatingRef.current = false
    }
  }

  function addAttachments(files: FileList | readonly File[] | null) {
    if (!files) return
    const accepted: HomeAttachment[] = []
    const remaining = Math.max(0, MAX_HOME_ATTACHMENTS - attachmentsRef.current.length)
    for (const file of normalizeAttachmentBatch(
      Array.from(files),
      attachmentsRef.current.some(({ file }) => /\.(atlas|skel)$/i.test(file.name)),
    )) {
      if (accepted.length >= remaining) {
        setError(`最多可以添加 ${MAX_HOME_ATTACHMENTS} 个参考素材`)
        break
      }
      const slot = attachmentSlotForFile(file)
      if (!slot) {
        setError(
          '仅支持 PNG、JPEG、WebP、GIF、SVG、MP4、WebM、GLB、HTML、ZIP、RAR 和 Spine（atlas、skel、json、png）文件',
        )
        continue
      }
      if (file.size <= 0 || file.size > maxAssetBytesForSlot(slot)) {
        setError(assetSizeError(slot))
        continue
      }
      const previewUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined
      if (previewUrl) attachmentUrls.current.add(previewUrl)
      attachmentSequence.current += 1
      accepted.push({ id: `attachment-${attachmentSequence.current}`, file, previewUrl })
    }
    const next = [...attachmentsRef.current, ...accepted]
    attachmentsRef.current = next
    setAttachments(next)
    void evictOverlongVideos(accepted)
  }

  /**
   * Staging stays synchronous so the picker feels immediate; the duration read
   * that follows is asynchronous, so an overlong video is taken back out once
   * it is known. Creating before this settles is still safe, because the upload
   * itself refuses the same video.
   */
  async function evictOverlongVideos(candidates: HomeAttachment[]) {
    const videos = candidates.filter(({ file }) => referenceSlotForMimeType(file.type) === 'referenceVideo')
    if (videos.length === 0) return
    const overlong = await Promise.all(
      videos.map(async ({ id, file }) => ((await isReferenceVideoTooLong(file)) ? id : null)),
    )
    const overlongIds = overlong.filter((id): id is string => id !== null)
    if (overlongIds.length === 0) return
    for (const id of overlongIds) removeAttachment(id)
    setError(REFERENCE_VIDEO_TOO_LONG_MESSAGE)
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id)
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
        attachmentUrls.current.delete(target.previewUrl)
      }
      const next = current.filter((attachment) => attachment.id !== id)
      attachmentsRef.current = next
      return next
    })
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 lg:pt-24 lg:pb-16">
      <section className="mx-auto max-w-4xl text-center" aria-labelledby="home-heading">
        <h1 id="home-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
          想做一个什么样的试玩？
        </h1>
        <p className="text-muted-foreground mt-3 text-sm sm:text-base">
          说说你的玩法想法，或上传参考素材，我们从这里开始。
        </p>
        <div
          className={cn(
            'bg-background mt-6 rounded-2xl border p-2.5 text-left transition-colors',
            draggingFiles && 'border-primary bg-primary/5 ring-primary/30 ring-2',
          )}
          data-dragging={draggingFiles || undefined}
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            dragDepth.current += 1
            if (canDropAttachments) setDraggingFiles(true)
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = canDropAttachments ? 'copy' : 'none'
          }}
          onDragLeave={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDraggingFiles(false)
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            dragDepth.current = 0
            setDraggingFiles(false)
            if (!canDropAttachments) return
            addAttachments(event.dataTransfer.files)
          }}
        >
          <Textarea
            aria-label="新试玩需求"
            placeholder="描述玩法，或上传／拖入视频、HTML、ZIP/RAR、Spine 资源…"
            className="min-h-20 resize-none border-0 px-2.5 py-2 text-base shadow-none focus-visible:ring-0"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={!user || creating || Boolean(creatingTemplate)}
          />
          <p className="text-muted-foreground px-2 text-xs">
            支持选择文件夹并保留目录结构，打包后最多 100 MiB。HTML、ZIP/RAR 单文件最多 100 MiB；Spine 请一起选择
            atlas、PNG 和 skel/JSON，合计最多 100 MiB。
          </p>
          {attachments.length > 0 && (
            <div className="mb-3 px-1">
              <AssetPreviewList
                ariaLabel="已选择的参考素材"
                items={attachments.map(({ id, file, previewUrl }) => ({
                  id,
                  filename: file.name,
                  mimeType: playableFileMimeType(file),
                  size: file.size,
                  previewUrl,
                }))}
                disabled={creating}
                onRemove={(item) => removeAttachment(item.id)}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={!user || creating || attachments.length >= MAX_HOME_ATTACHMENTS}
              onClick={() => attachmentInput.current?.click()}
              aria-label="添加参考图片、视频、SVG、GLB、HTML、压缩包或 Spine 资源"
            >
              <Paperclip aria-hidden="true" />
            </Button>
            <input
              ref={attachmentInput}
              className="sr-only"
              type="file"
              multiple
              accept={PLAYABLE_ATTACHMENT_ACCEPT}
              aria-label="上传参考图片、视频、SVG、GLB、HTML、压缩包或 Spine 资源"
              disabled={!user || creating}
              onChange={(event) => {
                addAttachments(event.target.files)
                event.target.value = ''
              }}
            />
            <FolderUploadButton
              disabled={!user || creating || Boolean(creatingTemplate) || attachments.length >= MAX_HOME_ATTACHMENTS}
              onFile={(file) => addAttachments([file])}
              onError={setError}
              onBusyChange={setPackingFolder}
            />
            <Button
              size="icon"
              className="rounded-full"
              onClick={() => void createPlayable()}
              disabled={!user || (!prompt.trim() && attachments.length === 0) || creating || packingFolder}
              aria-label="新建试玩"
            >
              {creating ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            </Button>
          </div>
        </div>
        {!user && !publicAccess && <p className="text-muted-foreground mt-3 text-sm">登录后即可创建并保存试玩。</p>}
        {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
      </section>

      <section className="mt-10" aria-labelledby="quick-start-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="quick-start-heading" className="font-semibold">
            从玩法模板快速开始
          </h2>
          <Link href="/best-practices" className="text-muted-foreground hover:text-foreground text-sm">
            浏览全部模板 →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAYABLE_TEMPLATES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="group overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5 hover:bg-muted/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              onClick={() => setPreviewMode(mode.id)}
              aria-label={`预览${mode.label}模板`}
            >
              <div className="relative aspect-[4/5] w-full border-b">
                <TemplatePreview mode={mode.id} title={`${mode.label}模板封面`} className="absolute inset-0" />
                <span className="bg-background/90 absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap shadow-sm backdrop-blur-sm">
                  点击试玩
                </span>
              </div>
              <div className="min-h-24 px-3 py-3">
                <h3 className="text-sm font-semibold">{mode.label}</h3>
                <p className="text-muted-foreground mt-1 text-xs leading-5">{mode.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
      <TemplatePreviewDialog
        mode={PLAYABLE_TEMPLATES.find((mode) => mode.id === previewMode)}
        creating={Boolean(previewMode && creatingTemplate === previewMode)}
        canStart={Boolean(user)}
        onOpenChange={(open) => {
          if (!open) setPreviewMode(undefined)
        }}
        onStart={(mode) => void createFromTemplate(mode.id)}
      />
    </main>
  )
}
