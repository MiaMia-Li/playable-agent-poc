import { Sandbox, type Snapshot } from '@vercel/sandbox'
import { createCodex } from '@ai-sdk/harness-codex'
import { prepareSandboxForHarness } from '@ai-sdk/harness/agent'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
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
    console.log('Installing utilities, Chinese fonts and ffmpeg')
    // ffmpeg cuts Reference Keyframes. It is checked by the keyframe extractor
    // itself, not by the build's tools version, so an older snapshot only costs
    // the keyframes (ADR 0003).
    await run('apt-get', ['install', '-y', 'jq', 'zip', 'unzip', 'fonts-noto-cjk', 'ffmpeg'], true)
    await run('ffmpeg', ['-hide_banner', '-version'])
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
    console.log('Installing build agent harness runtime')
    // 预装 Harness 的 bridge 及其依赖。构建时 createSession 读到同一份 bootstrap 标记即跳过，
    // 不必每个任务在沙盒里重装一次；标记随 Harness 版本变化，对不上时仍会自动重装。
    const harnessSession = await createVercelSandbox({ sandbox }).createSession()
    // Bootstrap 配方与认证无关，只包含 adapter 声明的文件和安装命令。
    const codex = createCodex()
    const prepared = await prepareSandboxForHarness({ harnesses: [codex], session: harnessSession })
    // 配方指纹决定构建时查找的标记文件名；缺失说明 adapter 没有声明 bootstrap，预装无从谈起。
    const harnessRecipeIdentity = prepared.recipeIdentities[codex.harnessId]
    if (prepared.skippedHarnessIds.length > 0 || !harnessRecipeIdentity)
      throw new Error('Harness bootstrap recipe is unavailable')
    // 安装目录与标记命名都是 Harness 内部约定；约定变了这里会直接失败，不会悄悄产出无效快照。
    const harnessBootstrapDir = path.posix.join(harnessSession.defaultWorkingDirectory, '.harness-bootstrap/codex')
    const harnessMarker = path.posix.join(harnessBootstrapDir, `.bootstrap-${harnessRecipeIdentity}.ok`)
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
    const ffmpegCheck = await restored.runCommand({ cmd: 'ffmpeg', args: ['-hide_banner', '-version'] })
    if (ffmpegCheck.exitCode !== 0) throw new Error('Restored ffmpeg check failed')
    // 构建时按这个确切文件名判断能否跳过安装；换成任意标记只能证明装过某份配方，证明不了是这一份。
    const harnessCheck = await restored.runCommand({
      cmd: 'node',
      args: [
        '-e',
        "const fs=require('node:fs');if(!fs.existsSync(`${process.env.HARNESS_BOOTSTRAP_DIR}/node_modules`))process.exit(1);if(!fs.existsSync(process.env.HARNESS_BOOTSTRAP_MARKER))process.exit(1)",
      ],
      env: { HARNESS_BOOTSTRAP_DIR: harnessBootstrapDir, HARNESS_BOOTSTRAP_MARKER: harnessMarker },
    })
    if (harnessCheck.exitCode !== 0) throw new Error('Restored harness runtime check failed')
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
