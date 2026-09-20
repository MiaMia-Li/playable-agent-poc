import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCtaAcceptance, installMraidRecorder } from './cta-acceptance.mjs'
import { createTemplateProbe } from './template-probe.mjs'
import { installRuntimeEvidence, runtimeEvidenceChecks } from './runtime-evidence.mjs'

// 通用验收入口：环境、监听、截图和证据只维护一份；玩法断言由本次场景模块补充。
const require = createRequire(import.meta.url)
let browser
let timer
const smoke = process.argv.includes('--smoke')
const report = { passed: false, smoke, checks: [], errors: [], requests: [], screenshots: [], cta: [] }
let stage = 'setup'
const startedAt = Date.now()
const evidenceDir = path.resolve('work/browser-acceptance')
try {
  const [html, scenario] = process.argv.slice(2)
  if (!html || !scenario) throw new Error('Provide HTML and scenario module')
  const artifact = path.resolve(html)
  report.sha256 = createHash('sha256').update(await readFile(artifact)).digest('hex')
  const playwright = (() => {
    try { return require('/opt/playable-tools/playwright.cjs') }
    catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
      return createRequire(path.join(process.cwd(), 'package.json'))('playwright')
    }
  })()
  const config = JSON.parse(await readFile('confirmed-config.json', 'utf8').catch(() => '{}'))
  const rendering = process.env.PLAYABLE_RENDERER
    ? { renderer: process.env.PLAYABLE_RENDERER, physics: process.env.PLAYABLE_PHYSICS }
    : config.rendering
  const evidenceKey = `__runtime_${createHash('sha256').update(String(Math.random())).digest('hex')}`
  const run = (await import(pathToFileURL(path.resolve(scenario)).href)).default
  if (typeof run !== 'function') throw new Error('Scenario must export an acceptance function')
  await mkdir(evidenceDir, { recursive: true })
  stage = 'launch'
  browser = await playwright.chromium.launch({ headless: true, timeout: 30000 })
  const context = await browser.newContext({ viewport: { width: 360, height: 640 } })
  context.setDefaultTimeout(10000)
  const page = await context.newPage()
  if (!smoke) await installMraidRecorder(page, () => {})
  if (rendering?.renderer === 'threejs') await page.addInitScript(installRuntimeEvidence, evidenceKey)
  // 允许单文件内嵌资源，拦截外部资源和弹窗，避免自动验收触发商店导航。
  await context.route(/https?:\/\//, route => { report.requests.push(route.request().url()); return route.abort() })
  context.on('page', popup => { if (popup !== page) { report.errors.push('Unexpected popup'); void popup.close() } })
  page.on('pageerror', () => report.errors.push('Uncaught page error'))
  page.on('console', message => {
    if (message.type() !== 'error') return
    report.errors.push('Browser console error')
    // Classify the known template SDK error without retaining console payloads.
    if (message.text().includes('[super-html] Unable to run, please run on')) report.errors.push('Ad platform unavailable')
  })
  const check = (name, condition) => {
    report.checks.push({ name, passed: Boolean(condition) })
    if (!condition) throw new Error('Gameplay assertion failed')
  }
  const capture = async name => {
    const filename = `${report.screenshots.length}-${String(name).replace(/[^a-z0-9_-]/gi, '_')}.png`
    await page.screenshot({ path: path.join(evidenceDir, filename) })
    report.screenshots.push(filename)
  }
  const navigation = createCtaAcceptance({ browser, artifactUrl: pathToFileURL(artifact).href, storeUrl: config.storeUrl, createProbe: target => createTemplateProbe(target, config.sourceTemplateId ?? config.mode), check, report: report.cta })
  await Promise.race([
    (async () => {
      stage = 'navigation'
      await page.goto(pathToFileURL(artifact).href, { waitUntil: 'load', timeout: 30000 })
      stage = 'contract'
      await page.waitForFunction(() => Boolean(window.__PLAYABLE__), undefined, { timeout: 15000 })
      stage = 'scenario'
      await run({ page, context, check, capture, navigation, probe: createTemplateProbe(page, config.sourceTemplateId ?? config.mode),
        // 坐标基于当前画布边界，避免模板逻辑尺寸与浏览器缩放不同导致误点。
        clickCanvas: async (x, y) => {
          const box = await page.locator('canvas').first().boundingBox()
          if (!box || x < 0 || x > 1 || y < 0 || y > 1) throw new Error('Invalid canvas click')
          await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
        },
      })
      if (report.checks.length === 0) throw new Error('Scenario did not assert gameplay')
      if (!smoke) navigation.assertVerified()
      stage = 'capture'
      await capture('portrait')
      if (!smoke) {
      await page.setViewportSize({ width: 640, height: 360 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await capture('landscape')
      }
      stage = 'network'
      if (rendering?.renderer === 'threejs') {
        stage = 'rendering'
        report.runtime = await page.evaluate(key => globalThis[key](), evidenceKey)
        for (const [name, passed] of runtimeEvidenceChecks(rendering, report.runtime)) check(name, passed)
      }
      stage = 'network'
      check('No external requests', report.requests.length === 0)
      stage = 'browser_errors'
      check('No browser errors or popups', report.errors.length === 0)
      report.passed = true
    })(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Acceptance timed out')), smoke ? 30000 : 120000) }),
  ])
} catch (error) {
  const codes = {
    'Acceptance timed out': 'timeout',
    'Gameplay assertion failed': 'assertion_failed',
    'Scenario must export an acceptance function': 'invalid_scenario',
    'Invalid canvas click': 'invalid_click',
    'Scenario did not assert gameplay': 'missing_assertions',
  }
  report.failure = { stage, code: error?.name === 'TimeoutError' ? 'timeout' : Object.hasOwn(codes, error?.message) ? codes[error.message] : 'execution_failed' }
  report.passed = false
  process.exitCode = 1
  console.error('Browser acceptance failed; inspect collected evidence')
} finally {
  clearTimeout(timer)
  try { await browser?.close() } catch { /* Preserve the original failure report. */ }
  report.durationMs = Date.now() - startedAt
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(path.join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2))
}
