import { nativeTemplateUiPolicy } from './native-template-ui'
import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import type { ConfirmationProposal } from './schemas'

const sourceSkills = {
  dragon_slots: ['dragon-slots-playable', '金龙麻将转轴'],
  dragon_reward_wheel: ['dragon-reward-wheel-playable', '金龙转盘集奖'],
  zeus_scatter: ['zeus-scatter-playable', '宙斯 Scatter 转轴'],
  balloon_master: ['balloon-master-playable', '彩球转盘消除'],
} as const

/** 指令按玩法独立命名；模板和专属资料均由所选 Skill 自己持有。 */
export function selectBuildSkill(confirmation: Pick<ConfirmationProposal, 'sourceTemplateId' | 'routing'>) {
  const entry = confirmation.sourceTemplateId ? sourceSkills[confirmation.sourceTemplateId] : undefined
  const [name, label] =
    entry ??
    (confirmation.routing.match === 'freeform'
      ? ['freeform-playable', '自定义试玩']
      : ['mahjong-pair-match-playable', '麻将配对试玩'])
  return { name, description: `Build and validate ${label}.`, root: path.join(process.cwd(), 'skills', name) }
}

export async function buildSkillEntry(confirmation: Pick<ConfirmationProposal, 'sourceTemplateId' | 'routing'>) {
  const skill = selectBuildSkill(confirmation)
  return { ...skill, content: await readFile(path.join(skill.root, 'SKILL.md'), 'utf8') }
}

/** 只携带当前玩法所需模板；共享构建器、默认素材和验收工具仍保留。 */
export function includeBuildSkillFile(
  relativePath: string,
  confirmation: Pick<ConfirmationProposal, 'sourceTemplateId' | 'routing' | 'mode'>,
) {
  const file = relativePath.split(path.sep).join('/')
  if (file.startsWith('agents/')) return false
  if (/^assets\/starter\/work\/(?:inspect-cocos-bundle\.mjs|patch-cocos-bundle\.mjs|vendor\/acorn\.)/.test(file))
    return Boolean(confirmation.sourceTemplateId)
  const template = /^assets\/templates\/([^/]+)\//.exec(file)
  if (template) return template[1] === (confirmation.sourceTemplateId ?? confirmation.mode)
  const reference = /^references\/(templates|modes)\/([^/]+)\.md$/.exec(file)
  if (reference) {
    if (reference[1] === 'templates')
      return !!confirmation.sourceTemplateId && ['adaptation', confirmation.sourceTemplateId].includes(reference[2])
    return !confirmation.sourceTemplateId && reference[2] === confirmation.mode
  }
  return !file.includes('/outputs/')
}

/** 存储按归属拆分，运行时合并到原路径，兼容已有提示词与验收场景。自定义根目录仍作为完整包使用。 */
export function buildSkillRoots(
  confirmation: Pick<ConfirmationProposal, 'sourceTemplateId' | 'routing'>,
  customRoot?: string,
) {
  const legacyRoot = path.join(process.cwd(), 'skills/mahjong-pair-match-playable')
  if (customRoot && customRoot !== legacyRoot) return [customRoot]
  return [path.join(process.cwd(), 'skills/_shared'), selectBuildSkill(confirmation).root]
}

export function sourceTemplateFile(sourceTemplateId: NonNullable<ConfirmationProposal['sourceTemplateId']>) {
  return path.join(
    process.cwd(),
    'skills',
    sourceSkills[sourceTemplateId][0],
    'assets/templates',
    sourceTemplateId,
    'source.html',
  )
}

interface SkillFile {
  relativePath: string
  content: Uint8Array
}

async function readSkillFiles(root: string, directory = root): Promise<SkillFile[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry): Promise<SkillFile[]> => {
      if (isFilesystemMetadata(entry.name, entry.isDirectory())) return []
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) return readSkillFiles(root, absolutePath)
      if (!entry.isFile()) return []
      return [
        { relativePath: path.relative(root, absolutePath), content: new Uint8Array(await readFile(absolutePath)) },
      ]
    }),
  )
  return files.flat().sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function isFilesystemMetadata(name: string, directory: boolean): boolean {
  if (directory && ['.git', '.svn', '__MACOSX'].includes(name)) return true
  return name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini' || name.startsWith('._')
}
/** 本地 CLI 与云端统一使用此装配入口，避免两套复制逻辑产生不同依赖。 */
export async function readBuildSkillFiles(
  confirmation: Pick<ConfirmationProposal, 'sourceTemplateId' | 'routing' | 'mode'>,
  customRoot?: string,
) {
  const files = (await Promise.all(buildSkillRoots(confirmation, customRoot).map((root) => readSkillFiles(root))))
    .flat()
    .filter((file) => includeBuildSkillFile(file.relativePath, confirmation))
  // 由服务端选定模板策略，供本地与云端构建共同读取，避免只依赖对话中的口头要求。
  const nativeUi = nativeTemplateUiPolicy(confirmation.sourceTemplateId)
  if (nativeUi)
    files.push({
      relativePath: 'template-ui-policy.json',
      content: new TextEncoder().encode(JSON.stringify(nativeUi, null, 2)),
    })
  if (new Set(files.map((file) => file.relativePath)).size !== files.length)
    throw new Error('Duplicate Skill workspace file')
  return files
}
