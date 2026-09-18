'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { inspectGlb } from '@/lib/playable/glb'

/** Loaded only when the user opens a model, so image lists do not allocate WebGL contexts. */
export default function ModelPreview({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null)
  const animation = useRef<{ select: (index: number) => void; pause: (paused: boolean) => void } | null>(null)
  const [clips, setClips] = useState<string[]>([])
  const [selected, setSelected] = useState('-1')
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState('正在加载模型…')
  useEffect(() => {
    const container = host.current
    if (!container) return
    const abort = new AbortController()
    let dispose: (() => void) | undefined
    void (async () => {
      const [THREE, { GLTFLoader }, { OrbitControls }, response] = await Promise.all([
        import('three'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/controls/OrbitControls.js'),
        fetch(url, { signal: abort.signal }),
      ])
      if (!response.ok) throw new Error('Model unavailable')
      const buffer = await response.arrayBuffer()
      const info = inspectGlb(new Uint8Array(buffer))
      if (abort.signal.aborted) return
      const manager = new THREE.LoadingManager()
      manager.setURLModifier((resource) => {
        if (!resource.startsWith('blob:') && !resource.startsWith('data:')) throw new Error('External model resource')
        return resource
      })
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, '')
      const releaseModel = () => {
        const textures = new Set<import('three').Texture>()
        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          object.geometry.dispose()
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
            material.dispose()
          }
        })
        for (const texture of textures) {
          texture.dispose()
          if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close()
        }
      }
      dispose = releaseModel
      if (abort.signal.aborted) {
        releaseModel()
        return
      }
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0xe8edf4)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x657084, 2.4))
      const light = new THREE.DirectionalLight(0xffffff, 3)
      light.position.set(3, 5, 4)
      scene.add(light)
      const bounds = new THREE.Box3().setFromObject(gltf.scene)
      const size = bounds.getSize(new THREE.Vector3())
      const radius = Math.max(size.length() / 2, 0.01)
      // Frame through a parent so root-motion animation never overwrites centering.
      const modelRoot = new THREE.Group()
      modelRoot.add(gltf.scene)
      modelRoot.position.copy(bounds.getCenter(new THREE.Vector3())).negate()
      scene.add(modelRoot)
      const mixer = new THREE.AnimationMixer(gltf.scene)
      const clock = new THREE.Clock()
      animation.current = {
        select: (index) => {
          mixer.stopAllAction()
          if (index >= 0 && gltf.animations[index]) mixer.clipAction(gltf.animations[index]).reset().play()
        },
        pause: (value) => {
          mixer.timeScale = value ? 0 : 1
        },
      }
      setClips(gltf.animations.map((clip, index) => clip.name || `动画 ${index + 1}`))
      setSelected('-1')
      setPaused(false)
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 100)
      camera.position.set(radius * 1.7, radius, radius * 2.7)
      container.appendChild(renderer.domElement)
      renderer.domElement.setAttribute('aria-label', '拖动旋转模型，滚轮缩放')
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.minDistance = radius * 0.3
      controls.maxDistance = radius * 10
      const resize = new ResizeObserver(() => {
        const width = container.clientWidth,
          height = container.clientHeight
        if (!width || !height) return
        renderer.setSize(width, height)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      })
      resize.observe(container)
      renderer.setAnimationLoop(() => {
        mixer.update(Math.min(clock.getDelta(), 0.1))
        controls.update()
        renderer.render(scene, camera)
      })
      dispose = () => {
        resize.disconnect()
        renderer.setAnimationLoop(null)
        controls.dispose()
        mixer.stopAllAction()
        mixer.uncacheRoot(gltf.scene)
        animation.current = null
        releaseModel()
        renderer.dispose()
        renderer.forceContextLoss()
        renderer.domElement.remove()
      }
      setStatus(
        `${info.meshes} 个网格 · ${info.triangles.toLocaleString()} 个三角面 · ${info.textures} 张贴图。拖动旋转，滚轮缩放。`,
      )
    })().catch(() => {
      dispose?.()
      if (!abort.signal.aborted) setStatus('模型预览失败，请检查模型文件或浏览器 WebGL 支持。')
    })
    return () => {
      abort.abort()
      dispose?.()
    }
  }, [url])
  return (
    <div>
      {clips.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Select
            value={selected}
            onValueChange={(value) => {
              setSelected(value)
              animation.current?.select(Number(value))
            }}
          >
            <SelectTrigger aria-label="模型动画">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="-1">默认姿态</SelectItem>
              {clips.map((name, index) => (
                <SelectItem key={index} value={String(index)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            type="button"
            disabled={selected === '-1'}
            onClick={() => {
              setPaused(!paused)
              animation.current?.pause(!paused)
            }}
          >
            {paused ? '播放' : '暂停'}
          </Button>
        </div>
      )}
      <div ref={host} className="h-80 w-full overflow-hidden rounded-md" />
      <p role="status" className="text-muted-foreground mt-2 text-xs">
        {status}
      </p>
    </div>
  )
}
