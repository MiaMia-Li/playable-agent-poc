import { Globe2 } from 'lucide-react'

interface StudioAccountProps {
  accountLabel: string
  publicAccess?: boolean
  compact?: boolean
}

export function StudioAccount({ accountLabel, publicAccess = false, compact = false }: StudioAccountProps) {
  return (
    <div
      className={`flex h-9 items-center rounded-lg ${compact ? 'justify-center' : 'gap-2.5 px-2'}`}
      aria-label={publicAccess ? '账户：公开体验，任务共享' : `账户：${accountLabel}`}
    >
      {publicAccess ? (
        <span className="bg-background text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md border">
          <Globe2 className="size-3.5" aria-hidden="true" />
        </span>
      ) : (
        <span className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium">
          {accountLabel.slice(0, 1).toUpperCase()}
        </span>
      )}
      {!compact && (
        <>
          <span className="min-w-0 flex-1 truncate text-sm">{publicAccess ? '公开体验' : accountLabel}</span>
          {publicAccess && (
            <span className="text-muted-foreground bg-foreground/[0.06] rounded-full px-2 py-0.5 text-[10px]">
              共享
            </span>
          )}
        </>
      )}
    </div>
  )
}
