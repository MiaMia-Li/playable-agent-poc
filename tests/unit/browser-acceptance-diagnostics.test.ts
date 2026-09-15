import { describe, expect, it } from 'vitest'
import { browserAcceptanceDiagnostics } from '@/lib/playable/browser-acceptance-diagnostics'

describe('browser acceptance diagnostics', () => {
  it('keeps failed check positions and fixed categories without exposing report payloads', () => {
    const diagnostic = browserAcceptanceDiagnostics(
      JSON.stringify({
        passed: false,
        smoke: true,
        failure: { stage: 'browser_errors', code: 'assertion_failed', message: 'secret' },
        checks: [
          { name: '/private/secret', passed: true },
          { name: 'No browser errors or popups', passed: false },
        ],
        errors: ['Browser console error', 'Ad platform unavailable', 'secret'],
        requests: ['https://secret.example/?token=secret'],
        screenshots: ['/private/secret.png'],
        durationMs: 5508,
        stdout: 'secret',
        stderr: 'secret',
      }),
      1,
    )
    expect(diagnostic).toMatchObject({
      phase: 'preview',
      exitCode: 1,
      reportStatus: 'available',
      failureStage: 'browser_errors',
      failureCode: 'assertion_failed',
      checks: [
        { index: 1, name: 'Gameplay assertion', passed: true },
        { index: 2, name: 'No browser errors or popups', passed: false },
      ],
      errors: ['Browser console error', 'Ad platform unavailable'],
      externalRequestCount: 1,
      screenshotCount: 1,
      durationMs: 5508,
    })
    expect(JSON.stringify(diagnostic)).not.toContain('secret')
  })

  it.each([null, '', '{', 'null', '{"passed":false}', JSON.stringify({ passed: false, smoke: false, checks: [] })])(
    'handles missing or malformed reports: %s',
    (report) => {
      expect(browserAcceptanceDiagnostics(report, 1).reportStatus).not.toBe('available')
    },
  )

  it('bounds evidence and tolerates untrusted field types', () => {
    const diagnostic = browserAcceptanceDiagnostics(
      JSON.stringify({
        passed: false,
        smoke: true,
        durationMs: -1,
        failure: { stage: ['scenario'], code: {} },
        checks: Array.from({ length: 110 }, () => ({ name: { secret: true }, passed: 'true' })),
      }),
    )
    expect(diagnostic).toMatchObject({
      exitCode: null,
      failureStage: 'unknown',
      failureCode: 'unknown',
      durationMs: null,
      checksTruncated: true,
    })
    expect('checks' in diagnostic && diagnostic.checks).toHaveLength(100)
    expect(JSON.stringify(diagnostic)).not.toContain('secret')
    expect(browserAcceptanceDiagnostics(' '.repeat(256001)).reportStatus).toBe('too_large')
  })
})
