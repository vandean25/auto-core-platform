import { useTranslation } from "react-i18next"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import type { RevenueGroup } from "@/api/types"
import { useIsMobile } from "@/hooks/use-mobile"

interface RevenueGroupTableProps {
    groups: RevenueGroup[]
}

export function RevenueGroupTable({ groups }: RevenueGroupTableProps) {
    const { t } = useTranslation('settings')
    const isMobile = useIsMobile()

    if (isMobile) {
        // Four columns do not fit a phone: one row per group, the table stays for larger screens.
        return (
            <ul className="divide-y rounded-md border">
                {groups.map((group) => (
                    <li key={group.id} className="flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0 space-y-1">
                            <p className="break-words font-medium">{group.name}</p>
                            <p className="text-sm text-muted-foreground">
                                {t('revenueGroups.table.taxRate')}: {group.tax_rate}%
                            </p>
                            <p className="text-sm text-muted-foreground">
                                {t('revenueGroups.table.accountNumber')}:{' '}
                                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{group.account_number}</code>
                            </p>
                        </div>
                        {group.is_default ? (
                            <Badge variant="secondary" className="shrink-0 bg-green-100 text-green-700 hover:bg-green-100">
                                {t('revenueGroups.table.defaultBadge')}
                            </Badge>
                        ) : null}
                    </li>
                ))}
            </ul>
        )
    }

    return (
        <div className="border rounded-md">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('revenueGroups.table.name')}</TableHead>
                        <TableHead>{t('revenueGroups.table.taxRate')}</TableHead>
                        <TableHead>{t('revenueGroups.table.accountNumber')}</TableHead>
                        <TableHead className="text-right">{t('revenueGroups.table.default')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {groups.map((group) => (
                        <TableRow key={group.id}>
                            <TableCell className="font-medium">{group.name}</TableCell>
                            <TableCell>{group.tax_rate}%</TableCell>
                            <TableCell>
                                <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">
                                    {group.account_number}
                                </code>
                            </TableCell>
                            <TableCell className="text-right">
                                {group.is_default ? (
                                    <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100">
                                        {t('revenueGroups.table.defaultBadge')}
                                    </Badge>
                                ) : (
                                    <span className="text-muted-foreground">-</span>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
