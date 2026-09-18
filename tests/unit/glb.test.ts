import { AnimationMixer, SkinnedMesh } from 'three'
import { expect, it } from 'vitest'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { inspectGlb } from '@/lib/playable/glb'
import { attachmentSlotForFile, playableAssetAccept, playableFileMimeType } from '@/lib/playable/asset-policy'
import { buildAssetManifestEntry } from '@/lib/playable/production-contract'
import { animatedSceneGlb, skinnedMorphGlb, triangleGlb } from '../fixtures/glb'

it('accepts a GLB that Three.js can actually load, and describes the original mesh in the build manifest', async () => {
  const bytes = triangleGlb()
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
  expect(gltf.scene.children).toHaveLength(1)
  expect(inspectGlb(bytes)).toMatchObject({ meshes: 1, vertices: 3, triangles: 1, selfContained: true })
  const entry = buildAssetManifestEntry(
    {
      id: 'model-1',
      slot: 'tileFaces',
      filename: 'block.glb',
      mimeType: 'model/gltf-binary',
      size: bytes.length,
      bytes,
    },
    'user-assets/tileFaces/model-1-block.glb',
  )
  expect(entry).toMatchObject({
    workspacePath: 'user-assets/tileFaces/model-1-block.glb',
    model: { format: 'glb', triangles: 1 },
  })
  expect(entry).not.toHaveProperty('bytes')
})

it.each(['', 'application/octet-stream', 'model/gltf-binary'])(
  'routes browser GLB MIME %s to resource assets, not reference images',
  (type) => {
    expect(playableFileMimeType({ name: 'character.GLB', type })).toBe('model/gltf-binary')
    expect(attachmentSlotForFile({ name: 'character.GLB', type })).toBe('models')
    expect(playableAssetAccept('backgroundBoard')).toContain('.glb')
    expect(playableAssetAccept('referenceImage')).not.toContain('.glb')
  },
)

it('refuses corrupt containers, out-of-bounds buffers, cycles and resources requiring network or decoders', () => {
  expect(() => inspectGlb(new Uint8Array([1, 2, 3]))).toThrow()
  const mutations = [
    (d: any) => {
      d.images = [{ uri: 'https://example.com/texture.png' }]
    },
    (d: any) => {
      d.images = [{ uri: '../texture.png' }]
    },
    (d: any) => {
      d.buffers[0].uri = 'file:///secret.bin'
    },
    (d: any) => {
      d.bufferViews[0].byteLength = 10000
    },
    (d: any) => {
      d.accessors[0].count = 10000
    },
    (d: any) => {
      d.nodes[0].children = [0]
    },
    (d: any) => {
      d.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: {} }
    },
    (d: any) => {
      d.extensionsRequired = ['EXT_meshopt_compression']
    },
  ]
  for (const mutation of mutations) expect(() => inspectGlb(triangleGlb(mutation))).toThrow()
})

it('preserves a generic scene hierarchy and actual authored animation through the model pipeline', async () => {
  const bytes = animatedSceneGlb()
  const entry = buildAssetManifestEntry(
    { id: 'actor', slot: 'models', filename: 'actor.glb', mimeType: 'model/gltf-binary', bytes, size: bytes.length },
    'user-assets/models/actor.glb',
  )
  expect(entry).toMatchObject({
    slot: 'models',
    model: { animationClips: [{ name: 'Travel', index: 0 }], animations: 1 },
  })
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
  expect(gltf.scene.getObjectByName('SceneRoot')?.children[0].name).toBe('Actor')
  const mixer = new AnimationMixer(gltf.scene)
  mixer.clipAction(gltf.animations[0]).play()
  mixer.update(0.5)
  expect(gltf.scene.getObjectByName('Actor')?.position.x).toBeCloseTo(1)
  mixer.stopAllAction()
  expect(gltf.scene.getObjectByName('Actor')?.position.x).toBeCloseTo(0)
})

it('keeps skeletons and morph-target animation usable for arbitrary character assets', async () => {
  const bytes = skinnedMorphGlb()
  expect(inspectGlb(bytes)).toMatchObject({
    skins: 1,
    morphTargets: 1,
    animationClips: [{ name: 'Expression', index: 0 }],
  })
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
  const character = gltf.scene.getObjectByName('Character') as SkinnedMesh
  expect(character.isSkinnedMesh).toBe(true)
  expect(character.skeleton.bones[0].name).toBe('Joint')
  const mixer = new AnimationMixer(gltf.scene)
  mixer.clipAction(gltf.animations[0]).play()
  mixer.update(0.5)
  expect(character.morphTargetInfluences?.[0]).toBeCloseTo(0.5)
})
