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

const defaultTreatments: Record<keyof ConfirmationProposal['resources'], string> = {
  tileFaces: '使用内置默认牌面素材',
  backgroundBoard: '使用内置默认背景与棋盘',
  animationEffects: '使用内置默认动画与特效',
  audio: '使用内置默认音频',
  endCard: '使用内置默认结束卡',
}

const generatedTreatments: Record<keyof ConfirmationProposal['resources'], string> = {
  tileFaces: '生成与当前主题一致的清晰牌面图集，透明背景',
  backgroundBoard: '生成与当前主题一致的竖屏背景与棋盘，主体区域保持清晰',
  animationEffects: '生成与当前主题一致的透明消除特效素材',
  audio: '根据当前标题和 CTA 生成简短中文宣传配音',
  endCard: '生成与当前主题一致的竖屏结束卡背景，预留标题和 CTA 区域',
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
  const controlsDisabled = Boolean(disabled || inProgress)
  const canConfirm = resourcesReady && validStoreUrl && !inProgress && !disabled
  const mode = getPlayableMode(proposal.mode)

  const updateResource = (
    key: keyof ConfirmationProposal['resources'],
    resource: ConfirmationProposal['resources'][typeof key],
  ) => {
    onChange({
      ...proposal,
      resources: {
        ...proposal.resources,
        [key]: resource,
      },
    })
  }

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
              <th className="bg-muted/40 w-28 px-3 py-2 font-medium">路由</th>
              <td className="px-3 py-2">
                <span>{proposal.routing.match === 'exact' ? '完全匹配' : '近似匹配'}</span>
                <span className="text-muted-foreground ml-2">
                  置信度 {Math.round(proposal.routing.confidence * 100)}%
                </span>
                {proposal.routing.differences.length > 0 && (
                  <ul className="text-muted-foreground mt-1 list-disc pl-5">
                    {proposal.routing.differences.map((difference) => (
                      <li key={difference}>{difference}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
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
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={resource.status === '内置默认' ? 'secondary' : 'outline'}
                      disabled={controlsDisabled}
                      aria-label={`使用内置默认${resourceLabels[key as PlayableAssetSlot]}`}
                      onClick={() =>
                        updateResource(key as PlayableAssetSlot, {
                          status: '内置默认',
                          treatment: defaultTreatments[key as PlayableAssetSlot],
                        })
                      }
                    >
                      内置默认
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={resource.status === '待生成' ? 'secondary' : 'outline'}
                      disabled={controlsDisabled}
                      aria-label={`AI 生成${resourceLabels[key as PlayableAssetSlot]}`}
                      onClick={() =>
                        updateResource(key as PlayableAssetSlot, {
                          status: '待生成',
                          treatment: generatedTreatments[key as PlayableAssetSlot],
                        })
                      }
                    >
                      {key === 'audio' ? 'AI 配音' : 'AI 生成'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={resource.status === '待上传' || resource.status === '用户上传' ? 'secondary' : 'outline'}
                      disabled={controlsDisabled}
                      aria-label={`本地上传${resourceLabels[key as PlayableAssetSlot]}`}
                      onClick={() =>
                        updateResource(key as PlayableAssetSlot, {
                          status: '待上传',
                          treatment: `等待上传${resourceLabels[key as PlayableAssetSlot]}`,
                        })
                      }
                    >
                      本地上传
                    </Button>
                  </div>
                  {resource.status === '待生成' && (
                    <div className="mt-2 space-y-1">
                      <Label htmlFor={`generation-${key}`}>{key === 'audio' ? 'AI 配音要求' : 'AI 生成要求'}</Label>
                      <Input
                        id={`generation-${key}`}
                        value={resource.treatment}
                        disabled={controlsDisabled}
                        onChange={(event) =>
                          updateResource(key as PlayableAssetSlot, {
                            status: '待生成',
                            treatment: event.target.value,
                          })
                        }
                      />
                    </div>
                  )}
                  {resource.status === '待上传' && onUpload && (
                    <div className="mt-2">
                      <Label
                        htmlFor={`asset-${key}`}
                        className="border-input hover:bg-accent cursor-pointer rounded-md border px-2 py-1 text-xs"
                      >
                        {uploadingSlot === key ? '上传中…' : `为${resourceLabels[key as PlayableAssetSlot]}上传素材`}
                      </Label>
                    </div>
                  )}
                  {resource.status === '待上传' && onUpload && (
                    <input
                      id={`asset-${key}`}
                      className="sr-only"
                      type="file"
                      disabled={controlsDisabled || Boolean(uploadingSlot)}
                      accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,audio/mp4,video/mp4,video/webm"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) onUpload(key as PlayableAssetSlot, file)
                        event.target.value = ''
                      }}
                    />
                  )}
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
          disabled={controlsDisabled}
          onChange={(event) => onChange({ ...proposal, storeUrl: event.target.value })}
        />
      </div>
      {!resourcesReady && <p className="text-destructive text-sm">请先上传所有标记为“待上传”的素材。</p>}
      {Object.values(proposal.resources).some((resource) => resource.status === '待生成') && (
        <p className="text-muted-foreground text-xs">AI 素材会在明确点击确认后生成，并使用当前会话的 API Key。</p>
      )}
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
