import { describe, expect, it } from 'vitest'
import { referenceImageWorkspaceFiles } from '@/lib/playable/reference-images'
import { restorePlayableConversation } from '@/lib/playable/conversation'

const evidence = {
  assetId: 'image-1',
  filename: '../image.png',
  sourceBuildId: 'build-2',
  sourceVersion: 2,
  purpose: 'problem' as const,
  description: '顶部多出一行',
}

describe('screenshot evidence', () => {
  it('restores turn attachments and source metadata while retaining legacy text messages', () => {
    const restored = restorePlayableConversation([
      { id: 'one', taskId: 'task', role: 'user', content: '旧消息', createdAt: new Date(1) },
      {
        id: 'two',
        taskId: 'task',
        role: 'user',
        content: JSON.stringify({
          kind: 'playable-user-turn',
          text: '修复顶部',
          attachments: [{ id: 'image-1', filename: 'image.png', mimeType: 'image/png' }],
          referenceImages: [evidence],
        }),
        createdAt: new Date(2),
      },
    ])
    expect(restored[0].content).toBe('旧消息')
    expect(restored[1]).toMatchObject({
      content: '修复顶部',
      referenceImages: [evidence],
      attachments: [{ id: 'image-1' }],
    })
  })

  it('packages selected screenshots as safe separate files and preserves their purpose and source', () => {
    const files = referenceImageWorkspaceFiles([{ ...evidence, mimeType: 'image/png', bytes: new Uint8Array([1, 2]) }])
    expect(files[0]).toEqual({ path: 'reference-images/1.png', bytes: new Uint8Array([1, 2]) })
    const manifest = JSON.parse(new TextDecoder().decode(files[1].bytes))
    expect(manifest).toEqual([{ ...evidence, mimeType: 'image/png', workspacePath: 'reference-images/1.png' }])
    expect(referenceImageWorkspaceFiles([])).toEqual([])
  })
})
