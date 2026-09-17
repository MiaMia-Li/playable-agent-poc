// Installed by the host before game code. Evidence comes from browser/engine calls,
// never from the game's __PLAYABLE__ success flags.
export function installRuntimeEvidence(key) {
  let visibleCanvas = false
  let draws = 0,
    steps = 0,
    contacts = 0,
    wasm = false,
    inputs = 0
  const pixels = new Set()
  addEventListener(
    'pointerdown',
    () => {
      inputs++
    },
    true,
  )
  for (const Type of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!Type) continue
    for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = Type.prototype[method]
      if (!original) continue
      Type.prototype[method] = function (...args) {
        const result = original.apply(this, args)
        if (this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
          const rect = this.canvas.getBoundingClientRect(),
            style = getComputedStyle(this.canvas)
          visibleCanvas ||=
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.opacity !== '0'
          draws++
          if (pixels.size < 2) {
            const pixel = new Uint8Array(4)
            for (const x of [0.25, 0.5, 0.75])
              for (const y of [0.25, 0.5, 0.75]) {
                this.readPixels(
                  Math.floor(this.drawingBufferWidth * x),
                  Math.floor(this.drawingBufferHeight * y),
                  1,
                  1,
                  this.RGBA,
                  this.UNSIGNED_BYTE,
                  pixel,
                )
                pixels.add(Array.from(pixel).join(','))
              }
          }
        }
        return result
      }
    }
  }
  const wrap = (instance) => {
    const raw = instance.exports
    if (!raw.rawphysicspipeline_step && !raw.rawphysicspipeline_stepWithEvents) return instance
    wasm = true
    const exports = Object.fromEntries(
      Object.entries(raw).map(([name, value]) => [
        name,
        typeof value !== 'function'
          ? value
          : (...args) => {
              const result = value(...args)
              if (name === 'rawphysicspipeline_step' || name === 'rawphysicspipeline_stepWithEvents') steps++
              if (inputs && /^rawcontactmanifold_num_(?:solver_)?contacts$/.test(name) && result > 0) contacts++
              return result
            },
      ]),
    )
    return new Proxy(instance, {
      get(target, property) {
        return property === 'exports' ? exports : Reflect.get(target, property, target)
      },
    })
  }
  for (const method of ['instantiate', 'instantiateStreaming']) {
    const original = WebAssembly[method]
    if (!original) continue
    WebAssembly[method] = async function (...args) {
      const result = await original.apply(WebAssembly, args)
      return result instanceof WebAssembly.Instance ? wrap(result) : { ...result, instance: wrap(result.instance) }
    }
  }
  Object.defineProperty(globalThis, key, {
    value: () => ({
      draws,
      steps,
      contacts,
      wasm,
      inputs,
      variedPixels: pixels.size > 1,
      three: globalThis.__THREE__ === '165',
      visibleCanvas,
    }),
  })
}

export function runtimeEvidenceChecks(decision, evidence) {
  if (decision?.renderer !== 'threejs') return []
  return [
    [
      'Confirmed Three.js rendered visible WebGL geometry',
      Boolean(evidence?.three && evidence.draws > 0 && evidence.visibleCanvas && evidence.variedPixels),
    ],
    ...(decision.physics === 'rapier'
      ? [
          [
            'Confirmed Rapier WASM stepped and reported contacts after input',
            Boolean(evidence?.wasm && evidence.steps > 1 && evidence.inputs > 0 && evidence.contacts > 0),
          ],
        ]
      : []),
  ]
}
