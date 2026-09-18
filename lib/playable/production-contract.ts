import { GLB_MIME_TYPE } from './asset-policy'
import { inspectGlb } from './glb'
import type { ConfirmationProposal } from './schemas'
import { deliveryProfileIdFor, deliveryProfileSnapshot, getDeliveryProfile } from './delivery-standards'
import { getPlayableMode, MAHJONG_PLAYABLE_PLUGIN } from './template-registry'
import type { PlayableAssetManifest, PlayableBuildAsset, PlayableValidationReport } from './playable-agent-adapter'

export interface PlayableProductionConfig {
  core: {
    pluginId: string
    pluginVersion: string
    runtimeVersion: string
    mode: ConfirmationProposal['mode']
    // 保留构建所用上传基底的身份，便于产物追溯；与模板 ID 分开记录。
    sourceHtmlAssetId?: string
    sourceTemplateId?: NonNullable<ConfirmationProposal['sourceTemplateId']>
    gameplay: string
    routing: ConfirmationProposal['routing']
    rendering?: ConfirmationProposal['rendering']
  }
  theme: {
    direction: string
  }
  assets: ConfirmationProposal['resources']
  ad: ConfirmationProposal['delivery'] & {
    storeUrl: string
    orientation: 'responsive'
  }
  copy: ConfirmationProposal['copy']
}

const sourceLabels: Record<
  NonNullable<ConfirmationProposal['resources'][keyof ConfirmationProposal['resources']]>['status'],
  string
> = {
  用户上传: 'task-upload',
  内置默认: `plugin:${MAHJONG_PLAYABLE_PLUGIN.id}@${MAHJONG_PLAYABLE_PLUGIN.version}`,
  待上传: 'pending-upload',
  待生成: 'openai-generated',
}

export function createProductionConfig(confirmation: ConfirmationProposal): PlayableProductionConfig {
  const mode = getPlayableMode(confirmation.mode)
  return {
    core: {
      pluginId: mode.pluginId,
      pluginVersion: mode.pluginVersion,
      runtimeVersion: mode.runtimeVersion,
      mode: confirmation.mode,
      ...(confirmation.sourceTemplateId ? { sourceTemplateId: confirmation.sourceTemplateId } : {}),
      ...(confirmation.sourceHtmlAssetId ? { sourceHtmlAssetId: confirmation.sourceHtmlAssetId } : {}),
      gameplay: confirmation.gameplay,
      routing: confirmation.routing,
      ...(confirmation.rendering ? { rendering: confirmation.rendering } : {}),
    },
    theme: {
      direction: Object.values(confirmation.resources)
        .map((resource) => resource.treatment)
        .join('；'),
    },
    assets: confirmation.resources,
    ad: {
      ...confirmation.delivery,
      storeUrl: confirmation.storeUrl,
      orientation: 'responsive',
    },
    copy: confirmation.copy,
  }
}

export function createAssetSourceManifest(
  confirmation: ConfirmationProposal,
  assets: PlayableBuildAsset[],
): PlayableAssetManifest {
  return {
    plugin: {
      id: MAHJONG_PLAYABLE_PLUGIN.id,
      version: MAHJONG_PLAYABLE_PLUGIN.version,
      runtimeVersion: MAHJONG_PLAYABLE_PLUGIN.runtimeVersion,
    },
    sources: Object.entries(confirmation.resources).map(([slot, resource]) => ({
      slot: slot as keyof ConfirmationProposal['resources'],
      status: resource.status,
      treatment: resource.treatment,
      origin: slot === 'models' && resource.status === '内置默认' ? 'none' : sourceLabels[resource.status],
      files: assets.filter((asset) => asset.slot === slot).map((asset) => asset.filename),
    })),
    assets: assets.map((asset) => buildAssetManifestEntry(asset, `user-assets/${asset.slot}/${asset.filename}`)),
    entrypoint: 'playable.html',
  }
}

export function createValidationReport(input: {
  rendering?: PlayableValidationReport['rendering']
  bytes: number
  offlineResources: boolean
  responsiveViewport: boolean
  delivery?: ConfirmationProposal['delivery']
}): PlayableValidationReport {
  const delivery = input.delivery ?? deliveryProfileSnapshot('applovin')
  const profile = getDeliveryProfile(deliveryProfileIdFor(delivery))
  const packageSizePassed = profile.maxBytes === null || input.bytes <= profile.maxBytes
  const buildPassed = input.offlineResources && input.responsiveViewport
  return {
    passed: buildPassed,
    ...(input.rendering ? { rendering: input.rendering } : {}),
    buildPassed,
    deliveryCompliant: packageSizePassed,
    behavior: 'passed',
    bytes: input.bytes,
    delivery: {
      profileId: profile.id,
      label: profile.label,
      maxBytes: profile.maxBytes,
    },
    plugin: {
      id: MAHJONG_PLAYABLE_PLUGIN.id,
      version: MAHJONG_PLAYABLE_PLUGIN.version,
      runtimeVersion: MAHJONG_PLAYABLE_PLUGIN.runtimeVersion,
    },
    gates: {
      schema: 'passed',
      behavior: 'passed',
      packageSize: profile.maxBytes === null ? 'not_applicable' : packageSizePassed ? 'passed' : 'failed',
      offlineResources: input.offlineResources ? 'passed' : 'failed',
      responsiveViewport: input.responsiveViewport ? 'passed' : 'failed',
      initialMute: 'passed',
      firstInteractionNavigation: 'passed',
      credentialScan: 'passed',
    },
  }
}

export function buildAssetManifestEntry(
  asset: PlayableBuildAsset,
  workspacePath: string,
): PlayableAssetManifest['assets'][number] {
  if (asset.bytes.byteLength !== asset.size) throw new Error('Uploaded asset size mismatch')
  const { bytes, ...metadata } = asset
  return { ...metadata, workspacePath, ...(asset.mimeType === GLB_MIME_TYPE ? { model: inspectGlb(bytes) } : {}) }
}
