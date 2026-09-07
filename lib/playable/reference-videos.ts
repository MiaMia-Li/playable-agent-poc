import type { PlayableModeId } from './types'

export const REFERENCE_VIDEOS: ReadonlyArray<{
  filename: string
  mode: PlayableModeId
  regressionFocus: string
}> = [
  {
    filename: 'Mahjong Match：Classic Tiles！-360 X 640-2026-09-01-c2f1079b9cd7c5090195cbb97ac59e5f.mp4',
    mode: 'perspective_3d',
    regressionFocus: '立体塔体、中心开口、暴露顶面和下层揭示',
  },
  {
    filename: 'Vita Mahjong-360 X 640-2026-09-01-5a8ed5d387599541396edd43ed2336a7.mp4',
    mode: 'gravity_fill',
    regressionFocus: '密集平铺、选择高亮、列下落和补位',
  },
  {
    filename: 'Vita Mahjong-720 X 1280-2026-09-01-5712dfecddd48c49c51db9d56b2ab6ed.mp4',
    mode: 'top_rack',
    regressionFocus: '分层牌阵、上方牌架、配对清除和下层释放',
  },
  {
    filename: 'Mahjong Match：Classic Tiles！-360 X 640-2026-09-01-636b98221290a1df6cbdd961f80d9083 (1).mp4',
    mode: 'center_collision',
    regressionFocus: '交错堆叠、中心运动、碰撞破碎和计分',
  },
]
