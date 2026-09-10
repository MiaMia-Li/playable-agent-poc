import {
  checkVercelSandboxConnectivity,
  VercelSandboxConnectivityError,
} from '../lib/sandbox/vercel-sandbox-connectivity'

async function main(): Promise<void> {
  try {
    await checkVercelSandboxConnectivity()
    console.log('Vercel Sandbox DNS and HTTPS egress checks passed')
  } catch (error) {
    if (error instanceof VercelSandboxConnectivityError && error.code === 'sandbox_dns_failed') {
      console.error('Vercel Sandbox DNS lookup failed')
    } else if (error instanceof VercelSandboxConnectivityError && error.code === 'sandbox_https_egress_failed') {
      console.error('Vercel Sandbox HTTPS egress check failed')
    } else {
      console.error('Vercel Sandbox connectivity check failed')
    }
    process.exitCode = 1
  }
}

void main()
