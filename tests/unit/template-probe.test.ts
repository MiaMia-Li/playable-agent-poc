import { afterEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { readTemplateState, createTemplateProbe } = await import(
  pathToFileURL(path.resolve('skills/_shared/assets/starter/work/template-probe.mjs')).href
)
afterEach(() => vi.unstubAllGlobals())
it('reads native Laya state and calculates input coordinates without invoking handlers', async () => {
  const handler = vi.fn(),
    button = {
      name: 'SpinButton',
      width: 100,
      height: 50,
      visible: true,
      localToGlobal: () => ({ x: 180, y: 400 }),
      onClick: handler,
      _children: [],
    }
  vi.stubGlobal('document', { querySelector: () => ({ getBoundingClientRect: () => ({ width: 360, height: 640 }) }) })
  vi.stubGlobal('Laya', { Point: class {}, stage: { name: 'stage', width: 360, height: 640, _children: [button] } })
  vi.stubGlobal('__PLAYABLE__', { snapshot: () => ({ phase: 'ready', score: 0 }), audio: { muted: true } })
  const snapshot = await readTemplateState({ templateId: 'zeus_scatter' })
  expect(snapshot).toMatchObject({ engine: 'laya', ready: true, state: { phase: 'ready', score: 0, muted: true } })
  expect(snapshot.targets.find((t: { name: string }) => t.name === 'SpinButton')).toMatchObject({ x: 0.5, y: 0.625 })
  expect(handler).not.toHaveBeenCalled()
})
it('uses engine targets for real pointer input and refuses ambiguous names', async () => {
  const click = vi.fn(),
    state = { targets: [{ name: 'SpinButton', key: '/SpinButton', x: 0.5, y: 0.625 }] }
  const page = {
    evaluate: vi.fn(async () => state),
    locator: () => ({ first: () => ({ boundingBox: async () => ({ x: 10, y: 20, width: 360, height: 640 }) }) }),
    mouse: { click },
  }
  const probe = createTemplateProbe(page, 'zeus_scatter')
  await probe.click('spin')
  expect(click).toHaveBeenCalledWith(190, 420)
  state.targets.push({ ...state.targets[0] })
  await expect(probe.click('spin')).rejects.toThrow('ambiguous')
  expect(click).toHaveBeenCalledOnce()
})
it('bounds unavailable state waits and never invents success', async () => {
  const probe = createTemplateProbe({ evaluate: async () => ({ ready: false }) }, 'dragon_reward_wheel')
  await expect(probe.waitFor((s: { ready: boolean }) => s.ready, { timeout: 30, interval: 25 })).rejects.toThrow(
    'timed out',
  )
  const stalled = createTemplateProbe({ evaluate: () => new Promise(() => {}) }, 'dragon_reward_wheel')
  await expect(stalled.waitFor(() => true, { timeout: 30 })).rejects.toThrow('timed out')
})

it('reads Cocos world bounds and excludes inactive native controls', async () => {
  const button = {
    name: 'start_btn',
    active: true,
    children: [],
    getComponent: () => ({ getBoundingBoxToWorld: () => ({ x: 120, y: 200, width: 120, height: 80 }) }),
  }
  const hidden = { ...button, name: 'hidden', active: false }
  const root = { name: 'Canvas', children: [button, hidden], components: [{ m_bGameEnd: false, m_iStep: 2 }] }
  vi.stubGlobal('document', { querySelector: () => ({ getBoundingClientRect: () => ({ width: 360, height: 640 }) }) })
  vi.stubGlobal('cc', {
    UITransform: class {},
    director: { getScene: () => root },
    view: { getVisibleSize: () => ({ width: 360, height: 640 }), getVisibleOrigin: () => ({ x: 0, y: 0 }) },
  })
  const snapshot = await readTemplateState({ templateId: 'dragon_reward_wheel' })
  expect(snapshot.engine).toBe('cocos')
  expect(snapshot.targets).toEqual([expect.objectContaining({ name: 'start_btn', x: 0.5, y: 0.625 })])
  expect(snapshot.nodes[0].components).toEqual([{ m_bGameEnd: false, m_iStep: 2 }])
})
