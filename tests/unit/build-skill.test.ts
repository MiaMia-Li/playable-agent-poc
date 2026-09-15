import { expect, it } from 'vitest'
import { buildSkillEntry, includeBuildSkillFile, readBuildSkillFiles } from '@/lib/playable/build-skill'
import { playableModeIds, sourceTemplateIds } from '@/lib/playable/types'

it.each(sourceTemplateIds)(
  'selects an independent entry and excludes unrelated assets for %s',
  async (sourceTemplateId) => {
    const confirmation = {
      sourceTemplateId,
      mode: 'gravity_fill' as const,
      routing: { match: 'exact' as const, confidence: 1, differences: [] },
    }
    const entry = await buildSkillEntry(confirmation)
    expect(entry.name).not.toBe('mahjong-pair-match-playable')
    expect(entry.content).toContain(`name: ${entry.name}`)
    expect(includeBuildSkillFile(`assets/templates/${sourceTemplateId}/source.html`, confirmation)).toBe(true)
    expect(includeBuildSkillFile('assets/templates/gravity_fill/config.json', confirmation)).toBe(false)
    expect(includeBuildSkillFile('assets/starter/work/browser-acceptance.mjs', confirmation)).toBe(true)
    for (const other of sourceTemplateIds.filter((id) => id !== sourceTemplateId)) {
      expect(includeBuildSkillFile(`assets/templates/${other}/source.html`, confirmation)).toBe(false)
    }
  },
)

it.each([...playableModeIds, ...sourceTemplateIds])(
  'assembles only the owned template and shared dependencies for %s',
  async (id) => {
    const sourceTemplateId = sourceTemplateIds.find((value) => value === id)
    const confirmation = {
      sourceTemplateId,
      mode: playableModeIds.find((value) => value === id) ?? 'gravity_fill',
      routing: { match: 'exact' as const, confidence: 1, differences: [] },
    }
    const files = await readBuildSkillFiles(confirmation)
    const policy = files.find((file) => file.relativePath === 'template-ui-policy.json')
    if (sourceTemplateId)
      expect(JSON.parse(new TextDecoder().decode(policy?.content))).toMatchObject({
        sourceTemplateId,
        cta: 'reuse-native',
        endCard: 'reuse-native',
        allowAdditionalCta: false,
        allowAdditionalEndCard: false,
      })
    else expect(policy).toBeUndefined()
    const names = files.map((file) => file.relativePath)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('SKILL.md')
    expect(names).toContain('assets/starter/work/browser-acceptance.mjs')
    expect(names).toContain('assets/starter/work/test-freeform-playable.mjs')
    const templates = names.filter((name) => /^assets\/templates\/[^/]+\//.test(name))
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.every((name) => name.startsWith(`assets/templates/${id}/`))).toBe(true)
    if (sourceTemplateId) {
      expect(names).toContain(`references/templates/${id}.md`)
      expect(names).toContain('references/templates/adaptation.md')
      expect(names.some((name) => /references\/modes|default-media|build-playable\.mjs/.test(name))).toBe(false)
    } else expect(names).toContain(`references/modes/${id}.md`)
  },
)

it('does not send Mahjong assets or instructions to a freeform build', async () => {
  const files = await readBuildSkillFiles({
    mode: 'gravity_fill',
    routing: { match: 'freeform', confidence: 1, differences: ['custom'] },
  })
  expect(files.some((file) => file.relativePath.startsWith('assets/templates/'))).toBe(false)
  expect(files.some((file) => file.relativePath.startsWith('references/modes/'))).toBe(false)
  expect(new TextDecoder().decode(files.find((file) => file.relativePath === 'SKILL.md')?.content)).toContain(
    'freeform-playable',
  )
})
