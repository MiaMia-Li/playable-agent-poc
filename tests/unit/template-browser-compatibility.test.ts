import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { applyTemplateBrowserCompatibility } from '@/lib/playable/template-browser-compatibility'

describe.each(['dragon_reward_wheel', 'dragon_slots'])('%s browser bridge', (templateId) => {
  const html = readFileSync(
    `skills/${templateId.replaceAll('_', '-')}-playable/assets/templates/${templateId}/source.html`,
    'utf8',
  )
  const patched = applyTemplateBrowserCompatibility(html, templateId)
  function load(mraid?: object) {
    const start = vi.fn()
    const check = vi.fn((sdk) => Boolean(sdk))
    const context = vm.createContext({
      mraid,
      super_boot_engine: start,
      super_log: vi.fn(),
      super_check_channel: check,
    })
    context.window = context
    const begin = patched.indexOf('function onSdkReady()')
    const end = patched.indexOf('window.__zip', begin)
    vm.runInContext(patched.slice(begin, end), context, { timeout: 1000 })
    return { start, check, ready: () => context.super_html.game_ready() }
  }
  it('uses the existing browser fallback without the missing-platform check and starts only once', () => {
    const { start, check, ready } = load()
    ready()
    ready()
    expect(start).toHaveBeenCalledOnce()
    expect(check).not.toHaveBeenCalled()
    expect(applyTemplateBrowserCompatibility(patched, templateId)).toBe(patched)
    expect(applyTemplateBrowserCompatibility(html, 'zeus_scatter')).toBe(html)
  })
  it('retains SDK ready and viewability gating', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const sdk = {
      getState: () => 'loading',
      isViewable: () => false,
      addEventListener: (name: string, fn: (...args: unknown[]) => void) => listeners.set(name, fn),
    }
    const { start, check, ready } = load(sdk)
    ready()
    expect(check).toHaveBeenCalledWith(sdk)
    expect(start).not.toHaveBeenCalled()
    listeners.get('ready')!()
    expect(start).not.toHaveBeenCalled()
    listeners.get('viewableChange')!(true)
    expect(start).toHaveBeenCalledOnce()
  })
})
