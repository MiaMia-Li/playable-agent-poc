// Only fixed categories and bounded numbers leave the sandbox. Scenario names,
// console text, request URLs and command output may contain private data.
const stages = ['setup', 'launch', 'navigation', 'contract', 'scenario', 'capture', 'network', 'browser_errors']
const codes = [
  'timeout',
  'assertion_failed',
  'invalid_scenario',
  'invalid_click',
  'missing_assertions',
  'execution_failed',
]
const errors = ['Unexpected popup', 'Uncaught page error', 'Browser console error', 'Ad platform unavailable']
const checks = ['No external requests', 'No browser errors or popups']

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function browserAcceptanceDiagnostics(reportText: string | null, exitCode?: number) {
  const command = {
    phase: 'preview',
    exitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
  }
  if (!reportText) return { ...command, reportStatus: 'unavailable' }
  if (reportText.length > 256000) return { ...command, reportStatus: 'too_large' }
  try {
    const report = record(JSON.parse(reportText))
    if (typeof report.passed !== 'boolean' || report.smoke !== true || !Array.isArray(report.checks))
      return { ...command, reportStatus: 'invalid' }
    const failure = record(report.failure)
    return {
      ...command,
      reportStatus: 'available',
      passed: report.passed,
      failureStage: typeof failure.stage === 'string' && stages.includes(failure.stage) ? failure.stage : 'unknown',
      failureCode: typeof failure.code === 'string' && codes.includes(failure.code) ? failure.code : 'unknown',
      durationMs:
        typeof report.durationMs === 'number' && Number.isSafeInteger(report.durationMs) && report.durationMs >= 0
          ? report.durationMs
          : null,
      checks: report.checks.slice(0, 100).map((value, index) => {
        const check = record(value)
        return {
          index: index + 1,
          name: typeof check.name === 'string' && checks.includes(check.name) ? check.name : 'Gameplay assertion',
          passed: check.passed === true,
        }
      }),
      checksTruncated: report.checks.length > 100,
      errors: errors.filter((error) => Array.isArray(report.errors) && report.errors.includes(error)),
      externalRequestCount: Array.isArray(report.requests) ? report.requests.length : 0,
      screenshotCount: Array.isArray(report.screenshots) ? report.screenshots.length : 0,
    }
  } catch {
    return { ...command, reportStatus: 'invalid' }
  }
}
