import { sourceTemplateFile } from '@/lib/playable/build-skill'
import { expect, it } from 'vitest'
import { access } from 'node:fs/promises'
import { sourceTemplateIds, playableModeIds } from '@/lib/playable/types'
import { buildValidationCommand, usesPerspectiveTemplate } from '@/lib/playable/build-template-policy'
import { createCodexBuildPrompt } from '@/lib/playable/codex-playable-agent'

const routes = ['exact', 'approximate', 'freeform'] as const
const strategies = [undefined, 'patch', 'regenerate'] as const
const revisions = (strategy: (typeof strategies)[number]) =>
  strategy
    ? {
        id: 'revision',
        baseBuildId: 'base',
        baseVersion: 1,
        targetVersion: 2,
        strategy,
        summary: '调整游戏',
        changes: ['修改已确认交互'],
        preserved: ['保留游戏引擎'],
      }
    : undefined

it.each(sourceTemplateIds)('模板源文件和适配说明存在：%s', async (id) => {
  await access(sourceTemplateFile(id))
  await access(sourceTemplateFile(id).replace(`/assets/templates/${id}/source.html`, `/references/templates/${id}.md`))
})

it.each(routes)('所有路由使用通用产物校验：%s', (match) => {
  const command = buildValidationCommand({ routing: { match, confidence: 1, differences: [] } })
  expect(command).toContain('test-freeform-playable.mjs')
  expect(command).not.toContain('test-playable.mjs')
})

it.each(
  sourceTemplateIds.flatMap((sourceTemplateId) =>
    playableModeIds.flatMap((mode) =>
      routes.flatMap((match) => strategies.map((strategy) => ({ sourceTemplateId, mode, match, strategy }))),
    ),
  ),
)('独立模板优先级：$sourceTemplateId / $mode / $match / $strategy', (test) => {
  const selection = { ...test, routing: { match: test.match, confidence: 1, differences: [] } }
  const prompt = createCodexBuildPrompt(test.match, revisions(test.strategy), test.sourceTemplateId, test.mode)
  expect(usesPerspectiveTemplate(selection)).toBe(false)
  expect(prompt).not.toContain('Three.js')
  expect(prompt).not.toContain('test-playable.mjs')
  expect(prompt).toContain(buildValidationCommand(selection))
  expect(prompt).toContain('sourceTemplateId and confirmed gameplay take precedence')
  if (test.strategy === 'patch') expect(prompt).toContain('Copy current-playable.html to output.html')
  else expect(prompt).toContain('already seeded from that source')
})

it.each(
  playableModeIds.flatMap((mode) =>
    routes.flatMap((match) => strategies.map((strategy) => ({ mode, match, strategy }))),
  ),
)('内置玩法约束及校验一致：$mode / $match / $strategy', (test) => {
  const selection = { mode: test.mode, routing: { match: test.match, confidence: 1, differences: [] } }
  const prompt = createCodexBuildPrompt(test.match, revisions(test.strategy), undefined, test.mode)
  expect(prompt).toContain(buildValidationCommand(selection))
  expect(prompt.includes('Three.js')).toBe(usesPerspectiveTemplate(selection))
})
