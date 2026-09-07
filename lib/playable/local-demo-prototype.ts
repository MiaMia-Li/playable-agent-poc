import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
} from './playable-agent-adapter'
import type { ConfirmationProposal, PlayableTaskPhase } from './schemas'
import type { PlayableAsset } from './task-assets'
import type { PlayableEventRecord, PlayableTaskRecord, PlayableTaskRepository } from './task-api'
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

function selectMode(prompt: string): PlayableModeId {
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
  return 'center_collision'
}

function createProposal(input: AgentInput): ConfirmationProposal {
  const mode = selectMode(input.prompt)
  return {
    mode,
    gameplay: {
      center_collision: '选择两张相同麻将牌，牌面向中心碰撞并消除计分。',
      top_rack: '选择可见麻将牌进入上方牌架，相同牌配对后自动清除。',
      gravity_fill: '选择相同麻将牌消除，空位由上方牌面下落补齐。',
      perspective_3d: '选择立体牌墙暴露的顶面，消除后逐层揭示下方麻将牌。',
    }[mode],
    resources: {
      tileFaces: { status: '内置默认', treatment: '使用 Skill 内置麻将牌面' },
      backgroundBoard: { status: '内置默认', treatment: '使用 Skill 内置背景与棋盘' },
      animationEffects: { status: '内置默认', treatment: '使用模式默认配对与消除特效' },
      audio: { status: '内置默认', treatment: '使用内置音频并默认静音' },
      endCard: { status: '内置默认', treatment: '使用内置结束卡' },
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
  async proposeConfirmation(input: AgentInput): Promise<ConfirmationProposal> {
    return createProposal(input)
  }

  async build(input: ConfirmedBuildInput): Promise<BuildResult> {
    const workspace = await mkdtemp(path.join(tmpdir(), 'playable-local-demo-'))
    const outputPath = path.join(workspace, 'playable.html')
    const starterRoot = path.join(process.cwd(), 'skills/mahjong-pair-match-playable/assets/starter')
    try {
      await execFileAsync(process.execPath, [
        path.join(starterRoot, 'build-playable.mjs'),
        input.confirmation.mode,
        outputPath,
        input.confirmation.storeUrl,
      ])
      await execFileAsync(process.execPath, [path.join(starterRoot, 'work/test-playable.mjs'), outputPath])
      const html = await readFile(outputPath, 'utf8')
      const assets = input.assets ?? []
      const assetManifest: PlayableAssetManifest = {
        assets: assets.map(({ bytes: _bytes, ...asset }) => ({
          ...asset,
          workspacePath: `user-assets/${asset.slot}/${asset.filename}`,
        })),
        entrypoint: 'playable.html',
      }
      return {
        html,
        assetManifest,
        validation: { behavior: 'passed', bytes: Buffer.byteLength(html) },
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

  async appendMessage(): Promise<void> {}

  async setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation'].includes(task.phase)) return false
    task.phase = 'awaiting_confirmation'
    task.confirmation = confirmation
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
    task.phase = 'ready'
    task.latestArtifactKey = artifactKey
    task.latestValidation = validation
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
}

const demoGlobal = globalThis as typeof globalThis & { __playableLocalDemoPrototype?: LocalDemoRuntime }

export const localDemoRuntime =
  demoGlobal.__playableLocalDemoPrototype ??
  (demoGlobal.__playableLocalDemoPrototype = {
    repository: new LocalDemoTaskRepository(),
    artifactStore: new LocalDemoArtifactStore(),
    agent: new LocalDemoAgent(),
  })

export async function authenticateLocalDemo(): Promise<string> {
  return localDemoUserId
}

export async function readLocalDemoApiKey(): Promise<string> {
  return localDemoApiKey
}
