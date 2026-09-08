import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'

export default function TaskLoading() {
  return (
    <main className="bg-background flex min-h-dvh flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="试玩工作台首页">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          Playable Studio
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="text-center" role="status" aria-live="polite">
          <Loader2 className="text-muted-foreground mx-auto mb-3 size-8 animate-spin" aria-hidden="true" />
          <p className="text-muted-foreground text-sm">正在加载试玩…</p>
        </div>
      </div>
    </main>
  )
}
