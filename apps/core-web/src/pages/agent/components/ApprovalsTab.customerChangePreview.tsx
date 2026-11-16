import {
  formatCustomerSupervisionChangeLabel,
  parseCustomerSupervisionChanges,
  parseVehicleSupervisionChanges,
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

export function isVehicleProposalAction(actionType: string): boolean {
  return actionType === 'vehicle.create' || actionType === 'vehicle.update'
}

export function supervisionChangesForProposal(
  actionType: string,
  previewJson: unknown,
  wouldChange: ProposalWouldChange[],
): ProposalWouldChange[] {
  if (isCustomerProposalAction(actionType)) {
    return parseCustomerSupervisionChanges(previewJson)
  }
  if (isVehicleProposalAction(actionType)) {
    return parseVehicleSupervisionChanges(previewJson)
  }
  return getDefaultSupervisionChanges(wouldChange)
}

export function formatSupervisionChangeLabel(
  actionType: string,
  change: ProposalWouldChange,
): string {
  if (!isCustomerProposalAction(actionType) && !isVehicleProposalAction(actionType)) {
    return formatDefaultSupervisionChangeLabel(change)
  }
  return formatCustomerSupervisionChangeLabel(change as CustomerSupervisionChange)
}
