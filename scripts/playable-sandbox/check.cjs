const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require('./playwright.cjs')
const manifest = require('./manifest.json')

async function check() {
  // 每次构建只检查版本和可执行文件，尽早发现旧快照或安装不完整的问题。
  assert.equal(manifest.version, process.env.PLAYABLE_TOOLS_EXPECTED_VERSION)
  assert.equal(require('./node_modules/playwright/package.json').version, manifest.playwrightVersion)
  fs.accessSync(chromium.executablePath(), fs.constants.X_OK)
  // 实际启动、点击和截图仅在创建快照及恢复验证时执行，避免给每次构建增加启动开销。
  if (!process.argv.includes('--launch')) return
  const browser = await chromium.launch({ headless: true })
  try {
    // 这里只证明浏览器具备基础交互和横竖屏截图能力，不代表游戏玩法已通过验收。
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } })
    await page.setContent('<html><body><button>开始试玩</button><canvas width="360" height="640"></canvas></body></html>')
    await page.locator('button').click()
    assert.equal(await page.locator('button').textContent(), '开始试玩')
    assert.ok((await page.screenshot()).byteLength > 0)
    await page.setViewportSize({ width: 640, height: 360 })
    assert.ok((await page.screenshot()).byteLength > 0)
  } finally {
    await browser.close()
  }
}

check().catch(() => {
  console.error('Preinstalled browser check failed')
  process.exitCode = 1
})
