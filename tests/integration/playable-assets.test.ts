import { zipFiles } from '../fixtures/imported-assets'
import { triangleGlb } from '../fixtures/glb'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  createPlayableAssetContentHandler,
  createPlayableAssetDeleteHandler,
  createPlayableAssetHandler,
  createPlayableAssetUploadCompleteHandler,
  createPlayableAssetUploadTokenHandler,
  MAX_ASSET_BYTES,
  type PlayableAsset,
} from '@/lib/playable/task-assets'
import { MAX_REFERENCE_VIDEO_SECONDS } from '@/lib/playable/asset-policy'

function uploadRequest(file: File, slot = 'audio', durationSeconds?: number) {
  const form = new FormData()
  form.set('slot', slot)
  form.set('file', file)
  if (durationSeconds !== undefined) form.set('durationSeconds', String(durationSeconds))
  return new NextRequest('https://app.example/api/playable-tasks/owned/assets', { method: 'POST', body: form })
}

function harness(owner = 'user-1') {
  const metadata: unknown[] = []
  const store = {
    put: vi.fn(async () => undefined),
    get: vi.fn(),
    delete: vi.fn(async () => undefined),
  }
  const activateReferenceVideo = vi.fn(async () => undefined)
  const handler = createPlayableAssetHandler({
    authenticate: async () => owner,
    findOwnedTask: async (taskId, userId) => taskId === 'owned' && userId === 'user-1',
    saveAsset: async (asset) => void metadata.push(asset),
    listAssets: async () => [],
    activateReferenceVideo,
    store,
    generateId: () => 'asset-1',
  })
  return { handler, metadata, store, activateReferenceVideo }
}

