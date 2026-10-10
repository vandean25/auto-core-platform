import { describe, expect, it } from 'vitest'
import {
  resolveActivityAgentName,
  resolveDecidedByLabel,
  resolveProposalAgentName,
  resolveUserId,
} from './agent-labels'

describe('resolveProposalAgentName', () => {
  it('shows the agent the proposal was created by, not the generic word', () => {
    expect(resolveProposalAgentName('mcp:qa-fresh-agent', {})).toBe('mcp:qa-fresh-agent')
  })

  it('prefers the created-by agent over an agent id in the payload, as the Activity row does', () => {
    expect(resolveProposalAgentName('mcp:qa-fresh-agent', { agent_id: 'payload-agent' })).toBe(
      'mcp:qa-fresh-agent',
    )
  })

  it('falls back to the agent id in the payload when no agent was recorded', () => {
    expect(resolveProposalAgentName(null, { agent_id: 'sales-agent' })).toBe('sales-agent')
    expect(resolveProposalAgentName(undefined, { agentId: 'billing-agent' })).toBe('billing-agent')
  })

  it('uses the generic label only when no agent is recorded anywhere', () => {
    expect(resolveProposalAgentName(null, {})).toBe('agent')
    expect(resolveProposalAgentName(null, { agent_id: '' })).toBe('agent')
  })
})

describe('resolveActivityAgentName', () => {
  it('shows the logged agent id', () => {
    expect(resolveActivityAgentName('mcp:qa-fresh-agent')).toBe('mcp:qa-fresh-agent')
  })

  it('uses the generic label only when the log has no agent id', () => {
    expect(resolveActivityAgentName(null)).toBe('agent')
    expect(resolveActivityAgentName(undefined)).toBe('agent')
  })
})

describe('resolveUserId', () => {
  it('returns a non-empty user id as is', () => {
    expect(resolveUserId('user-1')).toBe('user-1')
  })

  it('returns null for missing or non-string values', () => {
    expect(resolveUserId(null)).toBeNull()
    expect(resolveUserId(undefined)).toBeNull()
    expect(resolveUserId('')).toBeNull()
    expect(resolveUserId({})).toBeNull()
  })
})

describe('resolveDecidedByLabel', () => {
  const unknownUser = 'Unknown user'

  it('shows the person name', () => {
    expect(
      resolveDecidedByLabel({ name: 'Sam Supervisor', email: 'sam@example.com' }, unknownUser),
    ).toBe('Sam Supervisor')
  })

  it('shows the email when the person has no name', () => {
    expect(resolveDecidedByLabel({ name: null, email: 'sam@example.com' }, unknownUser)).toBe(
      'sam@example.com',
    )
  })

  it('shows the unknown-user label when neither name nor email can be resolved', () => {
    expect(resolveDecidedByLabel({ name: null, email: null }, unknownUser)).toBe(unknownUser)
  })
})
