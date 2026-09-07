'use client'

import { CheckCircle2, Loader2 } from 'lucide-react'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getPlayableMode } from '@/lib/playable/template-registry'
import { isAbsoluteHttpsUrl } from '@/lib/playable/schemas'
import type { PlayableAssetSlot } from '@/lib/playable/task-assets'

const resourceLabels: Record<keyof ConfirmationProposal['resources'], string> = {
  tileFaces: '牌面素材',
  backgroundBoard: '背景与棋盘',
  animationEffects: '动画与特效',
  audio: '音频',
  endCard: '结束卡',
}

interface ConfirmationTableProps {
  proposal: ConfirmationProposal
  onChange: (proposal: ConfirmationProposal) => void
  onConfirm: () => void
  confirming?: boolean
  buildPhase?: 'building' | 'validating'
  disabled?: boolean
  uploadingSlot?: PlayableAssetSlot
  onUpload?: (slot: PlayableAssetSlot, file: File) => void
}

export function ConfirmationTable({
  proposal,
  onChange,
  onConfirm,
  confirming,
  buildPhase,
  disabled,
  uploadingSlot,
  onUpload,
}: ConfirmationTableProps) {
  const resourcesReady = Object.values(proposal.resources).every((resource) => resource.status !== '待上传')
  const validStoreUrl = isAbsoluteHttpsUrl(proposal.storeUrl)
  const inProgress = Boolean(confirming || buildPhase)
  const canConfirm = resourcesReady && validStoreUrl && !inProgress && !disabled
  const mode = getPlayableMode(proposal.mode)

  return (
    <section aria-label="确认方案" className="space-y-4">
      <div>
        <h2 className="font-semibold">确认构建方案</h2>
        <p className="text-muted-foreground text-sm">请逐项确认；点击一次确认后才会开始构建。</p>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y">
            <tr>
              <th className="bg-muted/40 w-28 px-3 py-2 font-medium">玩法</th>
              <td className="px-3 py-2">
                <span className="font-mono text-xs">{mode.id}</span>
                <span className="mx-2">·</span>
                <span>{mode.label}</span>
                <p className="text-muted-foreground mt-1">{proposal.gameplay}</p>
              </td>
            </tr>
            {Object.entries(proposal.resources).map(([key, resource]) => (
              <tr key={key}>
                <th className="bg-muted/40 px-3 py-2 font-medium">
                  {resourceLabels[key as keyof ConfirmationProposal['resources']]}
                </th>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={resource.status === '待上传' ? 'destructive' : 'secondary'}>
                      {resource.status}
                    </Badge>
                    <span className="text-muted-foreground">{resource.treatment}</span>
                    {resource.status === '待上传' && onUpload && (
                      <Label
                        htmlFor={`asset-${key}`}
                        className="border-input hover:bg-accent cursor-pointer rounded-md border px-2 py-1 text-xs"
                      >
                        {uploadingSlot === key ? '上传中…' : `为${resourceLabels[key as PlayableAssetSlot]}上传素材`}
                      </Label>
                    )}
                    {resource.status === '待上传' && onUpload && (
                      <input
                        id={`asset-${key}`}
                        className="sr-only"
                        type="file"
                        disabled={Boolean(uploadingSlot)}
                        accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,audio/mp4,video/mp4,video/webm"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) onUpload(key as PlayableAssetSlot, file)
                          event.target.value = ''
                        }}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            <tr>
              <th className="bg-muted/40 px-3 py-2 font-medium">文案</th>
              <td className="space-y-1 px-3 py-2">
                <p>{proposal.copy.title}</p>
                <p className="text-muted-foreground">
                  CTA：{proposal.copy.cta} · {proposal.copy.locale}
                </p>
                <p className="text-muted-foreground">{proposal.copy.disclaimer}</p>
              </td>
            </tr>
            <tr>
              <th className="bg-muted/40 px-3 py-2 font-medium">交付</th>
              <td className="px-3 py-2">
                {proposal.delivery.network} · {proposal.delivery.logicalWidth} × {proposal.delivery.logicalHeight} · 单
                HTML · 5 MB
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="space-y-2">
        <Label htmlFor="store-url">商店跳转链接（HTTPS）</Label>
        <Input
          id="store-url"
          type="url"
          value={proposal.storeUrl}
          aria-invalid={!validStoreUrl}
          onChange={(event) => onChange({ ...proposal, storeUrl: event.target.value })}
        />
      </div>
      {!resourcesReady && <p className="text-destructive text-sm">请先上传所有标记为“待上传”的素材。</p>}
      <Button className="w-full" disabled={!canConfirm} onClick={onConfirm}>
        {inProgress ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
        {confirming
          ? '正在提交方案…'
          : buildPhase === 'building'
            ? 'Codex 正在构建试玩…'
            : buildPhase === 'validating'
              ? '正在验证并发布试玩…'
              : '确认方案并开始构建'}
      </Button>
    </section>
  )
}
