'use client'

import { sourceTemplateIds, type SourceTemplateId } from '@/lib/playable/types'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PLAYABLE_TEMPLATES, templatePrompts, type PlayableTemplateId } from '@/lib/playable/template-catalog'
import { PlayableStudioShell } from './studio-shell'
import { TemplatePreview } from './template-preview'
import { TemplatePreviewDialog } from './template-preview-dialog'

interface BestPracticesPageProps {
  accountLabel: string
}

export function BestPracticesPage({ accountLabel }: BestPracticesPageProps) {
  const router = useRouter()
  const [creatingMode, setCreatingMode] = useState<PlayableTemplateId>()
  const [previewMode, setPreviewMode] = useState<PlayableTemplateId>()
  const [error, setError] = useState('')

  async function startFromTemplate(mode: PlayableTemplateId) {
    if (creatingMode) return
    setCreatingMode(mode)
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
      router.push(`/tasks/${body.task.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法从模板创建试玩')
      setCreatingMode(undefined)
    }
  }

  return (
    <PlayableStudioShell activeSection="best-practices" accountLabel={accountLabel}>
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 lg:pt-20 lg:pb-16">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            {/* <p className="text-muted-foreground text-sm">可直接试玩的单 HTML 起点</p> */}
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">玩法模板</h1>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm sm:text-base">
              先试玩再选择。找到合适的基础玩法后，创建新对话继续修改主题、规则、素材和文案。
            </p>
          </div>
        </div>

        {error && <p className="text-destructive mt-5 text-sm">{error}</p>}

        <section className="mt-9 grid gap-5 md:grid-cols-2" aria-label="玩法模板">
          {PLAYABLE_TEMPLATES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="group grid w-full overflow-hidden rounded-2xl border bg-background text-left transition-all hover:-translate-y-0.5 hover:bg-muted/30 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none sm:grid-cols-[10.125rem_minmax(0,1fr)]"
              onClick={() => setPreviewMode(mode.id)}
              aria-label={`预览${mode.label}模板`}
            >
              <TemplatePreview
                mode={mode.id}
                title={`${mode.label}模板封面`}
                className="aspect-[9/16] w-full border-b sm:min-h-72 sm:border-r sm:border-b-0"
              />
              <div className="flex min-h-56 flex-col p-6 sm:min-h-72">
                <div className="flex-1">
                  <p className="text-muted-foreground text-xs">单 HTML · 360 × 640</p>
                  <h2 className="mt-3 text-xl font-semibold">{mode.label}</h2>
                  <p className="text-muted-foreground mt-2 text-sm leading-6">{mode.description}</p>
                </div>
                <p className="text-muted-foreground mt-6 text-sm transition-colors group-hover:text-foreground">
                  点击预览并开始创作 →
                </p>
              </div>
            </button>
          ))}
        </section>
        <TemplatePreviewDialog
          mode={PLAYABLE_TEMPLATES.find((mode) => mode.id === previewMode)}
          creating={Boolean(previewMode && creatingMode === previewMode)}
          onOpenChange={(open) => {
            if (!open) setPreviewMode(undefined)
          }}
          onStart={(mode) => void startFromTemplate(mode.id)}
        />
      </main>
    </PlayableStudioShell>
  )
}
