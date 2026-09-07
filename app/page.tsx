import { getServerSession } from '@/lib/session/get-server-session'
import { PlayableHome } from '@/components/playable/playable-workspace'
import { isLocalDemoMode, localDemoSession } from '@/lib/playable/local-demo-prototype'

export default async function Home() {
  const localDemo = isLocalDemoMode()
  const session = localDemo ? localDemoSession : await getServerSession()
  return (
    <PlayableHome user={session?.user ?? null} authProvider={session?.authProvider ?? null} localDemo={localDemo} />
  )
}
