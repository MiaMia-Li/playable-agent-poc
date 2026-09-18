// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FolderUploadButton } from '@/components/playable/folder-upload-button'
import { packageFolder } from '@/lib/playable/folder-upload-client'
vi.mock('@/lib/playable/folder-upload-client', () => ({ packageFolder: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('selects directories, locks while packing and forwards the completed archive', async () => {
  // 暂不完成打包 Promise，覆盖异步等待期间的重复点击和父级提交锁。
  let finish!: (file: File) => void
  vi.mocked(packageFolder).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const onFile = vi.fn(),
    onBusyChange = vi.fn()
  render(<FolderUploadButton disabled={false} onFile={onFile} onError={vi.fn()} onBusyChange={onBusyChange} />)
  const input = screen.getByLabelText('选择文件夹') as HTMLInputElement
  expect(input.hasAttribute('webkitdirectory')).toBe(true)
  fireEvent.change(input, { target: { files: [new File([''], 'index.html')] } })
  expect((screen.getByRole('button', { name: '打包中…' }) as HTMLButtonElement).disabled).toBe(true)
  expect(onBusyChange).toHaveBeenCalledWith(true)
  const archive = new File(['zip'], 'game.zip', { type: 'application/zip' })
  finish(archive)
  await waitFor(() => expect(onFile).toHaveBeenCalledWith(archive))
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
})

it('shows packaging errors and allows retry', async () => {
  vi.mocked(packageFolder).mockRejectedValue(new Error('文件夹内含压缩包，请先解压后再上传'))
  const onError = vi.fn(),
    onFile = vi.fn()
  render(<FolderUploadButton disabled={false} onFile={onFile} onError={onError} onBusyChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('选择文件夹'), { target: { files: [new File([''], 'a.zip')] } })
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith('文件夹内含压缩包，请先解压后再上传'))
  expect(onFile).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: '上传文件夹' }) as HTMLButtonElement).disabled).toBe(false)
})
