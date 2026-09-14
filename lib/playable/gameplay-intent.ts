import type { RequirementBrief } from './schemas'

/**
 * What the home page submits when the user attached references but typed
 * nothing. It is filler rather than a statement of intent, and treating it as
 * one would have the analyst report the video as diverging from "make a
 * playable from the references".
 */
export const ATTACHMENT_ONLY_PROMPT = '请根据上传的参考素材制作试玩'

/**
 * The user's stated intent, as compared against the reference video.
 *
 * Read from the brief because that is where intent settles: the task prompt
 * is only the opening sentence, often the placeholder above, while the brief
 * is rewritten in full every requirement turn. The result is also stored on
 * each analysis, so it doubles as the key for "has the intent changed since".
 */
export function deriveGameplayIntent(brief: RequirementBrief | null | undefined, prompt: string): string {
  const entries: Array<[string, string]> = brief
    ? [
        ['概述', brief.summary],
        ['玩法概念', brief.gameplay.concept],
        ['核心循环', brief.gameplay.coreLoop],
        ['操作', brief.gameplay.controls],
        ['目标', brief.gameplay.objective],
      ]
    : [['概述', prompt]]
  const seen = new Set<string>()
  const lines: string[] = []
  for (const [label, raw] of entries) {
    const value = raw.trim()
    // A brief seeded from the prompt repeats it in summary and concept.
    if (!value || value === ATTACHMENT_ONLY_PROMPT || seen.has(value)) continue
    seen.add(value)
    lines.push(`${label}：${value}`)
  }
  return lines.join('\n')
}
