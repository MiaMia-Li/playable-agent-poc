import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const helper = pathToFileURL(path.resolve('skills/_shared/assets/starter/work/cta-acceptance.mjs')).href
const storeUrl = 'https://example.com/app'
afterEach(() => vi.restoreAllMocks())

async function fixture(options: { clickUrl?: string; autoAt?: number; autoUrl?: string; duplicate?: boolean } = {}) {
  const { createCtaAcceptance } = await import(/* @vite-ignore */ helper)
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const contexts: Array<{ close: ReturnType<typeof vi.fn> }> = []
  const report: unknown[] = []
  const browser = {
    newContext: async () => {
      let record: (source: object, url: string) => void
      let elapsed = 0
      const page = {
        exposeBinding: async (_name: string, fn: typeof record) => {
          record = fn
        },
        addInitScript: async () => {},
        on: () => {},
        goto: async () => {},
        click: async () => {
          if (options.clickUrl) record({}, options.clickUrl)
        },
        waitForTimeout: async (ms: number) => {
          const start = now
          if (options.autoAt !== undefined && elapsed < options.autoAt && elapsed + ms >= options.autoAt) {
            now += options.autoAt - elapsed
            record({}, options.autoUrl ?? storeUrl)
            if (options.duplicate) record({}, options.autoUrl ?? storeUrl)
          }
          elapsed += ms
          now = start + ms
        },
      }
      const context = {
        newPage: async () => page,
        route: async () => {},
        on: () => {},
        setDefaultTimeout: () => {},
        close: vi.fn(),
      }
      contexts.push(context)
      return context
    },
  }
  const navigation = createCtaAcceptance({
    browser,
    artifactUrl: 'file:///fixture.html',
    storeUrl,
    createProbe: () => ({}),
    report,
    check: (name: string, passed: boolean) => {
      if (!passed) throw new Error(name)
    },
  })
  const run = (delay?: number) =>
    navigation.verify({
      reachCta: async () => {},
      clickCta: async ({ page }: { page: { click: () => Promise<void> } }) => page.click(),
      automaticDelayMs: delay,
    })
  return { navigation, run, contexts, report }
}

it('requires real SDK call evidence, not a stored URL or a no-op bridge', async () => {
  const { navigation, run, contexts } = await fixture()
  expect(() => navigation.assertVerified()).toThrow('Real CTA input')
  await expect(run()).rejects.toThrow('CTA input calls mraid.open')
  expect(contexts[0].close).toHaveBeenCalledOnce()
})

it('rejects the wrong store destination', async () => {
  const { run } = await fixture({ clickUrl: 'https://example.com/wrong' })
  await expect(run()).rejects.toThrow('confirmed store URL')
})

it('independently verifies a real click and a five-second automatic call', async () => {
  const { run, navigation, contexts, report } = await fixture({ clickUrl: storeUrl, autoAt: 5000 })
  await run(5000)
  expect(() => navigation.assertVerified()).not.toThrow()
  expect(contexts).toHaveLength(2)
  expect(contexts.every((context) => context.close.mock.calls.length === 1)).toBe(true)
  expect(report).toEqual([
    { trigger: 'click', passed: true },
    { trigger: 'automatic', delayMs: 5000, passed: true },
  ])
})

it.each([undefined, 1000, 6000])('rejects a missing or mistimed automatic call (%s)', async (autoAt) => {
  const { run, navigation } = await fixture({ clickUrl: storeUrl, autoAt })
  await expect(run(5000)).rejects.toThrow('confirmed delay')
  expect(() => navigation.assertVerified()).toThrow('Real CTA input')
})

it('rejects duplicate automatic calls', async () => {
  const { run } = await fixture({ clickUrl: storeUrl, autoAt: 5000, duplicate: true })
  await expect(run(5000)).rejects.toThrow('confirmed delay')
})
