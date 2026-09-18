'use client'

import { useRef, useState } from 'react'
import { FolderUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { packageFolder } from '@/lib/playable/folder-upload-client'

export function FolderUploadButton({
  disabled,
  onFile,
  onError,
  onBusyChange,
}: {
  disabled: boolean
  onFile: (file: File) => void
  onError: (message: string) => void
  onBusyChange: (busy: boolean) => void
}) {
  const input = useRef<HTMLInputElement | null>(null)
  // ref 立即阻止重复打包，state 驱动界面；父组件同步禁用发送，防止附件尚未入队就提交。
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FolderUp aria-hidden="true" />}
        {busy ? '打包中…' : '上传文件夹'}
      </Button>
      <input
        className="sr-only"
        type="file"
        multiple
        aria-label="选择文件夹"
        disabled={disabled || busy}
        ref={(element) => {
          input.current = element
          // 目录选择器通过此属性提供 webkitRelativePath，不能只用文件名重建目录。
          element?.setAttribute('webkitdirectory', '')
        }}
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? [])
          // 先保存文件列表再清空选择器，允许失败后重新选择同一个文件夹。
          event.target.value = ''
          if (!files.length || busyRef.current) return
          busyRef.current = true
          setBusy(true)
          onBusyChange(true)
          onError('')
          try {
            onFile(await packageFolder(files))
          } catch (error) {
            onError(error instanceof Error ? error.message : '文件夹打包失败，请重新选择')
          } finally {
            busyRef.current = false
            setBusy(false)
            onBusyChange(false)
          }
        }}
      />
    </>
  )
}
