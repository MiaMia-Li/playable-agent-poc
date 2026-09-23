'use client'

import { buildBaselineLabel } from '@/lib/playable/build-baseline'

import { nativeTemplateUiPolicy, NATIVE_END_CARD_TREATMENT } from '@/lib/playable/native-template-ui'
import { useId, useRef, useState } from 'react'
import { CheckCircle2, ImagePlus, Loader2, Video } from 'lucide-react'
import {
  applyVisualDirection,
  confirmationResource,
  defaultConfirmationPresentation,
  visualDirections,
  type ConfirmationProposal,
  type VisualDirection,
} from '@/lib/playable/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AssetPreviewList } from './asset-preview-list'
import { getPlayableMode, MAHJONG_PLAYABLE_PLUGIN, PLAYABLE_MODES } from '@/lib/playable/template-registry'
import { sourceTemplateIds, type SourceTemplateId } from '@/lib/playable/types'
import { PLAYABLE_TEMPLATES } from '@/lib/playable/template-catalog'
import { isAbsoluteHttpsUrl } from '@/lib/playable/schemas'
import type { SafePlayableAsset } from '@/lib/playable/task-assets'
import {
  hasIncompatibleModelAssets,
  PLAYABLE_MODEL_SLOTS,
  isPlayableResourceAssetSlot,
  playableAssetAccept,
  type PlayableAssetSlot,
} from '@/lib/playable/asset-policy'
import {
  DELIVERY_PROFILES,
  deliveryProfileIdFor,
  deliveryProfileSnapshot,
  getDeliveryProfile,
  isDeliveryProfileId,
} from '@/lib/playable/delivery-standards'

const defaultTreatments: Record<keyof ConfirmationProposal['resources'], string> = {
  tileFaces: '使用系统提供的牌面素材',
  backgroundBoard: '使用系统提供的背景与棋盘',
  animationEffects: '使用系统提供的动画与特效',
  audio: '使用系统提供的音频',
  endCard: '使用系统提供的结束卡',
  models: '不使用额外 3D 模型',
}

const systemAssetDescription = '系统提供，无需上传，可直接构建'

const generatedTreatments: Record<keyof ConfirmationProposal['resources'], string> = {
  tileFaces: '生成与当前主题一致的清晰牌面图集，透明背景',
  backgroundBoard: '生成与当前主题一致的竖屏背景与棋盘，主体区域保持清晰',
  animationEffects: '生成与当前主题一致的透明消除特效素材',
  audio: '根据当前标题和 CTA 生成简短中文宣传配音',
  endCard: '生成与当前主题一致的竖屏结束卡背景，预留标题和 CTA 区域',
  models: '3D 模型自动生成暂不支持',
}

const routingLabels: Record<ConfirmationProposal['routing']['match'], string> = {
  exact: '完全匹配',
  approximate: '近似匹配',
  freeform: 'Agent 自由生成',
}

const visualDirectionLabels: Record<VisualDirection, string> = {
  match_reference: '还原参考视频',
  custom: '自定义',
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
  resourceBindingPreviewUrl?: (assetId: string, path: string) => string
  showConfirmAction?: boolean
  /** The active reference video has a blueprint, so its look can be matched. */
  hasReferenceVisuals?: boolean
}

