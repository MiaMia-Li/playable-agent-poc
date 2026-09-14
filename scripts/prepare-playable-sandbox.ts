import { Sandbox, type Snapshot } from '@vercel/sandbox'
import { config } from 'dotenv'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { sanitizeBuildActivityDetail } from '../lib/playable/build-activity-detail'
import {
  PLAYABLE_PLAYWRIGHT_VERSION,
  PLAYABLE_SANDBOX_TOOLS_VERSION,
  PLAYABLE_TOOLS_ROOT,
} from '../lib/playable/sandbox-tools'

config({ path: '.env.local', quiet: true })
const assets = path.resolve('scripts/playable-sandbox')
// 本地只保存云端快照的 ID；该文件不会被 Next.js 自动加载，需手动配置到部署环境。
const output = path.resolve('.env.playable-sandbox.local')

/** 一次性预装工具，验证原环境和恢复环境后，才生成可用于部署的快照配置。 */
export async function preparePlayableSandbox() {
  // 避免覆盖已有部署配置，也避免重复创建不必要的云端资源。
  const exists = await access(output).then(
    () => true,
    () => false,
  )
  if (exists) throw new Error('Snapshot configuration already exists; move it before creating a replacement')
  const token = process.env.SANDBOX_VERCEL_TOKEN
  const teamId = process.env.SANDBOX_VERCEL_TEAM_ID
  const projectId = process.env.SANDBOX_VERCEL_PROJECT_ID
  if ([token, teamId, projectId].some(Boolean) && ![token, teamId, projectId].every(Boolean)) {
    throw new Error('Sandbox credentials are incomplete')
  }
  // 凭据仅供宿主调用 Vercel API，不通过 env 注入虚拟机；未显式配置时交由 SDK 使用 OIDC。
  const credentials = token && teamId && projectId ? { token, teamId, projectId } : {}
  let sandbox: Sandbox | undefined
  let restored: Sandbox | undefined
  let snapshot: Snapshot | undefined
  let saved = false
  try {
    console.log('Creating clean browser tools environment')
    sandbox = await Sandbox.create({
      // 使用 Ubuntu 镜像以安装 Playwright 官方依赖；滚动镜像升级后需重新验证兼容性。
      image: 'vercel/sandbox/universal',
      persistent: false,
      timeout: 15 * 60 * 1000,
      ...credentials,
    })
    const run = async (cmd: string, args: string[], sudo = false, env?: Record<string, string>) => {
      const result = await sandbox!.runCommand({ cmd, args, sudo, env })
      if (result.exitCode !== 0) {
        // 终端只显示静态提示；命令输出脱敏后写入私有本地文件，便于定位失败步骤。
        const detail = sanitizeBuildActivityDetail(
          { input: JSON.stringify({ cmd, args }), output: await result.output() },
          [token ?? '', teamId ?? '', projectId ?? ''],
        )
        await writeFile('.playable-sandbox-setup.log', JSON.stringify(detail, null, 2), { mode: 0o600 })
        throw new Error('Snapshot setup command failed')
      }
    }
    // 只上传公共工具文件，不把项目源码、用户素材或任务产物带入基础快照。
    const files = await Promise.all(
      ['playwright.cjs', 'check.cjs', 'README.md'].map(async (name) => ({
        path: `/tmp/playable-tools-bootstrap/${name}`,
        content: await readFile(path.join(assets, name)),
      })),
    )
    files.push(
      {
        path: '/tmp/playable-tools-bootstrap/manifest.json',
        content: Buffer.from(
          JSON.stringify({
            version: PLAYABLE_SANDBOX_TOOLS_VERSION,
            playwrightVersion: PLAYABLE_PLAYWRIGHT_VERSION,
          }),
        ),
      },
      {
        path: '/tmp/playable-tools-bootstrap/package.json',
        content: Buffer.from(
          JSON.stringify({ private: true, dependencies: { playwright: PLAYABLE_PLAYWRIGHT_VERSION } }),
        ),
      },
    )
    await sandbox.writeFiles(files)
    await run('mkdir', ['-p', PLAYABLE_TOOLS_ROOT], true)
    await run('cp', ['-R', '/tmp/playable-tools-bootstrap/.', PLAYABLE_TOOLS_ROOT], true)
    console.log('Updating system package index')
    await run('apt-get', ['update'], true)
    console.log('Installing utilities and Chinese fonts')
    await run('apt-get', ['install', '-y', 'jq', 'zip', 'unzip', 'fonts-noto-cjk'], true)
    console.log('Installing pinned Playwright package')
    await run('npm', ['install', '--prefix', PLAYABLE_TOOLS_ROOT, '--ignore-scripts', '--no-audit', '--no-fund'], true)
    console.log('Installing Chromium and browser system dependencies')
    // 将浏览器安装在包内缓存，避免 root 安装、普通用户执行时使用不同的缓存目录。
    await run(
      'node',
      [`${PLAYABLE_TOOLS_ROOT}/node_modules/playwright/cli.js`, 'install', '--with-deps', 'chromium'],
      true,
      {
        PLAYWRIGHT_BROWSERS_PATH: '0',
      },
    )
    const checkEnv = { PLAYABLE_TOOLS_EXPECTED_VERSION: PLAYABLE_SANDBOX_TOOLS_VERSION }
    console.log('Checking installed browser')
    await run('node', [`${PLAYABLE_TOOLS_ROOT}/check.cjs`, '--launch'], false, checkEnv)
    await run('rm', ['-r', '/tmp/playable-tools-bootstrap'])
    console.log('Saving browser tools snapshot')
    // 快照保存在 Vercel 云端且不自动过期；后续每个任务从它创建独立环境。
    snapshot = await sandbox.snapshot({ expiration: 0 })
    // 必须在恢复出的新环境中再次启动浏览器，确认快照包含完整依赖且普通用户可访问。
    restored = await Sandbox.create({
      source: { type: 'snapshot', snapshotId: snapshot.snapshotId },
      persistent: false,
      timeout: 2 * 60 * 1000,
      ...credentials,
    })
    const check = await restored.runCommand({
      cmd: 'node',
      args: [`${PLAYABLE_TOOLS_ROOT}/check.cjs`, '--launch'],
      env: checkEnv,
    })
    if (check.exitCode !== 0) throw new Error('Restored browser check failed')
    // wx 防止并发覆盖；只有恢复验证成功的快照才能进入部署配置。
    await writeFile(output, `PLAYABLE_SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}\n`, { flag: 'wx', mode: 0o600 })
    saved = true
    console.log('Snapshot verified; configuration saved to .env.playable-sandbox.local')
  } finally {
    // 无论成功失败都停止临时环境；未成功保存配置的快照一并删除，避免遗留无效资源。
    await restored?.stop().catch(() => {
      console.error('Snapshot test environment cleanup failed')
    })
    await sandbox?.stop().catch(() => {
      console.error('Snapshot setup environment cleanup failed')
    })
    if (snapshot && !saved)
      await snapshot.delete().catch(() => {
        console.error('Unverified snapshot cleanup failed')
      })
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === 'prepare-playable-sandbox.ts') {
  preparePlayableSandbox().catch(() => {
    console.error(
      'Playable snapshot preparation failed; failed command details are saved to .playable-sandbox-setup.log when available',
    )
    process.exitCode = 1
  })
}
