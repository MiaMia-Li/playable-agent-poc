/**
 * 宿主在 Sandbox 内做的确定性检查。reason 是固定枚举，可以安全地写入日志和构建步骤；
 * detail 只放宿主归纳出的类别（如标签名、引用类型），不放 URL、路径或产物原文。
 */
export const hostCheckReasons = [
  'artifact_missing',
  'contract_missing',
  'template_contract_missing',
  'credential',
  'external_resource',
  'viewport_missing',
  'canvas_missing',
  'master_modified',
  'validation_failed',
] as const

export type HostCheckReason = (typeof hostCheckReasons)[number]

export class PlayableHostCheckError extends Error {
  constructor(
    message: string,
    readonly reason: HostCheckReason,
    readonly detail?: Readonly<Record<string, string | number>>,
  ) {
    super(message)
    this.name = 'PlayableHostCheckError'
  }
}
