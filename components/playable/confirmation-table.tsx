'use client'

import { CheckCircle2 } from 'lucide-react'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
}

export function ConfirmationTable({ proposal, onChange, onConfirm, confirming }: ConfirmationTableProps) {
  const resourcesReady = Object.values(proposal.resources).every((resource) => resource.status !== '待上传')
  const validStoreUrl = /^https:\/\/\S+$/i.test(proposal.storeUrl)
  const canConfirm = resourcesReady && validStoreUrl && !confirming

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
              <td className="px-3 py-2">{proposal.gameplay}</td>
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
        <CheckCircle2 aria-hidden="true" />
        {confirming ? '正在启动构建…' : '确认方案并开始构建'}
      </Button>
    </section>
  )
}
