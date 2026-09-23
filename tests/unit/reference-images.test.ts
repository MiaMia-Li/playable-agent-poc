import { describe, expect, it } from 'vitest'
import { bindImageAttachmentResources, referenceImageWorkspaceFiles } from '@/lib/playable/reference-images'
import { restorePlayableConversation } from '@/lib/playable/conversation'
import { type ConfirmationProposal } from '@/lib/playable/schemas'

const evidence = {
  assetId: 'image-1',
  filename: '../image.png',
  description: '顶部多出一行',
}

describe('conversation image attachments', () => {
  // 读取旧消息时只去掉历史自动分类，文件身份和用户当时的文字仍须保留。
  it('restores attachments and discards obsolete classifications while retaining legacy text messages', () => {
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
          referenceImages: [{ ...evidence, sourceBuildId: 'build-2', sourceVersion: 2, purpose: 'problem' }],
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

  it('packages original images as safe separate files without assigning a purpose or source version', () => {
    const files = referenceImageWorkspaceFiles([{ ...evidence, mimeType: 'image/png', bytes: new Uint8Array([1, 2]) }])
    expect(files[0]).toEqual({ path: 'reference-images/1.png', bytes: new Uint8Array([1, 2]) })
    const manifest = JSON.parse(new TextDecoder().decode(files[1].bytes))
    expect(manifest).toEqual([{ ...evidence, mimeType: 'image/png', workspacePath: 'reference-images/1.png' }])
    expect(referenceImageWorkspaceFiles([])).toEqual([])
  })
})

describe('image attachment resource bindings', () => {
  const asset = { id: 'logo', filename: 'logo.png', slot: 'referenceImage' as const, mimeType: 'image/png' }
  function proposal(treatment: string, status: '用户上传' | '内置默认' = '用户上传') {
    return {
      referenceImages: [{ assetId: asset.id, filename: asset.filename, description: '把 logo 放进去' }],
      resources: { endCard: { status, treatment } },
    } as ConfirmationProposal
  }

  it('binds only a named available image to its intended resource and removes stale bindings', () => {
    const bound = bindImageAttachmentResources(proposal('使用 logo.png 作为品牌标志'), [asset])
    expect(bound.resourceBindings).toEqual({
      endCard: [{ kind: 'imageAttachment', assetId: 'logo', filename: 'logo.png' }],
    })
    expect(bindImageAttachmentResources(bound, []).resourceBindings).toBeUndefined()
    expect(bindImageAttachmentResources(proposal('仅参考颜色，不使用原图'), [asset]).resourceBindings).toBeUndefined()
    // 相似文件名不是同一份素材，防止短文件名被误匹配进另一个文件名。
    expect(bindImageAttachmentResources(proposal('使用 new-logo.png'), [asset]).resourceBindings).toBeUndefined()
    expect(
      bindImageAttachmentResources(proposal('使用 logo.png', '内置默认'), [asset]).resourceBindings,
    ).toBeUndefined()
    expect(bindImageAttachmentResources({ ...bound, referenceImages: [] }, [asset]).resourceBindings).toBeUndefined()
  })

  it('does not bind image bytes to audio or model slots', () => {
    const confirmation = proposal('使用 logo.png')
    confirmation.resources.audio = { status: '用户上传', treatment: 'logo.png' }
    confirmation.resources.models = { status: '用户上传', treatment: 'logo.png' }
    const bound = bindImageAttachmentResources(confirmation, [asset])
    expect(bound.resourceBindings?.audio).toBeUndefined()
    expect(bound.resourceBindings?.models).toBeUndefined()
  })
})
