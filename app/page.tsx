import { getServerSession } from '@/lib/session/get-server-session'
import { PlayableHome } from '@/components/playable/playable-workspace'
import { isLocalDemoMode, localDemoSession } from '@/lib/playable/local-demo-prototype'
import { isLocalCodexMode, isLocalHarnessMode, localCodexSession } from '@/lib/playable/local-codex-runtime'

export default async function Home() {
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const localHarness = isLocalHarnessMode()
  const session = localDemo
    ? localDemoSession
    : localCodex || localHarness
      ? localCodexSession
      : await getServerSession()
  return (
    <PlayableHome
      user={session?.user ?? null}
      authProvider={session?.authProvider ?? null}
      localDemo={localDemo}
      localCodex={localCodex}
      localHarness={localHarness}
    />
  )
}
