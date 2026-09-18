import path from 'node:path'
import { pathToFileURL } from 'node:url'

// 最小合法导出元数据用于导入链路测试；空动画只验证识别与传递，不代表运行时播放验收。
export const spineJson = JSON.stringify({
  skeleton: { spine: '4.2.22' },
  bones: [{ name: 'root' }],
  animations: { idle: {}, win: {} },
})
export const spineAtlas =
  'hero.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nhero\n  rotate: false\n  xy: 0,0\n  size: 1,1\n  orig: 1,1\n  offset: 0,0\n  index: -1\n'
export const spinePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4z8AAAAASUVORK5CYII=',
  'base64',
)
export async function zipFiles(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const url = pathToFileURL(path.join(process.cwd(), 'skills/_shared/assets/starter/work/zip-codec.mjs')).href
  const { encodeZip } = await import(url)
  return encodeZip(new Map(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)])))
}
