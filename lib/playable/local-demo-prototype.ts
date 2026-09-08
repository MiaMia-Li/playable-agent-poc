import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Session } from '@/lib/session/types'
import type { ArtifactStore } from './artifact-store'
import type {
  AgentInput,
  BuildResult,
  ConfirmedBuildInput,
  PlayableAgentAdapter,
  PlayableAssetManifest,
  PlayableBuildAsset,
} from './playable-agent-adapter'
import type { ConfirmationProposal, PlayableAgentReply, PlayableTaskPhase } from './schemas'
import type { PlayableAsset } from './task-assets'
import { createAssetSourceManifest, createValidationReport } from './production-contract'
import type {
  PlayableEventRecord,
  PlayableTaskMessageRecord,
  PlayableTaskRecord,
  PlayableTaskRepository,
} from './task-api'
import type { PlayableModeId } from './types'

const execFileAsync = promisify(execFile)
const localDemoUserId = 'local-demo-user'
const localDemoApiKey = 'sk-local-demo-only'

export const localDemoSession: Session = {
  created: 0,
  authProvider: 'github',
  user: {
    id: localDemoUserId,
    username: 'local-demo',
    email: undefined,
    avatar: '',
    name: '本地演示',
  },
}

export function isLocalDemoMode(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.LOCAL_DEMO_MODE === '1'
}

function selectMode(prompt: string): PlayableModeId | undefined {
  const normalized = prompt.toLowerCase()
  if (normalized.includes('perspective_3d') || normalized.includes('3d') || normalized.includes('立体')) {
    return 'perspective_3d'
  }
  if (normalized.includes('gravity_fill') || normalized.includes('下落') || normalized.includes('补位')) {
    return 'gravity_fill'
  }
  if (normalized.includes('top_rack') || normalized.includes('牌架') || normalized.includes('上方')) {
    return 'top_rack'
  }
  if (normalized.includes('center_collision') || normalized.includes('中心碰撞')) return 'center_collision'
  return undefined
}

type AssetStrategy = 'generated' | 'generated_images' | 'bundled' | 'uploaded'

function conversationText(input: AgentInput): string {
  return [
    ...(input.history ?? []).filter((turn) => turn.role === 'user').map((turn) => turn.content),
    input.prompt,
  ].join('\n')
}

function hasVisualTheme(prompt: string): boolean {
  const normalized = prompt.toLowerCase()
  return ['主题', '风格', '国风', '茶园', '霓虹', '农场', '海洋', '糖果', '卡通', '写实'].some((keyword) =>
    normalized.includes(keyword),
  )
}

function selectAssetStrategy(prompt: string): AssetStrategy | undefined {
  const normalized = prompt.toLowerCase()
  if (normalized.includes('图片 ai') || normalized.includes('图片ai')) return 'generated_images'
  if (normalized.includes('ai') && (normalized.includes('生成') || normalized.includes('素材'))) return 'generated'
  if (normalized.includes('上传') || normalized.includes('本地素材')) return 'uploaded'
  if (normalized.includes('内置') || normalized.includes('默认素材')) return 'bundled'
  return undefined
}

function hasLaunchDetails(prompt: string): boolean {
  const normalized = prompt.toLowerCase()
  const copyReady =
    normalized.includes('默认文案') ||
    normalized.includes('自动生成文案') ||
    (normalized.includes('标题') && normalized.includes('cta'))
  const linkReady =
    normalized.includes('测试链接') || normalized.includes('示例链接') || /https:\/\/[^\s]+/.test(normalized)
  return copyReady && linkReady
}

