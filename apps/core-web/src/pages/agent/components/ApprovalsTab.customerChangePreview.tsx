import {
  formatCustomerSupervisionChangeLabel,
  parseCustomerSupervisionChanges,
  type CustomerSupervisionChange,
} from '../agent-proposal-customer-preview'
import {
  formatDefaultSupervisionChangeLabel,
  getDefaultSupervisionChanges,
  type ProposalWouldChange,
} from '../agent-proposal-change-preview'

export function isCustomerProposalAction(actionType: string): boolean {
  return actionType === 'customer.create' || actionType === 'customer.update'
}

export function supervisionChangesForProposal(
  actionType: string,
  previewJson: unknown,
  wouldChange: ProposalWouldChange[],
): ProposalWouldChange[] {
  if (!isCustomerProposalAction(actionType)) {
    return getDefaultSupervisionChanges(wouldChange)
  }
  return parseCustomerSupervisionChanges(previewJson)
}

export function formatSupervisionChangeLabel(
  actionType: string,
  change: ProposalWouldChange,
): string {
  if (!isCustomerProposalAction(actionType)) {
    return formatDefaultSupervisionChangeLabel(change)
  }
  return formatCustomerSupervisionChangeLabel(change as CustomerSupervisionChange)
}
