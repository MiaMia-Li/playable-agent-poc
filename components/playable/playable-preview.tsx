'use client'

import { useMemo, useState } from 'react'
import { Download, Monitor, RefreshCw, Smartphone, Volume2, VolumeX } from 'lucide-react'
import type { PlayableTaskPhase } from '@/lib/playable/schemas'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PlayablePreviewProps {
  taskId: string
  phase: PlayableTaskPhase
}

export function PlayablePreview({ taskId, phase }: PlayablePreviewProps) {
  const authenticatedArtifactUrl = useMemo(
    () => `/api/playable-tasks/${encodeURIComponent(taskId)}/artifact?kind=playable`,
    [taskId],
  )
  const [artifactUrl, setArtifactUrl] = useState<string | undefined>(
    phase === 'ready' ? authenticatedArtifactUrl : undefined,
  )
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [muted, setMuted] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  if (phase === 'ready' && artifactUrl !== authenticatedArtifactUrl) {
    setArtifactUrl(authenticatedArtifactUrl)
  }

  const size = orientation === 'portrait' ? { width: 360, height: 640 } : { width: 640, height: 360 }

  return (
    <section aria-label="Preview" className="bg-muted/30 flex min-h-[32rem] flex-col overflow-hidden lg:min-h-0">
      <header className="bg-background flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="font-semibold">Preview</h2>
          <p className="text-muted-foreground text-xs">
            {phase === 'ready'
              ? '已连接安全预览'
              : phase === 'failed'
                ? '本次构建失败，保留上次成功版本'
                : '构建完成后自动显示'}
          </p>
        </div>
        <div className="flex items-center gap-1" role="toolbar" aria-label="预览控制">
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
            disabled={!artifactUrl}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <RefreshCw />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={muted ? '取消静音预览' : '静音预览'}
            aria-pressed={muted}
            onClick={() => {
              setMuted((value) => !value)
              setRefreshKey((value) => value + 1)
            }}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Button asChild size="icon" variant="ghost">
            <a aria-label="下载试玩" href={`${authenticatedArtifactUrl}&download=1`} download="playable.html">
              <Download />
            </a>
          </Button>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4 sm:p-6">
        <div
          className={cn(
            'bg-background relative shrink-0 overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/90 shadow-2xl transition-[width,height] duration-300',
            muted && 'after:absolute after:right-3 after:top-3 after:size-2 after:rounded-full after:bg-amber-400',
          )}
          style={{ width: size.width, height: size.height, maxWidth: '100%' }}
          aria-label={`${orientation === 'portrait' ? '竖屏' : '横屏'}画布 ${size.width} × ${size.height}`}
        >
          {artifactUrl ? (
            <iframe
              key={refreshKey}
              className="size-full border-0"
              title="Playable preview"
              sandbox="allow-scripts"
              allow={muted ? "autoplay 'none'" : 'autoplay'}
              src={artifactUrl}
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