function createProposal(mode: PlayableModeId, assetStrategy: AssetStrategy): ConfirmationProposal {
  const generated = assetStrategy === 'generated' || assetStrategy === 'generated_images'
  const uploaded = assetStrategy === 'uploaded'
  const imageResource = (treatment: string) =>
    uploaded
      ? ({ status: '待上传', treatment: '等待用户上传对应图片素材' } as const)
      : generated
        ? ({ status: '待生成', treatment } as const)
        : ({ status: '内置默认', treatment: '使用 Skill 内置图片素材' } as const)
  const audioResource = uploaded
    ? ({ status: '待上传', treatment: '等待用户上传音频素材' } as const)
    : assetStrategy === 'generated'
      ? ({ status: '待生成', treatment: '根据标题和 CTA 生成简短中文宣传配音' } as const)
      : ({ status: '内置默认', treatment: '使用内置音频并默认静音' } as const)
  return {
    routing: {
      match: 'exact',
      confidence: 1,
      differences: [],
    },
    mode,
    gameplay: {
      center_collision: '选择两张相同麻将牌，牌面向中心碰撞并消除计分。',
      top_rack: '选择可见麻将牌进入上方牌架，相同牌配对后自动清除。',
      gravity_fill: '选择相同麻将牌消除，空位由上方牌面下落补齐。',
      perspective_3d: '选择立体牌墙暴露的顶面，消除后逐层揭示下方麻将牌。',
    }[mode],
    resources: {
      tileFaces: imageResource('生成符合当前主题的清晰麻将牌面图集，透明背景'),
      backgroundBoard: imageResource('生成符合当前主题的竖屏背景与棋盘'),
      animationEffects: imageResource('生成符合当前主题的透明配对与消除特效'),
      audio: audioResource,
      endCard: imageResource('生成符合当前主题的竖屏结束卡背景'),
    },
    copy: {
      title: '麻将配对挑战',
      cta: '立即试玩',
      disclaimer: '本地演示版本',
      locale: 'zh-CN',
    },
    storeUrl: 'https://example.com/app',
    delivery: {
      network: 'applovin',
      logicalWidth: 360,
      logicalHeight: 640,
      output: 'single-html',
      maxBytes: 5242880,
    },
  }
}

class LocalDemoAgent implements PlayableAgentAdapter {
  async proposeConfirmation(input: AgentInput): Promise<PlayableAgentReply> {
    const context = conversationText(input)
    if (['跑酷', '射击', '胜负规则', '自定义状态机'].some((keyword) => context.includes(keyword))) {
      return {
        kind: 'plugin_request',
        message: '这个需求的核心状态机不属于当前麻将配对 Plugin，已整理为新增 Plugin 需求，不会生成一次性代码。',
        reasoning: '当前四个模板只能表达麻将配对、牌架、下落补位和纵深揭层。',
        pluginRequest: {
          summary: input.prompt,
          reason: '核心操作或胜负状态机无法由现有模板表达',
          requiredStateMachine: ['定义输入方式', '定义核心循环', '定义胜负与结束条件'],
          source: 'text-description',
        },
      }
    }
    const mode =
      selectMode(input.prompt) ??
      [...(input.history ?? [])]
        .reverse()
        .filter((turn) => turn.role === 'user')
        .map((turn) => selectMode(turn.content))
        .find(Boolean)
    if (!mode) {
      return {
        kind: 'clarification',
        message: '我已经记下视觉主题。接下来请选择一种核心玩法，之后我会整理完整构建方案。',
        reasoning: '当前需求描述了风格，但没有明确配对后的移动与消除机制。',
        options: [
          {
            id: 'center_collision',
            label: '中心碰撞',
            description: '相同牌飞向中心碰撞并消除',
            value: '选择中心碰撞（center_collision）玩法',
          },
          {
            id: 'top_rack',
            label: '上方牌架',
            description: '选中的牌进入上方牌架后配对',
            value: '选择上方牌架（top_rack）玩法',
          },
          {
            id: 'gravity_fill',
            label: '下落补位',
            description: '消除后同列牌面下落并补位',
            value: '选择下落补位（gravity_fill）玩法',
          },
          {
            id: 'perspective_3d',
            label: '3D 纵深',
            description: '从立体牌墙顶层逐层配对',
            value: '选择 3D 纵深（perspective_3d）玩法',
          },
        ],
      }
    }
    if (!hasVisualTheme(context)) {
      return {
        kind: 'clarification',
        message: '玩法已经明确。接下来请选择一个视觉主题，也可以直接描述你想要的美术风格。',
        reasoning: '当前对话还没有明确画面主题，暂时无法确定牌面、背景和结束卡的视觉方向。',
        options: [
          {
            id: 'classic_theme',
            label: '经典国风',
            description: '红金配色、木质牌桌与传统麻将纹样',
            value: '使用经典国风主题',
          },
          {
            id: 'fresh_theme',
            label: '清新茶园',
            description: '青绿配色、竹木元素与明亮氛围',
            value: '使用清新茶园主题',
          },
          {
            id: 'neon_theme',
            label: '霓虹夜市',
            description: '高对比霓虹色和热闹街机质感',
            value: '使用霓虹夜市主题',
          },
        ],
      }
    }
    const assetStrategy = selectAssetStrategy(context)
    if (!assetStrategy) {
      return {
        kind: 'clarification',
        message: '玩法已经明确。接下来请选择图片和音频素材的准备方式。',
        reasoning: '构建前需要确认素材由 AI 生成、使用内置资源，还是由你上传。',
        options: [
          {
            id: 'all_generated',
            label: '全部 AI 生成',
            description: '生成主题图片，并为标题和 CTA 生成配音',
            value: '图片和音频素材全部使用 AI 生成',
          },
          {
            id: 'generated_images',
            label: '图片 AI 生成',
            description: '生成主题图片，音频使用内置默认',
            value: '图片 AI 生成，音频使用内置默认',
          },
          {
            id: 'bundled',
            label: '全部内置默认',
            description: '使用模板自带图片、特效和音频',
            value: '全部使用内置默认素材',
          },
          {
            id: 'uploaded',
            label: '我来上传',
            description: '在确认表中上传自己的图片和音频',
            value: '图片和音频都使用我上传的本地素材',
          },
        ],
      }
    }
    if (!hasLaunchDetails(context)) {
      return {
        kind: 'clarification',
        message: '最后请确认投放文案和 HTTPS 商店链接。你可以直接输入标题、CTA 和链接，或先使用测试信息。',
        reasoning: '玩法和素材方向已经齐全，补齐跳转与文案后才能生成可确认的完整需求表。',
        options: [
          {
            id: 'default_launch_details',
            label: '使用默认测试信息',
            description: '自动生成中文文案，并暂用 HTTPS 示例链接',
            value: '使用默认文案和测试链接',
          },
        ],
      }
    }
    return {
      kind: 'confirmation',
      message: '玩法和视觉方向已经明确。我整理了完整方案，你可以继续调整每类素材的来源。',
      reasoning: `已根据对话选择${mode}玩法，并为未指定的素材保留内置默认。`,
      confirmation: createProposal(mode, assetStrategy),
    }
  }

