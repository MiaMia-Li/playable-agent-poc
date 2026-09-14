import { expect, it } from 'vitest'
import { mergeReasoning } from '@/lib/playable/reasoning-history'

it('累计快照不重复，工具后的新段保留前文，缺失摘要不清空历史', () => {
  let value = mergeReasoning(undefined, '读取')
  value = mergeReasoning(value, '读取模板')
  expect(value).toBe('读取模板')
  value = mergeReasoning(value, '检查')
  value = mergeReasoning(value, '检查布局')
  expect(value).toBe('读取模板\n\n---\n\n检查布局')
  expect(mergeReasoning(value, undefined)).toBe(value)
  expect(mergeReasoning(value, '检查布局')).toBe(value)
  expect(mergeReasoning(value, '检查')).toBe(value)
})
