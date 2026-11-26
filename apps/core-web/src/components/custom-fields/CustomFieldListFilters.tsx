import { useState, type FormEvent } from 'react'
import { ListFilter } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CustomFieldDefinition } from '@/api/custom-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type Props = {
  definitions: readonly CustomFieldDefinition[]
  filters: URLSearchParams
  onApply: (filters: URLSearchParams) => void
}

type FilterInputProps = {
  definition: CustomFieldDefinition
  filters: URLSearchParams
}

const selectClass = 'min-h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm max-sm:min-h-11'

function TextFilter({ definition, filters }: FilterInputProps) {
  const { t } = useTranslation('common')
  const id = `cf.${definition.key}`
  const exact = filters.get(`${id}[eq]`) ?? filters.get(id)
  const [operator, setOperator] = useState(exact === null ? 'contains' : 'eq')
  return (
    <div className="grid grid-cols-2 gap-2">
      <select
        className={selectClass}
        aria-label={t('customFields.list.operator', { field: definition.label })}
        value={operator}
        onChange={(event) => setOperator(event.target.value)}
      >
        <option value="contains">{t('customFields.list.contains')}</option>
        <option value="eq">{t('customFields.list.equals')}</option>
      </select>
      <Input
        className="max-sm:min-h-11"
        aria-label={definition.label}
        name={`${id}[${operator}]`}
        defaultValue={exact ?? filters.get(`${id}[contains]`) ?? ''}
        maxLength={500}
      />
    </div>
  )
}

function RangeFilter({ definition, filters }: FilterInputProps) {
  const { t } = useTranslation('common')
  const id = `cf.${definition.key}`
  const exact = filters.get(`${id}[eq]`) ?? filters.get(id)
  const inputType = definition.type === 'DATE' ? 'date' : 'number'
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['gte', 'lte'] as const).map((operator) => {
        const name = `${id}[${operator}]`
        const label = operator === 'gte' ? t('customFields.list.from') : t('customFields.list.to')
        return (
          <label key={operator} className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <span>{label}</span>
            <Input
              type={inputType}
              step={inputType === 'number' ? 'any' : undefined}
              name={name}
              defaultValue={filters.get(name) ?? exact ?? ''}
              className="min-w-0 max-sm:min-h-11"
            />
          </label>
        )
      })}
    </div>
  )
}

function BooleanFilter({ definition, filters }: FilterInputProps) {
  const { t } = useTranslation('common')
  const id = `cf.${definition.key}`
  const name = `${id}[is]`
  const value = filters.get(name) ?? filters.get(`${id}[eq]`) ?? filters.get(id) ?? ''
  return (
    <select className={selectClass} name={name} aria-label={definition.label} defaultValue={value}>
      <option value="">{t('customFields.list.any')}</option>
      <option value="true">{t('customFields.booleanYes')}</option>
      <option value="false">{t('customFields.booleanNo')}</option>
    </select>
  )
}

function FilterInput({ definition, filters }: FilterInputProps) {
  switch (definition.type) {
    case 'TEXT':
      return <TextFilter definition={definition} filters={filters} />
    case 'SELECT': {
      const id = `cf.${definition.key}`
      const exact = filters.get(`${id}[eq]`) ?? filters.get(id)
      const name = `${id}[in]`
      const selected = new Set([...filters.getAll(name), ...(exact === null ? [] : [exact])])
      return (definition.options ?? []).map((option) => (
        <label key={option} className="flex min-h-8 items-center gap-2 text-sm max-sm:min-h-11">
          <input type="checkbox" className="size-4 accent-primary" name={name} value={option} defaultChecked={selected.has(option)} />
          <span className="min-w-0 wrap-anywhere">{option}</span>
        </label>
      ))
    }
    case 'BOOLEAN':
      return <BooleanFilter definition={definition} filters={filters} />
    case 'DATE':
    case 'NUMBER':
      return <RangeFilter definition={definition} filters={filters} />
  }
}

export function CustomFieldListFilters({ definitions, filters, onApply }: Props) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  if (definitions.length === 0) return null
  const count = definitions.filter(({ key }) => [...filters.keys()].some((name) =>
    name === `cf.${key}` || name.startsWith(`cf.${key}[`),
  )).length

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new URLSearchParams()
    for (const [name, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string' && value !== '') next.append(name, value)
    }
    onApply(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 md:h-8" aria-label={t('customFields.sectionTitle')}>
          <ListFilter />
          {t('customFields.sectionTitle')}
          {count > 0 ? <span className="tabular-nums">{count}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-(--radix-popover-content-available-width) p-0">
        <form onSubmit={submit}>
          <div className="max-h-72 space-y-3 overflow-y-auto p-3">
            {definitions.map((definition) => (
              <fieldset className="min-w-0 space-y-1" key={definition.id}>
                <legend className="wrap-anywhere text-sm font-medium">{definition.label}</legend>
                <FilterInput definition={definition} filters={filters} />
              </fieldset>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t p-3">
            {count > 0 ? (
              <Button type="button" variant="ghost" className="max-sm:min-h-11" onClick={() => {
                onApply(new URLSearchParams())
                setOpen(false)
              }}>
                {t('dataTable.reset')}
              </Button>
            ) : null}
            <Button type="submit" className="max-sm:min-h-11">{t('customFields.list.apply')}</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
