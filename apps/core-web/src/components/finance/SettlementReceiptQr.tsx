import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { ensureNamespaceLoaded } from '@/lib/i18n'

type Props = {
  data: string
  size?: number
}

export function SettlementReceiptQr({ data, size = 160 }: Props) {
  const { t } = useTranslation('finance')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    void QRCode.toCanvas(canvas, data, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
  }, [data, size])

  return (
    <canvas
      ref={canvasRef}
      className="rounded border bg-white p-1"
      aria-label={t('settlement.qrAriaLabel')}
    />
  )
}
