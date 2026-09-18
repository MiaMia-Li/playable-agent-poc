/** Inspect the self-contained GLB subset supported by upload, preview and bundling. */
export function inspectGlb(bytes) {
  const fail = () => {
    throw new Error('Invalid or unsupported self-contained GLB')
  }
  if (!(bytes instanceof Uint8Array) || bytes.length < 28) fail()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    fail()
  let document,
    binaryLength = 0,
    offset = 12,
    chunks = 0
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail()
    const length = view.getUint32(offset, true),
      type = view.getUint32(offset + 4, true)
    offset += 8
    if (length % 4 || offset + length > bytes.length) fail()
    if (chunks === 0 && type === 0x4e4f534a) {
      try {
        document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length)))
      } catch {
        fail()
      }
    } else if (chunks === 1 && type === 0x004e4942) binaryLength = length
    else fail()
    chunks++
    offset += length
  }
  if (
    !document ||
    (document.asset?.minVersion && document.asset.minVersion !== '2.0') ||
    document.asset?.version !== '2.0' ||
    !Array.isArray(document.meshes) ||
    !document.meshes.length
  )
    fail()
  // No decoder downloads or unsupported compressed textures in this first version.
  const supported = new Set([
    'KHR_materials_unlit',
    'KHR_materials_clearcoat',
    'KHR_materials_transmission',
    'KHR_materials_volume',
    'KHR_materials_ior',
    'KHR_materials_specular',
    'KHR_materials_sheen',
    'KHR_materials_iridescence',
    'KHR_materials_anisotropy',
    'KHR_materials_emissive_strength',
    'KHR_texture_transform',
    'KHR_mesh_quantization',
    'EXT_texture_webp',
    'EXT_mesh_gpu_instancing',
  ])
  if (
    document.extensionsRequired !== undefined &&
    (!Array.isArray(document.extensionsRequired) || document.extensionsRequired.some((x) => !supported.has(x)))
  )
    fail()
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (
        key === 'uri' &&
        (typeof item !== 'string' ||
          !/^data:(?:image\/(?:png|jpeg|webp)|application\/octet-stream);base64,[A-Za-z0-9+/]*={0,2}$/.test(item))
      )
        fail()
      if (['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(key)) fail()
      walk(item)
    }
  }
  walk(document)
  const integer = (x) => Number.isSafeInteger(x) && x >= 0
  const buffers = document.buffers
  if (
    !Array.isArray(buffers) ||
    buffers.length !== 1 ||
    buffers[0].uri !== undefined ||
    !integer(buffers[0].byteLength) ||
    buffers[0].byteLength > binaryLength ||
    binaryLength - buffers[0].byteLength > 3
  )
    fail()
  const views = document.bufferViews ?? [],
    accessors = document.accessors ?? []
  if (!Array.isArray(views) || !Array.isArray(accessors)) fail()
  for (const v of views) {
    if (
      v.buffer !== 0 ||
      !integer(v.byteOffset ?? 0) ||
      !integer(v.byteLength) ||
      (v.byteOffset ?? 0) + v.byteLength > buffers[0].byteLength
    )
      fail()
    if (
      v.byteStride !== undefined &&
      (!integer(v.byteStride) || v.byteStride < 4 || v.byteStride > 252 || v.byteStride % 4)
    )
      fail()
  }
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  for (const a of accessors) {
    const width = widths[a.type],
      size = sizes[a.componentType],
      v = views[a.bufferView]
    // Sparse accessors are intentionally outside the initial upload subset.
    if (!width || !size || !integer(a.count) || a.count === 0 || !v || a.sparse || !integer(a.byteOffset ?? 0)) fail()
    const stride = v.byteStride ?? width * size
    if (stride < width * size || (a.byteOffset ?? 0) + (a.count - 1) * stride + width * size > v.byteLength) fail()
  }
  let vertices = 0,
    triangles = 0
  for (const m of document.meshes) {
    if (!Array.isArray(m.primitives) || !m.primitives.length) fail()
    for (const p of m.primitives) {
      const position = accessors[p.attributes?.POSITION]
      if (!position || position.type !== 'VEC3') fail()
      for (const index of Object.values(p.attributes))
        if (!integer(index) || !accessors[index] || accessors[index].count !== position.count) fail()
      if (p.material !== undefined && (!integer(p.material) || !document.materials?.[p.material])) fail()
      if (p.mode !== undefined && (!integer(p.mode) || p.mode > 6)) fail()
      if (
        p.indices !== undefined &&
        (!integer(p.indices) ||
          !accessors[p.indices] ||
          accessors[p.indices].type !== 'SCALAR' ||
          ![5121, 5123, 5125].includes(accessors[p.indices].componentType))
      )
        fail()
      if (p.indices !== undefined) {
        const a = accessors[p.indices],
          v = views[a.bufferView]
        const binaryStart = bytes.length - binaryLength
        const read = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32' }[a.componentType]
        for (let i = 0; i < a.count; i++)
          if (
            view[read](
              binaryStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? sizes[a.componentType]),
              true,
            ) >= position.count
          )
            fail()
      }
      vertices += position.count
      const count = p.indices === undefined ? position.count : accessors[p.indices].count
      if ((p.mode ?? 4) === 4) triangles += Math.floor(count / 3)
      else if ([5, 6].includes(p.mode)) triangles += Math.max(0, count - 2)
    }
  }
  const images = document.images ?? []
  if (!Array.isArray(images)) fail()
  for (const im of images)
    if (!im.uri && (!views[im.bufferView] || !['image/png', 'image/jpeg', 'image/webp'].includes(im.mimeType))) fail()
  for (const texture of document.textures ?? []) {
    const source = texture.extensions?.EXT_texture_webp?.source ?? texture.source
    if (!integer(source) || !images[source]) fail()
  }
  if (!integer(document.scene ?? 0) || !document.scenes?.[document.scene ?? 0]) fail()
  const nodes = document.nodes ?? [],
    scenes = document.scenes ?? []
  if (!Array.isArray(nodes) || !nodes.length || !Array.isArray(scenes) || !scenes.length) fail()
  const visiting = new Set(),
    visited = new Set()
  const visit = (index) => {
    if (!integer(index) || !nodes[index] || visiting.has(index)) fail()
    if (visited.has(index)) return
    visiting.add(index)
    const node = nodes[index]
    if (node.mesh !== undefined && (!integer(node.mesh) || !document.meshes[node.mesh])) fail()
    if (node.children !== undefined && !Array.isArray(node.children)) fail()
    for (const child of node.children ?? []) visit(child)
    visiting.delete(index)
    visited.add(index)
  }
  for (const scene of scenes) {
    if (!Array.isArray(scene.nodes) || !scene.nodes.length) fail()
    for (const n of scene.nodes) visit(n)
  }
  return {
    format: 'glb',
    meshes: document.meshes.length,
    vertices,
    triangles,
    textures: images.length,
    animations: document.animations?.length ?? 0,
    animationClips: (document.animations ?? []).map((clip, index) => ({
      name: clip.name || `Animation ${index + 1}`,
      index,
    })),
    skins: document.skins?.length ?? 0,
    morphTargets: document.meshes.reduce(
      (total, mesh) =>
        total + mesh.primitives.reduce((count, primitive) => count + (primitive.targets?.length ?? 0), 0),
      0,
    ),
    selfContained: true,
  }
}
