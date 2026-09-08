import { generateId as defaultGenerateId } from '@/lib/utils/id'
import type { ConfirmedBuildInput, PlayableBuildAsset } from './playable-agent-adapter'
import type { PlayableResourceAssetSlot } from './asset-policy'
import { MAX_ASSET_BYTES } from './task-assets'

const IMAGE_MODEL = 'gpt-image-2'
const SPEECH_MODEL = 'gpt-4o-mini-tts'

type MediaGenerationInput = Pick<ConfirmedBuildInput, 'taskId' | 'apiKey' | 'confirmation'>

interface MediaGenerationDependencies {
  fetch?: typeof fetch
  generateId?: () => string
}

const imageSettings: Partial<
  Record<PlayableResourceAssetSlot, { size: string; background: 'transparent' | 'opaque' }>
> = {
  tileFaces: { size: '1024x1024', background: 'transparent' },
  backgroundBoard: { size: '1024x1536', background: 'opaque' },
  animationEffects: { size: '1024x1024', background: 'transparent' },
  endCard: { size: '1024x1536', background: 'opaque' },
}

function validateGeneratedBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error('Generated playable media is invalid')
  }
  return bytes
}

async function generateImage(
  apiKey: string,
  prompt: string,
  settings: { size: string; background: 'transparent' | 'opaque' },
  request: typeof fetch,
): Promise<Uint8Array> {
  const response = await request('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size: settings.size,
      quality: 'low',
      background: settings.background,
    }),
  })
  if (!response.ok) throw new Error('Image generation failed')
  const body = (await response.json()) as { data?: Array<{ b64_json?: string }> }
  const encoded = body.data?.[0]?.b64_json
  if (!encoded) throw new Error('Image generation returned no media')
  return validateGeneratedBytes(new Uint8Array(Buffer.from(encoded, 'base64')))
}

async function generateSpeech(
  apiKey: string,
  title: string,
  cta: string,
  instructions: string,
  request: typeof fetch,
): Promise<Uint8Array> {
  const response = await request('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SPEECH_MODEL,
      voice: 'coral',
      input: `${title}。${cta}`,
      instructions,
      response_format: 'mp3',
    }),
  })
  if (!response.ok) throw new Error('Speech generation failed')
  return validateGeneratedBytes(new Uint8Array(await response.arrayBuffer()))
}

function imagePrompt(input: MediaGenerationInput, slot: PlayableResourceAssetSlot, treatment: string): string {
  return [
    `为 360×640 竖屏试玩广告创作 ${slot} 素材。`,
    `主题标题：${input.confirmation.copy.title}。`,
    `核心玩法：${input.confirmation.gameplay}。`,
    `美术要求：${treatment}。`,
    '不要生成品牌标志或可读文字，构图要适合移动端游戏界面叠加。',
  ].join('')
}

export async function generatePlayableMediaAssets(
  input: MediaGenerationInput,
  dependencies: MediaGenerationDependencies = {},
): Promise<PlayableBuildAsset[]> {
  const request = dependencies.fetch ?? fetch
  const nextId = dependencies.generateId ?? defaultGenerateId
  const generated: PlayableBuildAsset[] = []

  for (const [slotValue, resource] of Object.entries(input.confirmation.resources)) {
    const slot = slotValue as PlayableResourceAssetSlot
    if (resource.status !== '待生成') continue
    const id = nextId()
    if (slot === 'audio') {
      const bytes = await generateSpeech(
        input.apiKey,
        input.confirmation.copy.title,
        input.confirmation.copy.cta,
        resource.treatment,
        request,
      )
      generated.push({ id, slot, filename: `${slot}-ai.mp3`, mimeType: 'audio/mpeg', size: bytes.byteLength, bytes })
      continue
    }
    const settings = imageSettings[slot]
    if (!settings) throw new Error('Unsupported generated media slot')
    const bytes = await generateImage(input.apiKey, imagePrompt(input, slot, resource.treatment), settings, request)
    generated.push({ id, slot, filename: `${slot}-ai.png`, mimeType: 'image/png', size: bytes.byteLength, bytes })
  }

  return generated
}
