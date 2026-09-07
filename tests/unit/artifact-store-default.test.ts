import { beforeEach, describe, expect, it, vi } from 'vitest'

const blob = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@vercel/blob', () => blob)

import { PrivateVercelArtifactStore } from '@/lib/playable/artifact-store'

describe('default Vercel Blob adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps writes to private non-overwriting Blob uploads', async () => {
    blob.put.mockResolvedValueOnce({
      url: 'https://private.blob.vercel-storage.com/provider-only',
      pathname: 'users/u/tasks/t/b/playable.html',
    })
    const store = new PrivateVercelArtifactStore()
    const bytes = new Uint8Array([1, 2, 3])

    await store.put('users/u/tasks/t/b/playable.html', bytes, 'text/html')

    expect(blob.put).toHaveBeenCalledWith('users/u/tasks/t/b/playable.html', Buffer.from(bytes), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'text/html',
    })
  })

  it('maps reads to private Blob access and preserves stream identity', async () => {
    const stream = new ReadableStream<Uint8Array>()
    blob.get.mockResolvedValueOnce({ stream })
    const store = new PrivateVercelArtifactStore()

    await expect(store.get('users/u/tasks/t/b/playable.html')).resolves.toBe(stream)
    expect(blob.get).toHaveBeenCalledWith('users/u/tasks/t/b/playable.html', { access: 'private' })
  })
})
