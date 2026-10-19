import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { formatFieldLabel, type ImportEntityTypeUi, type ImportFieldDefinition } from './import-field-labels'

export type DataImportMappingTableProps = {
  entityType: ImportEntityTypeUi
  fields: ImportFieldDefinition[]
  mapping: Record<string, string>
  csvHeaders: string[]
  onMappingChange: (fieldKey: string, csvColumn: string) => void
}

/** Maps the import fields of the entity to the columns of the uploaded CSV. */
export function DataImportMappingTable(props: DataImportMappingTableProps) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <div className="overflow-x-auto border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('dataImport.mapping.acpField')}</TableHead>
            <TableHead>{t('dataImport.mapping.csvColumn')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.fields.map((field) => (
            <TableRow key={field.key}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span>{formatFieldLabel(props.entityType, field)}</span>
                  {field.required ? (
                    <Badge variant="destructive" className="text-[10px]">
                      {t('dataImport.mapping.required')}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <Select
                  value={props.mapping[field.key] ?? '__none__'}
                  onValueChange={(value) =>
                    props.onMappingChange(field.key, value === '__none__' ? '' : value)
                  }
                >
                  <SelectTrigger aria-label={t('dataImport.mapping.mapAria', { field: field.key })}>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {props.csvHeaders.map((header) => (
                      <SelectItem key={header} value={header}>
                        {header}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
