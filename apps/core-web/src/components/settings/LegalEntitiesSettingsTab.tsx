import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  useCreateLegalEntity,
  useLegalEntities,
  useUpdateLegalEntity,
} from '@/api/site-admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/status/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function LegalEntitiesSettingsTab() {
  const { data: entities, isLoading } = useLegalEntities()
  const createMutation = useCreateLegalEntity()
  const updateMutation = useUpdateLegalEntity()

  const [name, setName] = React.useState('')
  const [countryIso, setCountryIso] = React.useState<'AT' | 'DE'>('AT')

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return

    try {
      await createMutation.mutateAsync({ name: name.trim(), countryIso })
      toast.success('Legal entity created')
      setName('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create legal entity')
    }
  }

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await updateMutation.mutateAsync({ id, isActive: !isActive })
      toast.success(isActive ? 'Legal entity deactivated' : 'Legal entity reactivated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update legal entity')
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Legal Entities</h3>
        <p className="text-sm text-muted-foreground">
          Legal entities group sites for finance and same-GmbH stock transfers.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-[1fr_160px_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="legal-entity-name">Name</Label>
            <Input
              id="legal-entity-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Example GmbH"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="legal-entity-country">Country</Label>
            <Select value={countryIso} onValueChange={(value) => setCountryIso(value as 'AT' | 'DE')}>
              <SelectTrigger id="legal-entity-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AT">Austria (AT)</SelectItem>
                <SelectItem value="DE">Germany (DE)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
            + Legal Entity
          </Button>
        </form>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(entities ?? []).map((entity) => (
              <TableRow key={entity.id}>
                <TableCell className="font-medium">{entity.name}</TableCell>
                <TableCell>{entity.country_iso}</TableCell>
                <TableCell>
                  <StatusBadge status={entity.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={updateMutation.isPending}
                    onClick={() => void toggleActive(entity.id, entity.is_active)}
                  >
                    {entity.is_active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
