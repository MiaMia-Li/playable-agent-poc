'use client'

import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PlayableTemplate } from '@/lib/playable/template-catalog'
import { TemplatePreview } from './template-preview'

interface TemplatePreviewDialogProps {
  mode?: PlayableTemplate
  creating?: boolean
  canStart?: boolean
  onOpenChange: (open: boolean) => void
  onStart: (mode: PlayableTemplate) => void
}

export function TemplatePreviewDialog({
  mode,
  creating = false,
  canStart = true,
  onOpenChange,
  onStart,
}: TemplatePreviewDialogProps) {
  return (
    <Dialog open={Boolean(mode)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
        {mode && (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle>{mode.label}</DialogTitle>
              <DialogDescription>{mode.description}。可直接在下方试玩，确认后从这个模板继续创作。</DialogDescription>
            </DialogHeader>
            <TemplatePreview
              mode={mode.id}
              title={`${mode.label}可交互预览`}
              interactive
              className="mx-auto aspect-[9/16] w-full max-w-[360px] rounded-xl border"
            />
            <DialogFooter>
              <Button onClick={() => onStart(mode)} disabled={!canStart || creating}>
                {creating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                用此模板开始
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
