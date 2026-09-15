// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AgentText, ReasoningText } from '@/components/playable/reasoning-text'

afterEach(cleanup)
it('将摘要中的加粗、列表和代码渲染为 Markdown，忽略原始 HTML', () => {
  const { container } = render(
    <ReasoningText>{'**检查 HTML**\n\n- 读取模板\n- 运行 `test`\n\n<script>alert(1)</script>'}</ReasoningText>,
  )
  expect(screen.getByText('检查 HTML').tagName).toBe('STRONG')
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('test').tagName).toBe('CODE')
  expect(container.querySelector('script')).toBeNull()
})

it.each([ReasoningText, AgentText])('正文和思考摘要将内部文件链接显示为不可点击的文件名', (Component) => {
  const { container } = render(
    <Component>
      {[
        '[output.html](/vercel/work/output.html)',
        '[预览场景](work/preview-scenario.mjs)',
        '[报告](file:///tmp/report.json)',
        '[截图](sandbox:/mnt/data/screenshot.png)',
        '[相对文件](../work/config.json#L12)',
        '[编码文件](/tmp/my%20file.txt)',
        '[引用文件][artifact]',
        '',
        '[artifact]: ./result.html',
      ].join('\n\n')}
    </Component>,
  )
  expect(screen.queryAllByRole('link')).toHaveLength(0)
  for (const filename of [
    'output.html',
    'preview-scenario.mjs',
    'report.json',
    'screenshot.png',
    'config.json',
    'my file.txt',
    'result.html',
  ]) {
    expect(screen.getByText(filename).tagName).toBe('CODE')
  }
  expect(container.textContent).not.toContain('/vercel/work')
})

it('保留 HTTP 和 HTTPS 网页链接，不启用其他协议或页内跳转', () => {
  render(
    <AgentText>
      {
        '[文档](https://example.com/docs) [网页](http://example.com) [危险链接](javascript:alert) [文件下载](data:text/plain,secret) [章节](#heading)'
      }
    </AgentText>,
  )
  expect(screen.getAllByRole('link')).toHaveLength(2)
  expect(screen.getByRole('link', { name: '文档' })).toHaveAttribute('href', 'https://example.com/docs')
  expect(screen.getByRole('link', { name: '网页' })).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByText('危险链接').closest('a')).toBeNull()
  expect(screen.getByText('文件下载').closest('a')).toBeNull()
  expect(screen.getByText('章节').closest('a')).toBeNull()
})
