// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import { ChatWorkspace } from '@/components/playable/chat-workspace'
import { ConfirmationTable } from '@/components/playable/confirmation-table'
import { PlayablePreview } from '@/components/playable/playable-preview'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'

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

  it('renders chat, upload, confirmation, progress, and preview controls', () => {
    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured />)

    expect(screen.getByRole('region', { name: '需求对话' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '确认方案' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '构建进度' })).toHaveTextContent(
      '需求整理等待确认构建中验证中待验收已交付',
    )
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
    expect(screen.getByText('上方牌架')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认方案并开始构建' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('商店跳转链接（HTTPS）'), {
      target: { value: 'https://example.com/store' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ storeUrl: 'https://example.com/store' }))
  })

  it('polls authoritative task state immediately and ignores backward phase responses', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        task: {
          phase: 'awaiting_confirmation',
          hasArtifact: true,
          artifactVersion: 'old',
          confirmation: { ...proposal, storeUrl: 'https://example.com/store' },
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
        initialHasArtifact
        initialArtifactVersion="old"
      />,
    )

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/task-7/events', { cache: 'no-store' }),
    )
    expect(screen.getByRole('region', { name: '构建进度' })).toHaveTextContent('当前状态：构建中')
    expect(screen.getByRole('region', { name: '确认方案' })).toHaveTextContent('top_rack')
    expect(screen.getByTitle('Playable preview')).toBeInTheDocument()
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
    expect(screen.getByRole('region', { name: '助手正在思考' })).toBeInTheDocument()

    resolveFetch(
      new Response(
        `${JSON.stringify({
          type: 'clarification',
          message: '请选择一种玩法。',
          reasoning: '当前描述没有指定核心消除机制。',
          options: [
            { id: 'center', label: '中心碰撞', description: '配对后碰撞', value: '选择中心碰撞玩法' },
            { id: 'rack', label: '上方牌架', description: '选牌进入牌架', value: '选择上方牌架玩法' },
          ],
        })}\n`,
      ),
    )

    expect(await screen.findByText('请选择一种玩法。')).toBeInTheDocument()
    expect(screen.getByText(/当前描述没有指定核心消除机制/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /中心碰撞/ }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/playable-tasks/task-7/messages',
        expect.objectContaining({ body: JSON.stringify({ message: '选择中心碰撞玩法' }) }),
      ),
    )
  })

  it('lets users choose built-in, AI-generated, or uploaded media before confirmation', () => {
    const onChange = vi.fn()
    render(
      <ConfirmationTable
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onChange={onChange}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'AI 生成牌面素材' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: expect.objectContaining({
          tileFaces: expect.objectContaining({ status: '待生成' }),
        }),
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '本地上传背景与棋盘' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: expect.objectContaining({
          backgroundBoard: expect.objectContaining({ status: '待上传' }),
        }),
      }),
    )
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
    expect(screen.getByRole('region', { name: '助手正在思考' })).toBeInTheDocument()
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

  it('requires explicit human acceptance and can reopen an accepted artifact for revision', async () => {
    const fetchMock = vi.fn(async () => Response.json({ task: { id: 'task-7' } }))
    vi.stubGlobal('fetch', fetchMock)
    const onPhase = vi.fn()
    const { rerender } = render(
      <PlayablePreview taskId="task-7" phase="reviewing" hasArtifact artifactVersion="build-1" onPhase={onPhase} />,
    )

    expect(screen.getByText('自动门禁已通过，请完成人工验收')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载试玩' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '验收通过' }))
    await waitFor(() => expect(onPhase).toHaveBeenCalledWith('ready'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playable-tasks/task-7/review',
      expect.objectContaining({ body: JSON.stringify({ action: 'accept' }) }),
    )

    rerender(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="build-1" onPhase={onPhase} />)
    expect(screen.getByRole('button', { name: '下载交付物' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }))
    await waitFor(() => expect(onPhase).toHaveBeenCalledWith('awaiting_confirmation'))
  })
})
