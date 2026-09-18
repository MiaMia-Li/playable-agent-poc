/** 上传路径只允许规范的相对路径，防止写出导入目录；浏览器打包与服务端解包共用此规则。 */
export function safeImportPath(value: string): string {
  if (
    !value ||
    value.length > 500 ||
    /[\\\x00-\x1f:]/.test(value) ||
    value.startsWith('/') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid package path')
  return value
}
