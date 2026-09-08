'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FileJson2,
  Monitor,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { PlayableTaskPhase } from '@/lib/playable/schemas'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface PlayablePreviewProps {
  taskId: string
  phase: PlayableTaskPhase
  hasArtifact?: boolean
  artifactVersion?: string | null
  onPhase?: (phase: PlayableTaskPhase) => void
}

export function PlayablePreview({
  taskId,
  phase,
  hasArtifact = phase === 'ready',
  artifactVersion = null,
  onPhase,
}: PlayablePreviewProps) {
  const authenticatedArtifactUrl = useMemo(
    () => `/api/playable-tasks/${encodeURIComponent(taskId)}/artifact?kind=playable`,
    [taskId],
  )
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [muted, setMuted] = useState(true)
  const [manualVersion, setManualVersion] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const frameKey = `${artifactVersion ?? 'existing'}:${manualVersion}`

  const postMute = (value: boolean) => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'playable:set-muted', muted: value }, '*')
  }
  useEffect(() => postMute(muted), [muted, frameKey])

  const size = orientation === 'portrait' ? { width: 360, height: 640 } : { width: 640, height: 360 }

  async function submitReview(action: 'accept' | 'revise') {
    if (reviewing) return
    setReviewing(true)
    setReviewError('')
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error('无法更新验收状态')
      onPhase?.(action === 'accept' ? 'ready' : 'awaiting_confirmation')
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : '无法更新验收状态')
    } finally {
      setReviewing(false)
    }
  }

  const downloads = [
    ['playable', '单文件 HTML'],
    ['config', '完整生产配置'],
    ['manifest', '素材来源清单'],
    ['validation', '自检报告'],
  ] as const
  return (
    <section aria-label="Preview" className="bg-muted/30 flex min-h-[32rem] flex-col overflow-hidden lg:min-h-0">
      <header className="bg-background flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="font-semibold">Preview</h2>
          <p className="text-muted-foreground text-xs">
            {phase === 'ready'
              ? '已通过人工验收，可下载交付物'
              : phase === 'reviewing'
                ? '自动门禁已通过，请完成人工验收'
                : phase === 'failed'
                  ? hasArtifact
                    ? '本次构建失败，保留上次成功版本'
                    : '构建失败'
                  : hasArtifact
                    ? '正在构建新版本，显示上次成功版本'
                    : '构建完成后自动显示'}
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="预览控制">
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
          {hasArtifact && phase === 'ready' ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="下载交付物">
                  <Download />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {downloads.map(([kind, label]) => (
                  <DropdownMenuItem key={kind} asChild>
                    <a href={`${authenticatedArtifactUrl.replace('kind=playable', `kind=${kind}`)}&download=1`}>
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
      </header>
      {((hasArtifact && ['reviewing', 'ready'].includes(phase)) || phase === 'failed') && (
        <div className="bg-background flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-muted-foreground text-xs">
            {phase === 'reviewing'
              ? '请检查视觉质感、节奏、易理解性和品牌一致性。'
              : '可以保留当前成功版本并继续调整方案。'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={reviewing} onClick={() => void submitReview('revise')}>
              <RotateCcw aria-hidden="true" />
              返回修改
            </Button>
            {phase === 'reviewing' && (
              <Button size="sm" disabled={reviewing} onClick={() => void submitReview('accept')}>
                <CheckCircle2 aria-hidden="true" />
                验收通过
              </Button>
            )}
          </div>
          {reviewError && (
            <p className="text-destructive basis-full text-xs" role="alert">
              {reviewError}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-1 items-center justify-center overflow-auto p-4 sm:p-6">
        <div
          className={cn(
            'bg-background relative shrink-0 overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/90 shadow-2xl transition-[width,height] duration-300',
            muted && 'after:absolute after:right-3 after:top-3 after:size-2 after:rounded-full after:bg-amber-400',
          )}
          style={{ width: size.width, height: size.height, maxWidth: '100%' }}
          aria-label={`${orientation === 'portrait' ? '竖屏' : '横屏'}画布 ${size.width} × ${size.height}`}
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
              <p className="text-sm">确认方案并完成构建后，试玩将在这里出现。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
