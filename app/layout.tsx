import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { AppLayoutWrapper } from '@/components/app-layout-wrapper'
import { JotaiProvider } from '@/components/providers/jotai-provider'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { PlayableRecentTasksProvider } from '@/components/playable/recent-tasks-context'
import { BuildNotifications } from '@/components/playable/build-notifications'

export const metadata: Metadata = {
  title: 'Playable Studio',
  description: '通过对话整理需求、确认方案并生成可交互试玩。',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <JotaiProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {/* <SessionProvider /> */}
            <PlayableRecentTasksProvider>
              <AppLayoutWrapper>{children}</AppLayoutWrapper>
            </PlayableRecentTasksProvider>
            <Toaster />
            {/* 监听器跨任务页面保留，离开当前任务后仍能收到构建结果。 */}
            <BuildNotifications />
          </ThemeProvider>
        </JotaiProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
