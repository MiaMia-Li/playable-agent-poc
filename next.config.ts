import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Skill 入口按确认配置动态选择，显式打包，避免线上函数漏掉新增的指令文件。
  outputFileTracingIncludes: { '/api/playable-tasks/**': ['./skills/**/*'] },
  serverExternalPackages: ['ws', '@ai-sdk/harness-codex'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'github.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
}

export default nextConfig
