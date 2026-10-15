import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

type Props = {
  data: string
  size?: number
}

export function SettlementReceiptQr({ data, size = 160 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    void QRCode.toCanvas(canvas, data, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
  }, [data, size])

  return <canvas ref={canvasRef} className="rounded border bg-white p-1" aria-label="RKSV QR code" />
}
