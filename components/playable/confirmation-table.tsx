'use client'

import { useId, useRef } from 'react'
import { CheckCircle2, ImagePlus, Loader2, Video } from 'lucide-react'
import { defaultConfirmationPresentation, type ConfirmationProposal } from '@/lib/playable/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AssetPreviewList } from './asset-preview-list'
import { getPlayableMode, MAHJONG_PLAYABLE_PLUGIN, PLAYABLE_MODES } from '@/lib/playable/template-registry'
import { isAbsoluteHttpsUrl } from '@/lib/playable/schemas'
import type { SafePlayableAsset } from '@/lib/playable/task-assets'
import { isPlayableResourceAssetSlot, playableAssetAccept, type PlayableAssetSlot } from '@/lib/playable/asset-policy'
import {
  DELIVERY_PROFILES,
  deliveryProfileIdFor,
  deliveryProfileSnapshot,
  getDeliveryProfile,
  isDeliveryProfileId,
} from '@/lib/playable/delivery-standards'

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

const routingLabels: Record<ConfirmationProposal['routing']['match'], string> = {
  exact: '完全匹配',
  approximate: '近似匹配',
  freeform: '自由生成',
}

const copyFieldConfig: Record<keyof ConfirmationProposal['copy'], { label: string; maxLength: number }> = {
  title: { label: '游戏标题', maxLength: 120 },
  cta: { label: 'CTA 文案', maxLength: 80 },
  disclaimer: { label: '免责声明', maxLength: 300 },
  locale: { label: '语言', maxLength: 30 },
}

interface ConfirmationTableProps {
  proposal: ConfirmationProposal
  onChange: (proposal: ConfirmationProposal) => void
  onConfirm: () => void
  title?: string
  description?: string
  showHeader?: boolean
  confirming?: boolean
  buildPhase?: 'building' | 'validating'
  disabled?: boolean
  uploadingSlot?: PlayableAssetSlot
  onUpload?: (slot: PlayableAssetSlot, files: File[]) => void
  onRemoveAsset?: (asset: SafePlayableAsset) => void
  uploadedAssets?: SafePlayableAsset[]
  removingAssetId?: string
  assetPreviewUrl?: (asset: SafePlayableAsset) => string
  showConfirmAction?: boolean
}

export function isConfirmationReady(proposal: ConfirmationProposal): boolean {
  const presentation = proposal.presentation ?? defaultConfirmationPresentation
  const visibleResources = presentation.assetFields.map((field) => proposal.resources[field.slot])
  const hasPendingUpload = visibleResources.some((resource) => resource.status === '待上传')
  const hasUnsupportedAiGeneration =
    !MAHJONG_PLAYABLE_PLUGIN.capabilities.aiMediaGeneration &&
    visibleResources.some((resource) => resource.status === '待生成')
  return !hasPendingUpload && !hasUnsupportedAiGeneration && isAbsoluteHttpsUrl(proposal.storeUrl)
}

