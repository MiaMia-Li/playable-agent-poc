import { getServerSession } from '@/lib/session/get-server-session'
import { PlayableHome } from '@/components/playable/playable-workspace'

export default async function Home() {
  const session = await getServerSession()
  return <PlayableHome user={session?.user ?? null} authProvider={session?.authProvider ?? null} />
}
