// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/versions',
}))

import { VersionsPage } from '@/components/playable/versions-page'
import { PlayableRecentTasksProvider } from '@/components/playable/recent-tasks-context'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('versions page loading', () => {
  it('keeps recent conversations visible while build records are loading', () => {
    const existingTask = {
      id: 'existing-task',
      title: '已经加载的最近对话',
      prompt: '创建一个试玩',
      phase: 'ready' as const,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      hasArtifact: true,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    )

    render(
      <PlayableRecentTasksProvider initialTasks={[existingTask]}>
        <VersionsPage accountLabel="测试账号" />
      </PlayableRecentTasksProvider>,
    )

    expect(screen.getByRole('link', { name: /已经加载的最近对话/ })).toBeInTheDocument()
  })

  it('loads build records once without embedded previews and links previews to a new tab', async () => {
    const tasks = Array.from({ length: 3 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: index === 0 ? '需求 1' : `试玩 ${index + 1}`,
      prompt: `需求 ${index + 1}`,
      phase: 'ready' as const,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      hasArtifact: true,
    }))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/playable-tasks/library') {
        return Response.json({
          tasks,
          versions: tasks.map((task, index) => ({
            id: `build-${index + 1}`,
            taskId: task.id,
            status: 'succeeded',
            version: 1,
            current: true,
            confirmation: {
              routing: { match: 'freeform', confidence: 0.8, differences: ['不受模板状态机限制'] },
              mode: 'gravity_fill',
              gameplay: '相同牌向中心碰撞并消除',
              presentation: {
                assetFields: [
                  { slot: 'tileFaces', label: '麻将牌面' },
                  { slot: 'backgroundBoard', label: '上传的美女荷官、赌场背景与中心碰撞棋盘' },
                  { slot: 'animationEffects', label: '碰撞、消除与计分特效' },
                  { slot: 'audio', label: '点击、碰撞与消除音效' },
                  { slot: 'endCard', label: '挑战结束卡' },
                ],
                copyFields: ['title', 'cta', 'disclaimer', 'locale'],
                showReferenceAssets: true,
              },
              resources: {
                tileFaces: { status: '内置默认', treatment: '使用系统牌面' },
                backgroundBoard: {
                  status: '用户上传',
                  treatment: '7e3fbaddfd99d9f0da4dec4054aeeb9bce19ceapetxC1_w658.webp',
                },
                animationEffects: { status: '内置默认', treatment: '使用系统特效' },
                audio: { status: '内置默认', treatment: '使用系统音频' },
                endCard: { status: '内置默认', treatment: '使用系统结束卡' },
              },
              copy: { title: '测试游戏', cta: '立即下载', disclaimer: '测试演示', locale: 'zh-CN' },
              storeUrl: 'https://example.com/app',
              delivery: {
                network: 'applovin',
                logicalWidth: 360,
                logicalHeight: 640,
                output: 'single-html',
                maxBytes: 5242880,
              },
            },
            delivery: {
              label: 'AppLovin',
              logicalWidth: 360,
              logicalHeight: 640,
              output: 'single-html',
            },
            validation: {
              buildPassed: true,
              deliveryCompliant: true,
              bytes: 1048576,
            },
            createdAt: '2026-09-10T00:00:00.000Z',
            completedAt: '2026-09-10T00:01:00.000Z',
          })),
        })
      }
      if (url === '/api/playable-tasks') return Response.json({ tasks })
      const taskId = url.match(/^\/api\/playable-tasks\/(task-\d+)\/versions$/)?.[1]
      if (taskId) {
        const index = Number(taskId.split('-')[1])
        return Response.json({
          builds: [
            {
              id: `build-${index}`,
              status: 'succeeded',
              version: 1,
              current: true,
              createdAt: '2026-09-10T00:00:00.000Z',
              completedAt: '2026-09-10T00:01:00.000Z',
            },
          ],
        })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<VersionsPage accountLabel="测试账号" />)

    const firstVersion = await screen.findByRole('row', { name: '构建 build-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/library', { cache: 'no-store' })
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(within(firstVersion).queryByText('需求 1')).not.toBeInTheDocument()
    expect(within(firstVersion).getByText('build-1')).toBeInTheDocument()
    expect(within(firstVersion).getByText('1.0 MB')).toBeInTheDocument()
    expect(within(firstVersion).getByText('校验通过')).toBeInTheDocument()
    expect(within(firstVersion).getByText('下落补位')).toHaveAttribute('data-slot', 'badge')
    expect(within(firstVersion).getByText('Agent 自由生成')).toHaveAttribute('data-slot', 'badge')
    expect(within(firstVersion).queryByText('相同牌向中心碰撞并消除')).not.toBeInTheDocument()
    expect(within(firstVersion).queryByText('AppLovin')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '交付规格' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(firstVersion).getByRole('link', { name: '预览' })).toHaveAttribute(
      'href',
      '/api/playable-tasks/task-1/artifact?kind=playable&version=build-1',
    )
    expect(within(firstVersion).getByRole('link', { name: '预览' })).toHaveAttribute('target', '_blank')
    fireEvent.click(within(firstVersion).getByRole('button', { name: '查看完整配置' }))
    expect(await screen.findByRole('dialog', { name: '构建配置' })).toHaveTextContent('测试游戏')
    expect(screen.getByRole('dialog', { name: '构建配置' })).toHaveTextContent('相同牌向中心碰撞并消除')
    expect(screen.getByRole('dialog', { name: '构建配置' })).toHaveTextContent('系统素材')
    expect(screen.getByRole('dialog', { name: '构建配置' })).toHaveTextContent('上传的美女荷官、赌场背景与中心碰撞棋盘')
    expect(screen.getByRole('dialog', { name: '构建配置' })).toHaveTextContent(
      '7e3fbaddfd99d9f0da4dec4054aeeb9bce19ceapetxC1_w658.webp',
    )
    expect(screen.getByRole('dialog', { name: '构建配置' })).toHaveTextContent('AppLovin')
  })
})
