import { APIError, Sandbox } from '@vercel/sandbox'

/** 只读检查沙箱状态，不能为了判断构建是否停止而唤醒已停止的沙箱。 */
export async function readBuildSandboxState(sandboxId: string): Promise<'active' | 'stopped' | 'unknown'> {
  const credentials =
    process.env.SANDBOX_VERCEL_TOKEN && process.env.SANDBOX_VERCEL_TEAM_ID && process.env.SANDBOX_VERCEL_PROJECT_ID
      ? {
          token: process.env.SANDBOX_VERCEL_TOKEN,
          teamId: process.env.SANDBOX_VERCEL_TEAM_ID,
          projectId: process.env.SANDBOX_VERCEL_PROJECT_ID,
        }
      : {}
  try {
    const sandbox = await Sandbox.get({
      name: sandboxId,
      resume: false,
      signal: AbortSignal.timeout(5000),
      ...credentials,
    })
    // stopping 等过渡态仍可能占用资源，只有明确的终态才允许判定停止。
    return ['stopped', 'failed', 'aborted'].includes(sandbox.status) ? 'stopped' : 'active'
  } catch (error) {
    // destroy() 会删除沙箱，因此 404 也视为停止；鉴权、网络或限流错误仅代表状态未知。
    // 不输出原始错误，避免泄露凭据及内部沙箱信息。
    if (error instanceof APIError && error.response.status === 404) return 'stopped'
    console.error('Unable to inspect playable build sandbox')
    return 'unknown'
  }
}
