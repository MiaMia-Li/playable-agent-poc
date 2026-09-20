import type { BuildActivityDetail } from './build-activity-detail'

// 步骤标题固定，详情只接收宿主过滤后的公开信息。未知事件仍忽略。
export const buildActivityLabels = {
  preview_delayed: '生成时间超过预览目标，正在继续完成修改',
  stage_started: '阶段开始',
  stage_completed: '阶段结束',
  transferring: '正在传输构建文件',
  preview_checking: '正在检查预览交互',
  preview_check_failed: '预览交互检查失败',
  preview_repair_started: '正在定向修复预览（仅一次）',
  preview_repair_unchanged: '未产生有效修改，停止重试',
  artifact_repair_started: '正在修复产物资源引用（仅一次）',
  artifact_repair_unchanged: '产物未产生有效修改，停止重试',
  host_check_failed: '平台产物检查未通过',
  parameters_applied: '已应用模板参数，跳过模型修改',
  agent_message: 'Agent 说明',
  reasoning_summary: '思考摘要',
  preparing: '正在准备构建环境',
  agent_started: 'Agent 已开始执行',
  command_started: '正在执行命令',
  command_completed: '命令已完成',
  command_failed: '命令执行失败，等待 Agent 处理',
  file_changed: '已更新工作区文件',
  tool_started: '正在执行工具',
  tool_completed: '工具执行完成',
  tool_failed: '工具执行失败，等待 Agent 处理',
  agent_completed: 'Agent 执行结束，等待产物检查',
  validating: '正在检查游戏产物',
} as const

export type BuildActivity = keyof typeof buildActivityLabels
export type BuildActivityCallback = (activity: BuildActivity, detail?: BuildActivityDetail) => void

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

// CLI 以 item 为单位报告执行步骤。只读取类型、状态和退出码，不转发原始载荷。
export function cliBuildActivity(value: unknown): BuildActivity | undefined {
  const event = record(value)
  const item = record(event.item)
  if (item.type === 'command_execution') {
    if (event.type === 'item.started') return 'command_started'
    if (event.type === 'item.completed')
      return item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0)
        ? 'command_failed'
        : 'command_completed'
  }
  if (item.type === 'file_change' && event.type === 'item.completed')
    return item.status === 'failed' ? 'tool_failed' : 'file_changed'
  if (['mcp_tool_call', 'web_search'].includes(String(item.type))) {
    if (event.type === 'item.started') return 'tool_started'
    if (event.type === 'item.completed') return item.status === 'failed' ? 'tool_failed' : 'tool_completed'
  }
}

/** 将 Harness 流转换为与 CLI 一致的步骤类型，不透传原始数据。 */
export function harnessBuildActivity(value: unknown): BuildActivity | undefined {
  const event = record(value)
  // Harness 将文件修改展开为调用和结果两条事件，只在结果处展示一次。
  if (event.toolName === 'fileChange') return event.type === 'tool-result' ? 'file_changed' : undefined
  const command = ['bash', 'shell', 'exec_command'].includes(String(event.toolName))
  if (event.type === 'tool-call') return command ? 'command_started' : 'tool_started'
  if (event.type === 'tool-error') return command ? 'command_failed' : 'tool_failed'
  // 中间结果不能算完成；外层工具返回后仍需检查命令退出码。
  // 管道若掩盖了非零退出码，本层无法仅凭事件还原失败，所以命令完成不等于验收通过。
  if (event.type === 'tool-result' && !event.preliminary) {
    const output = record(event.output)
    const failed = output.status === 'failed' || (typeof output.exitCode === 'number' && output.exitCode !== 0)
    return command ? (failed ? 'command_failed' : 'command_completed') : failed ? 'tool_failed' : 'tool_completed'
  }
}

export interface BuildTimelineEvent {
  id: string
  type: string
  message?: string
  createdAt?: string
}

// 整体终态只认应用落库的成功或失败事件；模型的单步结束不代表产物已发布。
export function buildEventLabel(type: string): string | undefined {
  if (type === 'build_preview_ready') return '预览已保存，等待验收'
  if (type === 'build_started') return '构建已开始'
  if (type === 'build_succeeded') return '构建完成'
  if (type === 'build_failed') return '构建失败'
  if (!type.startsWith('build_activity_')) return undefined
  const key = type.slice('build_activity_'.length)
  return Object.hasOwn(buildActivityLabels, key) ? buildActivityLabels[key as BuildActivity] : undefined
}
