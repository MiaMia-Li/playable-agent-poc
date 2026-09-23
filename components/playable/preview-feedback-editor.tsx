'use client'

import { useEffect, useRef, useState, type RefObject, type PointerEvent } from 'react'
import { Loader2, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { PreviewFeedback } from '@/lib/playable/preview-feedback'

type Region = PreviewFeedback['region']

export function PreviewFeedbackEditor({
  frame,
  buildId,
  version,
  onFeedback,
}: {
  frame: RefObject<HTMLIFrameElement | null>
  buildId: string
  version: number
  onFeedback: (feedback: PreviewFeedback) => void
}) {
  const [capturing, setCapturing] = useState(false)
  const [snapshot, setSnapshot] = useState<{ image: string; width: number; height: number }>()
  const [region, setRegion] = useState<Region>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | undefined>(undefined)

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      // iframe 使用不透明来源，不能只靠 origin 校验；必须匹配当前窗口和捕获请求 ID。
      if (!pending.current || event.source !== frame.current?.contentWindow) return
      const data = event.data
      if (!data || data.type !== 'playable:capture-result' || data.id !== pending.current.id) return
      clearTimeout(pending.current.timer)
      pending.current = undefined
      setCapturing(false)
      // 预览代码也可能主动发消息；只接受有大小上限的 PNG 和合理的整数尺寸。
      if (
        data.error ||
        typeof data.image !== 'string' ||
        data.image.length > 6_000_000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(data.image) ||
        !Number.isInteger(data.width) ||
        !Number.isInteger(data.height) ||
        data.width < 1 ||
        data.height < 1 ||
        data.width > 2400 ||
        data.height > 2400
      ) {
        setError('无法捕获当前画面，请重试，或上传截图描述修改。')
        return
      }
      setSnapshot({ image: data.image, width: data.width, height: data.height })
      setRegion(undefined)
      setMessage('')
    }
    window.addEventListener('message', receive)
    return () => {
      window.removeEventListener('message', receive)
      if (pending.current) clearTimeout(pending.current.timer)
    }
  }, [frame])

  function capture() {
    if (pending.current || !frame.current?.contentWindow) return
    setError('')
    setCapturing(true)
    const id = crypto.randomUUID()
    pending.current = {
      id,
      timer: setTimeout(() => {
        pending.current = undefined
        setCapturing(false)
        setError('捕获画面超时，请刷新预览后重试。')
      }, 10000),
    }
    frame.current.contentWindow.postMessage({ type: 'playable:capture', id }, '*')
  }

  // 区域坐标归一化到截图的 0～1 范围，弹窗缩放或设备分辨率变化不会改变定位含义。
  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const clamp = (value: number) => Math.max(0, Math.min(1, value))
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return
    const end = point(event)
    setRegion({
      x: Math.min(start.current.x, end.x),
      y: Math.min(start.current.y, end.y),
      width: Math.abs(end.x - start.current.x),
      height: Math.abs(end.y - start.current.y),
    })
  }

  // 过滤单击或轻微抖动形成的极小选区，避免把无意义的区域发送给需求 Agent。
  const selected = region && region.width > 0.01 && region.height > 0.01
  return (
    <>
      <Button size="icon" variant="ghost" aria-label="框选画面提出修改" disabled={capturing} onClick={capture}>
        {capturing ? <Loader2 className="animate-spin" /> : <ScanLine />}
      </Button>
      {error && (
        <span role="alert" className="text-destructive max-w-48 text-xs">
          {error}
        </span>
      )}
      <Dialog
        open={Boolean(snapshot)}
        onOpenChange={(open) => {
          if (!open) setSnapshot(undefined)
        }}
      >
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>修改 v{version} 的画面</DialogTitle>
            <DialogDescription>拖动框选要改的位置，或选择整张画面。画面和版本会一起加入需求。</DialogDescription>
          </DialogHeader>
          {snapshot && (
            <div
              aria-label="框选反馈区域"
              className="relative mx-auto w-full touch-none select-none overflow-hidden rounded-md border cursor-crosshair"
              style={{
                maxWidth: `min(100%, ${(snapshot.width / snapshot.height) * 42}dvh)`,
                aspectRatio: `${snapshot.width} / ${snapshot.height}`,
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.currentTarget.setPointerCapture(event.pointerId)
                start.current = point(event)
                setRegion(undefined)
              }}
              onPointerMove={move}
              onPointerUp={(event) => {
                move(event)
                start.current = undefined
              }}
              onPointerCancel={() => {
                start.current = undefined
                setRegion(undefined)
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={snapshot.image}
                alt={`v${version} 反馈画面`}
                draggable={false}
                className="pointer-events-none block size-full"
              />
              {region && (
                <div
                  className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/15"
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                  }}
                />
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setRegion({ x: 0, y: 0, width: 1, height: 1 })}>
              选择整张画面
            </Button>
            <p role="status" className="text-muted-foreground text-xs">
              {selected ? '已选中区域' : '请框选修改区域'}
            </p>
          </div>
          <Textarea
            aria-label="画面修改要求"
            placeholder="例如：这个按钮大一点，向上移一些"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={4000}
          />
          <Button
            disabled={!selected || !message.trim()}
            onClick={() => {
              if (!snapshot || !region) return
              onFeedback({ id: crypto.randomUUID(), buildId, version, ...snapshot, region, message: message.trim() })
              setSnapshot(undefined)
            }}
          >
            加入需求
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
