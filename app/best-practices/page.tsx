import { BestPracticesPage } from '@/components/playable/best-practices-page'
import { isLocalDemoMode, localDemoSession } from '@/lib/playable/local-demo-prototype'
import { isLocalCodexMode, isLocalHarnessMode, localCodexSession } from '@/lib/playable/local-codex-runtime'
import { publicPlayableSession } from '@/lib/playable/public-access'

export default function BestPractices() {
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const localHarness = isLocalHarnessMode()
  const session = localDemo ? localDemoSession : localCodex || localHarness ? localCodexSession : publicPlayableSession
  const accountLabel = localDemo ? '本地演示' : localCodex ? '本地 Codex' : localHarness ? '本地 Harness' : '公开体验'

  return (
    <BestPracticesPage
      accountLabel={session?.user.name || session?.user.username || accountLabel}
      publicAccess={!localDemo && !localCodex && !localHarness}
    />
  )
}
