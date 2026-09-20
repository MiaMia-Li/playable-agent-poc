import { describe, expect, it } from 'vitest'
import { packageFolder } from '@/lib/playable/folder-upload-client'
import { extractAssetArchive, packageHtmlEntry } from '@/lib/playable/asset-archive'
import { MAX_ARCHIVE_BYTES } from '@/lib/playable/asset-policy'

function folderFile(path: string, content = 'test', size?: number) {
  const file = new File([content], path.split('/').pop()!)
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('folder uploads', () => {
  it('preserves relative HTML and nested resource paths through server extraction', async () => {
    const archive = await packageFolder([
      folderFile('game/index.html', '<img src="images/hero.png">'),
      folderFile('game/images/hero.png'),
      folderFile('game/spine/hero.atlas'),
      folderFile('game/spine/hero.json'),
      folderFile('game/.DS_Store'),
    ])
    expect(archive.name).toBe('game.zip')
    expect(archive.type).toBe('application/zip')
    // 用真实服务端解包器读取浏览器生成的 ZIP，验证两端协议与相对资源路径一致。
    const extracted = await extractAssetArchive(new Uint8Array(await archive.arrayBuffer()), archive.type)
    expect(extracted.map((file) => file.path)).toEqual([
      'game/index.html',
      'game/images/hero.png',
      'game/spine/hero.atlas',
      'game/spine/hero.json',
    ])
    expect(packageHtmlEntry(extracted)).toBe('game/index.html')
    expect(new TextDecoder().decode(extracted[0].bytes)).toBe('<img src="images/hero.png">')
  })
  it('rejects empty, unsafe, duplicate, nested archives and mixed roots', async () => {
    for (const files of [
      [],
      [folderFile('game/.hidden')],
      [folderFile('game/../escape')],
      [folderFile('game/a'), folderFile('game/A')],
      [folderFile('game/a.zip')],
      [folderFile('one/a'), folderFile('two/b')],
    ]) {
      await expect(packageFolder(files)).rejects.toThrow()
    }
  })
  it('checks budgets before reading file contents', async () => {
    await expect(packageFolder([folderFile('game/a', '', MAX_ARCHIVE_BYTES + 1)])).rejects.toThrow('300 MiB')
    await expect(packageFolder(Array.from({ length: 1001 }, (_, i) => folderFile(`game/${i}`)))).rejects.toThrow('1000')
  })
})
