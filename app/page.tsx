import { PlayableHome } from '@/components/playable/playable-workspace'
import { isLocalDemoMode, localDemoSession } from '@/lib/playable/local-demo-prototype'
import { isLocalCodexMode, isLocalHarnessMode, localCodexSession } from '@/lib/playable/local-codex-runtime'
import { publicPlayableSession } from '@/lib/playable/public-access'

export default async function Home() {
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const localHarness = isLocalHarnessMode()
  const session = localDemo ? localDemoSession : localCodex || localHarness ? localCodexSession : publicPlayableSession
  return (
    <PlayableHome
      user={session?.user ?? null}
      authProvider={session?.authProvider ?? null}
      localDemo={localDemo}
      localCodex={localCodex}
      localHarness={localHarness}
      publicAccess={!localDemo && !localCodex && !localHarness}
    />
  )
}
