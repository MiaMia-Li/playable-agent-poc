import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createPlayableAssetHandler, MAX_ASSET_BYTES } from '@/lib/playable/task-assets'

function uploadRequest(file: File, slot = 'audio') {
  const form = new FormData()
  form.set('slot', slot)
  form.set('file', file)
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
      asset: { id: 'asset-1', slot: 'audio', filename: 'sound.mp3', mimeType: 'audio/mpeg', size: 3 },
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
      uploadRequest(new File(['video'], 'reference.webm', { type: 'video/webm' }), 'referenceVideo'),
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
      },
    })
    await expect(videoResponse.json()).resolves.toEqual({
      asset: {
        id: 'asset-1',
        slot: 'referenceVideo',
        filename: 'reference.webm',
        mimeType: 'video/webm',
        size: 5,
      },
    })
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
