import { parsePersistedPlayableAgentReply } from './persisted-schema-compat'
import type {
  ClarificationOption,
  ConfirmationProposal,
  RequirementInputRequest,
  RevisionPlan,
  RevisionProposal,
} from './schemas'
import type { PlayableBuildRecord, PlayableReferenceSelectionRecord, PlayableTaskMessageRecord } from './task-api'
import type { MarketResearchReport, ReferenceSelectionInput } from './research/schemas'

export interface RestoredPlayableConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'sent'
  reasoning?: string
  options?: ClarificationOption[]
  request?: RequirementInputRequest
  confirmation?: ConfirmationProposal
  revision?: RevisionPlan | RevisionProposal
  research?: MarketResearchReport
  adoptedSelection?: ReferenceSelectionInput
}

export function restorePlayableConversation(
  storedMessages: PlayableTaskMessageRecord[],
  pendingRevision?: RevisionProposal | null,
  builds: PlayableBuildRecord[] = [],
  selections: PlayableReferenceSelectionRecord[] = [],
): RestoredPlayableConversationMessage[] {
  const decoded = storedMessages.flatMap(
    (stored): Array<{ message: RestoredPlayableConversationMessage; createdAt: Date }> => {
      if (stored.role === 'user') {
        return [
          {
            message: { id: stored.id, role: 'user', content: stored.content, status: 'sent' },
            createdAt: stored.createdAt,
          },
        ]
      }
      try {
        const reply = parsePersistedPlayableAgentReply(JSON.parse(stored.content))
        return [
          {
            message: {
              id: stored.id,
              role: 'assistant',
              content: reply.message,
              reasoning: reply.reasoning,
              options: reply.kind === 'clarification' ? reply.options : undefined,
              request: reply.kind === 'clarification' ? reply.request : undefined,
              confirmation: reply.kind === 'confirmation' || reply.kind === 'revision' ? reply.confirmation : undefined,
              revision: reply.kind === 'revision' ? reply.revision : undefined,
              research: reply.kind === 'research' ? reply.research : undefined,
              adoptedSelection:
                reply.kind === 'research'
                  ? selections.find((selection) => selection.runId === reply.research.runId)?.selection
                  : undefined,
              status: 'sent',
            },
            createdAt: stored.createdAt,
          },
        ]
      } catch {
        return []
      }
    },
  )
  const proposalEntries = decoded.filter((entry) => entry.message.confirmation)
  const restored = decoded.map(({ message, createdAt }) => {
    if (!message.confirmation) return message
    const proposalIndex = proposalEntries.findIndex((entry) => entry.message.id === message.id)
    const nextProposalAt = proposalEntries[proposalIndex + 1]?.createdAt
    const acceptedBuild = builds
      .filter(
        (build) =>
          build.createdAt.getTime() >= createdAt.getTime() &&
          (!nextProposalAt || build.createdAt.getTime() < nextProposalAt.getTime()),
      )
      .at(-1)
    return acceptedBuild ? { ...message, confirmation: acceptedBuild.confirmation } : message
  })

  if (!pendingRevision) return restored
  const latestRevisionIndex = restored.findLastIndex((message) => message.role === 'assistant' && message.revision)
  if (latestRevisionIndex < 0) return restored
  return restored.map((message, index) =>
    index === latestRevisionIndex ? { ...message, revision: pendingRevision } : message,
  )
}
