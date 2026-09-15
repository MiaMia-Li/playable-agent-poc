// Runs inside the page. Never calls gameplay handlers, changes timers or writes engine state.
export async function readTemplateState({ templateId } = {}) {
  const safeScalar = (value) =>
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length < 160) ||
    (typeof value === 'number' && Number.isFinite(value))
  const select = (object) => {
    const result = {}
    for (const key of [
      'phase',
      'state',
      'score',
      'matches',
      'spins',
      'progress',
      'result',
      'ended',
      'muted',
      'intro',
      'm_bGameEnd',
      'm_bClick',
      'm_iStep',
      'iRoundNum',
      'isSpinning',
      'remainingSpins',
      'currentState',
    ]) {
      try {
        if (safeScalar(object?.[key])) result[key] = object[key]
      } catch {
        /* Unavailable state remains absent. */
      }
    }
    return result
  }
  const game = globalThis.__PLAYABLE__
  let contract = game
  if (typeof game?.snapshot === 'function') contract = game.snapshot()
  const state = select(contract)
  if (typeof game?.audio?.muted === 'boolean') state.muted = game.audio.muted
  const nodes = [],
    targets = []
  let engine = game ? 'contract' : 'unknown',
    root,
    cocos
  if (globalThis.Laya?.stage) {
    engine = 'laya'
    root = globalThis.Laya.stage
  } else {
    cocos = globalThis.cc
    if (!cocos && globalThis.System?.import) {
      try {
        cocos = await globalThis.System.import('cc')
      } catch {
        /* Not a Cocos page. */
      }
    }
    if (cocos?.director?.getScene) {
      root = cocos.director.getScene()
      engine = 'cocos'
    }
  }
  const canvas = document.querySelector('canvas'),
    viewport = canvas?.getBoundingClientRect()
  const stack = root ? [{ node: root, parent: '', active: true }] : []
  const seen = new Set()
  while (stack.length && nodes.length < 2000) {
    const { node, parent, active: parentActive } = stack.pop()
    if (!node || seen.has(node)) continue
    seen.add(node)
    const name = String(node.name ?? '').slice(0, 120),
      key = parent + '/' + name
    const active = parentActive && node.active !== false && node.visible !== false && node.activeInHierarchy !== false
    const item = { name, key, active, state: select(node) }
    const components = node.components ?? node._components ?? []
    item.components = Array.from(components)
      .slice(0, 20)
      .map((component) => select(component))
      .filter((value) => Object.keys(value).length)
    nodes.push(item)
    if (active && viewport?.width && viewport?.height) {
      let box
      try {
        if (engine === 'cocos') {
          const transform = node.getComponent?.(cocos.UITransform),
            size = cocos.view.getVisibleSize(),
            origin = cocos.view.getVisibleOrigin()
          const bounds = transform?.getBoundingBoxToWorld()
          if (bounds && size.width && size.height)
            box = {
              x: (bounds.x + bounds.width / 2 - origin.x) / size.width,
              y: 1 - (bounds.y + bounds.height / 2 - origin.y) / size.height,
              width: bounds.width / size.width,
              height: bounds.height / size.height,
            }
        } else if (engine === 'laya' && node.width > 0 && node.height > 0) {
          const point = node.localToGlobal(new globalThis.Laya.Point(node.width / 2, node.height / 2))
          box = {
            x: point.x / root.width,
            y: point.y / root.height,
            width: node.width / root.width,
            height: node.height / root.height,
          }
        }
      } catch {
        /* Do not guess a target if engine bounds are unavailable. */
      }
      if (
        box &&
        Object.values(box).every(Number.isFinite) &&
        box.width > 0 &&
        box.height > 0 &&
        box.x >= 0 &&
        box.x <= 1 &&
        box.y >= 0 &&
        box.y <= 1
      )
        targets.push({ name, key, ...box })
    }
    const children = node.children ?? node._children ?? []
    for (const child of children) stack.push({ node: child, parent: key, active })
  }
  return {
    version: 1,
    templateId: templateId ?? null,
    engine,
    ready: Boolean(game || root) && Boolean(canvas),
    state,
    nodes,
    targets,
    truncated: stack.length > 0,
  }
}
const defaultTargets = {
  dragon_reward_wheel: { start: 'start_btn', collect: 'Node_collect' },
  dragon_slots: { spin: 'btn_start' },
  zeus_scatter: { spin: 'SpinButton', collect: 'CollectButton' },
  balloon_master: { download: 'DownloadButton' },
}
export function createTemplateProbe(page, templateId) {
  const snapshot = async (timeout = 3000) => {
    let timer
    try {
      return await Promise.race([
        page.evaluate(readTemplateState, { templateId }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Template probe timed out')), timeout)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    snapshot,
    async waitFor(predicate, { timeout = 10000, interval = 100 } = {}) {
      if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30000 || !Number.isFinite(interval) || interval < 25)
        throw new Error('Invalid probe wait')
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const state = await snapshot(Math.min(3000, Math.max(1, deadline - Date.now())))
        if (predicate(state)) return state
        await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))))
      }
      throw new Error('Template state wait timed out')
    },
    async click(name) {
      const current = await snapshot(),
        requested = defaultTargets[templateId]?.[name] ?? name
      const matches = current.targets.filter((target) => target.name === requested || target.key === requested)
      if (matches.length !== 1) throw new Error('Template target missing or ambiguous')
      const box = await page.locator('canvas').first().boundingBox()
      if (!box) throw new Error('Template canvas unavailable')
      const target = matches[0]
      await page.mouse.click(box.x + box.width * target.x, box.y + box.height * target.y)
    },
  }
}
