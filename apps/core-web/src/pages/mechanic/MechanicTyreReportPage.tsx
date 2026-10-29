import { useParams } from 'react-router-dom'
import { TyreMeasurementSection } from '@/features/tyre-report/TyreMeasurementSection'

export default function MechanicTyreReportPage() {
  const { id } = useParams<{ id: string }>()

  if (!id) return null

  return (
    <div className="p-4">
      <TyreMeasurementSection parent={{ kind: 'order', id }} orderId={id} />
    </div>
  )
}
