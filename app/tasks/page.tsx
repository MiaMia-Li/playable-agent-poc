import { getServerSession } from '@/lib/session/get-server-session'
import { redirect } from 'next/navigation'

export default async function TasksListPage() {
  const session = await getServerSession()
  if (!session?.user) redirect('/')
  redirect('/')
}