describe('playable asset upload', () => {
  it.each(['text/html', '', 'application/octet-stream'])('accepts HTML source with MIME %s', async (type) => {
    const { handler, store } = harness()
    const response = await handler(
      uploadRequest(new File(['<!doctype html><button>Play</button>'], 'game.html', { type }), 'sourceHtml'),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(response.status).toBe(201)
    expect((await response.json()).asset).toMatchObject({ slot: 'sourceHtml', mimeType: 'text/html' })
    expect(store.put).toHaveBeenCalled()
  })

  it('stores one allowlisted file privately in one explicit owned slot without exposing its key', async () => {
    const { handler, metadata, store } = harness()
    const response = await handler(
      uploadRequest(new File([new Uint8Array([1, 2, 3])], 'sound.mp3', { type: 'audio/mpeg' })),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toEqual({
      asset: {
        id: 'asset-1',
        slot: 'audio',
        filename: 'sound.mp3',
        mimeType: 'audio/mpeg',
        size: 3,
        durationSeconds: null,
      },
    })
    expect(store.put).toHaveBeenCalledWith(
      'users/user-1/tasks/owned/assets/asset-1',
      new Uint8Array([1, 2, 3]),
      'audio/mpeg',
    )
    expect(metadata).toEqual([
      expect.objectContaining({ id: 'asset-1', taskId: 'owned', userId: 'user-1', slot: 'audio' }),
    ])
    expect(JSON.stringify(body)).not.toContain('users/')
    expect(JSON.stringify(body)).not.toContain('blob')
  })

  it('accepts image and video files in their dedicated reference slots', async () => {
    const imageHarness = harness()
    const videoHarness = harness()
    const context = { params: Promise.resolve({ taskId: 'owned' }) }

    const imageResponse = await imageHarness.handler(
      uploadRequest(new File(['image'], 'reference.webp', { type: 'image/webp' }), 'referenceImage'),
      context,
    )
    const videoResponse = await videoHarness.handler(
      uploadRequest(new File(['video'], 'reference.webm', { type: 'video/webm' }), 'referenceVideo', 24),
      context,
    )

    expect(imageResponse.status).toBe(201)
    expect(videoResponse.status).toBe(201)
    await expect(imageResponse.json()).resolves.toEqual({
      asset: {
        id: 'asset-1',
        slot: 'referenceImage',
        filename: 'reference.webp',
        mimeType: 'image/webp',
        size: 5,
        durationSeconds: null,
      },
    })
    await expect(videoResponse.json()).resolves.toEqual({
      asset: {
        id: 'asset-1',
        slot: 'referenceVideo',
        filename: 'reference.webm',
        mimeType: 'video/webm',
        size: 5,
        durationSeconds: 24,
      },
    })
  })

  // The browser names the uploaded video in the analysis request that follows,
  // and the route refuses one that is not active, so the upload has to move
  // the pointer before that request can arrive.
  it('makes an uploaded reference video the active one, and leaves images alone', async () => {
    const imageHarness = harness()
    const videoHarness = harness()
    const context = { params: Promise.resolve({ taskId: 'owned' }) }

    await imageHarness.handler(
      uploadRequest(new File(['image'], 'reference.png', { type: 'image/png' }), 'referenceImage'),
      context,
    )
    await videoHarness.handler(
      uploadRequest(new File(['video'], 'reference.mp4', { type: 'video/mp4' }), 'referenceVideo', 12),
      context,
    )

    expect(imageHarness.activateReferenceVideo).not.toHaveBeenCalled()
    expect(videoHarness.activateReferenceVideo).toHaveBeenCalledWith('owned', 'user-1', 'asset-1')
  })

  it('does not activate a reference video it refused to store', async () => {
    const videoHarness = harness()

    await videoHarness.handler(
      uploadRequest(
        new File(['video'], 'long.mp4', { type: 'video/mp4' }),
        'referenceVideo',
        MAX_REFERENCE_VIDEO_SECONDS + 1,
      ),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(videoHarness.activateReferenceVideo).not.toHaveBeenCalled()
  })

  // The limit is about what the analysis pipeline can usefully read, so it is
  // enforced on the browser-reported duration at upload rather than after a
  // long video has already been stored and paid for.
  it('refuses a reference video longer than the analysis limit and names the limit', async () => {
    const videoHarness = harness()

    const response = await videoHarness.handler(
      uploadRequest(
        new File(['video'], 'long.webm', { type: 'video/webm' }),
        'referenceVideo',
        MAX_REFERENCE_VIDEO_SECONDS + 1,
      ),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: 'Video too long',
      maxDurationSeconds: MAX_REFERENCE_VIDEO_SECONDS,
    })
    expect(videoHarness.store.put).not.toHaveBeenCalled()
  })

  // An unreadable duration must not be treated as zero or as a violation: the
  // browser reports Infinity or NaN for some streamed containers.
  it('stores a reference video whose duration the browser could not report', async () => {
    const videoHarness = harness()

    const response = await videoHarness.handler(
      uploadRequest(new File(['video'], 'streamed.webm', { type: 'video/webm' }), 'referenceVideo', Infinity),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ asset: { durationSeconds: null } })
  })

  it('uses indistinguishable 404s for missing and foreign tasks', async () => {
    const missing = harness()
    const foreign = harness('user-2')
    const file = new File(['x'], 'x.png', { type: 'image/png' })
    const responses = await Promise.all([
      missing.handler(uploadRequest(file), { params: Promise.resolve({ taskId: 'missing' }) }),
      foreign.handler(uploadRequest(file), { params: Promise.resolve({ taskId: 'owned' }) }),
    ])
    expect(responses.map((response) => response.status)).toEqual([404, 404])
  })

  it('rejects unknown slots, disallowed MIME types, and oversized files before storage', async () => {
    const { handler, store } = harness()
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const responses = await Promise.all([
      handler(uploadRequest(new File(['x'], 'x.svg', { type: 'image/svg+xml' })), context),
      handler(uploadRequest(new File(['x'], 'x.png', { type: 'image/png' }), 'everything'), context),
      handler(uploadRequest(new File(['x'], 'x.mp4', { type: 'video/mp4' }), 'backgroundBoard'), context),
      handler(uploadRequest(new File(['x'], 'x.png', { type: 'image/png' }), 'referenceVideo'), context),
      handler(
        uploadRequest(new File([new Uint8Array(MAX_ASSET_BYTES + 1)], 'large.mp3', { type: 'audio/mpeg' }), 'audio'),
        context,
      ),
    ])
    expect(responses.map((response) => response.status)).toEqual([415, 400, 415, 415, 413])
    expect(store.put).not.toHaveBeenCalled()
  })
})

describe('playable direct asset upload', () => {
  const context = { params: Promise.resolve({ taskId: 'owned' }) }
  const key = 'users/user-1/tasks/owned/assets/asset-1'

  function jsonRequest(path: string, body: unknown) {
    return new NextRequest(`https://app.example/api/playable-tasks/owned/assets/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  function directHarness(options: { stored?: { size: number; contentType: string }; direct?: boolean } = {}) {
    const metadata: PlayableAsset[] = []
    const store = { put: vi.fn(), get: vi.fn(), delete: vi.fn(async () => undefined) }
    const directUploads = {
      issueUploadToken: vi.fn(async () => 'client-token'),
      describe: vi.fn(async () => options.stored),
    }
    const activateReferenceVideo = vi.fn(async () => undefined)
    const dependencies = {
      authenticate: async () => 'user-1',
      findOwnedTask: async (taskId: string) => taskId === 'owned',
      saveAsset: async (asset: PlayableAsset) => void metadata.push(asset),
      listAssets: async () => metadata,
      activateReferenceVideo,
      store,
      directUploads: options.direct === false ? undefined : directUploads,
      generateId: () => 'asset-1',
    }
    return {
      token: createPlayableAssetUploadTokenHandler(dependencies),
      complete: createPlayableAssetUploadCompleteHandler(dependencies),
      metadata,
      store,
      directUploads,
      activateReferenceVideo,
    }
  }

  it('validates actual GLB bytes on direct completion and deletes invalid uploads', async () => {
    const bytes = triangleGlb()
    const valid = directHarness({ stored: { size: bytes.length, contentType: 'model/gltf-binary' } })
    valid.store.get.mockResolvedValue(new Response(bytes).body)
    const body = { slot: 'tileFaces', pathname: key, filename: 'block.glb' }
    expect((await valid.complete(jsonRequest('uploads/complete', body), context)).status).toBe(201)
    const invalid = directHarness({ stored: { size: 3, contentType: 'model/gltf-binary' } })
    invalid.store.get.mockResolvedValue(new Response('bad').body)
    expect((await invalid.complete(jsonRequest('uploads/complete', body), context)).status).toBe(415)
    expect(invalid.store.delete).toHaveBeenCalledWith(key)
    expect(invalid.metadata).toEqual([])
  })

  // Vercel refuses function bodies over 4.5 MB, so a video past that size
  // only ever reaches storage this way.
  it('issues a token for a large video scoped to a key the server chose', async () => {
    const { token, directUploads } = directHarness()

    const response = await token(
      jsonRequest('uploads', {
        slot: 'referenceVideo',
        mimeType: 'video/mp4',
        size: 50 * 1024 * 1024,
        durationSeconds: 21,
      }),
      context,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ pathname: key, clientToken: 'client-token' })
    expect(directUploads.issueUploadToken).toHaveBeenCalledWith(key, {
      contentType: 'video/mp4',
      maxBytes: 100 * 1024 * 1024,
    })
  })

  it.each([
    ['sourceHtml', 'text/html'],
    ['assetPackage', 'application/zip'],
    ['assetPackage', 'application/vnd.rar'],
    ['spine', 'application/x-spine-png'],
  ])('issues a 100 MiB direct-upload token for %s / %s', async (slot, mimeType) => {
    const { token, directUploads } = directHarness()
    const response = await token(jsonRequest('uploads', { slot, mimeType, size: 100 * 1024 * 1024 }), context)
    expect(response.status).toBe(200)
    expect(directUploads.issueUploadToken).toHaveBeenCalledWith(key, {
      contentType: mimeType,
      maxBytes: 100 * 1024 * 1024,
    })
    const over = await token(jsonRequest('uploads', { slot, mimeType, size: 100 * 1024 * 1024 + 1 }), context)
    expect(over.status).toBe(413)
  })

  // 上传声明与实际内容必须分别验证，防止伪造 MIME 的无效压缩包进入持久化素材清单。
  it('validates actual uploaded archive bytes before registering the blob', async () => {
    const bytes = await zipFiles({ 'index.html': '<html>Game</html>' })
    const good = directHarness({ stored: { size: bytes.length, contentType: 'application/zip' } })
    good.store.get.mockResolvedValue(new Response(Uint8Array.from(bytes)).body)
    expect(
      (
        await good.complete(
          jsonRequest('uploads/complete', { slot: 'assetPackage', pathname: key, filename: 'game.zip' }),
          context,
        )
      ).status,
    ).toBe(201)
    const bad = directHarness({ stored: { size: 3, contentType: 'application/zip' } })
    bad.store.get.mockResolvedValue(new Response('bad').body)
    expect(
      (
        await bad.complete(
          jsonRequest('uploads/complete', { slot: 'assetPackage', pathname: key, filename: 'game.zip' }),
          context,
        )
      ).status,
    ).toBe(415)
    expect(bad.store.delete).toHaveBeenCalledWith(key)
    expect(bad.metadata).toEqual([])
  })

  it('refuses a token on the same terms as the multipart route', async () => {
    const { token, directUploads } = directHarness()
    const responses = await Promise.all([
      token(jsonRequest('uploads', { slot: 'referenceVideo', mimeType: 'image/png', size: 10 }), context),
      token(jsonRequest('uploads', { slot: 'audio', mimeType: 'audio/mpeg', size: MAX_ASSET_BYTES + 1 }), context),
      token(
        jsonRequest('uploads', {
          slot: 'referenceVideo',
          mimeType: 'video/mp4',
          size: 10,
          durationSeconds: MAX_REFERENCE_VIDEO_SECONDS + 1,
        }),
        context,
      ),
      token(jsonRequest('uploads', { slot: 'everything', mimeType: 'video/mp4', size: 10 }), context),
    ])

    expect(responses.map((response) => response.status)).toEqual([415, 413, 413, 400])
    expect(directUploads.issueUploadToken).not.toHaveBeenCalled()
  })

  it('tells the browser to fall back when the store has no direct uploads', async () => {
    const { token, complete } = directHarness({ direct: false })

    const responses = await Promise.all([
      token(jsonRequest('uploads', { slot: 'referenceVideo', mimeType: 'video/mp4', size: 10 }), context),
      complete(jsonRequest('uploads/complete', { slot: 'referenceVideo', pathname: key, filename: 'x.mp4' }), context),
    ])

    expect(responses.map((response) => response.status)).toEqual([501, 501])
  })

  it('records a completed upload from what storage holds and makes the video active', async () => {
    const { complete, metadata, activateReferenceVideo } = directHarness({
      stored: { size: 50 * 1024 * 1024, contentType: 'video/mp4' },
    })

    const response = await complete(
      jsonRequest('uploads/complete', {
        slot: 'referenceVideo',
        pathname: key,
        filename: 'rec.mp4',
        durationSeconds: 21,
      }),
      context,
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      asset: {
        id: 'asset-1',
        slot: 'referenceVideo',
        filename: 'rec.mp4',
        mimeType: 'video/mp4',
        size: 50 * 1024 * 1024,
        durationSeconds: 21,
      },
    })
    expect(metadata).toEqual([expect.objectContaining({ storageKey: key, userId: 'user-1', taskId: 'owned' })])
    expect(activateReferenceVideo).toHaveBeenCalledWith('owned', 'user-1', 'asset-1')
  })

  it('records a retried completion only once', async () => {
    const { complete, metadata } = directHarness({ stored: { size: 10, contentType: 'video/mp4' } })
    const body = { slot: 'referenceVideo', pathname: key, filename: 'rec.mp4' }

    await complete(jsonRequest('uploads/complete', body), context)
    const retried = await complete(jsonRequest('uploads/complete', body), context)

    expect(retried.status).toBe(200)
    expect(metadata).toHaveLength(1)
  })

  it('refuses to record a key outside this task or a blob that never arrived', async () => {
    const { complete, metadata } = directHarness()
    const responses = await Promise.all([
      complete(
        jsonRequest('uploads/complete', {
          slot: 'referenceVideo',
          pathname: 'users/user-2/tasks/owned/assets/asset-1',
          filename: 'x.mp4',
        }),
        context,
      ),
      complete(
        jsonRequest('uploads/complete', {
          slot: 'referenceVideo',
          pathname: `${key}/../../other`,
          filename: 'x.mp4',
        }),
        context,
      ),
      complete(jsonRequest('uploads/complete', { slot: 'referenceVideo', pathname: key, filename: 'x.mp4' }), context),
    ])

    expect(responses.map((response) => response.status)).toEqual([400, 400, 404])
    expect(metadata).toEqual([])
  })

  it('deletes a stored blob that fails the checks instead of recording it', async () => {
    const { complete, metadata, store } = directHarness({ stored: { size: 10, contentType: 'image/png' } })

    const response = await complete(
      jsonRequest('uploads/complete', { slot: 'referenceVideo', pathname: key, filename: 'x.mp4' }),
      context,
    )

    expect(response.status).toBe(415)
    expect(store.delete).toHaveBeenCalledWith(key)
    expect(metadata).toEqual([])
  })
})

describe('playable asset delete', () => {
  function asset(slot: PlayableAsset['slot']): PlayableAsset {
    return {
      id: 'asset-1',
      taskId: 'owned',
      userId: 'user-1',
      slot,
      filename: 'x',
      mimeType: slot === 'referenceVideo' ? 'video/mp4' : 'image/png',
      size: 1,
      storageKey: 'asset-key',
      durationSeconds: null,
      createdAt: new Date(),
    }
  }

  function deleteHarness(stored: PlayableAsset) {
    const releaseReferenceVideo = vi.fn(async () => undefined)
    const handler = createPlayableAssetDeleteHandler({
      authenticate: async () => 'user-1',
      findOwnedAsset: async () => stored,
      deleteOwnedAsset: async () => stored,
      releaseReferenceVideo,
      store: { put: vi.fn(), get: vi.fn(), delete: vi.fn(async () => undefined) },
    })
    return { handler, releaseReferenceVideo }
  }

  const context = { params: Promise.resolve({ taskId: 'owned', assetId: 'asset-1' }) }
  const deleteRequest = () =>
    new NextRequest('https://app.example/api/playable-tasks/owned/assets/asset-1', { method: 'DELETE' })

  // Left pointing at a deleted video, the task would keep feeding that video's
  // blueprint to the agent and the build.
  it('releases the active pointer when a reference video is deleted', async () => {
    const { handler, releaseReferenceVideo } = deleteHarness(asset('referenceVideo'))

    const response = await handler(deleteRequest(), context)

    expect(response.status).toBe(204)
    expect(releaseReferenceVideo).toHaveBeenCalledWith('owned', 'user-1', 'asset-1')
  })

  it('does not touch the active pointer when another kind of asset is deleted', async () => {
    const { handler, releaseReferenceVideo } = deleteHarness(asset('referenceImage'))

    await handler(deleteRequest(), context)

    expect(releaseReferenceVideo).not.toHaveBeenCalled()
  })
})

describe('playable asset content', () => {
  it('downloads HTML without executing it on the app origin', async () => {
    const handler = createPlayableAssetContentHandler({
      authenticate: async () => 'user-1',
      findOwnedAsset: async () => ({
        id: 'html',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'sourceHtml',
        filename: 'game.html',
        mimeType: 'text/html',
        size: 1,
        storageKey: 'source',
        durationSeconds: null,
        createdAt: new Date(),
      }),
      deleteOwnedAsset: async () => undefined,
      store: {
        put: vi.fn(),
        delete: vi.fn(),
        get: async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('<script>alert(1)</script>'))
              controller.close()
            },
          }),
      },
    })
    const response = await handler(new NextRequest('https://app.example/assets/html'), {
      params: Promise.resolve({ taskId: 'owned', assetId: 'html' }),
    })
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('encodes Unicode filenames in the content disposition header', async () => {
    const handler = createPlayableAssetContentHandler({
      authenticate: async () => 'user-1',
      findOwnedAsset: async () => ({
        id: 'asset-1',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'referenceImage',
        filename: '中文.png',
        mimeType: 'image/png',
        size: 3,
        storageKey: 'asset-key',
        durationSeconds: null,
        createdAt: new Date(),
      }),
      deleteOwnedAsset: async () => undefined,
      store: {
        put: vi.fn(async () => undefined),
        get: vi.fn(
          async () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]))
                controller.close()
              },
            }),
        ),
        delete: vi.fn(async () => undefined),
      },
    })

    const response = await handler(new NextRequest('https://app.example/assets/asset-1'), {
      params: Promise.resolve({ taskId: 'owned', assetId: 'asset-1' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename="__.png"; filename*=UTF-8''%E4%B8%AD%E6%96%87.png`,
    )
  })
})

