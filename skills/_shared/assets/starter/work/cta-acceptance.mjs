// Test MRAID at the actual SDK boundary without opening a store or injecting game state.
export async function installMraidRecorder(page, record) {
  await page.exposeBinding('__recordPlayableMraidOpen', (_, url) => record(url))
  await page.addInitScript(() => {
    const listeners = new Map()
    window.mraid = {
      getVersion: () => '2.0',
      getState: () => 'default',
      isViewable: () => true,
      getPlacementType: () => 'interstitial',
      supports: () => false,
      getScreenSize: () => ({ width: innerWidth, height: innerHeight }),
      getMaxSize: () => ({ width: innerWidth, height: innerHeight }),
      getCurrentPosition: () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }),
      getDefaultPosition: () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }),
      addEventListener: (name, fn) => {
        if (!listeners.has(name)) listeners.set(name, new Set())
        listeners.get(name).add(fn)
      },
      removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
      open: (url) => {
        void window.__recordPlayableMraidOpen(url)
      },
    }
  })
}

export function createCtaAcceptance({ browser, artifactUrl, storeUrl, createProbe, check, report }) {
  let verified = false
  return {
    async verify({ reachCta, clickCta, automaticDelayMs }) {
      if (typeof reachCta !== 'function' || typeof clickCta !== 'function') throw new Error('Invalid CTA scenario')
      if (
        automaticDelayMs !== undefined &&
        (!Number.isFinite(automaticDelayMs) || automaticDelayMs <= 0 || automaticDelayMs > 60000)
      )
        throw new Error('Invalid CTA delay')
      for (const automatic of automaticDelayMs === undefined ? [false] : [false, true]) {
        const context = await browser.newContext({ viewport: { width: 360, height: 640 } })
        try {
          const calls = []
          const errors = []
          await context.route(/https?:\/\//, (route) => {
            errors.push('External navigation')
            return route.abort()
          })
          const page = await context.newPage()
          context.on('page', (popup) => {
            if (popup !== page) {
              errors.push('Unexpected popup')
              void popup.close()
            }
          })
          page.on('pageerror', () => errors.push('Page error'))
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push('Console error')
          })
          context.setDefaultTimeout(10000)
          await installMraidRecorder(page, (url) => calls.push({ url, at: Date.now() }))
          await page.goto(artifactUrl, { waitUntil: 'load', timeout: 30000 })
          const target = { page, probe: createProbe(page) }
          await reachCta(target)
          const enteredAt = Date.now()
          check('No store open before CTA trigger', calls.length === 0)
          if (automatic) {
            // reachCta must return immediately on observing the real configured timer-start state.
            await page.waitForTimeout(automaticDelayMs + 500)
            check(
              'Automatic CTA calls mraid.open once at the confirmed delay',
              calls.length === 1 &&
                calls[0].at - enteredAt >= automaticDelayMs - 250 &&
                calls[0].at - enteredAt <= automaticDelayMs + 500,
            )
          } else {
            await clickCta(target)
            await page.waitForTimeout(100)
            check('CTA input calls mraid.open exactly once', calls.length === 1)
          }
          check('MRAID receives the confirmed store URL', typeof storeUrl === 'string' && calls[0]?.url === storeUrl)
          check('CTA has no external navigation or browser errors', errors.length === 0)
          report.push({
            trigger: automatic ? 'automatic' : 'click',
            ...(automatic ? { delayMs: automaticDelayMs } : {}),
            passed: true,
          })
        } finally {
          await context.close()
        }
      }
      verified = true
    },
    assertVerified() {
      check('Real CTA input verified through MRAID', verified)
    },
  }
}
