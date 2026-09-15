// These source bridges already start the game without MRAID. Avoid calling their
// error-reporting channel check when taking that existing browser fallback.
export function applyTemplateBrowserCompatibility(html: string, templateId?: string | null): string {
  if (templateId !== 'dragon_reward_wheel' && templateId !== 'dragon_slots') return html
  const original = 'super_check_channel(window.mraid)?"loading"===mraid.getState()?'
  const replacement = '(window.mraid&&super_check_channel(window.mraid))?"loading"===mraid.getState()?'
  // Only recognize the original bridge, rather than rewriting arbitrary game code.
  if (!html.includes('window.super_html={download:function(a)') || html.split(original).length !== 2) return html
  return html.replace(original, replacement)
}
