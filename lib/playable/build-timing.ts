import type { BuildActivityCallback } from './build-activity'

export const buildStageLabels = {
  environment: '环境准备',
  transfer: '文件传输',
  model: '模型修改',
  browser: '浏览器验收',
  validation: '产物检查',
  publish: '产物发布',
} as const
export type BuildStage = keyof typeof buildStageLabels
export interface BuildTiming {
  stage: BuildStage
  at: number
  durationMs?: number
}

export function readBuildTiming(value: unknown): BuildTiming | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Record<string, unknown>
  if (typeof item.stage !== 'string' || !Object.hasOwn(buildStageLabels, item.stage)) return
  if (typeof item.at !== 'number' || !Number.isFinite(item.at) || item.at < 0) return
  if (
    item.durationMs !== undefined &&
    (typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) || item.durationMs < 0)
  )
    return
  return {
    stage: item.stage as BuildStage,
    at: item.at,
    ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs as number }),
  }
}

/** 宿主记录阶段边界；浏览器时间取固定验收命令的真实执行区间，不从模型文案猜测。 */
export function createBuildTimingReporter(report: BuildActivityCallback, now = Date.now) {
  let active: { stage: BuildStage; at: number } | undefined
  const browserCalls = new Set<string>()
  const finish = () => {
    if (!active) return
    const at = now()
    report('stage_completed', { timing: { stage: active.stage, at, durationMs: Math.max(0, at - active.at) } })
    active = undefined
  }
  const start = (stage: BuildStage) => {
    if (active?.stage === stage) return
    finish()
    active = { stage, at: now() }
    report('stage_started', { timing: active })
  }
  const activity: BuildActivityCallback = (event, detail) => {
    if (event === 'preparing') {
      browserCalls.clear()
      start('environment')
    }
    if (event === 'transferring') start('transfer')
    if (event === 'agent_started') start('model')
    if (event === 'validating' || event === 'agent_completed') start('validation')
    if (
      event === 'command_started' &&
      detail?.id &&
      /(?:^|[\s"'\\])node\s+["']?(?:[^\s"']*\/)?browser-acceptance\.mjs(?:[\s"'\\]|$)/.test(detail.input ?? '')
    ) {
      browserCalls.add(detail.id)
      start('browser')
    }
    report(event, detail)
    if (
      (event === 'command_completed' || event === 'command_failed') &&
      detail?.id &&
      browserCalls.delete(detail.id) &&
      browserCalls.size === 0
    )
      start('model')
  }
  return { start, finish, activity }
}
