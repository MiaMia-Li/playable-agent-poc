import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { extractAssetArchive, safeImportPath, packageHtmlEntry } from '@/lib/playable/asset-archive'
import { inspectSpineGroups } from '@/lib/playable/spine-assets'
import {
  MAX_HTML_BYTES,
  MAX_ARCHIVE_BYTES,
  MAX_FORM_UPLOAD_BYTES,
  maxAssetBytesForSlot,
  playableFileMimeType,
} from '@/lib/playable/asset-policy'
import { spineJson, spineAtlas, spinePng, zipFiles } from '../fixtures/imported-assets'
import { attachImportedManifest } from '@/lib/playable/task-imports'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import type { PlayableAssetManifest } from '@/lib/playable/playable-agent-adapter'

const spineFiles = [
  { path: 'hero.json', bytes: Buffer.from(spineJson) },
  { path: 'hero.atlas', bytes: Buffer.from(spineAtlas) },
  { path: 'hero.png', bytes: spinePng },
]

describe('asset package ingestion', () => {
  it('raises only HTML, packages and Spine while retaining the direct-upload threshold', () => {
    expect(maxAssetBytesForSlot('sourceHtml')).toBe(MAX_HTML_BYTES)
    expect(maxAssetBytesForSlot('assetPackage')).toBe(MAX_ARCHIVE_BYTES)
    expect(maxAssetBytesForSlot('spine')).toBe(100 * 1024 * 1024)
    expect(MAX_FORM_UPLOAD_BYTES).toBe(4 * 1024 * 1024)
    expect(maxAssetBytesForSlot('referenceImage')).toBe(4 * 1024 * 1024)
    expect(playableFileMimeType({ name: 'game.rar', type: 'application/x-rar-compressed' })).toBe('application/vnd.rar')
  })
  it('preserves ZIP paths and detects the nested HTML entrypoint', async () => {
    const files = await extractAssetArchive(
      await zipFiles({ 'game/index.html': '<html>Game</html>', 'game/images/hero.png': spinePng }),
      'application/zip',
    )
    expect(files.map((file) => file.path)).toEqual(['game/index.html', 'game/images/hero.png'])
    expect(packageHtmlEntry(files)).toBe('game/index.html')
  })
  it('extracts a real RAR archive with folders', async () => {
    const files = await extractAssetArchive(
      await readFile('tests/fixtures/archives/folders.rar'),
      'application/vnd.rar',
    )
    expect(files.length).toBeGreaterThan(0)
    expect(files.some((file) => file.path.includes('/'))).toBe(true)
  })
  it.each(['../escape', '/root/file', 'folder/../../file', 'C:/file', 'folder\\file'])(
    'rejects unsafe paths: %s',
    (value) => {
      expect(() => safeImportPath(value)).toThrow()
    },
  )
  it('rejects duplicate and oversized ZIP entries before extraction', async () => {
    const zip = Buffer.from(await zipFiles({ 'a.txt': 'a', 'A.txt': 'b' }))
    await expect(extractAssetArchive(zip, 'application/zip')).rejects.toThrow()
    const oversized = Buffer.from(await zipFiles({ 'large.txt': 'x' }))
    const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    oversized.writeUInt32LE(MAX_ARCHIVE_BYTES + 1, central + 24)
    await expect(extractAssetArchive(oversized, 'application/zip')).rejects.toThrow()
  })
  it('recognizes complete Spine resources and surfaces missing textures and version incompatibility', () => {
    expect(inspectSpineGroups(spineFiles)[0]).toMatchObject({
      version: '4.2.22',
      runtimeVersion: '4.2.120',
      animations: ['idle', 'win'],
      textures: ['hero.png'],
      issues: [],
    })
    expect(inspectSpineGroups(spineFiles.slice(0, 2))[0].issues).toContain('atlas 引用的 PNG 纹理不完整')
    const old = [
      { ...spineFiles[0], bytes: Buffer.from(spineJson.replace('4.2.22', '3.8.99')) },
      ...spineFiles.slice(1),
    ]
    expect(inspectSpineGroups(old)[0].issues.join(' ')).toContain('重新导出')
  })
  it('recognizes a binary skeleton version without treating its bytes as text instructions', () => {
    const version = Buffer.from('4.2.22')
    const bytes = Buffer.concat([Buffer.alloc(8), Buffer.from([version.length + 1]), version, Buffer.alloc(32)])
    expect(inspectSpineGroups([{ path: 'hero.skel', bytes }, ...spineFiles.slice(1)])[0]).toMatchObject({
      version: '4.2.22',
      issues: [],
    })
  })

  it('adds only field-bound archive entries to the build asset manifest', () => {
    const summary = {
      assetId: 'folder-1',
      filename: 'game.zip',
      root: 'user-imports/folder-1',
      htmlCandidates: [],
      files: [
        { path: 'game/tiles/tile.png', size: 4 },
        { path: 'game/guide/hand.png', size: 4 },
      ],
      spine: [],
      issues: [],
    }
    const bindings: NonNullable<ConfirmationProposal['resourceBindings']> = {
      tileFaces: [
        {
          kind: 'import',
          assetId: summary.assetId,
          path: 'game/tiles/tile.png',
          filename: 'tile.png',
          mimeType: 'image/png',
          size: 4,
        },
      ],
      animationEffects: [
        {
          kind: 'import',
          assetId: summary.assetId,
          path: 'game/guide/hand.png',
          filename: 'hand.png',
          mimeType: 'image/png',
          size: 4,
        },
      ],
    }
    const manifest: PlayableAssetManifest = {
      plugin: { id: 'test', version: '1', runtimeVersion: '1' },
      sources: [
        { slot: 'tileFaces', status: '用户上传', treatment: '牌面', origin: 'task-upload', files: [] },
        {
          slot: 'animationEffects',
          status: '用户上传',
          treatment: '引导',
          origin: 'task-upload',
          files: [],
        },
      ],
      assets: [],
      entrypoint: 'playable.html',
    }

    attachImportedManifest(manifest, [summary], bindings)

    expect(manifest.sources).toMatchObject([
      { slot: 'tileFaces', files: ['user-imports/folder-1/game/tiles/tile.png'] },
      { slot: 'animationEffects', files: ['user-imports/folder-1/game/guide/hand.png'] },
    ])
  })
})
