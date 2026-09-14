/**
 * 提供方可能发送累计文本，也可能在工具执行后开始新段摘要。
 * 累计快照只更新最后一段，独立摘要追加；空值不能抹掉已收到的内容。
 */
export function mergeReasoning(previous: string | undefined, next: string | undefined): string | undefined {
  if (!next?.trim()) return previous
  if (!previous) return next
  if (next.startsWith(previous)) return next
  if (previous === next || previous.endsWith(next)) return previous
  const separator = '\n\n---\n\n'
  const split = previous.lastIndexOf(separator)
  const last = split < 0 ? previous : previous.slice(split + separator.length)
  if (next.startsWith(last)) return previous.slice(0, previous.length - last.length) + next
  if (last.startsWith(next)) return previous
  return previous + separator + next
}
