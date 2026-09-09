// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmationProposal, RequirementBrief } from '@/lib/playable/schemas'
import { ChatWorkspace } from '@/components/playable/chat-workspace'
import { ConfirmationTable } from '@/components/playable/confirmation-table'
import { PlayablePreview } from '@/components/playable/playable-preview'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'

Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })

const proposal: ConfirmationProposal = {
  routing: { match: 'approximate', confidence: 0.8, differences: ['奖励表现使用模板默认效果'] },
  mode: 'top_rack',
  gameplay: '相同牌进入牌架后消除',
  resources: {
    tileFaces: { status: '待上传', treatment: '上传牌面' },
    backgroundBoard: { status: '内置默认', treatment: '默认背景' },
    animationEffects: { status: '内置默认', treatment: '默认特效' },
    audio: { status: '待上传', treatment: '上传音频' },
    endCard: { status: '内置默认', treatment: '默认结束卡' },
  },
  copy: { title: '试玩', cta: '下载', disclaimer: '演示', locale: 'zh-CN' },
  storeUrl: 'http://example.com',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlayableWorkspace', () => {
  it('opens the API key dialog when BYOK is missing', () => {
    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured={false} />)

    expect(screen.getByRole('dialog', { name: '配置 OpenAI API Key' })).toBeInTheDocument()
    expect(screen.getByLabelText('OpenAI API Key')).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: '暂不配置' }))
    expect(screen.queryByRole('dialog', { name: '配置 OpenAI API Key' })).not.toBeInTheDocument()
  })

  it('lets local Codex users configure a media API key without blocking chat', () => {
    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured localCodex />)

    expect(screen.queryByRole('dialog', { name: '配置 OpenAI API Key' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '媒体 API Key' }))
    expect(screen.getByRole('dialog', { name: '配置 OpenAI API Key' })).toBeInTheDocument()
  })

  it('uses the production API key flow in local Harness mode', () => {
    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured={false} localHarness />)

    expect(screen.getByText('本地 Harness · 线上 Agent')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '配置 OpenAI API Key' })).toBeInTheDocument()
  })

  it('starts the first conversation automatically after the API key is available', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/messages')) {
        return new Response(
          `${JSON.stringify({
            type: 'clarification',
            message: '请选择一种玩法。',
            reasoning: '目前只有视觉主题。',
            options: [{ id: 'center', label: '中心碰撞', description: '碰撞消除', value: '选择中心碰撞玩法' }],
          })}\n`,
        )
      }
      return Response.json({
        task: { phase: 'draft', hasArtifact: false, artifactVersion: null, confirmation: null },
        events: [],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured initialPrompt="制作农场主题试玩" />)

    expect(await screen.findByText('请选择一种玩法。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playable-tasks/task-7/messages',
      expect.objectContaining({ body: JSON.stringify({ message: '制作农场主题试玩' }) }),
    )
  })

  it('renders a persisted brief and dynamic multi-select request', () => {
    const brief: RequirementBrief = {
      version: 1,
      summary: '夏日清爽麻将消除，并增加奖励表现',
      gameplay: { concept: '麻将消除', coreLoop: '配对消除', controls: '点击', objective: '清空牌面' },
      experience: { visualTheme: '夏日清爽', tone: '轻松', camera: '竖屏' },
      assets: { images: 'unknown', audio: 'unknown' },
      launch: { title: '', cta: '', locale: 'zh-CN', storeUrl: '' },
      constraints: [],
      openQuestions: ['选择体验重点'],
      routing: {
        match: 'approximate',
        mode: 'center_collision',
        confidence: 0.7,
        differences: ['需要增加奖励表现'],
      },
    }
    const options = [
      { id: 'pace', label: '节奏', description: '快速反馈', value: '重视节奏' },
      { id: 'visual', label: '画面', description: '丰富表现', value: '重视画面' },
    ]
    render(
      <ChatWorkspace
        taskId="task-tools"
        phase="draft"
        brief={brief}
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
        initialConversation={[
          {
            id: 'agent-1',
            role: 'assistant',
            content: '请选择体验重点。',
            reasoning: '这会影响部分匹配的实现。',
            status: 'sent',
            options,
            request: { type: 'multi_select', question: '哪些体验最重要？', options, allowCustom: true },
          },
        ]}
      />,
    )

    expect(screen.getByRole('region', { name: '需求 Brief' })).toHaveTextContent('部分匹配')
    expect(screen.getByRole('region', { name: '需求 Brief' })).toHaveTextContent('选择体验重点')
    const submit = screen.getByRole('button', { name: '确认选择' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /节奏/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /画面/ }))
    expect(submit).toBeEnabled()
  })

  it('renders chat, upload, confirmation, progress, and preview controls', () => {
    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured />)

    expect(screen.getByRole('region', { name: '需求对话' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '确认方案' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '构建进度' })).toHaveTextContent('方案生成中可试玩')
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '竖屏预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '横屏预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消静音预览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '下载试玩' })).toBeDisabled()
  })

  it('shows compact progress on the confirmation button while Codex builds', () => {
    render(
      <ConfirmationTable
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onChange={vi.fn()}
        onConfirm={vi.fn()}
        buildPhase="building"
      />,
    )

    expect(screen.getByRole('button', { name: 'Codex 正在构建试玩…' })).toBeDisabled()
  })

  it('renders exact mode ID and label and enforces pending-upload and HTTPS gates', () => {
    const onChange = vi.fn()
    render(<ConfirmationTable proposal={proposal} onChange={onChange} onConfirm={vi.fn()} />)

    expect(screen.getByText('top_rack')).toBeInTheDocument()
    expect(screen.getByLabelText('玩法模板')).toHaveTextContent('上方牌架')
    expect(screen.getByRole('button', { name: '确认方案并开始构建' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('商店跳转链接（HTTPS）'), {
      target: { value: 'https://example.com/store' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ storeUrl: 'https://example.com/store' }))
  })

  it('lets the user customize template, gameplay, and copy in the confirmation table', () => {
    const onChange = vi.fn()
    render(
      <ConfirmationTable
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onChange={onChange}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('玩法说明'), { target: { value: '自定义核心玩法' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gameplay: '自定义核心玩法' }))

    fireEvent.change(screen.getByLabelText('游戏标题'), { target: { value: '夏日消消乐' } })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ copy: expect.objectContaining({ title: '夏日消消乐' }) }),
    )

    expect(screen.getByLabelText('玩法模板')).toBeEnabled()
    expect(screen.getByLabelText('CTA 文案')).toBeEnabled()
    expect(screen.getByLabelText('语言')).toBeEnabled()
    expect(screen.getByLabelText('免责声明')).toBeEnabled()
  })

  it('labels unsupported gameplay as direct freeform generation', () => {
    render(
      <ConfirmationTable
        proposal={{
          ...proposal,
          routing: { match: 'freeform', confidence: 0.1, differences: ['核心状态机不受模板支持'] },
          gameplay: '自由移动并击败 Boss',
          presentation: {
            assetFields: [
              { slot: 'tileFaces', label: '英雄与怪物' },
              { slot: 'backgroundBoard', label: '战斗场景' },
              { slot: 'animationEffects', label: '攻击特效' },
            ],
            copyFields: ['title', 'cta'],
            showReferenceAssets: false,
          },
        }}
        onChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('自由生成')).toBeInTheDocument()
    expect(screen.getByText('实现方式')).toBeInTheDocument()
    expect(screen.getByText('英雄与怪物')).toBeInTheDocument()
    expect(screen.getByText('战斗场景')).toBeInTheDocument()
    expect(screen.queryByText('音频')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('语言')).not.toBeInTheDocument()
    expect(screen.queryByText('参考素材')).not.toBeInTheDocument()
    expect(screen.getByText(/不受参考模板状态机限制/)).toBeInTheDocument()
  })

  it('polls authoritative build state without overwriting the confirmation draft', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        task: {
          phase: 'awaiting_confirmation',
          hasArtifact: true,
          artifactVersion: 'old',
          confirmation: { ...proposal, mode: 'center_collision', storeUrl: 'https://example.com/store' },
        },
        events: [],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableWorkspace
        taskId="task-7"
        initialApiKeyConfigured
        initialPhase="building"
        initialProposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        initialHasArtifact
        initialArtifactVersion="old"
      />,
    )

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/task-7/events', { cache: 'no-store' }),
    )
    expect(screen.getByRole('region', { name: '构建进度' })).toHaveTextContent('当前状态：生成试玩')
    expect(screen.getByRole('region', { name: '确认方案' })).toHaveTextContent('top_rack')
    expect(screen.getByTitle('Playable preview')).toBeInTheDocument()
  })

  it('does not poll events while a task is idle', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<PlayableWorkspace taskId="task-idle" initialApiKeyConfigured initialPhase="draft" />)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads exactly one file into its selected pending resource slot', async () => {
    const onProposal = vi.fn()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        asset: { id: 'asset-1', slot: 'audio', filename: 'sound.mp3', mimeType: 'audio/mpeg', size: 3 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={proposal}
        onProposal={onProposal}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('为音频上传素材'), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'sound.mp3', { type: 'audio/mpeg' })] },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, options] = fetchMock.mock.calls[0]
    expect(options?.body).toBeInstanceOf(FormData)
    expect((options?.body as FormData).get('slot')).toBe('audio')
    await waitFor(() =>
      expect(onProposal).toHaveBeenCalledWith({
        ...proposal,
        resources: {
          ...proposal.resources,
          audio: { status: '用户上传', treatment: 'sound.mp3' },
        },
      }),
    )
  })

  it('uploads a reference video without assigning it to a production resource slot', async () => {
    const onProposal = vi.fn()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        asset: {
          id: 'reference-1',
          slot: 'referenceVideo',
          filename: 'reference.webm',
          mimeType: 'video/webm',
          size: 5,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={proposal}
        onProposal={onProposal}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('选择参考视频'), {
      target: { files: [new File(['video'], 'reference.webm', { type: 'video/webm' })] },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, options] = fetchMock.mock.calls[0]
    expect((options?.body as FormData).get('slot')).toBe('referenceVideo')
    expect(await screen.findByText('reference.webm')).toBeInTheDocument()
    expect(onProposal).not.toHaveBeenCalled()
  })

  it('parses a final NDJSON frame, reports malformed frames, and posts confirmation', async () => {
    const confirmationLine = JSON.stringify({
      type: 'confirmation',
      confirmation: { ...proposal, storeUrl: 'https://x.test' },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(`${confirmationLine}`))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const onProposal = vi.fn()
    const { rerender } = render(
      <ChatWorkspace
        taskId="task-7"
        phase="draft"
        onProposal={onProposal}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '做一个试玩' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    await waitFor(() => expect(onProposal).toHaveBeenCalled())

    const readyProposal = {
      ...proposal,
      storeUrl: 'https://x.test',
      resources: {
        ...proposal.resources,
        tileFaces: { status: '内置默认' as const, treatment: '默认' },
        audio: { status: '内置默认' as const, treatment: '默认' },
      },
    }
    rerender(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={readyProposal}
        onProposal={onProposal}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '确认方案并开始构建' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/playable-tasks/task-7/confirm',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('sends the composed message when Enter is pressed', async () => {
    const fetchMock = vi.fn(async () => new Response(`${JSON.stringify({ type: 'informational', message: '收到' })}\n`))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace taskId="task-7" phase="draft" onProposal={vi.fn()} onPhase={vi.fn()} onRequireApiKey={vi.fn()} />,
    )

    const input = screen.getByLabelText('试玩需求')
    fireEvent.change(input, { target: { value: '按回车发送' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/playable-tasks/task-7/messages',
        expect.objectContaining({ body: JSON.stringify({ message: '按回车发送' }) }),
      ),
    )
  })

  it('renders an assistant clarification, decision rationale, quick choices, and loading over an existing proposal', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '我想换一种玩法' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    expect(screen.getByRole('region', { name: 'Thinking' })).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()

    resolveFetch(
      new Response(
        [
          JSON.stringify({ type: 'assistant_progress', message: '请选择', reasoning: '正在判断核心玩法。' }),
          JSON.stringify({
            type: 'clarification',
            message: '请选择一种玩法。',
            reasoning: '当前描述没有指定核心消除机制。',
            options: [
              { id: 'center', label: '中心碰撞', description: '配对后碰撞', value: '选择中心碰撞玩法' },
              { id: 'rack', label: '上方牌架', description: '选牌进入牌架', value: '选择上方牌架玩法' },
            ],
          }),
        ].join('\n'),
      ),
    )

    expect(await screen.findByText('请选择一种玩法。')).toBeInTheDocument()
    expect(screen.getByText(/当前描述没有指定核心消除机制/)).toBeInTheDocument()
    expect(screen.getAllByRole('article', { name: '助手回复' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /中心碰撞/ }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/playable-tasks/task-7/messages',
        expect.objectContaining({ body: JSON.stringify({ message: '选择中心碰撞玩法' }) }),
      ),
    )
  })

  it('keeps AI generation disabled while allowing local uploads before confirmation', () => {
    const onChange = vi.fn()
    const onUpload = vi.fn()
    render(
      <ConfirmationTable
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onChange={onChange}
        onConfirm={vi.fn()}
        onUpload={onUpload}
      />,
    )

    expect(screen.getByRole('button', { name: 'AI 生成牌面素材（暂不支持）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI 生成背景与棋盘（暂不支持）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI 生成动画与特效（暂不支持）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI 生成音频（暂不支持）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI 生成结束卡（暂不支持）' })).toBeDisabled()

    const backgroundInput = screen.getByLabelText('为背景与棋盘上传素材')
    expect(backgroundInput).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif')
    fireEvent.change(backgroundInput, {
      target: { files: [new File(['image'], 'board.png', { type: 'image/png' })] },
    })
    expect(onUpload).toHaveBeenCalledWith('backgroundBoard', [expect.objectContaining({ name: 'board.png' })])

    expect(screen.getByRole('button', { name: '上传参考图片' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '上传参考视频' })).toBeEnabled()
    expect(screen.getByLabelText('选择参考图片')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif')
    expect(screen.getByLabelText('选择参考视频')).toHaveAttribute('accept', 'video/mp4,video/webm')
  })

  it('blocks a legacy AI-generated plan until the user chooses an available asset source', () => {
    render(
      <ConfirmationTable
        proposal={{
          ...proposal,
          storeUrl: 'https://example.com/store',
          resources: {
            ...proposal.resources,
            tileFaces: { status: '待生成', treatment: '生成主题牌面' },
          },
        }}
        onChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('AI 素材生成暂不支持，请改用内置默认或本地上传。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认方案并开始构建' })).toBeDisabled()
  })

  it('automatically submits the initial prompt once in local Codex mode', async () => {
    let requestSignal: AbortSignal | null | undefined
    let resolveFetch!: (response: Response) => void
    const responsePromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const confirmationLine = JSON.stringify({
      type: 'confirmation',
      confirmation: { ...proposal, storeUrl: 'https://example.com/store' },
    })
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal
      return responsePromise
    })
    vi.stubGlobal('fetch', fetchMock)
    const onProposal = vi.fn()

    render(
      <StrictMode>
        <ChatWorkspace
          taskId="task-local-codex"
          initialPrompt="做一个中心碰撞试玩"
          phase="draft"
          onProposal={onProposal}
          onPhase={vi.fn()}
          onRequireApiKey={vi.fn()}
          autoSubmitInitialPrompt
        />
      </StrictMode>,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(screen.getByRole('region', { name: 'Thinking' })).toBeInTheDocument()
    resolveFetch(new Response(confirmationLine))
    await waitFor(() => expect(onProposal).toHaveBeenCalledOnce())
    expect(requestSignal?.aborted).toBe(false)
    expect(screen.queryByText('已停止生成确认方案')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playable-tasks/task-local-codex/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: '做一个中心碰撞试玩' }),
      }),
    )
    expect(screen.getAllByText('做一个中心碰撞试玩')).toHaveLength(1)
  })

  it('surfaces malformed NDJSON and aborts an in-flight confirmation on stop', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{malformed'))
      .mockImplementationOnce((_url, options) => {
        capturedSignal = options?.signal
        return new Promise((_resolve, reject) =>
          capturedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        )
      })
    vi.stubGlobal('fetch', fetchMock)
    const props = {
      taskId: 'task-7',
      phase: 'draft' as const,
      onProposal: vi.fn(),
      onPhase: vi.fn(),
      onRequireApiKey: vi.fn(),
    }
    const { unmount } = render(<ChatWorkspace {...props} />)
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '坏帧' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('响应数据格式错误')

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '停止我' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(capturedSignal?.aborted).toBe(true)
    unmount()
  })

  it('uses only the authenticated artifact endpoint in a scripts-only sandbox', () => {
    render(<PlayablePreview taskId="task-7" phase="ready" />)

    const iframe = screen.getByTitle('Playable preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe).toHaveAttribute('src', '/api/playable-tasks/task-7/artifact?kind=playable')
  })

  it('starts muted and unmutes through postMessage without adding iframe permissions or replacing the frame', () => {
    render(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="v1" />)
    const iframe = screen.getByTitle('Playable preview') as HTMLIFrameElement
    const frameBefore = iframe
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')

    fireEvent.click(screen.getByRole('button', { name: '取消静音预览' }))

    expect(postMessage).toHaveBeenCalledWith({ type: 'playable:set-muted', muted: false }, '*')
    expect(screen.getByRole('button', { name: '静音预览' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTitle('Playable preview')).toBe(frameBefore)
    expect(iframe).not.toHaveAttribute('allow')
  })

  it('keeps a server-authoritative previous artifact on failed reload and refreshes for a new version', () => {
    const { rerender } = render(
      <PlayablePreview taskId="task-7" phase="failed" hasArtifact artifactVersion="old-build" />,
    )
    const oldFrame = screen.getByTitle('Playable preview')
    expect(oldFrame).toHaveAttribute('src', '/api/playable-tasks/task-7/artifact?kind=playable')

    rerender(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="new-build" />)

    expect(screen.getByTitle('Playable preview')).not.toBe(oldFrame)
  })

  it('loads and switches between successful playable versions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          builds: [
            {
              id: 'build-1',
              status: 'succeeded',
              version: 1,
              current: false,
              createdAt: new Date(1).toISOString(),
              completedAt: new Date(2).toISOString(),
            },
            {
              id: 'build-2',
              status: 'succeeded',
              version: 2,
              current: true,
              createdAt: new Date(3).toISOString(),
              completedAt: new Date(4).toISOString(),
            },
          ],
        }),
      ),
    )
    render(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="build-2" />)

    await waitFor(() =>
      expect(screen.getByTitle('Playable preview')).toHaveAttribute(
        'src',
        '/api/playable-tasks/task-7/artifact?kind=playable&version=build-2',
      ),
    )
    fireEvent.click(screen.getByLabelText('选择试玩版本'))
    fireEvent.click(await screen.findByRole('option', { name: 'v1' }))
    await waitFor(() =>
      expect(screen.getByTitle('Playable preview')).toHaveAttribute(
        'src',
        '/api/playable-tasks/task-7/artifact?kind=playable&version=build-1',
      ),
    )
  })

  it('keeps the previous version visible and can retry a failed build', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/versions')) {
        return Response.json({
          builds: [
            {
              id: 'build-1',
              status: 'succeeded',
              version: 1,
              current: true,
              createdAt: new Date(1).toISOString(),
              completedAt: new Date(2).toISOString(),
            },
          ],
        })
      }
      return Response.json({ task: { phase: 'building' } }, { status: 202 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onPhase = vi.fn()
    render(
      <PlayablePreview
        taskId="task-7"
        phase="failed"
        hasArtifact
        artifactVersion="build-1"
        confirmation={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onPhase={onPhase}
      />,
    )

    expect(screen.getByText('本次构建失败，正在展示上一成功版本。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试构建' }))
    await waitFor(() => expect(onPhase).toHaveBeenCalledWith('building'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playable-tasks/task-7/confirm',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps natural-language chat available after a successful build', async () => {
    const fetchMock = vi.fn(
      async () => new Response(`${JSON.stringify({ type: 'informational', message: '可以继续修改当前试玩。' })}\n`),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-ready"
        phase="ready"
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('试玩需求')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '把标题改得更轻松' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    expect(await screen.findByText('可以继续修改当前试玩。')).toBeInTheDocument()
  })

  it('makes a successful artifact downloadable without a separate acceptance action', async () => {
    const fetchMock = vi.fn(async () => Response.json({ builds: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="build-1" />)

    expect(screen.getByRole('group', { name: '预览控制' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载交付物' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '验收通过' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '返回修改' })).not.toBeInTheDocument()
  })
})
