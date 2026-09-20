// 安装包或浏览器入口契约变化时递增；构建端据此拒绝不兼容的旧快照。仅补注释无需递增。
export const PLAYABLE_SANDBOX_TOOLS_VERSION = '2'
// 该版本支持当前镜像的 Ubuntu 26.04；旧版 1.58.2 会在安装浏览器依赖时失败。
export const PLAYABLE_PLAYWRIGHT_VERSION = '1.63.0'
// 工具放在任务工作区之外，避免每次构建重新安装或被游戏文件覆盖。
export const PLAYABLE_TOOLS_ROOT = '/opt/playable-tools'
export const PLAYABLE_TOOLS_CHECK = 'node /opt/playable-tools/check.cjs'
// 同时兼容未配置快照的环境：存在预装说明时才要求 Agent 使用固定入口。
export const PLAYABLE_TOOLS_PROMPT =
  'Use the detected tools in work/acceptance-handoff.json during acceptance; otherwise read sandbox-tools.json. Use node assets/starter/work/node-tools.mjs header|json|hash INPUT OUTPUT for binary headers, JSON and hashes; do not assume xxd, jq or Python exist. ' +
  'A playable HTML baseline holds its assets inline, so a single line can be megabytes: never dump one with cat, sed, nl, head, tail, awk or an unbounded rg. Read it with node assets/starter/work/node-tools.mjs slice FILE FROM TO (numbered lines, over-long lines shortened, at most 400 lines per call) and locate text with node assets/starter/work/node-tools.mjs search FILE PATTERN (case-insensitive, match context only, never whole lines). Plain rg is fine only with --max-columns 200. ' +
  'What one command hands back is capped; past the cap the output is withheld with a notice while the command still completes normally. Treat that notice as a signal to narrow the range, never to retry the same dump. If the browser wrapper is not already established in the handoff, check whether /opt/playable-tools/README.md exists. If present, read it and use the preinstalled Playwright wrapper; do not run npm install or download browsers again. If absent, use the available browser tooling. Cocos inspection exit zero means the diagnostic report was saved, not that decoding is supported. Read status and code in work/cocos-inspection/latest.json directly; on unsupported, inspect the report and switch to targeted source inspection without retrying unchanged input. Do not depend on a temporary pretty report or execute sliced obfuscated initialization.'
