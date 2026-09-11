import type { SourceTemplateId } from './types'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Session } from '@/lib/session/types'
import type { ArtifactStore } from './artifact-store'
import type {
  AgentInput,
  AgentReplyOptions,
  BuildResult,
  ConfirmedBuildInput,
  PlayableAgentAdapter,
  PlayableAssetManifest,
  PlayableBuildAsset,
} from './playable-agent-adapter'
import type {
  ConfirmationProposal,
  GameplayBlueprint,
  PlayableAgentReply,
  PlayableTaskPhase,
  RequirementBrief,
  RevisionProposal,
} from './schemas'
import type { PlayableAsset } from './task-assets'
import { createAssetSourceManifest, createValidationReport } from './production-contract'
import type {
  PlayableBuildRecord,
  PlayableEventRecord,
  PlayableReferenceSelectionRecord,
  PlayableResearchRunRecord,
  PlayableTaskMessageRecord,
  PlayableTaskRecord,
  PlayableTaskRepository,
  PlayableVideoAnalysisRecord,
} from './task-api'
import type { PlayableModeId } from './types'
import { createRequirementBrief } from './requirement-tools'
import type { MarketResearchAgent } from './research/market-research-agent'
import { LocalDemoMarketResearchAgent } from './research/local-demo-market-research-agent'
import {
  marketResearchReportSchema,
  referenceSelectionInputSchema,
  resolvedReferenceSelectionSchema,
  type MarketResearchReport,
  type ReferenceSelectionInput,
  type ResearchRunStatus,
  type SearchBrief,
} from './research/schemas'

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

type AssetStrategy = 'bundled' | 'uploaded'

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
  if (normalized.includes('上传') || normalized.includes('本地素材')) return 'uploaded'
  if (normalized.includes('系统素材') || normalized.includes('内置') || normalized.includes('默认素材')) {
    return 'bundled'
  }
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

function hasUnsupportedCoreGameplay(prompt: string): boolean {
  const normalized = prompt.toLowerCase()
  return ['跑酷', '射击', '赛车', '塔防', '平台跳跃', '实时战斗', '自由移动', '自定义状态机', '自定义胜负规则'].some(
    (keyword) => normalized.includes(keyword),
  )
}

function classifyRouting(prompt: string, selectedMode?: PlayableModeId): ConfirmationProposal['routing'] {
  if (hasUnsupportedCoreGameplay(prompt)) {
    return {
      match: 'freeform',
      confidence: 0.2,
      differences: ['现有模板无法表达该核心输入、状态机或胜负规则，将由大模型自由生成'],
    }
  }

  if (!selectedMode) {
    return { match: 'exact', confidence: 1, differences: [] }
  }

  const differences: string[] = []
  const normalized = prompt.toLowerCase()
  if (normalized.includes('boss') || normalized.includes('闯关')) {
    differences.push('Boss 生命值与关卡推进不属于模板核心，由大模型在现有玩法上补充')
  }
  if ((normalized.includes('3d') || normalized.includes('纵深')) && selectedMode !== 'perspective_3d') {
    differences.push('所选模板不是完整 3D 实现，将近似处理镜头和纵深表现')
  }
  if (normalized.includes('镜头')) differences.push('镜头表现将按模板能力近似实现')
  if (normalized.includes('奖励')) differences.push('奖励表现将复用模板能力近似实现')

  return differences.length
    ? { match: 'approximate', confidence: 0.72, differences }
    : { match: 'exact', confidence: 1, differences: [] }
}

function requestedGameplay(input: AgentInput): string {
  const initialRequest = input.history?.find((turn) => turn.role === 'user')?.content ?? input.prompt
  return `由大模型根据需求自由实现：${initialRequest.slice(0, 240)}`
}