  async build(input: ConfirmedBuildInput): Promise<BuildResult> {
    const workspace = await mkdtemp(path.join(tmpdir(), 'playable-local-demo-'))
    const outputPath = path.join(workspace, 'playable.html')
    const starterRoot = path.join(process.cwd(), 'skills/mahjong-pair-match-playable/assets/starter')
    try {
      const assets = input.assets ?? []
      const assetManifest = createAssetSourceManifest(input.confirmation, assets)
      await writeFile(path.join(workspace, 'confirmed-config.json'), JSON.stringify(input.confirmation), 'utf8')
      for (const asset of assets) {
        const manifestAsset = assetManifest.assets.find((candidate) => candidate.id === asset.id)
        if (!manifestAsset) throw new Error('Playable asset manifest is incomplete')
        const assetPath = path.join(workspace, manifestAsset.workspacePath)
        await mkdir(path.dirname(assetPath), { recursive: true })
        await writeFile(assetPath, asset.bytes)
      }
      await writeFile(path.join(workspace, 'asset-manifest.json'), JSON.stringify(assetManifest), 'utf8')
      await execFileAsync(
        process.execPath,
        [
          path.join(starterRoot, 'build-playable.mjs'),
          input.confirmation.mode,
          outputPath,
          input.confirmation.storeUrl,
        ],
        { cwd: workspace },
      )
      await execFileAsync(process.execPath, [path.join(starterRoot, 'work/test-playable.mjs'), outputPath])
      const html = await readFile(outputPath, 'utf8')
      return {
        html,
        assetManifest,
        validation: createValidationReport({
          bytes: Buffer.byteLength(html),
          offlineResources: true,
          responsiveViewport: true,
        }),
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }

  async cancel(): Promise<void> {}
}

class LocalDemoArtifactStore implements ArtifactStore {
  private readonly values = new Map<string, Uint8Array>()

  async put(key: string, value: string | Uint8Array): Promise<void> {
    this.values.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value.slice())
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const value = this.values.get(key)
    if (!value) return
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(value.slice())
        controller.close()
      },
    })
  }
}

class LocalDemoTaskRepository implements PlayableTaskRepository {
  private readonly tasks = new Map<string, PlayableTaskRecord>()
  private readonly events = new Map<string, PlayableEventRecord[]>()
  private readonly assets = new Map<string, PlayableAsset[]>()
  private readonly messages = new Map<string, PlayableTaskMessageRecord[]>()

  async createTask(input: { id: string; userId: string; prompt: string }): Promise<PlayableTaskRecord> {
    const task: PlayableTaskRecord = {
      ...input,
      phase: 'draft',
      confirmation: null,
      latestArtifactKey: null,
      createdAt: new Date(),
    }
    this.tasks.set(task.id, task)
    return task
  }

  async findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined> {
    const task = this.tasks.get(taskId)
    return task?.userId === userId ? task : undefined
  }

