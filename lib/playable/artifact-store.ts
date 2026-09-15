import { BlobNotFoundError, del as deleteBlob, get as getBlob, head as headBlob, put as putBlob } from '@vercel/blob'
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import { logExternalRequestError } from './external-request-logging'
import type { DirectAssetUploads } from './task-assets'

export interface ArtifactStore {
  put(
    key: string,
    value: string | Uint8Array,
    contentType: string,
    options?: { allowOverwrite?: boolean },
  ): Promise<void>
  get(key: string): Promise<ReadableStream<Uint8Array> | undefined>
  delete(key: string): Promise<void>
}

/** Long enough for a maximum-size reference video over a slow connection. */
const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000

export interface PrivateBlobClient {
  put(
    pathname: string,
    body: string | Uint8Array,
    options: {
      access: 'private'
      addRandomSuffix: false
      allowOverwrite: boolean
      contentType: string
    },
  ): PromiseLike<{ url: string; pathname: string }>
  get(pathname: string, options: { access: 'private' }): PromiseLike<{ stream: ReadableStream<Uint8Array> } | null>
  del(pathname: string): PromiseLike<void>
  head(pathname: string): PromiseLike<{ size: number; contentType: string } | null>
  issueClientToken(options: {
    pathname: string
    allowedContentTypes: string[]
    maximumSizeInBytes: number
    addRandomSuffix: false
    allowOverwrite: false
    validUntil: number
  }): PromiseLike<string>
}

const vercelBlobClient: PrivateBlobClient = {
  put: (pathname, body, options) => putBlob(pathname, typeof body === 'string' ? body : Buffer.from(body), options),
  get: async (pathname, options) => {
    const result = await getBlob(pathname, options)
    return result?.stream ? { stream: result.stream } : null
  },
  del: (pathname) => deleteBlob(pathname),
  head: async (pathname) => {
    try {
      const { size, contentType } = await headBlob(pathname)
      return { size, contentType }
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  },
  issueClientToken: (options) => generateClientTokenFromReadWriteToken(options),
}

export class PrivateVercelArtifactStore implements ArtifactStore, DirectAssetUploads {
  constructor(private readonly client: PrivateBlobClient = vercelBlobClient) {}

  async put(
    key: string,
    value: string | Uint8Array,
    contentType: string,
    options?: { allowOverwrite?: boolean },
  ): Promise<void> {
    try {
      await this.client.put(key, value, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: options?.allowOverwrite ?? false,
        contentType,
      })
    } catch (error) {
      logExternalRequestError('Vercel Blob', error)
      throw error
    }
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | undefined> {
    try {
      const result = await this.client.get(key, { access: 'private' })
      if (!result) return
      return result.stream
    } catch (error) {
      logExternalRequestError('Vercel Blob', error)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key)
    } catch (error) {
      logExternalRequestError('Vercel Blob', error)
      throw error
    }
  }

  async issueUploadToken(key: string, constraints: { contentType: string; maxBytes: number }): Promise<string> {
    try {
      return await this.client.issueClientToken({
        pathname: key,
        allowedContentTypes: [constraints.contentType],
        maximumSizeInBytes: constraints.maxBytes,
        addRandomSuffix: false,
        allowOverwrite: false,
        validUntil: Date.now() + UPLOAD_TOKEN_TTL_MS,
      })
    } catch (error) {
      logExternalRequestError('Vercel Blob', error)
      throw error
    }
  }

  async describe(key: string): Promise<{ size: number; contentType: string } | undefined> {
    try {
      return (await this.client.head(key)) ?? undefined
    } catch (error) {
      logExternalRequestError('Vercel Blob', error)
      throw error
    }
  }
}