function createProposal(
  mode: PlayableModeId,
  assetStrategy: AssetStrategy,
  routing: ConfirmationProposal['routing'],
  freeformGameplay?: string,
): ConfirmationProposal {
  const uploaded = assetStrategy === 'uploaded'
  const imageResource = () =>
    uploaded
      ? ({ status: '待上传', treatment: '等待用户上传对应图片素材' } as const)
      : ({ status: '内置默认', treatment: '使用系统提供的图片素材' } as const)
  const audioResource = uploaded
    ? ({ status: '待上传', treatment: '等待用户上传音频素材' } as const)
    : ({ status: '内置默认', treatment: '使用系统提供的音频并默认静音' } as const)
  return {
    routing,
    presentation:
      routing.match === 'freeform'
        ? {
            assetFields: [
              { slot: 'tileFaces', label: '角色与交互对象' },
              { slot: 'backgroundBoard', label: '场景背景' },
              { slot: 'animationEffects', label: '动画与特效' },
              { slot: 'audio', label: '音频' },
              { slot: 'endCard', label: '结束画面' },
            ],
            copyFields: ['title', 'cta'],
            showReferenceAssets: true,
          }
        : {
            assetFields: [
              { slot: 'tileFaces', label: '牌面素材' },
              { slot: 'backgroundBoard', label: '背景与棋盘' },
              { slot: 'animationEffects', label: '动画与特效' },
              { slot: 'audio', label: '音频' },
              { slot: 'endCard', label: '结束卡' },
            ],
            copyFields: ['title', 'cta', 'disclaimer', 'locale'],
            showReferenceAssets: true,
          },
    mode,
    gameplay:
      freeformGameplay ??
      {
        center_collision: '选择两张相同麻将牌，牌面向中心碰撞并消除计分。',
        top_rack: '选择可见麻将牌进入上方牌架，相同牌配对后自动清除。',
        gravity_fill: '选择相同麻将牌消除，空位由上方牌面下落补齐。',
        perspective_3d: '选择立体牌墙暴露的顶面，消除后逐层揭示下方麻将牌。',
      }[mode],
    resources: {
      tileFaces: imageResource(),
      backgroundBoard: imageResource(),
      animationEffects: imageResource(),
      audio: audioResource,
      endCard: imageResource(),
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

function createLocalFreeformPlayable(storeUrl: string): string {
  const safeStoreUrl = JSON.stringify(storeUrl).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>自由生成试玩</title>
  <style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#152238;color:#fff;font-family:system-ui,sans-serif}body{display:grid;place-items:center}#wrap{position:relative;width:min(100vw,56.25vh);aspect-ratio:9/16;max-height:100vh;background:linear-gradient(#263c62,#10192b);overflow:hidden}canvas{width:100%;height:100%;touch-action:none}#end{position:absolute;inset:0;display:none;place-items:center;background:#101827dd;text-align:center}#end.show{display:grid}button{border:0;border-radius:999px;padding:14px 28px;background:#ffcf4a;color:#172033;font-weight:800}
  </style>
</head>
<body>
  <main id="wrap"><canvas id="game" width="360" height="640"></canvas><section id="end"><div><h1>挑战成功</h1><p>你击败了 Boss</p><button id="cta">立即试玩</button></div></section></main>
  <script>
    const STORE_URL=${safeStoreUrl};
    const canvas=document.getElementById('game'),ctx=canvas.getContext('2d'),end=document.getElementById('end');
    const state={mode:'freeform',health:6,interactions:0,completed:false,audio:{muted:true,unlocked:false}};
    window.__PLAYABLE__={...state,audio:state.audio,snapshot:()=>({...state,audio:{...state.audio}})};
    function sync(){Object.assign(window.__PLAYABLE__,state)}
    function draw(){ctx.clearRect(0,0,360,640);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 24px system-ui';ctx.fillText('点击攻击 Boss',180,72);ctx.fillStyle='#ef5b5b';ctx.beginPath();ctx.arc(180,300,92,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.font='800 42px system-ui';ctx.fillText('BOSS',180,314);ctx.fillStyle='#273653';ctx.fillRect(55,450,250,22);ctx.fillStyle='#65df84';ctx.fillRect(55,450,250*(state.health/6),22);ctx.font='600 18px system-ui';ctx.fillStyle='#fff';ctx.fillText('剩余生命 '+state.health,180,510)}
    canvas.addEventListener('pointerdown',()=>{if(state.completed)return;state.interactions++;state.audio.unlocked=true;state.health--;if(state.health<=0){state.health=0;state.completed=true;end.classList.add('show')}sync();draw()});
    document.getElementById('cta').addEventListener('click',()=>{if(!state.completed)return;if(window.mraid&&typeof window.mraid.open==='function')window.mraid.open(STORE_URL);else window.open(STORE_URL,'_blank','noopener')});
    window.addEventListener('message',event=>{if(event.source!==window.parent||event.data?.type!=='playable:set-muted'||typeof event.data.muted!=='boolean')return;state.audio.muted=event.data.muted;sync()});
    draw();
  </script>
</body>
</html>`
}

class LocalDemoAgent implements PlayableAgentAdapter {
  async proposeConfirmation(input: AgentInput, options?: AgentReplyOptions): Promise<PlayableAgentReply> {
    const context = conversationText(input)
    const brief: RequirementBrief = input.brief
      ? structuredClone(input.brief)
      : createRequirementBrief(input.history?.find((turn) => turn.role === 'user')?.content ?? input.prompt)
    if (
      /(?:搜索|查找|调研|分析).{0,20}(?:同类|竞品|市场|试玩|广告)|(?:同类|竞品).{0,20}(?:搜索|查找|调研|分析)/.test(
        input.prompt,
      )
    ) {
      if (!options?.executeTool) {
        return {
          kind: 'clarification',
          message: '当前无法执行市场搜索。你可以稍后重试，或直接继续整理试玩需求。',
          reasoning: '市场研究工具当前不可用。',
          options: [],
          brief,
        }
      }
      const searchBrief: SearchBrief = {
        version: 1,
        trigger: 'explicit',
        category: /麻将/.test(context) ? '消除' : '休闲游戏',
        subcategory: /麻将/.test(context) ? '麻将配对' : '',
        gameplayKeywords: [/麻将/.test(context) ? '点击配对' : '核心交互'],
        market: '全球',
        locale: 'zh-CN',
        adNetwork: 'AppLovin',
        timeRange: '最近 90 天',
        focusAreas: ['前三秒', '核心循环', '反馈与 CTA'],
        requirementSummary: input.prompt.slice(0, 600),
      }
      const result = marketResearchReportSchema.safeParse(
        await options.executeTool({
          name: 'search_market_references',
          assetIds: [],
          assetId: null,
          searchBrief,
        }),
      )
      if (!result.success) {
        return {
          kind: 'clarification',
          message: '暂时无法完成市场搜索。你想重试，还是直接继续整理试玩需求？',
          reasoning: '市场研究没有返回可用结果。',
          options: [],
          brief,
        }
      }
      return {
        kind: 'research',
        message: '已找到 3 个同类公开案例，并整理了可借鉴的玩法方向。',
        reasoning: '研究结果仅作为公开趋势参考，采用前不会修改当前需求。',
        research: result.data,
      }
    }
    const informationalAfterBuild =
      input.hasArtifact &&
      input.confirmation &&
      /^(?:你好|您好|你是谁|你能做什么|怎么使用|如何使用|当前是什么版本|现在是什么版本)[？?。！!]*$/.test(
        input.prompt.trim(),
      )
    if (informationalAfterBuild) {
      return {
        kind: 'informational',
        message: '当前试玩已生成。你可以继续描述明确的修改内容，我会先整理修改计划，等你确认后再构建下一版。',
        reasoning: '这是一条使用或状态咨询，不会修改当前试玩。',
        brief,
        tools: ['respond_to_user'],
      }
    }
    const adoptedResearch = input.referenceSelection
      ? [
          input.referenceSelection.primaryCandidate?.title,
          ...input.referenceSelection.selectedHighlights.map(({ value }) => value),
          input.referenceSelection.customRequirements,
        ]
          .filter(Boolean)
          .join('；')
      : ''
    const requirementContext = adoptedResearch ? `${context}；已采用市场参考：${adoptedResearch}` : context
    brief.summary = requirementContext.slice(0, 600)
    brief.gameplay.concept = requirementContext.slice(0, 500)
    if (input.hasArtifact && input.confirmation) {
      const regenerate = /重新生成|重新制作|重新构建|重做|效果.{0,4}(?:差|不好)/.test(input.prompt)
      return {
        kind: 'revision',
        message: regenerate
          ? '我会保留已确认的需求和素材，重新生成下一版试玩。'
          : '我会基于当前版本完成这次修改，其他内容保持不变。',
        reasoning: regenerate ? '当前要求涉及整体效果重做。' : '当前要求适合在现有版本上局部修改。',
        revision: {
          strategy: regenerate ? 'regenerate' : 'patch',
          summary: input.prompt.slice(0, 600),
          changes: [input.prompt.slice(0, 300)],
          preserved: regenerate ? ['已确认的需求和用户素材'] : ['未在本次要求中提及的内容'],
        },
        confirmation: input.confirmation,
        brief,
        tools: [
          'update_requirement_brief',
          'list_playable_capabilities',
          'validate_implementation_route',
          'submit_revision',
        ],
      }
    }
    const selectedMode =
      selectMode(input.prompt) ??
      [...(input.history ?? [])]
        .reverse()
        .filter((turn) => turn.role === 'user')
        .map((turn) => selectMode(turn.content))
        .find(Boolean)
    const freeform = hasUnsupportedCoreGameplay(context)
    if (!selectedMode && !freeform) {
      brief.openQuestions = ['核心玩法是什么？']
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
        request: {
          type: 'single_select',
          question: '请选择核心玩法，也可以描述其他玩法。',
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
              description: '消除后元素从上方下落补位',
              value: '选择下落补位（gravity_fill）玩法',
            },
            {
              id: 'perspective_3d',
              label: '3D 纵深',
              description: '从立体牌墙顶层逐层配对',
              value: '选择 3D 纵深（perspective_3d）玩法',
            },
          ],
          allowCustom: true,
        },
        brief,
        tools: ['update_requirement_brief', 'list_playable_capabilities', 'ask_user'],
      }
    }
    const mode = selectedMode ?? 'center_collision'
    const routing = classifyRouting(context, selectedMode)
    brief.routing = { ...routing, mode }
    if (!hasVisualTheme(context)) {
      brief.openQuestions = ['需要什么视觉主题？']
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
        request: {
          type: 'single_select',
          question: '请选择视觉主题，也可以描述自定义风格。',
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
          allowCustom: true,
        },
        brief,
        tools: ['update_requirement_brief', 'ask_user'],
      }
    }
    brief.experience.visualTheme = input.prompt.slice(0, 300)
    const assetStrategy = selectAssetStrategy(context)
    if (!assetStrategy) {
      brief.openQuestions = ['图片和音频使用系统素材还是用户上传？']
      return {
        kind: 'clarification',
        message: '玩法已经明确。接下来请选择图片和音频素材的准备方式。',
        reasoning: '当前版本暂不支持 AI 素材生成，请选择系统素材或本地上传。',
        options: [
          {
            id: 'bundled',
            label: '使用系统素材',
            description: '系统提供，无需上传，可直接构建',
            value: '图片和音频使用系统素材',
          },
          {
            id: 'uploaded',
            label: '我来上传',
            description: '在确认表中上传自己的图片和音频',
            value: '图片和音频都使用我上传的本地素材',
          },
        ],
        request: {
          type: 'single_select',
          question: '请选择图片和音频素材来源。',
          options: [
            {
              id: 'bundled',
              label: '使用系统素材',
              description: '系统提供，无需上传，可直接构建',
              value: '图片和音频使用系统素材',
            },
            {
              id: 'uploaded',
              label: '我来上传',
              description: '在确认表中上传自己的图片和音频',
              value: '图片和音频都使用我上传的本地素材',
            },
          ],
          allowCustom: false,
        },
        brief,
        tools: ['update_requirement_brief', 'inspect_uploaded_assets', 'ask_user'],
      }
    }
    brief.assets = {
      images: assetStrategy === 'uploaded' ? 'upload' : 'bundled',
      audio: assetStrategy === 'uploaded' ? 'upload' : 'bundled',
    }
    if (!hasLaunchDetails(context)) {
      brief.openQuestions = ['需要什么投放文案和 HTTPS 商店链接？']
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
        request: {
          type: 'text',
          question: '请输入标题、CTA 和 HTTPS 商店链接，或选择默认测试信息。',
          options: [],
          allowCustom: true,
        },
        brief,
        tools: ['update_requirement_brief', 'ask_user'],
      }
    }
    brief.launch = {
      title: '麻将配对挑战',
      cta: '立即试玩',
      locale: 'zh-CN',
      storeUrl: context.match(/https:\/\/[^\s]+/)?.[0] ?? 'https://example.com/app',
    }
    brief.openQuestions = []
    return {
      kind: 'confirmation',
      message:
        routing.match === 'freeform'
          ? '现有模板无法表达这个核心玩法，将由大模型自由生成。请确认素材与交付方案。'
          : routing.match === 'approximate'
            ? '核心玩法可以复用现有模板，差异部分将近似实现。请确认后开始构建。'
            : '玩法与现有模板完全匹配。请确认后开始构建。',
      reasoning:
        routing.match === 'freeform'
          ? '核心输入、状态机或胜负规则超出现有模板范围。'
          : routing.match === 'approximate'
            ? '核心状态机一致，但存在模板无法完全复现的表现差异。'
            : '操作、状态机和结束条件均可由现有模板表达。',
      confirmation: createProposal(
        mode,
        assetStrategy,
        routing,
        routing.match === 'freeform' ? requestedGameplay(input) : undefined,
      ),
      brief,
      tools: [
        'update_requirement_brief',
        'list_playable_capabilities',
        'validate_implementation_route',
        'submit_confirmation',
      ],
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
      if (input.gameplayBlueprint) {
        await writeFile(
          path.join(workspace, 'gameplay-blueprint.json'),
          JSON.stringify(input.gameplayBlueprint),
          'utf8',
        )
      }
      for (const asset of assets) {
        const manifestAsset = assetManifest.assets.find((candidate) => candidate.id === asset.id)
        if (!manifestAsset) throw new Error('Playable asset manifest is incomplete')
        const assetPath = path.join(workspace, manifestAsset.workspacePath)
        await mkdir(path.dirname(assetPath), { recursive: true })
        await writeFile(assetPath, asset.bytes)
      }
      await writeFile(path.join(workspace, 'asset-manifest.json'), JSON.stringify(assetManifest), 'utf8')
      if (input.revision?.strategy === 'patch' && input.baseHtml) {
        await writeFile(outputPath, input.baseHtml, 'utf8')
        await execFileAsync(process.execPath, [
          input.confirmation.routing.match === 'freeform'
            ? path.join(starterRoot, 'work/test-freeform-playable.mjs')
            : path.join(starterRoot, 'work/test-playable.mjs'),
          outputPath,
        ])
      } else if (input.confirmation.routing.match === 'freeform') {
        await writeFile(outputPath, createLocalFreeformPlayable(input.confirmation.storeUrl), 'utf8')
        await execFileAsync(process.execPath, [path.join(starterRoot, 'work/test-freeform-playable.mjs'), outputPath])
      } else {
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
      }
      const html = await readFile(outputPath, 'utf8')
      return {
        html,
        assetManifest,
        validation: createValidationReport({
          bytes: Buffer.byteLength(html),
          offlineResources: true,
          responsiveViewport: true,
          delivery: input.confirmation.delivery,
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

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

class LocalDemoTaskRepository implements PlayableTaskRepository {
  private readonly tasks = new Map<string, PlayableTaskRecord>()
  private readonly events = new Map<string, PlayableEventRecord[]>()
  private readonly assets = new Map<string, PlayableAsset[]>()
  private readonly messages = new Map<string, PlayableTaskMessageRecord[]>()
  private readonly builds = new Map<string, PlayableBuildRecord[]>()
  private readonly videoAnalyses = new Map<string, PlayableVideoAnalysisRecord[]>()
  private readonly researchRuns = new Map<string, PlayableResearchRunRecord>()
  private readonly researchReports = new Map<string, MarketResearchReport>()
  private readonly referenceSelections = new Map<string, PlayableReferenceSelectionRecord>()

  async createTask(input: {
    id: string
    userId: string
    prompt: string
    sourceTemplateId?: SourceTemplateId
  }): Promise<PlayableTaskRecord> {
    const task: PlayableTaskRecord = {
      ...input,
      phase: 'draft',
      requirementBrief: {
        ...createRequirementBrief(),
        ...(input.sourceTemplateId ? { sourceTemplateId: input.sourceTemplateId } : {}),
      },
      confirmation: null,
      pendingRevision: null,
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

  async renameOwnedTask(taskId: string, userId: string, title: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task) return false
    task.title = title
    return true
  }

  async deleteOwnedTask(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task) return false
    this.tasks.delete(taskId)
    return true
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

  async updateRequirementBrief(taskId: string, userId: string, brief: RequirementBrief): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (
      !task ||
      !['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)
    )
      return false
    task.requirementBrief = structuredClone(brief)
    return true
  }

  async setDraft(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (
      !task ||
      !['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)
    )
      return false
    task.phase = 'draft'
    task.pendingRevision = null
    return true
  }

  async setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (
      !task ||
      !['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)
    )
      return false
    task.phase = 'awaiting_confirmation'
    task.confirmation = confirmation
    task.pendingRevision = null
    return true
  }

  async setAwaitingRevision(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
    revision: RevisionProposal,
  ): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)) return false
    task.phase = 'awaiting_revision_confirmation'
    task.confirmation = structuredClone(confirmation)
    task.pendingRevision = structuredClone(revision)
    return true
  }

  async clearPendingRevision(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)) return false
    task.phase = 'ready'
    task.pendingRevision = null
    return true
  }

  async claimBuild(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
    buildId: string,
    revision?: RevisionProposal,
  ): Promise<PlayableTaskRecord | undefined> {
    const task = await this.findOwnedTask(taskId, userId)
    if (
      !task ||
      !(revision
        ? ['awaiting_revision_confirmation', 'failed'].includes(task.phase)
        : ['awaiting_confirmation', 'failed'].includes(task.phase))
    )
      return
    task.phase = 'building'
    task.confirmation = confirmation
    const builds = this.builds.get(taskId) ?? []
    builds.push({
      id: buildId,
      taskId,
      status: 'building',
      confirmation: structuredClone(confirmation),
      revision: revision ? structuredClone(revision) : null,
      artifactKey: null,
      createdAt: new Date(),
    })
    this.builds.set(taskId, builds)
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
    buildId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || task.phase !== expectedPhase) return false
    const build = this.builds.get(taskId)?.find((candidate) => candidate.id === buildId)
    if (!build || build.status !== 'building') return false
    const completedAt = new Date()
    task.phase = 'ready'
    task.latestArtifactKey = artifactKey
    task.latestValidation = validation
    task.pendingRevision = null
    build.status = 'succeeded'
    build.artifactKey = artifactKey
    build.validation = validation
    build.completedAt = completedAt
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

  async markFailed(taskId: string, buildId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (task && ['building', 'validating'].includes(task.phase)) task.phase = 'failed'
    const build = this.builds.get(taskId)?.find((candidate) => candidate.id === buildId)
    if (build?.status === 'building') {
      build.status = 'failed'
      build.completedAt = new Date()
    }
  }

  async listBuilds(taskId: string): Promise<PlayableBuildRecord[]> {
    return this.builds.get(taskId) ?? []
  }

  async findBuild(taskId: string, buildId: string): Promise<PlayableBuildRecord | undefined> {
    return this.builds.get(taskId)?.find((build) => build.id === buildId)
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

  async findOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined> {
    return (this.assets.get(taskId) ?? []).find((asset) => asset.id === assetId && asset.userId === userId)
  }

  async deleteOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined> {
    const asset = await this.findOwnedAsset(taskId, userId, assetId)
    if (!asset) return
    this.assets.set(
      taskId,
      (this.assets.get(taskId) ?? []).filter((candidate) => candidate.id !== assetId),
    )
    return asset
  }

  async createVideoAnalysis(input: {
    id: string
    taskId: string
    assetId: string
    pipelineVersion: string
    model: string
  }): Promise<PlayableVideoAnalysisRecord> {
    const analysis: PlayableVideoAnalysisRecord = {
      ...input,
      status: 'pending',
      blueprint: null,
      errorCode: null,
      createdAt: new Date(),
      completedAt: null,
    }
    const analyses = this.videoAnalyses.get(input.taskId) ?? []
    analyses.push(analysis)
    this.videoAnalyses.set(input.taskId, analyses)
    return analysis
  }

  async findLatestVideoAnalysis(taskId: string): Promise<PlayableVideoAnalysisRecord | undefined> {
    return this.videoAnalyses.get(taskId)?.at(-1)
  }

  async updateVideoAnalysisStatus(id: string, status: PlayableVideoAnalysisRecord['status']): Promise<void> {
    const analysis = [...this.videoAnalyses.values()].flat().find((candidate) => candidate.id === id)
    if (analysis) analysis.status = status
  }

  async completeVideoAnalysis(id: string, blueprint: GameplayBlueprint): Promise<void> {
    const analysis = [...this.videoAnalyses.values()].flat().find((candidate) => candidate.id === id)
    if (!analysis) return
    analysis.status = 'succeeded'
    analysis.blueprint = structuredClone(blueprint)
    analysis.completedAt = new Date()
  }

  async failVideoAnalysis(id: string, errorCode: string): Promise<void> {
    const analysis = [...this.videoAnalyses.values()].flat().find((candidate) => candidate.id === id)
    if (!analysis) return
    analysis.status = 'failed'
    analysis.errorCode = errorCode
    analysis.completedAt = new Date()
  }

  async createResearchRun(input: {
    id: string
    taskId: string
    userId: string
    brief: SearchBrief
    cacheKey: string
    strategyVersion: string
    sourceIds: string[]
  }): Promise<PlayableResearchRunRecord> {
    const run: PlayableResearchRunRecord = {
      id: input.id,
      taskId: input.taskId,
      userId: input.userId,
      status: 'confirmed',
      trigger: input.brief.trigger,
      searchBrief: structuredClone(input.brief),
      cacheKey: input.cacheKey,
      strategyVersion: input.strategyVersion,
      sourceIds: [...input.sourceIds],
      industrySummary: null,
      warnings: [],
      cachedFromRunId: null,
      errorCode: null,
      createdAt: new Date(),
      completedAt: null,
    }
    this.researchRuns.set(run.id, run)
    return run
  }

  async updateResearchRunStatus(id: string, taskId: string, status: ResearchRunStatus): Promise<boolean> {
    const run = this.researchRuns.get(id)
    if (!run || run.taskId !== taskId) return false
    run.status = status
    return true
  }

  async completeResearchRun(
    id: string,
    taskId: string,
    value: MarketResearchReport,
    cachedFromRunId: string | null = null,
  ): Promise<MarketResearchReport> {
    const run = this.researchRuns.get(id)
    if (!run || run.taskId !== taskId) throw new Error('Research run transition failed')
    const report = marketResearchReportSchema.parse({ ...value, runId: id })
    run.status = 'completed'
    run.sourceIds = [...report.sourceCoverage.sourceIds]
    run.industrySummary = structuredClone(report.industrySummary)
    run.warnings = [...report.warnings]
    run.cachedFromRunId = cachedFromRunId
    run.errorCode = null
    run.completedAt = new Date(report.generatedAt)
    this.researchReports.set(id, structuredClone(report))
    return report
  }

  async failResearchRun(id: string, taskId: string, status: 'failed' | 'cancelled', errorCode: string): Promise<void> {
    const run = this.researchRuns.get(id)
    if (!run || run.taskId !== taskId) return
    run.status = status
    run.errorCode = errorCode
    run.completedAt = new Date()
  }

  async findReusableResearchReport(
    userId: string,
    cacheKey: string,
    strategyVersion: string,
    notBefore: Date,
  ): Promise<MarketResearchReport | undefined> {
    const run = [...this.researchRuns.values()].find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.cacheKey === cacheKey &&
        candidate.strategyVersion === strategyVersion &&
        candidate.status === 'completed' &&
        Boolean(candidate.completedAt && candidate.completedAt >= notBefore),
    )
    return run ? structuredClone(this.researchReports.get(run.id)) : undefined
  }

  async findResearchReport(taskId: string, userId: string, runId: string): Promise<MarketResearchReport | undefined> {
    const run = this.researchRuns.get(runId)
    if (!run || run.taskId !== taskId || run.userId !== userId || run.status !== 'completed') return
    return structuredClone(this.researchReports.get(runId))
  }

  async saveReferenceSelection(input: {
    id: string
    taskId: string
    userId: string
    selection: ReferenceSelectionInput
  }) {
    const selection = referenceSelectionInputSchema.parse(input.selection)
    if (this.referenceSelections.has(selection.runId)) return
    const report = await this.findResearchReport(input.taskId, input.userId, selection.runId)
    if (!report) return
    const candidates = new Map(report.candidates.map((candidate) => [candidate.id, candidate]))
    const primaryCandidate = selection.primaryCandidateId ? candidates.get(selection.primaryCandidateId) : null
    if (selection.primaryCandidateId && !primaryCandidate) return
    const selectedHighlights = selection.selectedHighlights.flatMap((highlight) => {
      const candidate = candidates.get(highlight.candidateId)
      if (!candidate || !candidate.borrowableHighlights.includes(highlight.value)) return []
      return [{ candidate, value: highlight.value }]
    })
    if (selectedHighlights.length !== selection.selectedHighlights.length) return
    this.referenceSelections.set(selection.runId, {
      id: input.id,
      runId: selection.runId,
      taskId: input.taskId,
      userId: input.userId,
      selection,
      createdAt: new Date(),
    })
    return resolvedReferenceSelectionSchema.parse({
      runId: selection.runId,
      industrySummary: report.industrySummary,
      primaryCandidate,
      selectedHighlights,
      customRequirements: selection.customRequirements,
      exclusions: selection.exclusions,
    })
  }

  async listReferenceSelections(taskId: string, userId: string): Promise<PlayableReferenceSelectionRecord[]> {
    return [...this.referenceSelections.values()].filter(
      (selection) => selection.taskId === taskId && selection.userId === userId,
    )
  }
}

interface LocalDemoRuntime {
  repository: PlayableTaskRepository
  artifactStore: ArtifactStore
  agent: PlayableAgentAdapter
  marketResearchAgent: MarketResearchAgent
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
    marketResearchAgent: new LocalDemoMarketResearchAgent(),
    mediaGenerator: generateLocalDemoMedia,
  })

export async function authenticateLocalDemo(): Promise<string> {
  return localDemoUserId
}

export async function readLocalDemoApiKey(): Promise<string> {
  return localDemoApiKey
}
