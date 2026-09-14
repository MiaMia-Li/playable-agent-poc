import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  createPlayableAssetContentHandler,
  createPlayableAssetHandler,
  MAX_ASSET_BYTES,
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
  const handler = createPlayableAssetHandler({
    authenticate: async () => owner,
    findOwnedTask: async (taskId, userId) => taskId === 'owned' && userId === 'user-1',
    saveAsset: async (asset) => void metadata.push(asset),
    listAssets: async () => [],
    store,
    generateId: () => 'asset-1',
  })
  return { handler, metadata, store }
}

describe('playable asset upload', () => {
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

describe('playable asset content', () => {
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
