import { Loader2 } from 'lucide-react'

export default function TaskLoading() {
  return (
    <main className="bg-background flex h-full min-h-0 flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="text-center" role="status" aria-live="polite">
          <Loader2 className="text-muted-foreground mx-auto mb-3 size-8 animate-spin" aria-hidden="true" />
          <p className="text-muted-foreground text-sm">正在加载试玩…</p>
        </div>
      </div>
    </main>
  )
}
