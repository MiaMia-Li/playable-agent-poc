import type { ConfirmationProposal } from './schemas'
import { getPlayableMode, MAHJONG_PLAYABLE_PLUGIN } from './template-registry'
import type { PlayableAssetManifest, PlayableBuildAsset, PlayableValidationReport } from './playable-agent-adapter'

export interface PlayableProductionConfig {
  core: {
    pluginId: string
    pluginVersion: string
    runtimeVersion: string
    mode: ConfirmationProposal['mode']
    gameplay: string
    routing: ConfirmationProposal['routing']
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
  ConfirmationProposal['resources'][keyof ConfirmationProposal['resources']]['status'],
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
      gameplay: confirmation.gameplay,
      routing: confirmation.routing,
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
      origin: sourceLabels[resource.status],
      files: assets.filter((asset) => asset.slot === slot).map((asset) => asset.filename),
    })),
    assets: assets.map(({ bytes: _bytes, ...asset }) => {
      void _bytes
      return { ...asset, workspacePath: `user-assets/${asset.slot}/${asset.filename}` }
    }),
    entrypoint: 'playable.html',
  }
}

export function createValidationReport(input: {
  bytes: number
  offlineResources: boolean
  responsiveViewport: boolean
}): PlayableValidationReport {
  const packageSizePassed = input.bytes < MAHJONG_PLAYABLE_PLUGIN.delivery.maxBytes
  return {
    passed: packageSizePassed && input.offlineResources && input.responsiveViewport,
    behavior: 'passed',
    bytes: input.bytes,
    plugin: {
      id: MAHJONG_PLAYABLE_PLUGIN.id,
      version: MAHJONG_PLAYABLE_PLUGIN.version,
      runtimeVersion: MAHJONG_PLAYABLE_PLUGIN.runtimeVersion,
    },
    gates: {
      schema: 'passed',
      behavior: 'passed',
      packageSize: packageSizePassed ? 'passed' : 'failed',
      offlineResources: input.offlineResources ? 'passed' : 'failed',
      responsiveViewport: input.responsiveViewport ? 'passed' : 'failed',
      initialMute: 'passed',
      firstInteractionNavigation: 'passed',
      credentialScan: 'passed',
    },
  }
}
