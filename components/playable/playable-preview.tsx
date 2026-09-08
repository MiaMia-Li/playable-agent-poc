'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileJson2, Monitor, RefreshCw, Smartphone, Volume2, VolumeX } from 'lucide-react'
import type { PlayableTaskPhase } from '@/lib/playable/schemas'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface PlayablePreviewProps {
  taskId: string
  phase: PlayableTaskPhase
  hasArtifact?: boolean
  artifactVersion?: string | null
  confirmation?: ConfirmationProposal
  onPhase?: (phase: PlayableTaskPhase) => void
  onRequireApiKey?: () => void
}

interface PlayableBuildSummary {
  id: string
  status: 'building' | 'failed' | 'succeeded'
  version: number | null
  current: boolean
  createdAt: string
  completedAt: string | null
}

export function PlayablePreview({
  taskId,
  phase,
  hasArtifact = phase === 'ready',
  artifactVersion = null,
  confirmation,
  onPhase,
  onRequireApiKey,
}: PlayablePreviewProps) {
  const [builds, setBuilds] = useState<PlayableBuildSummary[]>([])
  const [selectedBuildId, setSelectedBuildId] = useState<string>()
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [muted, setMuted] = useState(true)
  const [manualVersion, setManualVersion] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [actionError, setActionError] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const successfulBuilds = builds.filter(
    (build): build is PlayableBuildSummary & { version: number } =>
      build.status === 'succeeded' && build.version !== null,
  )
  const selectedBuild = successfulBuilds.find((build) => build.id === selectedBuildId)
  const displayedVersion = selectedBuild?.version ?? successfulBuilds.find((build) => build.current)?.version
  const authenticatedArtifactUrl = useMemo(() => {
    const parameters = new URLSearchParams({ kind: 'playable' })
    if (selectedBuildId) parameters.set('version', selectedBuildId)
    return `/api/playable-tasks/${encodeURIComponent(taskId)}/artifact?${parameters.toString()}`
  }, [selectedBuildId, taskId])
  const frameKey = `${selectedBuildId ?? artifactVersion ?? 'existing'}:${manualVersion}`

  useEffect(() => {
    if (!hasArtifact) return
    let active = true
    void fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/versions`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法加载版本记录')
        return (await response.json()) as { builds?: PlayableBuildSummary[] }
      })
      .then(({ builds: responseBuilds }) => {
        if (!active) return
        const nextBuilds = responseBuilds ?? []
        setBuilds(nextBuilds)
        setSelectedBuildId(nextBuilds.find((build) => build.current)?.id)
      })
      .catch(() => {
        if (active) setActionError('无法加载版本记录')
      })
    return () => {
      active = false
    }
  }, [artifactVersion, hasArtifact, taskId])

  const postMute = (value: boolean) => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'playable:set-muted', muted: value }, '*')
  }
  useEffect(() => postMute(muted), [muted, frameKey])

  const logicalSize = orientation === 'portrait' ? { width: 360, height: 640 } : { width: 640, height: 360 }
  const displaySize = orientation === 'portrait' ? { width: 432, height: 768 } : { width: 768, height: 432 }
  const displayRatio = displaySize.width / displaySize.height
  const emptyMessage =
    phase === 'failed'
      ? '本次构建失败，可以直接重试或在左侧修改方案。'
      : phase === 'building'
        ? 'Codex 正在构建试玩…'
        : phase === 'validating'
          ? '正在验证试玩…'
          : '确认方案并完成构建后，试玩将在这里出现。'

  function artifactUrl(kind: 'playable' | 'config' | 'manifest' | 'validation', download = false) {
    const parameters = new URLSearchParams({ kind })
    if (selectedBuildId) parameters.set('version', selectedBuildId)
    if (download) parameters.set('download', '1')
    return `/api/playable-tasks/${encodeURIComponent(taskId)}/artifact?${parameters.toString()}`
  }

  async function retryBuild() {
    if (retrying || phase !== 'failed' || !confirmation) return
    setRetrying(true)
    setActionError('')
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      })
      if (response.status === 428) {
        onRequireApiKey?.()
        throw new Error('请先配置 API Key')
      }
      if (!response.ok) throw new Error('无法重新构建')
      onPhase?.('building')
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '无法重新构建')
    } finally {
      setRetrying(false)
    }
  }

  const downloads = [
    ['playable', '单文件 HTML'],
    ['config', '完整生产配置'],
    ['manifest', '素材来源清单'],
    ['validation', '自检报告'],
  ] as const
  return (
    <section
      aria-label="Preview"
      className="bg-muted/30 flex min-h-[32rem] flex-col overflow-hidden lg:min-h-0 lg:border-l"
    >
      <div className="flex shrink-0 justify-center px-4 py-3">
        <div
          className="bg-background/80 flex items-center gap-1 rounded-md border p-1"
          role="group"
          aria-label="预览控制"
        >
          <Button
            size="icon"
            variant={orientation === 'portrait' ? 'secondary' : 'ghost'}
            aria-label="竖屏预览"
            aria-pressed={orientation === 'portrait'}
            onClick={() => setOrientation('portrait')}
          >
            <Smartphone />
          </Button>
          <Button
            size="icon"
            variant={orientation === 'landscape' ? 'secondary' : 'ghost'}
            aria-label="横屏预览"
            aria-pressed={orientation === 'landscape'}
            onClick={() => setOrientation('landscape')}
          >
            <Monitor />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="刷新预览"
            disabled={!hasArtifact}
            onClick={() => setManualVersion((value) => value + 1)}
          >
            <RefreshCw />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={muted ? '取消静音预览' : '静音预览'}
            aria-pressed={muted}
            disabled={!hasArtifact}
            onClick={() => setMuted((value) => !value)}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          {hasArtifact ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="下载交付物">
                  <Download />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {downloads.map(([kind, label]) => (
                  <DropdownMenuItem key={kind} asChild>
                    <a href={artifactUrl(kind, true)}>
                      <FileJson2 aria-hidden="true" />
                      {label}
                    </a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="icon" variant="ghost" aria-label="下载试玩" disabled>
              <Download />
            </Button>
          )}
        </div>
      </div>
      {hasArtifact && (
        <div className="flex shrink-0 items-center justify-center gap-2 px-4 pb-2">
          <span className="text-muted-foreground text-xs">试玩版本</span>
          {successfulBuilds.length > 1 ? (
            <Select value={selectedBuildId} onValueChange={setSelectedBuildId}>
              <SelectTrigger size="sm" className="w-28" aria-label="选择试玩版本">
                <SelectValue placeholder={displayedVersion ? `v${displayedVersion}` : '当前版本'} />
              </SelectTrigger>
              <SelectContent>
                {[...successfulBuilds].reverse().map((build) => (
                  <SelectItem key={build.id} value={build.id}>
                    v{build.version}
                    {build.current ? ' · 当前' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs font-medium">{displayedVersion ? `v${displayedVersion}` : '当前版本'}</span>
          )}
        </div>
      )}
      {phase === 'failed' && hasArtifact && (
        <p className="text-muted-foreground shrink-0 px-4 pb-2 text-center text-xs">
          本次构建失败，正在展示上一成功版本。
        </p>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-6">
        <div
          className={cn(
            'bg-background relative shrink-0 overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/90 shadow-2xl transition-[width,height] duration-300',
            muted && 'after:absolute after:right-3 after:top-3 after:size-2 after:rounded-full after:bg-amber-400',
          )}
          style={{
            width: `min(${displaySize.width}px, 100%, calc((100dvh - 10rem) * ${displayRatio}))`,
            aspectRatio: `${displaySize.width} / ${displaySize.height}`,
          }}
          aria-label={`${orientation === 'portrait' ? '竖屏' : '横屏'}画布 ${logicalSize.width} × ${logicalSize.height}`}
        >
          {hasArtifact ? (
            <iframe
              key={frameKey}
              ref={iframeRef}
              className="size-full border-0"
              title="Playable preview"
              sandbox="allow-scripts"
              src={authenticatedArtifactUrl}
              onLoad={() => postMute(muted)}
            />
          ) : (
            <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-3 px-8 text-center">
              <Smartphone className="size-10 opacity-40" aria-hidden="true" />
              <p className="text-sm">{emptyMessage}</p>
              {phase === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retrying || !confirmation}
                  onClick={() => void retryBuild()}
                >
                  {retrying ? '正在重试…' : '重试构建'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {phase === 'failed' && hasArtifact && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-4">
          <Button size="sm" variant="outline" disabled={retrying || !confirmation} onClick={() => void retryBuild()}>
            {retrying ? '正在重试…' : '重试构建'}
          </Button>
          <span className="text-muted-foreground text-xs">也可以在左侧直接描述需要修改的内容。</span>
        </div>
      )}
      {actionError && (
        <p className="text-destructive shrink-0 px-4 pb-3 text-center text-xs" role="alert">
          {actionError}
        </p>
      )}
    </section>
  )
}
