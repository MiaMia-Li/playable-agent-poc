import { cliBuildActivity, harnessBuildActivity, type BuildActivityCallback } from './build-activity'

/** 仅保存公开的执行信息，不接受原始模型载荷、隐藏推理或进程环境。 */
export interface BuildActivityDetail {
  id?: string
  tool?: string
  input?: string
  output?: string
  text?: string
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
function text(value: unknown): string | undefined {
  if (value === undefined) return undefined
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return '[无法展示此内容]'
  }
}

/** 两种适配器都先挑选公开字段，最终由宿主统一脱敏后落库。 */
export function reportCliBuildActivity(value: unknown, report?: BuildActivityCallback) {
  const event = record(value)
  const item = record(event.item)
  if (!String(event.type).startsWith('item.')) return
  const id = typeof item.id === 'string' ? item.id : undefined
  // Codex JSON 事件中的 reasoning 是提供方公开的推理摘要，不是隐藏思维链。
  if (event.type === 'item.completed' && ['agent_message', 'reasoning'].includes(String(item.type))) {
    report?.(item.type === 'reasoning' ? 'reasoning_summary' : 'agent_message', { id, text: text(item.text) })
    return
  }
  const activity = cliBuildActivity(event)
  if (!activity) return
  report?.(activity, {
    id,
    tool: text(item.tool ?? item.type),
    input: text(item.command ?? item.arguments ?? item.query ?? item.changes),
    output: text(item.aggregated_output ?? item.result ?? item.error),
  })
}

/**
 * 按段落收集公开文本，段落结束再持久化，避免逐 token 写数据库和切断密钥导致脱敏失效。
 * 工具开始和结束即时上报。每轮流单独创建收集器，重试时不会串接上轮文本。
 */
export function createHarnessActivityReporter(report?: BuildActivityCallback) {
  const pending = new Map<string, { type: 'agent_message' | 'reasoning_summary'; text: string }>()
  const flush = (id?: string) => {
    for (const [key, part] of pending) {
      if (id !== undefined && key !== id) continue
      if (part.text) report?.(part.type, { id: key, text: part.text })
      pending.delete(key)
    }
  }
  return {
    flush,
    accept(value: unknown) {
      const event = record(value)
      const id = String(event.id ?? event.type)
      if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
        const type = event.type === 'text-delta' ? 'agent_message' : 'reasoning_summary'
        const current = pending.get(id) ?? { type, text: '' }
        current.text += typeof event.text === 'string' ? event.text : typeof event.delta === 'string' ? event.delta : ''
        pending.set(id, current)
        return
      }
      if (event.type === 'text-end' || event.type === 'reasoning-end') {
        flush(id)
        return
      }
      const activity = harnessBuildActivity(event)
      if (!activity) return
      report?.(activity, {
        id: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
        tool: text(event.toolName),
        input: text(event.input),
        output: text(event.output ?? event.error),
      })
    },
  }
}

/**
 * 使用本轮凭据和服务端敏感环境变量做精确替换，再覆盖常见密钥、认证头与连接串。
 * 必须在截断之前过滤，不能把 JSON 或密钥切开后再尝试匹配。
 */
export function sanitizeBuildActivityDetail(detail: BuildActivityDetail, secrets: string[]): BuildActivityDetail {
  const sanitize = (value: string) => {
    let safe = value
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      safe = safe.split(secret).join('[已隐藏]')
      safe = safe.split(JSON.stringify(secret).slice(1, -1)).join('[已隐藏]')
    }
    safe = safe
      .replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+)\b/g, '[已隐藏]')
      .replace(/Bearer\s+[^\s"'\\]+/gi, 'Bearer [已隐藏]')
      .replace(
        /((?:[\w-]*(?:api[_-]?key|token|secret|password)|authorization)"?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi,
        '$1"[已隐藏]"',
      )
      .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s"']+/gi, '[连接信息已隐藏]')
      .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
    return safe.length > 24000 ? safe.slice(0, 24000) + '\n[内容过长，已截断]' : safe
  }
  return Object.fromEntries(
    ['id', 'tool', 'input', 'output', 'text'].flatMap((key) => {
      const value = detail[key as keyof BuildActivityDetail]
      return typeof value === 'string' ? [[key, sanitize(value)]] : []
    }),
  )
}

/** 只解析本功能写入的版本化详情；历史文案和任意原始事件不能作为详情展示。 */
export function readBuildActivityDetail(message?: string): BuildActivityDetail | undefined {
  if (!message?.startsWith('{')) return
  try {
    const value = JSON.parse(message)
    if (value.version !== 1 || !value.detail || typeof value.detail !== 'object') return
    return Object.fromEntries(
      ['id', 'tool', 'input', 'output', 'text'].flatMap((key) =>
        typeof value.detail[key] === 'string' ? [[key, value.detail[key]]] : [],
      ),
    )
  } catch {
    return
  }
}
