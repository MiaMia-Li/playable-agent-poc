export interface PreviewFeedback {
  id: string
  buildId: string
  version: number
  image: string
  width: number
  height: number
  /** 相对于截图左上角的归一化坐标，取值 0～1，与截图的像素宽高分开保存。 */
  region: { x: number; y: number; width: number; height: number }
  message: string
}

// 截图来自用户主动框选，因此可以明确其定位用途；普通上传图片仍由对话决定用途。
export function previewFeedbackMessage(feedback: PreviewFeedback): string {
  const { region } = feedback
  const percent = (value: number) => Math.round(value * 100)
  return `请基于 v${feedback.version} 修改试玩：${feedback.message}\n预览反馈区域（相对于附图左上角）：左 ${percent(region.x)}%，上 ${percent(region.y)}%，宽 ${percent(region.width)}%，高 ${percent(region.height)}%。附图是该版本当时的试玩画面，仅用于定位修改，不是生产素材。`
}

/** 只生成本地待发送附件，用户发送需求后才通过现有素材接口上传。 */
export function previewFeedbackFile(feedback: PreviewFeedback): File {
  const bytes = Uint8Array.from(atob(feedback.image.split(',')[1]), (character) => character.charCodeAt(0))
  return new File([bytes], `preview-v${feedback.version}-${feedback.id}.png`, { type: 'image/png' })
}
