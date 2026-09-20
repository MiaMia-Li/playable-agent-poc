/**
 * 一条 Agent 命令能带回模型的字节上限。
 *
 * 构建基底是单文件试玩，整行可能是上兆的 base64；`sed`、`nl` 或 `rg` 命中那一行就会
 * 把整份产物塞进工具输出，一次要花数百秒，而宿主最终只保留 24000 字符用于展示。
 * 这里在沙盒里对 Agent 登录 shell 的 stdout 和 stderr 各接一个采集进程：命令照常跑完、
 * 退出码不变、命令内部写文件的重定向不经过这里，只有回传给模型的字节被截断。
 *
 * 宿主自己的 `sandbox.run` 用的是 `bash -c`，不读 `.bash_profile`，因此验收、打包和
 * 产物检查的输出不受影响。
 */
export const PLAYABLE_OUTPUT_CAP_BYTES = 32768
/** 放在工作区之外，Agent 清理 `work/` 时不会把守卫一起删掉。 */
export const OUTPUT_CAP_DIRECTORY = '.playable-tools'
export const OUTPUT_CAP_SCRIPT_NAME = 'output-cap.mjs'
/** 同一个沙盒重复安装时据此跳过，避免叠加多层重定向。 */
export const OUTPUT_CAP_MARKER = '# playable-output-cap'

/** 读完整条流但只放行前 N 字节；提前退出会让上游收到 EPIPE 并改写退出码。 */
export const OUTPUT_CAP_SCRIPT = `import { stdin, stdout, env } from 'node:process'

const configured = Number.parseInt(env.PLAYABLE_OUTPUT_CAP_BYTES ?? '', 10)
const cap = Number.isFinite(configured) && configured > 0 ? configured : ${PLAYABLE_OUTPUT_CAP_BYTES}
let written = 0
let withheld = 0

stdout.on('error', () => {})
stdin.on('data', (chunk) => {
  const room = Math.max(0, cap - written)
  const forwarded = Math.min(room, chunk.length)
  if (forwarded > 0) {
    written += forwarded
    stdout.write(chunk.subarray(0, forwarded))
  }
  withheld += chunk.length - forwarded
})
stdin.on('end', () => {
  if (withheld === 0) return
  stdout.write(
    '\\n[output capped at ' +
      cap +
      ' bytes; ' +
      withheld +
      ' more bytes were withheld. The command itself completed. Do not retry the same dump: read a narrower range with ' +
      'node assets/starter/work/node-tools.mjs slice FILE FROM TO, or locate text with ' +
      'node assets/starter/work/node-tools.mjs search FILE PATTERN.]\\n',
  )
})
`

/**
 * 登录 shell 片段。采集进程用进程替换接管 stdout 和 stderr，保持流式输出。
 * 退出前先把 fd 还回原处让采集进程读到 EOF，再等它写完：`wait` 对进程替换的 PID
 * 并非所有 bash 版本都支持，失败时退回有上限的轮询，既不丢末尾输出，
 * 也不会因为命令留下了仍持有管道的后台进程而让 shell 永远停住。
 */
export function outputCapProfile(scriptPath: string, capBytes: number = PLAYABLE_OUTPUT_CAP_BYTES): string {
  return `${OUTPUT_CAP_MARKER}
# Installed by the playable build host. Bounds the bytes one agent command hands back
# to the model. Commands still run to completion, exit codes are unchanged, and
# redirections to files inside a command never pass through here.
if [ -z "\${PLAYABLE_OUTPUT_CAP_ACTIVE:-}" ] && [ -n "\${BASH_VERSION:-}" ] && [ -r "${scriptPath}" ] && command -v node >/dev/null 2>&1; then
  export PLAYABLE_OUTPUT_CAP_ACTIVE=1
  export PLAYABLE_OUTPUT_CAP_BYTES=${capBytes}
  __playable_cap_finish() {
    exec 1>&3 2>&4
    wait "\$__playable_cap_out" "\$__playable_cap_err" 2>/dev/null
    __playable_cap_tries=0
    while kill -0 "\$__playable_cap_out" 2>/dev/null || kill -0 "\$__playable_cap_err" 2>/dev/null; do
      [ "\$__playable_cap_tries" -ge 100 ] && break
      __playable_cap_tries=\$((__playable_cap_tries + 1))
      sleep 0.05
    done
  }
  exec 3>&1 4>&2
  exec 1> >(node "${scriptPath}" >&3)
  __playable_cap_out=\$!
  exec 2> >(node "${scriptPath}" >&4)
  __playable_cap_err=\$!
  trap __playable_cap_finish EXIT
fi
`
}

export interface OutputCapSandbox {
  readonly defaultWorkingDirectory: string
  writeTextFile(options: { path: string; content: string; abortSignal?: AbortSignal }): PromiseLike<void>
  readTextFile(options: { path: string; abortSignal?: AbortSignal }): PromiseLike<string | null>
  run(options: { command: string; abortSignal?: AbortSignal }): PromiseLike<{ exitCode: number; stdout: string }>
}

/**
 * 装好并经登录 shell 验证后返回 true。已有 `.bash_profile` 时追加，缺失时先 source `.profile`，
 * 否则新建的 `.bash_profile` 会遮蔽镜像原本的 PATH 设置。
 *
 * 宿主的 `run` 用 `bash -c`，Agent 用 `/bin/bash -lc`，两者的 `$HOME` 必须指向同一处，
 * 所以最后拿登录 shell 实测一次，而不是假定写进去就生效。
 */
export async function installOutputCap(
  sandbox: OutputCapSandbox,
  options: { capBytes?: number; abortSignal?: AbortSignal } = {},
): Promise<boolean> {
  const abort = options.abortSignal ? { abortSignal: options.abortSignal } : {}
  const home = await sandbox.run({ command: 'printf %s "$HOME"', ...abort })
  const homeDirectory = home.exitCode === 0 ? home.stdout.trim() : ''
  if (!homeDirectory.startsWith('/')) return false
  const scriptPath = `${sandbox.defaultWorkingDirectory}/${OUTPUT_CAP_DIRECTORY}/${OUTPUT_CAP_SCRIPT_NAME}`
  const profilePath = `${homeDirectory}/.bash_profile`
  const existing = await sandbox.readTextFile({ path: profilePath, ...abort })
  if (!existing?.includes(OUTPUT_CAP_MARKER)) {
    await sandbox.writeTextFile({ path: scriptPath, content: OUTPUT_CAP_SCRIPT, ...abort })
    const profile = outputCapProfile(scriptPath, options.capBytes ?? PLAYABLE_OUTPUT_CAP_BYTES)
    await sandbox.writeTextFile({
      path: profilePath,
      content:
        existing === null
          ? `# 新建的 .bash_profile 会取代 .profile，先保留镜像原有的 PATH 与运行时设置。\nif [ -f "${homeDirectory}/.profile" ]; then . "${homeDirectory}/.profile"; fi\n\n${profile}`
          : `${existing.endsWith('\n') ? existing : `${existing}\n`}\n${profile}`,
      ...abort,
    })
  }
  const probe = await sandbox.run({
    command: '/bin/bash -lc \'printf %s "${PLAYABLE_OUTPUT_CAP_ACTIVE:-off}"\'',
    ...abort,
  })
  return probe.exitCode === 0 && probe.stdout.trim().endsWith('1')
}
