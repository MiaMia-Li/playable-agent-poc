import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const exec = promisify(execFile)
const runner = path.resolve('skills/_shared/assets/starter/work/browser-acceptance.mjs')

it.each(['console', 'assertion', 'timeout', 'launch'])(
  'writes actionable safe evidence for %s failures',
  async (failure) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'browser-report-test-'))
    try {
      await mkdir(path.join(root, 'node_modules/playwright'), { recursive: true })
      await writeFile(path.join(root, 'package.json'), '{}')
      await writeFile(path.join(root, 'output.html'), '<html></html>')
      await writeFile(
        path.join(root, 'scenario.mjs'),
        `export default async ({check}) => { check('game input', ${failure !== 'assertion'}); }`,
      )
      // Exercise the actual runner without installing a browser or starting a server.
      await writeFile(
        path.join(root, 'node_modules/playwright/index.js'),
        `
      const handlers = {};
      const page = {
        on: (event, callback) => { handlers[event] = callback },
        goto: async () => {
          if (${failure === 'console'}) handlers.console({ type: () => 'error', text: () => '[super-html] Unable to run, please run on {applovin} private-token' });
          if (${failure === 'timeout'}) throw Object.assign(new Error('private timeout details'), { name: 'TimeoutError' });
        },
        waitForFunction: async () => {}, screenshot: async () => {},
      };
      module.exports = { chromium: { launch: async () => {
        if (${failure === 'launch'}) throw new Error('private launch details');
        return { close: async () => { throw new Error('private close details') }, newContext: async () => ({
          setDefaultTimeout: () => {}, newPage: async () => page, route: async () => {}, on: () => {},
        }) };
      } } };
    `,
      )
      await expect(
        exec(process.execPath, [runner, 'output.html', 'scenario.mjs', '--smoke'], { cwd: root }),
      ).rejects.toMatchObject({ code: 1 })
      const reportText = await readFile(path.join(root, 'work/browser-acceptance/report.json'), 'utf8')
      const report = JSON.parse(reportText)
      expect(report.passed).toBe(false)
      expect(report.smoke).toBe(true)
      expect(report.durationMs).toBeGreaterThanOrEqual(0)
      expect(report.failure).toEqual({
        stage: { console: 'browser_errors', assertion: 'scenario', timeout: 'navigation', launch: 'launch' }[failure],
        code: failure === 'timeout' ? 'timeout' : failure === 'launch' ? 'execution_failed' : 'assertion_failed',
      })
      if (failure === 'console') expect(report.errors).toContain('Ad platform unavailable')
      expect(reportText).not.toContain('private')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
