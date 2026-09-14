'use client'

import { X } from 'lucide-react'
import type { GameplayAnnotation } from '@/lib/playable/schemas'

function formatSeconds(seconds: number): string {
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`
}

function formatRanges(annotation: GameplayAnnotation): string {
  return annotation.evidence
    .map(({ startSeconds, endSeconds }) =>
      startSeconds === endSeconds
        ? formatSeconds(startSeconds)
        : `${formatSeconds(startSeconds)}–${formatSeconds(endSeconds)}`,
    )
    .join('、')
}

/**
 * Always rendered while a reference video is active, empty or not. The agent
 * resends the whole list each turn and may drop an entry; an inline "recorded"
 * event would never fire for the one that went missing, so only a standing
 * list lets the user notice.
 */
export function GameplayAnnotationList({
  annotations,
  deletingId,
  onDelete,
}: {
  annotations: GameplayAnnotation[]
  deletingId?: string
  onDelete?: (annotation: GameplayAnnotation) => void
}) {
  return (
    <section aria-label="玩法标注" className="space-y-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">你的玩法标注</h2>
        {annotations.length > 0 && <span className="text-muted-foreground text-xs">{annotations.length} 条</span>}
      </div>
      {annotations.length === 0 ? (
        <p className="text-muted-foreground text-xs leading-5">
          视频里有分析没看准的地方，可以直接在对话里说明，例如「第 12 秒那个是长按，不是点击」。
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs leading-5">
            这些是你对参考视频的说明，构建时优先于模型推论。记错或多余的可以直接删除。
          </p>
          <ul className="space-y-1.5">
            {annotations.map((annotation) => (
              <li key={annotation.id} className="bg-muted/40 flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
                <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
                  {formatRanges(annotation)}
                </span>
                <span className="min-w-0 flex-1 break-words">{annotation.value}</span>
                {onDelete && (
                  <button
                    type="button"
                    aria-label={`删除标注 ${annotation.value}`}
                    className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-50"
                    disabled={deletingId === annotation.id}
                    onClick={() => onDelete(annotation)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
