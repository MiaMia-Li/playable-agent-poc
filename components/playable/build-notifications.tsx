'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { BUILD_WATCH_EVENT, BUILD_WATCH_KEY, readWatchedBuilds } from '@/lib/playable/build-notifications'

/** 挂在根布局，站内跳转不会中断当前标签页已登记的构建监听。 */
export function BuildNotifications() {
  const router = useRouter()
  useEffect(() => {
    const watched = new Set(readWatchedBuilds())
    const pending = new Set<string>()
    const controller = new AbortController()
    const persist = () => {
      try {
        sessionStorage.setItem(BUILD_WATCH_KEY, JSON.stringify([...watched]))
      } catch {
        /* 存储不可用时仍保留内存监听，当前页面的完成提醒不受影响。 */
      }
    }
    const poll = async (taskId: string) => {
      // 慢请求可能超过轮询间隔，同一任务至多保留一个进行中的状态请求。
      if (pending.has(taskId)) return
      pending.add(taskId)
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/events`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (response.status === 404) {
          watched.delete(taskId)
          persist()
          return
        }
        if (!response.ok) return
        const body = await response.json()
        const phase = body.task?.phase
        if (!phase || phase === 'building' || phase === 'validating' || controller.signal.aborted) return
        // 排队需求可能在本次轮询前就把任务推进到待确认阶段；此时须从构建事件判断成败。
        const lastBuildEvent = Array.isArray(body.events)
          ? body.events.findLast((event: { type?: string }) =>
              ['build_started', 'build_succeeded', 'build_failed'].includes(event?.type ?? ''),
            )?.type
          : undefined
        const failed = phase === 'failed' || lastBuildEvent === 'build_failed'
        const succeeded = phase === 'ready' || phase === 'reviewing' || lastBuildEvent === 'build_succeeded'
        if (phase !== 'cancelled' && !failed && !succeeded) return
        // 提醒前先移除并持久化，后续轮询或重新挂载不会对同一次构建重复通知。
        if (!watched.delete(taskId)) return
        persist()
        if (phase === 'cancelled') return
        const title = failed ? '试玩构建未完成' : '试玩已生成'
        const description = failed ? '打开任务查看原因，可以重试或继续修改。' : '可以开始试玩，或继续处理排队需求。'
        const open = () => router.push(`/tasks/${encodeURIComponent(taskId)}`)
        const options = { description, duration: 10000, action: { label: '打开任务', onClick: open } }
        if (failed) toast.error(title, options)
        else toast.success(title, options)
        if (
          document.visibilityState === 'hidden' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          try {
            const notification = new Notification(title, { body: description, tag: `playable-build-${taskId}` })
            notification.onclick = () => {
              window.focus()
              open()
              notification.close()
            }
          } catch {
            /* 不支持系统通知的浏览器仍可使用站内提醒。 */
          }
        }
      } catch {
        /* 临时网络错误留待下一次轮询重试，不丢弃监听记录。 */
      } finally {
        pending.delete(taskId)
      }
    }
    const watch = (event: Event) => {
      const taskId = (event as CustomEvent<unknown>).detail
      if (typeof taskId !== 'string' || !taskId || watched.has(taskId)) return
      watched.add(taskId)
      persist()
    }
    window.addEventListener(BUILD_WATCH_EVENT, watch)
    const tick = () => {
      for (const taskId of watched) void poll(taskId)
    }
    tick()
    const timer = setInterval(tick, 5000)
    return () => {
      window.removeEventListener(BUILD_WATCH_EVENT, watch)
      clearInterval(timer)
      controller.abort()
    }
  }, [router])
  return null
}

function subscribePermission(change: () => void) {
  window.addEventListener('focus', change)
  window.addEventListener('playable:notification-permission', change)
  return () => {
    window.removeEventListener('focus', change)
    window.removeEventListener('playable:notification-permission', change)
  }
}

export function BuildNotificationButton() {
  // 回到页面时重新读取权限；权限请求仅由下面的用户点击触发，服务端渲染不访问浏览器 API。
  const permission = useSyncExternalStore(
    subscribePermission,
    () => ('Notification' in window ? Notification.permission : 'unsupported'),
    () => 'unsupported',
  )
  const [error, setError] = useState('')
  if (permission === 'unsupported') return null
  return (
    <div className="mt-2">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-1 text-xs"
        disabled={permission === 'granted'}
        onClick={async () => {
          setError('')
          try {
            const next = await Notification.requestPermission()
            window.dispatchEvent(new Event('playable:notification-permission'))
            if (next === 'denied') setError('请在浏览器的网站设置中允许通知。站内完成提醒仍可使用。')
          } catch {
            setError('浏览器通知暂不可用，完成后仍会在站内提醒。')
          }
        }}
      >
        {permission === 'granted' ? <BellRing /> : <Bell />}
        {permission === 'granted' ? '已开启完成提醒' : '开启浏览器完成提醒'}
      </Button>
      {error && (
        <p role="status" className="text-muted-foreground text-xs">
          {error}
        </p>
      )}
    </div>
  )
}
