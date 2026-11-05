import { useTranslation } from 'react-i18next'
import type { AgentProposal } from '@/api/agent-proposals'
import { formatCurrency, formatNumber } from '@/lib/format'
import {
  resolveLineAmountTaxBasis,
  type AmountTaxBasis,
} from '../agent-proposal-tax-basis'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface ProposedLine {
  name: string | null
  type: 'PART' | 'LABOR' | 'FEE'
  quantity: number | null
  unitPriceEur: number | null
  amountEur: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toFiniteOrNull = (value: number) => (Number.isFinite(value) ? value : null)

/**
 * Reads the proposed line the way the approval writes it: quantity defaults to
 * 1, type defaults to PART, and the unit price is unit_price_cents, else
 * unit_price or unitPrice. Accepts the nested `line_item` and the flat form.
 */
function getProposedLine(payload: Record<string, unknown>): ProposedLine {
  const line = isRecord(payload.line_item) ? payload.line_item : payload
  const quantity = Number(line.quantity ?? 1)
  const unitPriceEur =
    line.unit_price_cents !== undefined
      ? Number(line.unit_price_cents) / 100
      : Number(line.unit_price ?? line.unitPrice ?? 0)
  return {
    name: typeof line.description === 'string' ? line.description : null,
    type:
      line.type === 'LABOR'
        ? 'LABOR'
        : line.type === 'FEE'
          ? 'FEE'
          : 'PART',
    quantity: toFiniteOrNull(quantity),
    unitPriceEur: toFiniteOrNull(unitPriceEur),
    amountEur: toFiniteOrNull(unitPriceEur * quantity),
  }
}

/** Formats an EUR amount followed by its net/gross label, or a dash when there is no amount. */
export function useFormatMoneyWithTaxBasis() {
  const { t } = useTranslation('agent')
  return (amountEur: number | null | undefined, basis: AmountTaxBasis | null) => {
    if (amountEur == null) return '—'
    const basisLabel =
      basis === 'NET'
        ? t('approvals.amountNet')
        : basis === 'GROSS'
          ? t('approvals.amountGross')
          : t('approvals.taxBasisNotSet')
    return `${formatCurrency(amountEur)} (${basisLabel})`
  }
}

export function ProposedLinesTable({
  proposal,
  payload,
}: {
  proposal: AgentProposal
  payload: Record<string, unknown>
}) {
  const { t } = useTranslation('agent')
  const formatMoney = useFormatMoneyWithTaxBasis()
  const line = getProposedLine(payload)
  const basis = resolveLineAmountTaxBasis(proposal)
  const lineTypeLabel =
    line.type === 'LABOR'
      ? t('approvals.lineTypeLabor')
      : line.type === 'FEE'
        ? t('approvals.lineTypeFee')
        : t('approvals.lineTypePart')

  return (
    <div className="space-y-2" data-testid={`proposed-lines-${proposal.id}`}>
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {t('approvals.proposedLines')}
      </div>
      <Table className="text-xs text-foreground">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 pr-3">{t('approvals.lineName')}</TableHead>
            <TableHead className="h-8 pr-3">{t('approvals.lineType')}</TableHead>
            <TableHead className="h-8 pr-3 text-right">{t('approvals.lineQuantity')}</TableHead>
            <TableHead className="h-8 pr-3 text-right">{t('approvals.lineUnitPrice')}</TableHead>
            <TableHead className="h-8 text-right">{t('approvals.amount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="py-1.5 pr-3 font-medium text-foreground">
              {line.name ?? t('approvals.unnamedLine')}
            </TableCell>
            <TableCell className="py-1.5 pr-3">{lineTypeLabel}</TableCell>
            <TableCell className="py-1.5 pr-3 text-right font-mono">
              {line.quantity === null ? '—' : formatNumber(line.quantity)}
            </TableCell>
            <TableCell className="py-1.5 pr-3 text-right font-mono">
              {formatMoney(line.unitPriceEur, basis)}
            </TableCell>
            <TableCell className="py-1.5 text-right font-mono font-semibold text-success">
              {formatMoney(line.amountEur, basis)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
