/** 兼容字符串、序列化错误和 SDK 的多层包装；提取内容仅供内部分类，不直接展示给用户。 */
export function codexErrorDetails(error: unknown): { text: string; statuses: number[]; names: string[] } {
  const messages: string[] = []
  const statuses: number[] = []
  const names: string[] = []
  const seen = new Set<unknown>()
  const pending = [error]
  // 错误链可能循环引用或异常嵌套，去重并限制遍历数量，避免错误处理本身卡住。
  while (pending.length && seen.size < 32) {
    const current = pending.shift()
    if (current == null || seen.has(current)) continue
    seen.add(current)
    if (typeof current === 'string') {
      messages.push(current)
      continue
    }
    if (typeof current !== 'object') continue
    const value = current as Record<string, unknown>
    for (const key of ['message', 'code', 'responseBody']) {
      if (typeof value[key] === 'string') messages.push(value[key])
    }
    if (typeof value.name === 'string') names.push(value.name)
    for (const key of ['status', 'statusCode']) {
      if (typeof value[key] === 'number') statuses.push(value[key])
    }
    pending.push(value.cause, value.lastError, value.error, value.response)
  }
  const text = messages.join('\n').toLowerCase()
  // Codex CLI 可能只保留 HTTP 状态的文本；恢复状态码，避免把包在断流文案里的
  // 400/401/403/404 等请求或权限错误误判为可以重试的连接故障。
  for (const match of text.matchAll(
    /(?:unexpected status(?: code)?|http(?:\/\d(?:\.\d)?)?|status(?: code)?)[\s:=]+(\d{3})\b/g,
  ))
    statuses.push(Number(match[1]))
  return { text, statuses, names }
}

export type CodexFailureKind = 'cancelled' | 'quota' | 'auth' | 'capacity' | 'rate_limit' | 'connection' | 'other'

/** 先识别取消及需要人工处理的错误，再匹配外层断流文案，防止无效重试掩盖真正原因。 */
export function classifyCodexFailure(error: unknown): CodexFailureKind {
  const { text, statuses, names } = codexErrorDetails(error)
  if (names.some((name) => name === 'AbortError' || name === 'TimeoutError')) return 'cancelled'
  if (
    statuses.includes(402) ||
    /no credits remaining|insufficient[_ ]quota|exceeded your current quota|quota exceeded|usage limit|usage_limit_reached|billing|credit balance/.test(
      text,
    )
  )
    return 'quota'
  if (
    statuses.some((status) => status === 401 || status === 403) ||
    /invalid[_ ]api[_ ]key|incorrect api key|model access|unauthorized|forbidden|authentication|permission denied/.test(
      text,
    )
  )
    return 'auth'
  if (
    statuses.some((status) => status === 400 || status === 404 || status === 422) ||
    /context[_ ](?:length|window)|model_not_found|invalid[_ ]request|unsupported model|does not exist/.test(text)
  )
    return 'other'
  if (
    /(?:model|server)[^\n]*\b(?:at capacity|overloaded)|overloaded_error|model_capacity_exceeded|server_overloaded|service unavailable/.test(
      text,
    ) ||
    statuses.includes(503)
  )
    return 'capacity'
  if (statuses.includes(429) || /rate[_ ]limit|too many requests|slow_down/.test(text)) return 'rate_limit'
  if (
    statuses.some((status) => [408, 500, 502, 504].includes(status)) ||
    /stream disconnected before completion|stream closed before|bridge closed before|connection (?:reset|closed)|network error|error sending request|dns error|econnreset|etimedout|timed out|idle timeout|internal server error|bad gateway|gateway timeout/.test(
      text,
    )
  )
    return 'connection'
  return 'other'
}

/** 通知只描述执行中的状态；即使提到容量不足，也要由本轮终态决定是否失败。 */
export function codexNoticeActivity(message: string) {
  if (/^reconnecting(?:\.{3}|…)/i.test(message)) return 'agent_reconnecting' as const
  if (/^falling back from websockets to https transport\b/i.test(message)) return 'agent_transport_fallback' as const
  if (/^retrying\b|^previous response was not found\. retrying the full request\./i.test(message))
    return 'agent_retrying' as const
  return 'agent_warning' as const
}
