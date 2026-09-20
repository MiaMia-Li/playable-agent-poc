import { expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import {
  attachmentSlotForFile,
  isMimeTypeAllowedForSlot,
  playableAssetAccept,
  PLAYABLE_ATTACHMENT_ACCEPT,
  referenceSlotForMimeType,
  SVG_MIME_TYPE,
} from '@/lib/playable/asset-policy'
import { importedResourcePaths } from '@/lib/playable/task-imports'

const { JSDOM } = await import(pathToFileURL(createRequire(import.meta.url).resolve('jsdom')).href)
const { mountSvgBackground } = await import(
  pathToFileURL(path.resolve('skills/_shared/assets/starter/work/svg-animation.mjs')).href
)
const source = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')

it('routes SVG uploads to playable resources without offering them to vision analysis', () => {
  for (const type of ['', 'application/octet-stream', SVG_MIME_TYPE]) {
    expect(attachmentSlotForFile({ name: 'water.SVG', type })).toBe('animationEffects')
  }
  expect(referenceSlotForMimeType(SVG_MIME_TYPE)).toBeUndefined()
  expect(isMimeTypeAllowedForSlot('referenceImage', SVG_MIME_TYPE)).toBe(false)
  for (const slot of ['backgroundBoard', 'animationEffects', 'tileFaces', 'endCard'] as const) {
    expect(playableAssetAccept(slot)).toContain(SVG_MIME_TYPE)
  }
  expect(PLAYABLE_ATTACHMENT_ACCEPT).toContain('.svg')
  expect(
    importedResourcePaths(
      [
        {
          assetId: 'a',
          filename: 'pack.zip',
          root: 'user-imports/a',
          htmlCandidates: [],
          files: [{ path: 'water.svg', size: 20 }],
          spine: [],
          issues: [],
        },
      ],
      'backgroundBoard',
    ),
  ).toEqual(['user-imports/a/water.svg'])
})

it('keeps one SVG source alive on resize and removes listeners on teardown', () => {
  const dom = new JSDOM('<div id="game"><canvas></canvas></div>')
  const container = dom.window.document.getElementById('game')!
  const background = mountSvgBackground({ container, source })
  const setSource = vi.spyOn(background.element, 'src', 'set')
  const original = background.element.src
  dom.window.dispatchEvent(new dom.window.Event('resize'))
  expect(background.element.src).toBe(original)
  expect(setSource).not.toHaveBeenCalled()
  expect(container.firstChild).toBe(background.element)
  expect(background.element.style.pointerEvents).toBe('none')
  expect(background.element.style.objectFit).toBe('cover')
  expect(container.querySelectorAll('canvas')).toHaveLength(1)
  background.destroy()
  expect(container.querySelector('img')).toBeNull()
  dom.window.close()
})

it('chooses supplied compositions using container orientation and observes container resizing', () => {
  const dom = new JSDOM('<div id="game"></div>')
  const container = dom.window.document.getElementById('game')!
  let size = { width: 360, height: 640 }
  container.getBoundingClientRect = () => size
  let resize = () => {}
  const disconnect = vi.fn()
  dom.window.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback
    }
    observe = vi.fn()
    disconnect = disconnect
  }
  const landscapeSource = source + ' '
  const layer = mountSvgBackground({ container, portraitSource: source, landscapeSource })
  expect(layer.element.getAttribute('src')).toBe(source)
  size = { width: 640, height: 360 }
  resize()
  expect(layer.element.getAttribute('src')).toBe(landscapeSource)
  size = { width: 360, height: 640 }
  resize()
  expect(layer.element.getAttribute('src')).toBe(source)
  layer.destroy()
  expect(disconnect).toHaveBeenCalledOnce()
  dom.window.close()
})

it('rejects active documents and remote sources', () => {
  const dom = new JSDOM('<div></div>')
  const container = dom.window.document.querySelector('div')
  for (const source of ['https://example.com/water.svg', 'data:text/html,<script/>', '<svg/>']) {
    expect(() => mountSvgBackground({ container, source })).toThrow('data URLs')
  }
  expect(() => mountSvgBackground({ container, portraitSource: source })).toThrow('both orientation')
  dom.window.close()
})
