import type { ConfirmationProposal } from './schemas'

export interface AgentInput {
  taskId: string
  prompt: string
  apiKey: string
}

export interface ConfirmedBuildInput {
  taskId: string
  apiKey: string
  confirmation: ConfirmationProposal
}

export interface BuildResult {
  html: string
  validation: {
    behavior: 'passed'
    bytes: number
  }
}

export interface PlayableAgentAdapter {
  proposeConfirmation(input: AgentInput): Promise<ConfirmationProposal>
  build(input: ConfirmedBuildInput): Promise<BuildResult>
  cancel(taskId: string): Promise<void>
}
