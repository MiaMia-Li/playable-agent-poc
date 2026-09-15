// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameplayAnnotation, GameplayBlueprint } from '@/lib/playable/schemas'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'

Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })

const blueprint: GameplayBlueprint = {
  version: 3,
  timeline: [],
  summary: '点击两个相同图案连线消除',
  orientation: 'portrait',
  controls: [],
  sceneStructure: { value: '棋盘', confidence: 1, evidence: [] },
  entities: [],
  coreLoop: { value: '连线', confidence: 1, evidence: [] },
  stateTransitions: [],
  objective: { value: '清空', confidence: 1, evidence: [] },
  failureConditions: [],
  progression: [],
  tutorial: [],
  endCard: null,
  audio: [],
  intentDivergence: [{ value: '视频是连连看，不是三消', confidence: 0.9, evidence: [] }],
  visualStyle: '卡通',
  uncertainties: [],
  overallConfidence: 0.9,
}

const video = {
  id: 'video-1',
  slot: 'referenceVideo' as const,
  filename: 'gameplay.mp4',
  mimeType: 'video/mp4',
  size: 5,
  durationSeconds: 12,
}

const annotation: GameplayAnnotation = {
  id: 'annotation-1',
  assetId: video.id,
  source: 'user',
  value: '第 12 秒是长按，不是点击',
  evidence: [{ startSeconds: 12, endSeconds: 12.5, observation: '长按' }],
  confidence: 1,
  origin: 'chat',
}

type FetchCall = [RequestInfo | URL, RequestInit | undefined]

function analysisPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return (fetchMock.mock.calls as FetchCall[])
    .filter(([input, init]) => String(input).endsWith('/analysis') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

function pendingAnalysis() {
  return Response.json({ analysis: { assetId: video.id, status: 'pending', blueprint: null } }, { status: 202 })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('reference video analysis in the workspace', () => {
  // Analysing on upload is what lets the user's typing time cover the run.
  // The request has to name the video: two uploads in quick succession would
  // otherwise both resolve to whichever happened to be newest.
  it('starts analysis of an uploaded video by name as soon as the upload lands', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/assets')) return Response.json({ asset: video }, { status: 201 })
      if (url.endsWith('/analysis')) return pendingAnalysis()
      if (url.endsWith('/messages')) {
        return new Response(`${JSON.stringify({ type: 'informational', message: '收到视频' })}\n`)
      }
      return Response.json({}, { status: init?.method ? 404 : 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayableWorkspace taskId="task-upload" />)

    fireEvent.change(screen.getByLabelText('选择参考图片或视频'), {
      target: { files: [new File(['video'], 'gameplay.mp4', { type: 'video/mp4' })] },
    })
    expect(await screen.findByText('gameplay.mp4')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '参考这个视频' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    await waitFor(() => expect(analysisPosts(fetchMock)).toEqual([{ assetId: video.id }]))
    expect(await screen.findByRole('region', { name: '参考视频分析' })).toHaveTextContent('等待分析')
  })

  // The degraded run is a real observation, so it is shown; but without saying
  // so a user cannot tell it apart from a good one, and a re-run would be a guess.
  it('says when a result came back at reduced resolution and re-runs it on request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/analysis') ? pendingAnalysis() : Response.json({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableWorkspace
        taskId="task-degraded"
        initialAssets={[video]}
        initialActiveReferenceVideoId={video.id}
        initialVideoAnalysisStatus="succeeded"
        initialGameplayBlueprint={blueprint}
        initialVideoAnalysisMediaResolution="default"
      />,
    )

    const card = screen.getByRole('region', { name: '参考视频分析' })
    expect(card).toHaveTextContent('较低分辨率')
    expect(card).toHaveTextContent('视频是连连看，不是三消')
    fireEvent.click(within(card).getByRole('button', { name: '重新分析' }))

    await waitFor(() => expect(analysisPosts(fetchMock)).toEqual([{ assetId: video.id, rerun: true }]))
  })

  it('does not mention resolution for a result that got the resolution it asked for', () => {
    render(
      <PlayableWorkspace
        taskId="task-clean"
        initialAssets={[video]}
        initialActiveReferenceVideoId={video.id}
        initialVideoAnalysisStatus="succeeded"
        initialGameplayBlueprint={blueprint}
        initialVideoAnalysisMediaResolution="high"
      />,
    )

    expect(screen.getByRole('region', { name: '参考视频分析' })).not.toHaveTextContent('较低分辨率')
  })

  // v1 analyses read as "not analysed", and so does a task whose active video
  // was deleted. Without an explicit way to start, those videos would stay
  // unanalysed for good.
  it('offers to analyse a video that has no current analysis, without starting it unasked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/analysis') ? pendingAnalysis() : Response.json({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayableWorkspace taskId="task-legacy" initialAssets={[video]} />)

    const card = screen.getByRole('region', { name: '参考视频分析' })
    expect(card).toHaveTextContent('尚未分析')
    expect(analysisPosts(fetchMock)).toEqual([])
    fireEvent.click(within(card).getByRole('button', { name: '分析参考视频' }))

    await waitFor(() => expect(analysisPosts(fetchMock)).toEqual([{ assetId: video.id }]))
  })

  // The agent resends the full list each turn and can drop an entry without
  // saying so. A standing list is the only place that loss becomes visible,
  // and deleting from it must not have to go through the agent.
  it('keeps the annotation list on screen and deletes an entry through the API', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ annotations: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableWorkspace
        taskId="task-annotations"
        initialAssets={[video]}
        initialActiveReferenceVideoId={video.id}
        initialVideoAnalysisStatus="succeeded"
        initialGameplayBlueprint={blueprint}
        initialGameplayAnnotations={[annotation]}
      />,
    )

    const list = screen.getByRole('region', { name: '玩法标注' })
    expect(list).toHaveTextContent('第 12 秒是长按，不是点击')
    expect(list).toHaveTextContent('12s–12.5s')
    fireEvent.click(within(list).getByRole('button', { name: `删除标注 ${annotation.value}` }))

    await waitFor(() => expect(list).not.toHaveTextContent('第 12 秒是长按，不是点击'))
    expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/task-annotations/annotations?id=annotation-1', {
      method: 'DELETE',
    })
  })

  it('shows the list the agent recorded during a turn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/messages')
          ? new Response(
              [
                JSON.stringify({ type: 'annotations', annotations: [annotation] }),
                JSON.stringify({ type: 'informational', message: '已记录标注' }),
              ].join('\n'),
            )
          : Response.json({}),
      ),
    )
    render(
      <PlayableWorkspace
        taskId="task-record"
        initialAssets={[video]}
        initialActiveReferenceVideoId={video.id}
        initialVideoAnalysisStatus="succeeded"
        initialGameplayBlueprint={blueprint}
      />,
    )
    expect(screen.getByRole('region', { name: '玩法标注' })).toHaveTextContent('可以直接在对话里说明')

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '第 12 秒是长按' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    expect(await screen.findByText('已记录标注')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '玩法标注' })).toHaveTextContent('第 12 秒是长按，不是点击')
  })

  it('reports analysis as unavailable when the service is not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Video analysis is unavailable' }, { status: 503 })),
    )
    render(<PlayableWorkspace taskId="task-no-key" initialAssets={[video]} />)

    fireEvent.click(screen.getByRole('button', { name: '分析参考视频' }))

    expect(await screen.findByText('分析不可用')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '分析参考视频' })).not.toBeInTheDocument()
  })
})
