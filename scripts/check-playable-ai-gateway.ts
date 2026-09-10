import { probePlayableAIGateway } from '../lib/playable/ai-gateway-probe'
import { readPlayableAIConfig } from '../lib/playable/ai-provider'

async function main(): Promise<void> {
  try {
    await probePlayableAIGateway(readPlayableAIConfig())
    console.log('Playable AI gateway check passed')
  } catch {
    console.error('Playable AI gateway check failed')
    process.exitCode = 1
  }
}

void main()
