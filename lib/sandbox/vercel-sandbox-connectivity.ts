import { lookup as dnsLookup } from 'node:dns/promises'

const VERCEL_SANDBOX_API_HOSTNAME = 'vercel.com'
const VERCEL_SANDBOX_API_URL = 'https://vercel.com/api'

type ConnectivityErrorCode = 'sandbox_dns_failed' | 'sandbox_https_egress_failed'

type SandboxDnsLookup = (hostname: string, options: { all: true }) => Promise<unknown>
type SandboxApiProbe = (url: string, options: { method: 'HEAD'; signal: AbortSignal }) => Promise<unknown>

interface ConnectivityDependencies {
  lookup?: SandboxDnsLookup
  probe?: SandboxApiProbe
}

export class VercelSandboxConnectivityError extends Error {
  readonly code: ConnectivityErrorCode

  constructor(code: ConnectivityErrorCode, cause: unknown) {
    super(code, { cause })
    this.name = 'VercelSandboxConnectivityError'
    this.code = code
  }
}

const defaultLookup: SandboxDnsLookup = async (hostname, options) => {
  await dnsLookup(hostname, options)
}

const defaultProbe: SandboxApiProbe = async (url, options) => {
  await fetch(url, options)
}

export async function checkVercelSandboxConnectivity({
  lookup = defaultLookup,
  probe = defaultProbe,
}: ConnectivityDependencies = {}): Promise<void> {
  try {
    await lookup(VERCEL_SANDBOX_API_HOSTNAME, { all: true })
  } catch (error) {
    throw new VercelSandboxConnectivityError('sandbox_dns_failed', error)
  }

  try {
    await probe(VERCEL_SANDBOX_API_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new VercelSandboxConnectivityError('sandbox_https_egress_failed', error)
  }
}

export { VERCEL_SANDBOX_API_HOSTNAME, VERCEL_SANDBOX_API_URL }
