import Image from 'next/image'
import type { PlayableModeId } from '@/lib/playable/types'
import { cn } from '@/lib/utils'

const templatePreviewPaths: Record<PlayableModeId, string> = {
  center_collision: '/playable-templates/center_collision.html',
  top_rack: '/playable-templates/top_rack.html',
  gravity_fill: '/playable-templates/gravity_fill.html',
  perspective_3d: '/playable-templates/perspective_3d.html',
}

const templateCoverPaths: Record<PlayableModeId, string> = {
  center_collision: '/playable-templates/covers/center_collision.webp',
  top_rack: '/playable-templates/covers/top_rack.webp',
  gravity_fill: '/playable-templates/covers/gravity_fill.webp',
  perspective_3d: '/playable-templates/covers/perspective_3d.webp',
}

interface TemplatePreviewProps {
  mode: PlayableModeId
  title: string
  className?: string
  interactive?: boolean
}

export function TemplatePreview({ mode, title, className, interactive = false }: TemplatePreviewProps) {
  return (
    <div className={cn('bg-muted relative overflow-hidden', className)}>
      {interactive ? (
        <iframe title={title} src={templatePreviewPaths[mode]} sandbox="allow-scripts" className="size-full border-0" />
      ) : (
        <Image
          src={templateCoverPaths[mode]}
          alt={title}
          fill
          unoptimized={mode === 'perspective_3d'}
          sizes="(min-width: 1024px) 250px, (min-width: 640px) 162px, 100vw"
          className="object-cover"
        />
      )}
    </div>
  )
}
