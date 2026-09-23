import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

async function collectTraces(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) return collectTraces(filename)
      return entry.isFile() && entry.name.endsWith('.nft.json') ? [filename] : []
    }),
  )
  return nested.flat()
}

async function checkBuildTraces() {
  const output = path.resolve('.next')
  // 检查服务端路由及根级运行时清单，避开缓存、开发产物和依赖目录。
  const traces = await collectTraces(path.join(output, 'server'))
  for (const entry of await readdir(output, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.nft.json')) traces.push(path.join(output, entry.name))
  }
  if (!traces.length) throw new Error('Build trace manifests are missing. Run pnpm build first.')

  // Vercel 可能合并多个路由的依赖，必须检查所有清单的并集，不能只检查单个路由。
  const files = new Set()
  for (const trace of traces) {
    const manifest = JSON.parse(await readFile(trace, 'utf8'))
    if (!Array.isArray(manifest.files)) throw new Error('A build trace manifest is invalid.')
    for (const filename of manifest.files) files.add(path.resolve(path.dirname(trace), filename))
  }
  const checked = new Set()
  for (const filename of files) {
    for (let parent = path.dirname(filename); parent !== path.dirname(parent); parent = path.dirname(parent)) {
      if (!files.has(parent) || checked.has(parent)) continue
      checked.add(parent)
      // 符号链接本身可以部署，但函数包不能同时在该链接路径下创建普通文件。
      // 应由构建器把文件指向真实路径；不能直接删除链接，否则可能破坏运行时模块解析。
      if ((await lstat(parent)).isSymbolicLink()) {
        throw new Error('Build traces contain files inside a traced symlink directory. Use the webpack build.')
      }
    }
  }
}

try {
  await checkBuildTraces()
  console.log('Deployment file traces passed.')
} catch {
  // CI 只输出固定诊断，避免把原始路径或构建环境信息写入公开日志。
  console.error(
    'Deployment file trace check failed. Run pnpm build with webpack and inspect the server trace manifests.',
  )
  process.exitCode = 1
}