describe('GLB resource upload', () => {
  it.each(['', 'application/octet-stream', 'model/gltf-binary'])(
    'stores a validated model with canonical MIME: %s',
    async (type) => {
      const { handler, store, metadata } = harness()
      const bytes = triangleGlb()
      const response = await handler(uploadRequest(new File([bytes], 'block.glb', { type }), 'models'), {
        params: Promise.resolve({ taskId: 'owned' }),
      })
      expect(response.status).toBe(201)
      expect(metadata).toEqual([expect.objectContaining({ mimeType: 'model/gltf-binary', slot: 'models' })])
      expect(store.put).toHaveBeenCalledWith(expect.any(String), bytes, 'model/gltf-binary')
    },
  )
  it('rejects fake GLB and external textures before saving anything', async () => {
    for (const bytes of [
      new Uint8Array([1, 2, 3]),
      triangleGlb((d) => {
        d.images = [{ uri: 'https://example.com/t.png' }]
      }),
    ]) {
      const { handler, store, metadata } = harness()
      const response = await handler(uploadRequest(new File([bytes], 'block.glb'), 'backgroundBoard'), {
        params: Promise.resolve({ taskId: 'owned' }),
      })
      expect(response.status).toBe(415)
      expect(store.put).not.toHaveBeenCalled()
      expect(metadata).toEqual([])
    }
  })
  it('does not let model files become screenshot evidence or audio', async () => {
    for (const slot of ['referenceImage', 'referenceVideo', 'audio', 'endCard']) {
      const { handler } = harness()
      const response = await handler(uploadRequest(new File([triangleGlb()], 'block.glb'), slot), {
        params: Promise.resolve({ taskId: 'owned' }),
      })
      expect(response.status).toBe(415)
    }
  })
})
