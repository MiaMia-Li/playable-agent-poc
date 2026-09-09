export const DELIVERY_PROFILE_IDS = ['applovin', 'generic_single_html'] as const
export const APPLOVIN_MAX_BYTES = 5_242_880

export type DeliveryProfileId = (typeof DELIVERY_PROFILE_IDS)[number]

export interface DeliveryProfile {
  id: DeliveryProfileId
  label: string
  description: string
  network: 'applovin' | 'generic'
  logicalWidth: 360
  logicalHeight: 640
  output: 'single-html'
  maxBytes: number | null
}

export const DELIVERY_PROFILES = {
  applovin: {
    id: 'applovin',
    label: 'AppLovin',
    description: '单 HTML，文件最大 5 MiB',
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: APPLOVIN_MAX_BYTES,
  },
  generic_single_html: {
    id: 'generic_single_html',
    label: '通用单 HTML',
    description: '离线单 HTML，不设置渠道体积上限',
    network: 'generic',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: null,
  },
} as const satisfies Record<DeliveryProfileId, DeliveryProfile>

export function isDeliveryProfileId(value: string): value is DeliveryProfileId {
  return DELIVERY_PROFILE_IDS.some((id) => id === value)
}

export function getDeliveryProfile(id: DeliveryProfileId) {
  return DELIVERY_PROFILES[id]
}

export function deliveryProfileSnapshot(id: DeliveryProfileId) {
  const profile = getDeliveryProfile(id)
  return {
    profileId: profile.id,
    network: profile.network,
    logicalWidth: profile.logicalWidth,
    logicalHeight: profile.logicalHeight,
    output: profile.output,
    maxBytes: profile.maxBytes,
  } as const
}

export function deliveryProfileIdFor(input: {
  profileId?: DeliveryProfileId
  network: DeliveryProfile['network']
}): DeliveryProfileId {
  return input.profileId ?? (input.network === 'generic' ? 'generic_single_html' : 'applovin')
}

export function matchesDeliveryProfileSnapshot(input: {
  profileId?: DeliveryProfileId
  network: DeliveryProfile['network']
  logicalWidth: number
  logicalHeight: number
  output: string
  maxBytes: number | null
}): boolean {
  const profile = getDeliveryProfile(deliveryProfileIdFor(input))
  return (
    input.network === profile.network &&
    input.logicalWidth === profile.logicalWidth &&
    input.logicalHeight === profile.logicalHeight &&
    input.output === profile.output &&
    input.maxBytes === profile.maxBytes
  )
}