export function isConfirmationReady(proposal: ConfirmationProposal, assets: SafePlayableAsset[] = []): boolean {
  const presentation = proposal.presentation ?? defaultConfirmationPresentation
  const visibleResources = presentation.assetFields.map((field) => confirmationResource(proposal, field.slot))
  const hasPendingUpload = visibleResources.some((resource) => resource.status === '待上传')
  const hasUnsupportedAiGeneration =
    !MAHJONG_PLAYABLE_PLUGIN.capabilities.aiMediaGeneration &&
    visibleResources.some((resource) => resource.status === '待生成')
  return (
    !hasPendingUpload &&
    !hasUnsupportedAiGeneration &&
    isAbsoluteHttpsUrl(proposal.storeUrl) &&
    !hasIncompatibleModelAssets(proposal, assets)
  )
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
  resourceBindingPreviewUrl,
  showConfirmAction = true,
  hasReferenceVisuals = false,
}: ConfirmationTableProps) {
  const uploadInputs = useRef<Partial<Record<PlayableAssetSlot, HTMLInputElement | null>>>({})
  const [expandedImportedSlots, setExpandedImportedSlots] = useState<Set<string>>(() => new Set())
  const storeUrlId = useId()
  const nativeUi = nativeTemplateUiPolicy(proposal.sourceTemplateId)
  const presentation = proposal.presentation ?? defaultConfirmationPresentation
  const assetFields = [
    ...presentation.assetFields,
    ...(presentation.assetFields.some((field) => field.slot === 'models')
      ? []
      : [{ slot: 'models' as const, label: '3D 模型' }]),
  ].filter((field, index, fields) => fields.findIndex((candidate) => candidate.slot === field.slot) === index)
  const visibleResources = assetFields.map((field) => confirmationResource(proposal, field.slot))
  const hasPendingUpload = visibleResources.some((resource) => resource.status === '待上传')
  const aiMediaGenerationEnabled = MAHJONG_PLAYABLE_PLUGIN.capabilities.aiMediaGeneration
  const hasUnsupportedAiGeneration =
    !aiMediaGenerationEnabled && visibleResources.some((resource) => resource.status === '待生成')
  const resourcesReady = !hasPendingUpload && !hasUnsupportedAiGeneration
  const validStoreUrl = isAbsoluteHttpsUrl(proposal.storeUrl)
  const inProgress = Boolean(confirming || buildPhase)
  const controlsDisabled = Boolean(disabled || inProgress)
  const incompatibleModels = hasIncompatibleModelAssets(proposal, uploadedAssets)
  const canConfirm = resourcesReady && validStoreUrl && !inProgress && !disabled && !incompatibleModels
  const mode =
    PLAYABLE_TEMPLATES.find((template) => template.id === proposal.sourceTemplateId) ?? getPlayableMode(proposal.mode)
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
    const nextTemplate = PLAYABLE_TEMPLATES.find((candidate) => candidate.id === value)
    if (!nextTemplate || nextTemplate.id === mode.id) return
    onChange({
      ...proposal,
      mode: nextMode?.id ?? proposal.mode,
      sourceTemplateId: sourceTemplateIds.includes(value as SourceTemplateId) ? (value as SourceTemplateId) : null,
      gameplay: nextTemplate.description,
      routing: { match: 'exact', confidence: 1, differences: [] },
      rendering: { renderer: 'template', physics: 'template', reason: '沿用所选模板的渲染与运动实现' },
    })
  }

  return (
    <section aria-label="确认方案" className="space-y-4">
      {Boolean(proposal.importedAssetIds?.length) && (
        <p className="text-muted-foreground text-sm">
          已导入压缩包或 Spine 资源；构建会使用原始文件和目录结构，并检查资源完整性。
        </p>
      )}
      {nativeUi && (
        <p className="text-muted-foreground text-sm">
          复用模板原生 CTA 和结束页，不额外添加。文案与素材修改应用到原生界面。
        </p>
      )}
      {showHeader && (
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      )}
      {Boolean(proposal.referenceImages?.length) && (
        <section aria-label="本次构建图片附件" className="rounded-xl border p-3 text-sm">
          <h3 className="font-medium">本次构建图片附件</h3>
          <ul className="mt-1 space-y-1">
            {proposal.referenceImages?.map((ref) => (
              <li key={ref.assetId}>
                {ref.filename}
                <p className="text-muted-foreground whitespace-pre-wrap text-xs">{ref.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y">
            <tr>
              <th className="bg-muted/40 w-28 px-3 py-2 font-medium">路由</th>
              <td className="px-3 py-2">
                <span>{routingLabels[proposal.routing.match]}</span>
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
                {/* baseline 表示实际修改起点；sourceHtmlAssetId 可能只是该版本的原始来源。 */}
                {proposal.baseline && (
                  <p className="text-sm font-medium">修改基底：{buildBaselineLabel(proposal, uploadedAssets)}</p>
                )}
                {proposal.sourceHtmlAssetId ? (
                  <>
                    <Badge variant="secondary">
                      {proposal.baseline?.kind === 'version' ? '保留版本原有实现' : '基于上传 HTML 修改'}
                    </Badge>
                    <p className="text-muted-foreground text-xs">
                      {uploadedAssets.find((asset) => asset.id === proposal.sourceHtmlAssetId)?.filename ??
                        '已确认的 HTML 源文件'}
                      {' · 保留原有玩法、引擎与内嵌资源，按确认需求修改。'}
                    </p>
                  </>
                ) : proposal.routing.match === 'freeform' ? (
                  <>
                    <Badge variant="secondary">Agent 自由生成</Badge>
                    <p className="text-muted-foreground text-xs">
                      构建 Agent 将直接实现确认的玩法，不受参考模板状态机限制。
                    </p>
                  </>
                ) : (
                  <>
                    <Select value={mode.id} disabled={controlsDisabled} onValueChange={updateMode}>
                      <SelectTrigger className="w-full" aria-label="玩法模板">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLAYABLE_TEMPLATES.map((candidate) => (
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
            {proposal.rendering && (
              <tr>
                <th className="bg-muted/40 w-28 px-3 py-2 font-medium">画面与运动</th>
                <td className="space-y-1 px-3 py-2">
                  <p>
                    {proposal.rendering.renderer === 'threejs'
                      ? '真实 3D 场景'
                      : proposal.rendering.renderer === 'canvas2d'
                        ? '2D 画面'
                        : '沿用模板画面'}{' '}
                    ·{' '}
                    {proposal.rendering.physics === 'rapier'
                      ? '真实物理碰撞'
                      : proposal.rendering.physics === 'template'
                        ? '沿用模板运动'
                        : '按玩法规则控制运动'}
                  </p>
                  <p className="text-muted-foreground text-xs">{proposal.rendering.reason}</p>
                </td>
              </tr>
            )}
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
              const resource = confirmationResource(proposal, slot)
              const bindings = proposal.resourceBindings?.[slot] ?? []
              // 对话图片可被明确用作资源；展示已绑定的原文件，不要求用户再次上传到资源槽。
              const slotAssets = uploadedAssets.filter(
                (asset) =>
                  asset.slot === slot ||
                  bindings.some((binding) => binding.kind === 'imageAttachment' && binding.assetId === asset.id),
              )
              const importedBindings = bindings.filter((binding) => binding.kind === 'import')
              const sourceHtmlBindings = bindings.filter((binding) => binding.kind === 'sourceHtml')
              const importedBindingsExpanded = expandedImportedSlots.has(slot)
              const visibleImportedBindings = importedBindingsExpanded
                ? importedBindings
                : importedBindings.slice(0, 24)
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
                        {resource.status === '内置默认'
                          ? slot === 'models'
                            ? '不使用额外模型'
                            : '系统素材'
                          : resource.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        {resource.status === '内置默认'
                          ? slot === 'models'
                            ? '无需额外模型，可继续构建'
                            : systemAssetDescription
                          : resource.treatment}
                      </span>
                    </div>
                    {PLAYABLE_MODEL_SLOTS.some((modelSlot) => modelSlot === slot) && (
                      <p className="text-muted-foreground mt-2 text-xs">
                        {slot === 'models'
                          ? '支持 GLB 角色、道具和场景模型（贴图内嵌）'
                          : '支持图片和 GLB 模型（贴图内嵌）'}
                        ，单个文件最多 4 MiB。
                      </p>
                    )}
                    {resource.status === '用户上传' && (
                      <Textarea
                        aria-label={`${label}用途说明`}
                        className="mt-2"
                        value={resource.treatment}
                        placeholder="按文件名说明模型用途、动作或动画需求，以及是否需要碰撞；例如角色、道具、场景或展示对象"
                        disabled={controlsDisabled}
                        onChange={(event) => updateResource(slot, { ...resource, treatment: event.target.value })}
                      />
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={resource.status === '内置默认' ? 'secondary' : 'outline'}
                        disabled={controlsDisabled}
                        aria-label={`使用系统素材${label}`}
                        onClick={() =>
                          updateResource(slot, {
                            status: '内置默认',
                            treatment:
                              nativeUi && slot === 'endCard' ? NATIVE_END_CARD_TREATMENT : defaultTreatments[slot],
                          })
                        }
                      >
                        {slot === 'models' ? '不使用模型' : '使用系统素材'}
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
                    {sourceHtmlBindings.length > 0 && (
                      <ul className="text-muted-foreground mt-2 space-y-1 text-xs" aria-label={`${label}源 HTML 资源`}>
                        {sourceHtmlBindings.map((binding) => (
                          <li key={`${binding.assetId}:${binding.filename}`}>{binding.filename} · 源 HTML 内嵌资源</li>
                        ))}
                      </ul>
                    )}
                    {importedBindings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <AssetPreviewList
                          ariaLabel={`${label}导入素材`}
                          items={visibleImportedBindings.map((binding) => ({
                            id: `${binding.assetId}:${binding.path}`,
                            filename: binding.filename,
                            mimeType: binding.mimeType,
                            size: binding.size,
                            previewUrl: resourceBindingPreviewUrl?.(binding.assetId, binding.path),
                          }))}
                        />
                        {importedBindings.length > 24 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="link"
                            className="h-auto px-0 text-xs"
                            aria-expanded={importedBindingsExpanded}
                            aria-label={
                              importedBindingsExpanded
                                ? '收起已绑定文件'
                                : `查看全部 ${importedBindings.length} 个已绑定文件`
                            }
                            onClick={() =>
                              setExpandedImportedSlots((current) => {
                                const next = new Set(current)
                                if (next.has(slot)) next.delete(slot)
                                else next.add(slot)
                                return next
                              })
                            }
                          >
                            {importedBindingsExpanded
                              ? '收起'
                              : `查看全部 ${importedBindings.length} 个（另有 ${importedBindings.length - 24} 个）`}
                          </Button>
                        )}
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
                        placeholder={nativeUi && field === 'cta' ? '原生 CTA 文案（留空保留）' : config.label}
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
            {hasReferenceVisuals && (
              <tr>
                <th className="bg-muted/40 px-3 py-2 font-medium">视觉风格</th>
                <td className="space-y-2 px-3 py-2">
                  <Select
                    value={proposal.visualDirection}
                    disabled={controlsDisabled}
                    onValueChange={(value) => {
                      const next = visualDirections.find((direction) => direction === value)
                      if (!next) return
                      // Same rule as the server, so the route shown is the route built.
                      onChange(applyVisualDirection({ ...proposal, visualDirection: next }, { hasReferenceVisuals }))
                    }}
                  >
                    <SelectTrigger className="w-full" aria-label="视觉风格">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visualDirections.map((direction) => (
                        <SelectItem key={direction} value={direction}>
                          {visualDirectionLabels[direction]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {proposal.visualDirection === 'match_reference'
                      ? '按参考视频的配色、版面、UI 与特效还原；已上传的素材优先。'
                      : '不以参考视频的外观为目标，只参考其玩法。'}
                  </p>
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
      {incompatibleModels && (
        <p className="text-destructive text-sm">
          GLB 模型需要 Three.js 自定义构建。请在对话中说明使用模型，让 Agent 更新确认方案。
        </p>
      )}
      {hasPendingUpload && <p className="text-destructive text-sm">请先上传所有标记为“待上传”的素材。</p>}
      {hasUnsupportedAiGeneration && (
        <p className="text-destructive text-sm">AI 素材生成暂不支持，请改用系统素材或本地上传。</p>
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
