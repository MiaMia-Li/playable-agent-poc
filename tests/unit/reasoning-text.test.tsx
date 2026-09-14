// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReasoningText } from '@/components/playable/reasoning-text'

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
