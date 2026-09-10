import type { MarketResearchReport, SearchBrief } from './schemas'

export type MarketResearchProgressStage = 'searching' | 'filtering' | 'analyzing' | 'summarizing'

export interface MarketResearchAgent {
  search(
    input: {
      runId: string
      apiKey: string
      brief: SearchBrief
    },
    options?: {
      abortSignal?: AbortSignal
      onProgress?: (stage: MarketResearchProgressStage) => void
    },
  ): Promise<MarketResearchReport>
}

export type MarketResearchErrorCode = 'unavailable' | 'timeout' | 'cancelled' | 'output_invalid'

export class MarketResearchError extends Error {
  constructor(readonly code: MarketResearchErrorCode) {
    super('Market research failed')
    this.name = 'MarketResearchError'
  }
}
