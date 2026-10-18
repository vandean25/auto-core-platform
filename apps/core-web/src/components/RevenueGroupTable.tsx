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

interface RevenueGroupTableProps {
    groups: RevenueGroup[]
}

export function RevenueGroupTable({ groups }: RevenueGroupTableProps) {
    const { t } = useTranslation('settings')
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
