import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/status/StatusBadge'
import { fetchWithAuth } from '@/api/client'
import { createHttpError } from '@/lib/error-utils'
import { workshopKeys } from '@/api/workshop'

export type WorkshopMechanicFinding = {
  proposal_id: string
  trace_id: string
  status: string
  workshop_task_id: string
  finding_text: string
  media: Array<{ id: string; mime_type: string; caption: string | null }>
  summary: string | null
  created_at: string
}

async function fetchMechanicFindings(orderId: string): Promise<WorkshopMechanicFinding[]> {
  const response = await fetchWithAuth(
    `/api/workshop/orders/${encodeURIComponent(orderId)}/mechanic-findings`,
  )
  if (!response.ok) {
    throw await createHttpError(response, 'Failed to load mechanic findings')
  }
  const body = (await response.json()) as { data: WorkshopMechanicFinding[] }
  return body.data
}

type MechanicFindingAdvisorPanelProps = {
  orderId: string
}

export function MechanicFindingAdvisorPanel({ orderId }: MechanicFindingAdvisorPanelProps) {
  const query = useQuery({
    queryKey: [...workshopKeys.detail(orderId), 'mechanic-findings'],
    queryFn: () => fetchMechanicFindings(orderId),
    enabled: Boolean(orderId),
  })

  const findings = query.data ?? []
  if (findings.length === 0) {
    return null
  }

  return (
    <Card data-testid='mechanic-finding-advisor-panel'>
      <CardHeader className='pb-3'>
        <CardTitle className='text-base'>Mechanic findings</CardTitle>
        <p className='text-sm text-slate-500'>
          Evidence from the bay. Map local labor and parts lines, then apply through approvals.
        </p>
      </CardHeader>
      <CardContent className='space-y-4'>
        {findings.map((finding) => (
          <article
            key={finding.proposal_id}
            className='rounded-md border border-slate-200 p-4 space-y-2'
            data-testid={`mechanic-finding-${finding.proposal_id}`}
          >
            <div className='flex flex-wrap items-center gap-2'>
              <StatusBadge status={finding.status} />
              {finding.summary && (
                <span className='text-sm font-medium text-slate-800'>{finding.summary}</span>
              )}
            </div>
            <p className='text-sm whitespace-pre-wrap text-slate-700'>{finding.finding_text}</p>
            {finding.media.length > 0 && (
              <ul className='text-xs text-slate-500 list-disc pl-4'>
                {finding.media.map((item) => (
                  <li key={item.id}>
                    {item.mime_type}
                    {item.caption ? ` — ${item.caption}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </CardContent>
    </Card>
  )
}
