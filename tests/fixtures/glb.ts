/** A real self-contained triangle GLB, independent of user-uploaded artifacts. */
export function triangleGlb(
  edit?: (document: Record<string, any>) => void,
  data = [-1, 0, 0, 1, 0, 0, 0, 1, 0],
): Uint8Array<ArrayBuffer> {
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: data.length * 4 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  }
  edit?.(document)
  const json = new TextEncoder().encode(JSON.stringify(document))
  const length = Math.ceil(json.length / 4) * 4
  const bytes = new Uint8Array(28 + length + data.length * 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.length, true)
  view.setUint32(12, length, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.fill(32, 20, 20 + length)
  bytes.set(json, 20)
  view.setUint32(20 + length, data.length * 4, true)
  view.setUint32(24 + length, 0x004e4942, true)
  data.forEach((value, i) => view.setFloat32(28 + length + i * 4, value, true))
  return bytes
}

/** Generic animated scene with hierarchy and authored translation, unrelated to a game template. */
export function animatedSceneGlb(): Uint8Array<ArrayBuffer> {
  return triangleGlb(
    (document) => {
      document.nodes = [
        { name: 'SceneRoot', children: [1] },
        { name: 'Actor', mesh: 0 },
      ]
      document.bufferViews.push(
        { buffer: 0, byteOffset: 36, byteLength: 8 },
        { buffer: 0, byteOffset: 44, byteLength: 24 },
      )
      document.accessors.push(
        { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
        { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
      )
      document.animations = [
        {
          name: 'Travel',
          samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
          channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
        },
      ]
    },
    [-1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2, 0, 0],
  )
}

/** Skinned character-like asset with a morph animation, without any game-specific semantics. */
export function skinnedMorphGlb(): Uint8Array<ArrayBuffer> {
  return triangleGlb(
    (document) => {
      document.nodes = [{ name: 'Root', children: [1, 2] }, { name: 'Character', mesh: 0, skin: 0 }, { name: 'Joint' }]
      document.skins = [{ joints: [2], skeleton: 2 }]
      document.bufferViews.push(
        { buffer: 0, byteOffset: 36, byteLength: 24 },
        { buffer: 0, byteOffset: 60, byteLength: 48 },
        { buffer: 0, byteOffset: 108, byteLength: 36 },
        { buffer: 0, byteOffset: 144, byteLength: 8 },
        { buffer: 0, byteOffset: 152, byteLength: 8 },
      )
      document.accessors.push(
        { bufferView: 1, componentType: 5123, count: 3, type: 'VEC4' },
        { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
        { bufferView: 3, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0.5, 0], max: [0, 0.5, 0] },
        { bufferView: 4, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
        { bufferView: 5, componentType: 5126, count: 2, type: 'SCALAR' },
      )
      document.meshes[0].primitives[0].attributes = { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }
      document.meshes[0].primitives[0].targets = [{ POSITION: 3 }]
      document.meshes[0].weights = [0]
      document.animations = [
        {
          name: 'Expression',
          samplers: [{ input: 4, output: 5 }],
          channels: [{ sampler: 0, target: { node: 1, path: 'weights' } }],
        },
      ]
    },
    [
      -1,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
      ...Array(6).fill(0),
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0.5,
      0,
      0,
      0.5,
      0,
      0,
      0.5,
      0,
      0,
      1,
      0,
      1,
    ],
  )
}
