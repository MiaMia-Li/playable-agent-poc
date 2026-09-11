import { cookies, headers } from 'next/headers'
import { AppLayout } from './app-layout'
import { getSidebarWidthFromCookie, getSidebarOpenFromCookie } from '@/lib/utils/cookies'

interface AppLayoutWrapperProps {
  children: React.ReactNode
}

export async function AppLayoutWrapper({ children }: AppLayoutWrapperProps) {
  const cookieStore = await cookies()
  const cookieString = cookieStore.toString()
  const initialSidebarWidth = getSidebarWidthFromCookie(cookieString)
  const initialSidebarOpen = getSidebarOpenFromCookie(cookieString)

  // Detect if mobile from user agent
  const headersList = await headers()
  const userAgent = headersList.get('user-agent') || ''
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
  const localDemo = process.env.NODE_ENV !== 'production' && process.env.LOCAL_DEMO_MODE === '1'
  const localCodex = process.env.NODE_ENV !== 'production' && process.env.LOCAL_CODEX_MODE === '1'
  const localHarness = process.env.NODE_ENV !== 'production' && process.env.LOCAL_HARNESS_MODE === '1'
  const playableAccountLabel = localDemo
    ? '本地演示'
    : localCodex
      ? '本地 Codex'
      : localHarness
        ? '本地 Harness'
        : '公开体验'

  return (
    <AppLayout
      initialSidebarWidth={initialSidebarWidth}
      initialSidebarOpen={initialSidebarOpen}
      initialIsMobile={isMobile}
      playableAccountLabel={playableAccountLabel}
      playablePublicAccess={!localDemo && !localCodex && !localHarness}
    >
      {children}
    </AppLayout>
  )
}