  async listOwnedTasks(userId: string): Promise<PlayableTaskRecord[]> {
    return [...this.tasks.values()]
      .filter((task) => task.userId === userId)
      .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))
  }

  async appendMessage(taskId: string, role: 'user' | 'agent', content: string): Promise<void> {
    const items = this.messages.get(taskId) ?? []
    items.push({ id: `message-${items.length + 1}`, taskId, role, content, createdAt: new Date() })
    this.messages.set(taskId, items)
  }

  async listMessages(taskId: string): Promise<PlayableTaskMessageRecord[]> {
    return this.messages.get(taskId) ?? []
  }

  async setDraft(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation'].includes(task.phase)) return false
    task.phase = 'draft'
    return true
  }

  async setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation'].includes(task.phase)) return false
    task.phase = 'awaiting_confirmation'
    task.confirmation = confirmation
    return true
  }

  async setNeedsPlugin(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation'].includes(task.phase)) return false
    task.phase = 'needs_plugin'
    return true
  }

  async claimBuild(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
  ): Promise<PlayableTaskRecord | undefined> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || task.phase !== 'awaiting_confirmation') return
    task.phase = 'building'
    task.confirmation = confirmation
    return task
  }

  async compareAndSetPhase(taskId: string, expected: PlayableTaskPhase, next: PlayableTaskPhase): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || task.phase !== expected) return false
    task.phase = next
    return true
  }

  async publishArtifact(
    taskId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || task.phase !== expectedPhase) return false
    task.phase = 'reviewing'
    task.latestArtifactKey = artifactKey
    task.latestValidation = validation
    return true
  }

  async acceptArtifact(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || task.phase !== 'reviewing') return false
    task.phase = 'ready'
    return true
  }

  async requestRevision(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['reviewing', 'ready', 'failed'].includes(task.phase) || !task.confirmation) return false
    task.phase = 'awaiting_confirmation'
    return true
  }

  async markFailed(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (task && ['building', 'validating'].includes(task.phase)) task.phase = 'failed'
  }

  async appendEvent(event: { taskId: string; type: string; phase?: string; message?: string }): Promise<void> {
    const items = this.events.get(event.taskId) ?? []
    items.push({ ...event, id: `event-${items.length + 1}`, createdAt: new Date() })
    this.events.set(event.taskId, items)
  }

  async listEvents(taskId: string): Promise<PlayableEventRecord[]> {
    return this.events.get(taskId) ?? []
  }

  async saveAsset(asset: PlayableAsset): Promise<void> {
    const items = this.assets.get(asset.taskId) ?? []
    items.push(asset)
    this.assets.set(asset.taskId, items)
  }

  async listAssets(taskId: string, userId: string): Promise<PlayableAsset[]> {
    return (this.assets.get(taskId) ?? []).filter((asset) => asset.userId === userId)
  }
}

interface LocalDemoRuntime {
  repository: PlayableTaskRepository
  artifactStore: ArtifactStore
  agent: PlayableAgentAdapter
  mediaGenerator: (input: {
    taskId: string
    apiKey: string
    confirmation: ConfirmationProposal
  }) => Promise<PlayableBuildAsset[]>
}

const transparentPng = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
)
const silentWav = new Uint8Array([
  82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 68, 172, 0, 0, 136, 88, 1, 0,
  2, 0, 16, 0, 100, 97, 116, 97, 0, 0, 0, 0,
])

async function generateLocalDemoMedia(input: { confirmation: ConfirmationProposal }): Promise<PlayableBuildAsset[]> {
  return Object.entries(input.confirmation.resources).flatMap(([slot, resource]) => {
    if (resource.status !== '待生成') return []
    const audio = slot === 'audio'
    const bytes = audio ? silentWav : transparentPng
    return [
      {
        id: `local-demo-ai-${slot}`,
        slot: slot as PlayableBuildAsset['slot'],
        filename: `${slot}-demo.${audio ? 'wav' : 'png'}`,
        mimeType: audio ? 'audio/wav' : 'image/png',
        size: bytes.byteLength,
        bytes: bytes.slice(),
      },
    ]
  })
}

const demoGlobal = globalThis as typeof globalThis & { __playableLocalDemoPrototype?: LocalDemoRuntime }

export const localDemoRuntime =
  demoGlobal.__playableLocalDemoPrototype ??
  (demoGlobal.__playableLocalDemoPrototype = {
    repository: new LocalDemoTaskRepository(),
    artifactStore: new LocalDemoArtifactStore(),
    agent: new LocalDemoAgent(),
    mediaGenerator: generateLocalDemoMedia,
  })

export async function authenticateLocalDemo(): Promise<string> {
  return localDemoUserId
}

export async function readLocalDemoApiKey(): Promise<string> {
  return localDemoApiKey
}
