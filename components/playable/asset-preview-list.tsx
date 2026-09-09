'use client'

import Image from 'next/image'
import { FileAudio, FileImage, FileVideo, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface PreviewAssetItem {
  id: string
  filename: string
  mimeType: string
  size?: number
  previewUrl?: string
}

export function AssetPreviewList({
  items,
  ariaLabel = '已上传素材',
  disabled,
  removingId,
  onRemove,
}: {
  items: PreviewAssetItem[]
  ariaLabel?: string
  disabled?: boolean
  removingId?: string
  onRemove?: (item: PreviewAssetItem) => void
}) {
  if (items.length === 0) return null

  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.id} className="bg-muted/40 relative min-w-0 overflow-hidden rounded-md border">
          <div className="flex min-h-20 items-center gap-2 p-2 pr-9">
            {item.mimeType.startsWith('image/') && item.previewUrl ? (
              <Image
                unoptimized
                src={item.previewUrl}
                alt={item.filename}
                width={88}
                height={64}
                className="h-16 w-22 shrink-0 rounded object-cover"
              />
            ) : item.mimeType.startsWith('video/') && item.previewUrl ? (
              <video
                src={item.previewUrl}
                aria-label={`预览 ${item.filename}`}
                className="h-16 w-22 shrink-0 rounded bg-black object-cover"
                controls
                preload="metadata"
              />
            ) : item.mimeType.startsWith('audio/') && item.previewUrl ? (
              <div className="min-w-0 flex-1 space-y-2">
                <span className="flex items-center gap-2 text-xs">
                  <FileAudio className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.filename}</span>
                </span>
                <audio className="h-8 w-full" src={item.previewUrl} controls preload="metadata" />
              </div>
            ) : (
              <span className="bg-background flex size-16 shrink-0 items-center justify-center rounded border">
                {item.mimeType.startsWith('video/') ? (
                  <FileVideo className="text-muted-foreground size-5" aria-hidden="true" />
                ) : (
                  <FileImage className="text-muted-foreground size-5" aria-hidden="true" />
                )}
              </span>
            )}
            {!item.mimeType.startsWith('audio/') && (
              <span className="min-w-0 text-xs">
                <span className="block truncate font-medium">{item.filename}</span>
                <span className="text-muted-foreground mt-1 block">{formatBytes(item)}</span>
              </span>
            )}
          </div>
          {onRemove && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute top-1.5 right-1.5 size-7"
              aria-label={`删除素材 ${item.filename}`}
              title="删除素材"
              disabled={disabled || removingId === item.id}
              onClick={() => onRemove(item)}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function formatBytes(item: PreviewAssetItem & { size?: number }): string {
  if (!item.size) return item.mimeType
  if (item.size >= 1024 * 1024) return `${(item.size / 1024 / 1024).toFixed(1)} MB`
  return `${(item.size / 1024).toFixed(1)} KB`
}
