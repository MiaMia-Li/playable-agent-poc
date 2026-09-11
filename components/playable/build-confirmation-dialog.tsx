'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { defaultConfirmationPresentation, type ConfirmationProposal } from '@/lib/playable/schemas'
import { deliveryProfileIdFor, getDeliveryProfile } from '@/lib/playable/delivery-standards'
import { getPlayableMode } from '@/lib/playable/template-registry'

const routingLabels: Record<ConfirmationProposal['routing']['match'], string> = {
  exact: '完全匹配',
  approximate: '近似匹配',
  freeform: 'Agent 自由生成',
}

const copyLabels: Record<keyof ConfirmationProposal['copy'], string> = {
  title: '游戏标题',
  cta: 'CTA 文案',
  disclaimer: '免责声明',
  locale: '语言',
}

interface BuildConfirmationDialogProps {
  buildId: string
  confirmation: ConfirmationProposal
}

export function BuildConfirmationSummary({ buildId, confirmation }: BuildConfirmationDialogProps) {
  const mode = getPlayableMode(confirmation.mode)

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{mode.label}</Badge>
        <Badge variant="outline">{routingLabels[confirmation.routing.match]}</Badge>
      </div>
      <div className="mt-2">
        <BuildConfirmationDialog buildId={buildId} confirmation={confirmation} />
      </div>
    </div>
  )
}

export function BuildConfirmationDialog({ buildId, confirmation }: BuildConfirmationDialogProps) {
  const presentation = confirmation.presentation ?? defaultConfirmationPresentation
  const mode = getPlayableMode(confirmation.mode)
  const deliveryProfile = getDeliveryProfile(deliveryProfileIdFor(confirmation.delivery))

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="h-auto px-0 py-0 text-xs">
          查看完整配置
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle>构建配置</DialogTitle>
          <DialogDescription>构建 {buildId} 所使用的确认方案快照。</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 text-sm">
          <div className="divide-y overflow-hidden rounded-xl border">
            <section className="grid gap-2 px-4 py-3.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4">
              <h3 className="text-muted-foreground text-xs font-medium">构建方案</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{mode.label}</Badge>
                <Badge variant="outline">{routingLabels[confirmation.routing.match]}</Badge>
              </div>
            </section>

            <section
              aria-labelledby={`${buildId}-gameplay`}
              className="grid gap-2 px-4 py-3.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4"
            >
              <h3 id={`${buildId}-gameplay`} className="text-muted-foreground text-xs font-medium">
                玩法方案
              </h3>
              <div className="leading-6">
                <p className="whitespace-pre-wrap">{confirmation.gameplay}</p>
                {confirmation.routing.differences.length > 0 && (
                  <div className="mt-2.5">
                    <p className="text-muted-foreground text-xs">与模板的差异</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {confirmation.routing.differences.map((difference) => (
                        <li key={difference}>{difference}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>

            {presentation.assetFields.length > 0 && (
              <section
                aria-labelledby={`${buildId}-resources`}
                className="grid gap-2 px-4 py-3.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4"
              >
                <h3 id={`${buildId}-resources`} className="text-muted-foreground text-xs font-medium">
                  素材策略
                </h3>
                <div className="min-w-0 divide-y">
                  {presentation.assetFields.map(({ slot, label }) => {
                    const resource = confirmation.resources[slot]
                    return (
                      <div
                        key={slot}
                        className="grid min-w-0 gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{label}</span>
                          <Badge variant="secondary" className="shrink-0">
                            {resource.status === '内置默认' ? '系统素材' : resource.status}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground min-w-0 text-xs leading-5 [overflow-wrap:anywhere] sm:text-sm">
                          {resource.treatment}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            <section
              aria-labelledby={`${buildId}-copy`}
              className="grid gap-2 px-4 py-3.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4"
            >
              <h3 id={`${buildId}-copy`} className="text-muted-foreground text-xs font-medium">
                文案与跳转
              </h3>
              <dl className="divide-y">
                {presentation.copyFields.map((field) => (
                  <div key={field} className="grid gap-1 py-2 first:pt-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
                    <dt className="text-muted-foreground text-xs">{copyLabels[field]}</dt>
                    <dd className="whitespace-pre-wrap">{confirmation.copy[field] || '—'}</dd>
                  </div>
                ))}
                <div className="grid gap-1 pt-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
                  <dt className="text-muted-foreground text-xs">商店跳转链接</dt>
                  <dd className="min-w-0 break-all">
                    <a
                      href={confirmation.storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {confirmation.storeUrl}
                    </a>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="grid gap-2 px-4 py-3.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4">
              <h3 className="text-muted-foreground text-xs font-medium">交付信息</h3>
              <p>
                <span className="font-medium">{deliveryProfile.label}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {confirmation.delivery.logicalWidth} × {confirmation.delivery.logicalHeight} · 单 HTML ·{' '}
                  {confirmation.delivery.maxBytes === null
                    ? '无渠道体积上限'
                    : `${confirmation.delivery.maxBytes / 1024 / 1024} MiB 上限`}
                </span>
              </p>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