export function ConfirmationTable({
  proposal,
  onChange,
  onConfirm,
  title = '确认构建方案',
  description = '以下是当前构建方案。你可以继续修改，确认后才会开始构建。',
  showHeader = true,
  confirming,
  buildPhase,
  disabled,
  uploadingSlot,
  onUpload,
  onRemoveAsset,
  uploadedAssets = [],
  removingAssetId,
  assetPreviewUrl,
  showConfirmAction = true,
}: ConfirmationTableProps) {
  const uploadInputs = useRef<Partial<Record<PlayableAssetSlot, HTMLInputElement | null>>>({})
  const storeUrlId = useId()
  const presentation = proposal.presentation ?? defaultConfirmationPresentation
  const assetFields = presentation.assetFields.filter(
    (field, index, fields) => fields.findIndex((candidate) => candidate.slot === field.slot) === index,
  )
  const visibleResources = assetFields.map((field) => proposal.resources[field.slot])
  const hasPendingUpload = visibleResources.some((resource) => resource.status === '待上传')
  const aiMediaGenerationEnabled = MAHJONG_PLAYABLE_PLUGIN.capabilities.aiMediaGeneration
  const hasUnsupportedAiGeneration =
    !aiMediaGenerationEnabled && visibleResources.some((resource) => resource.status === '待生成')
  const resourcesReady = !hasPendingUpload && !hasUnsupportedAiGeneration
  const validStoreUrl = isAbsoluteHttpsUrl(proposal.storeUrl)
  const inProgress = Boolean(confirming || buildPhase)
  const controlsDisabled = Boolean(disabled || inProgress)
  const canConfirm = resourcesReady && validStoreUrl && !inProgress && !disabled
  const mode = getPlayableMode(proposal.mode)
  const deliveryProfile = getDeliveryProfile(deliveryProfileIdFor(proposal.delivery))
  const referenceAssets = uploadedAssets.filter((asset) => !isPlayableResourceAssetSlot(asset.slot))

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

  const updateMode = (value: string) => {
    const nextMode = PLAYABLE_MODES.find((candidate) => candidate.id === value)
    if (nextMode) onChange({ ...proposal, mode: nextMode.id })
  }

  return (
    <section aria-label="确认方案" className="space-y-4">
      {showHeader && (
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y">
            <tr>
              <th className="bg-muted/40 w-28 px-3 py-2 font-medium">路由</th>
              <td className="px-3 py-2">
                <span>{routingLabels[proposal.routing.match]}</span>
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
              <th className="bg-muted/40 w-28 px-3 py-2 font-medium">
                {proposal.routing.match === 'exact'
                  ? '匹配模板'
                  : proposal.routing.match === 'approximate'
                    ? '基础模板'
                    : '实现方式'}
              </th>
              <td className="space-y-2 px-3 py-2">
                {proposal.routing.match === 'freeform' ? (
                  <>
                    <Badge variant="secondary">Agent 自由生成</Badge>
                    <p className="text-muted-foreground text-xs">
                      构建 Agent 将直接实现确认的玩法，不受参考模板状态机限制。
                    </p>
                  </>
                ) : (
                  <>
                    <Select value={proposal.mode} disabled={controlsDisabled} onValueChange={updateMode}>
                      <SelectTrigger className="w-full" aria-label="玩法模板">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLAYABLE_MODES.map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {candidate.label} ({candidate.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">
                      <span className="font-mono">{mode.id}</span> · {mode.description}
                    </p>
                  </>
                )}
              </td>
            </tr>
            <tr>
              <th className="bg-muted/40 w-28 px-3 py-2 font-medium">玩法方案</th>
              <td className="px-3 py-2">
                <Textarea
                  aria-label="玩法说明"
                  className="min-h-20 resize-y"
                  maxLength={1200}
                  value={proposal.gameplay}
                  disabled={controlsDisabled}
                  onChange={(event) => onChange({ ...proposal, gameplay: event.target.value })}
                />
              </td>
            </tr>
            {assetFields.map(({ slot, label }) => {
              const resource = proposal.resources[slot]
              const slotAssets = uploadedAssets.filter((asset) => asset.slot === slot)
              return (
                <tr key={slot}>
                  <th className="bg-muted/40 px-3 py-2 font-medium">{label}</th>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          resource.status === '待上传' || resource.status === '待生成' ? 'destructive' : 'secondary'
                        }
                      >
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
                        aria-label={`使用内置默认${label}`}
                        onClick={() =>
                          updateResource(slot, {
                            status: '内置默认',
                            treatment: defaultTreatments[slot],
                          })
                        }
                      >
                        内置默认
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={controlsDisabled || !aiMediaGenerationEnabled}
                        aria-label={`AI 生成${label}（暂不支持）`}
                        title="AI 素材生成暂不支持"
                        onClick={() =>
                          updateResource(slot, {
                            status: '待生成',
                            treatment: generatedTreatments[slot],
                          })
                        }
                      >
                        {slot === 'audio' ? 'AI 配音（暂不支持）' : 'AI 生成（暂不支持）'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          resource.status === '待上传' || resource.status === '用户上传' ? 'secondary' : 'outline'
                        }
                        disabled={controlsDisabled || Boolean(uploadingSlot) || !onUpload}
                        aria-label={`本地上传${label}`}
                        onClick={() => uploadInputs.current[slot]?.click()}
                      >
                        {uploadingSlot === slot ? '上传中…' : '本地上传'}
                      </Button>
                      {onUpload && (
                        <input
                          ref={(node) => {
                            uploadInputs.current[slot] = node
                          }}
                          aria-label={`为${label}上传素材`}
                          className="sr-only"
                          type="file"
                          multiple
                          disabled={controlsDisabled || Boolean(uploadingSlot)}
                          accept={playableAssetAccept(slot)}
                          onChange={(event) => {
                            const files = Array.from(event.target.files ?? [])
                            if (files.length > 0) onUpload(slot, files)
                            event.target.value = ''
                          }}
                        />
                      )}
                    </div>
                    {slotAssets.length > 0 && (
                      <div className="mt-2">
                        <AssetPreviewList
                          items={slotAssets.map((asset) => ({ ...asset, previewUrl: assetPreviewUrl?.(asset) }))}
                          disabled={controlsDisabled}
                          removingId={removingAssetId}
                          onRemove={
                            onRemoveAsset
                              ? (item) => {
                                  const asset = uploadedAssets.find((candidate) => candidate.id === item.id)
                                  if (asset) onRemoveAsset(asset)
                                }
                              : undefined
                          }
                        />
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {presentation.showReferenceAssets && (onUpload || referenceAssets.length > 0) && (
              <tr>
                <th className="bg-muted/40 px-3 py-2 font-medium">参考素材</th>
                <td className="space-y-2 px-3 py-2">
                  {onUpload && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={controlsDisabled || Boolean(uploadingSlot)}
                        onClick={() => uploadInputs.current.referenceImage?.click()}
                      >
                        <ImagePlus aria-hidden="true" />
                        {uploadingSlot === 'referenceImage' ? '图片上传中…' : '上传参考图片'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={controlsDisabled || Boolean(uploadingSlot)}
                        onClick={() => uploadInputs.current.referenceVideo?.click()}
                      >
                        <Video aria-hidden="true" />
                        {uploadingSlot === 'referenceVideo' ? '视频上传中…' : '上传参考视频'}
                      </Button>
                      {(['referenceImage', 'referenceVideo'] as const).map((slot) => (
                        <input
                          key={slot}
                          ref={(node) => {
                            uploadInputs.current[slot] = node
                          }}
                          aria-label={slot === 'referenceImage' ? '选择参考图片' : '选择参考视频'}
                          className="sr-only"
                          type="file"
                          multiple
                          disabled={controlsDisabled || Boolean(uploadingSlot)}
                          accept={playableAssetAccept(slot)}
                          onChange={(event) => {
                            const files = Array.from(event.target.files ?? [])
                            if (files.length > 0) onUpload(slot, files)
                            event.target.value = ''
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {referenceAssets.length > 0 && (
                    <AssetPreviewList
                      items={referenceAssets.map((asset) => ({ ...asset, previewUrl: assetPreviewUrl?.(asset) }))}
                      disabled={controlsDisabled}
                      removingId={removingAssetId}
                      onRemove={
                        onRemoveAsset
                          ? (item) => {
                              const asset = referenceAssets.find((candidate) => candidate.id === item.id)
                              if (asset) onRemoveAsset(asset)
                            }
                          : undefined
                      }
                    />
                  )}
                  <p className="text-muted-foreground text-xs">参考文件会随任务保存；当前不会自动解析视频画面。</p>
                </td>
              </tr>
            )}
            {presentation.copyFields.length > 0 && (
              <tr>
                <th className="bg-muted/40 px-3 py-2 font-medium">文案</th>
                <td className="grid gap-2 px-3 py-2 sm:grid-cols-2">
                  {presentation.copyFields.map((field) => {
                    const config = copyFieldConfig[field]
                    return (
                      <Input
                        key={field}
                        aria-label={config.label}
                        placeholder={config.label}
                        maxLength={config.maxLength}
                        value={proposal.copy[field]}
                        disabled={controlsDisabled}
                        onChange={(event) =>
                          onChange({ ...proposal, copy: { ...proposal.copy, [field]: event.target.value } })
                        }
                      />
                    )
                  })}
                </td>
              </tr>
            )}
            <tr>
              <th className="bg-muted/40 px-3 py-2 font-medium">交付与跳转</th>
              <td className="space-y-3 px-3 py-2">
                <div className="space-y-2">
                  <Label>交付标准</Label>
                  <Select
                    value={deliveryProfile.id}
                    disabled={controlsDisabled}
                    onValueChange={(value) => {
                      if (!isDeliveryProfileId(value)) return
                      onChange({ ...proposal, delivery: deliveryProfileSnapshot(value) })
                    }}
                  >
                    <SelectTrigger className="w-full" aria-label="交付标准">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(DELIVERY_PROFILES).map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {deliveryProfile.logicalWidth} × {deliveryProfile.logicalHeight} · 单 HTML ·{' '}
                    {deliveryProfile.maxBytes === null
                      ? '无渠道体积上限'
                      : `${deliveryProfile.maxBytes / 1024 / 1024} MiB 上限`}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={storeUrlId}>商店跳转链接（HTTPS）</Label>
                  <Input
                    id={storeUrlId}
                    type="url"
                    value={proposal.storeUrl}
                    aria-invalid={!validStoreUrl}
                    disabled={controlsDisabled}
                    onChange={(event) => onChange({ ...proposal, storeUrl: event.target.value })}
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {hasPendingUpload && <p className="text-destructive text-sm">请先上传所有标记为“待上传”的素材。</p>}
      {hasUnsupportedAiGeneration && (
        <p className="text-destructive text-sm">AI 素材生成暂不支持，请改用内置默认或本地上传。</p>
      )}
      {showConfirmAction && (
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
      )}
    </section>
  )
}
