import { VersionsPage } from '@/components/playable/versions-page'
import { isLocalDemoMode, localDemoSession } from '@/lib/playable/local-demo-prototype'
import { isLocalCodexMode, isLocalHarnessMode, localCodexSession } from '@/lib/playable/local-codex-runtime'
import { publicPlayableSession } from '@/lib/playable/public-access'

export default function Versions() {
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const localHarness = isLocalHarnessMode()
  const session = localDemo ? localDemoSession : localCodex || localHarness ? localCodexSession : publicPlayableSession
  const accountLabel = localDemo ? '本地演示' : localCodex ? '本地 Codex' : localHarness ? '本地 Harness' : '公开体验'

  return (
    <VersionsPage
      accountLabel={session?.user.name || session?.user.username || accountLabel}
      publicAccess={!localDemo && !localCodex && !localHarness}
    />
  )
}
