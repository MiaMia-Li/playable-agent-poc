import type { PlayableModeId } from '@/lib/playable/types'
import { cn } from '@/lib/utils'

const templatePreviewPaths: Record<PlayableModeId, string> = {
  center_collision: '/playable-templates/center_collision.html',
  top_rack: '/playable-templates/top_rack.html',
  gravity_fill: '/playable-templates/gravity_fill.html',
  perspective_3d: '/playable-templates/perspective_3d.html',
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
      <iframe
        title={title}
        src={templatePreviewPaths[mode]}
        sandbox="allow-scripts"
        tabIndex={interactive ? 0 : -1}
        className={cn('size-full border-0', !interactive && 'pointer-events-none')}
      />
    </div>
  )
}
