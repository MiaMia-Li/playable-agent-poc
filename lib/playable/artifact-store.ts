import { del as deleteBlob, get as getBlob, put as putBlob } from '@vercel/blob'

export interface ArtifactStore {
  put(key: string, value: string | Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<ReadableStream<Uint8Array> | undefined>
  delete(key: string): Promise<void>
}

export interface PrivateBlobClient {
  put(
    pathname: string,
    body: string | Uint8Array,
    options: {
      access: 'private'
      addRandomSuffix: false
      allowOverwrite: false
      contentType: string
    },
  ): PromiseLike<{ url: string; pathname: string }>
  get(pathname: string, options: { access: 'private' }): PromiseLike<{ stream: ReadableStream<Uint8Array> } | null>
  del(pathname: string): PromiseLike<void>
}

const vercelBlobClient: PrivateBlobClient = {
  put: (pathname, body, options) => putBlob(pathname, typeof body === 'string' ? body : Buffer.from(body), options),
  get: async (pathname, options) => {
    const result = await getBlob(pathname, options)
    return result?.stream ? { stream: result.stream } : null
  },
  del: (pathname) => deleteBlob(pathname),
}

export class PrivateVercelArtifactStore implements ArtifactStore {
  constructor(private readonly client: PrivateBlobClient = vercelBlobClient) {}

  async put(key: string, value: string | Uint8Array, contentType: string): Promise<void> {
    await this.client.put(key, value, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType,
    })
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const result = await this.client.get(key, { access: 'private' })
    if (!result) return
    return result.stream
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key)
  }
}
