import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Skill 和预览截图渲染器都在运行时通过文件系统读取，显式包含，避免线上函数漏打包。
  outputFileTracingIncludes: {
    '/api/playable-tasks/**': ['./skills/**/*', './node_modules/html-to-image/dist/html-to-image.js'],
  },
  // unrar 在运行时定位随包分发的 WASM，保留原包结构避免服务端打包改变资源路径。
  serverExternalPackages: ['ws', '@ai-sdk/harness-codex', 'node-unrar-js'],
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
