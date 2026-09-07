// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlayablePreview } from '@/components/playable/playable-preview'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'

afterEach(cleanup)

describe('PlayableWorkspace', () => {
  it('keeps the playable task-list path free of the legacy repository workspace', () => {
    const taskListPage = readFileSync(resolve(process.cwd(), 'app/tasks/page.tsx'), 'utf8')

    expect(taskListPage).not.toContain('TasksListClient')
    expect(taskListPage).toContain("redirect('/')")
  })

  it('opens the API key dialog when BYOK is missing', () => {
    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured={false} />)

    expect(screen.getByRole('dialog', { name: '配置 OpenAI API Key' })).toBeInTheDocument()
    expect(screen.getByLabelText('OpenAI API Key')).toHaveAttribute('type', 'password')
  })

  it('renders chat, upload, confirmation, progress, and preview controls', () => {
    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured />)

    expect(screen.getByRole('region', { name: '需求对话' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上传素材' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '确认方案' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '构建进度' })).toHaveTextContent(
      '需求整理 → 等待确认 → 构建中 → 验证中 → 可预览',
    )
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '竖屏预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '横屏预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '静音预览' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下载试玩' })).toBeInTheDocument()
  })

  it('uses only the authenticated artifact endpoint in a scripts-only sandbox', () => {
    render(<PlayablePreview taskId="task-7" phase="ready" />)

    const iframe = screen.getByTitle('Playable preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe).toHaveAttribute('src', '/api/playable-tasks/task-7/artifact?kind=playable')
  })

  it('reloads the secure preview with autoplay blocked when muted', () => {
    render(<PlayablePreview taskId="task-7" phase="ready" />)

    fireEvent.click(screen.getByRole('button', { name: '静音预览' }))

    expect(screen.getByTitle('Playable preview')).toHaveAttribute('allow', "autoplay 'none'")
    expect(screen.getByRole('button', { name: '取消静音预览' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the prior successful artifact URL after a failed build', () => {
    const { rerender } = render(<PlayablePreview taskId="task-7" phase="ready" />)
    const artifactUrl = screen.getByTitle('Playable preview').getAttribute('src')

    rerender(<PlayablePreview taskId="task-7" phase="failed" />)

    expect(screen.getByTitle('Playable preview')).toHaveAttribute('src', artifactUrl)
  })
})
