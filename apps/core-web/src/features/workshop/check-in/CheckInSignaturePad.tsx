import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

export type CheckInSignaturePadHandle = {
  hasInk: () => boolean
  toPngBlob: () => Promise<Blob | null>
  clear: () => void
}

type Props = {
  readOnly: boolean
  signedByName: string
  onSignedByNameChange: (value: string) => void
  acknowledged: boolean
  onAcknowledgedChange: (value: boolean) => void
  padRef: React.RefObject<CheckInSignaturePadHandle | null>
  signaturePreviewUrl?: string | null
  onSignatureCanvasClear?: () => void
}

function clientPoint(
  canvas: HTMLCanvasElement,
  event: PointerEvent,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

export function CheckInSignaturePad({
  readOnly,
  signedByName,
  onSignedByNameChange,
  acknowledged,
  onAcknowledgedChange,
  padRef,
  signaturePreviewUrl,
  onSignatureCanvasClear,
}: Props) {
  const { t } = useTranslation('workshop')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const hasInkRef = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(320, Math.floor(rect.width))
    const height = Math.max(160, Math.floor(rect.height))
    if (canvas.width !== width || canvas.height !== height) {
      const ctx = canvas.getContext('2d')
      const image = ctx?.getImageData(0, 0, canvas.width, canvas.height)
      canvas.width = width
      canvas.height = height
      if (image && ctx) {
        ctx.putImageData(image, 0, 0)
      }
    }
  }, [])

  useEffect(() => {
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [resizeCanvas])

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasInkRef.current = false
    setHasInk(false)
    onSignatureCanvasClear?.()
  }, [onSignatureCanvasClear])

  useEffect(() => {
    padRef.current = {
      hasInk: () => hasInkRef.current,
      toPngBlob: async () => {
        const canvas = canvasRef.current
        if (!canvas || !hasInkRef.current) {
          return null
        }
        return new Promise((resolve) => {
          canvas.toBlob((blob) => resolve(blob), 'image/png')
        })
      },
      clear: clearCanvas,
    }
  }, [clearCanvas, padRef])

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly) {
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }
    canvas.setPointerCapture(event.pointerId)
    drawingRef.current = true
    const { x, y } = clientPoint(canvas, event.nativeEvent)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const continueStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || readOnly) {
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }
    const { x, y } = clientPoint(canvas, event.nativeEvent)
    ctx.lineTo(x, y)
    ctx.stroke()
    if (!hasInkRef.current) {
      hasInkRef.current = true
      setHasInk(true)
    }
  }

  const endStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return
    }
    drawingRef.current = false
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section
      className="rounded-lg border border-muted bg-background p-4"
      data-testid="check-in-signature-slot"
      aria-label={t('checkIn.review.signatureSectionAria')}
    >
      <h3 className="text-lg font-medium">{t('checkIn.review.signatureTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('checkIn.review.signatureSimpleEsignNotice')}
      </p>
      <p
        className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        data-testid="check-in-signature-legal-placeholder"
      >
        {t('checkIn.review.signatureAcknowledgementLegal')}
      </p>

      <div className="mt-4 flex items-start gap-3">
        <Checkbox
          id="check-in-acknowledged"
          className="mt-1 min-h-11 min-w-11"
          checked={acknowledged}
          disabled={readOnly}
          onCheckedChange={(value) => onAcknowledgedChange(value === true)}
          aria-label={t('checkIn.review.signatureAcknowledgementAria')}
        />
        <Label htmlFor="check-in-acknowledged" className="text-sm leading-snug">
          {t('checkIn.review.signatureAcknowledgementLabel')}
        </Label>
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="check-in-signed-by-name">{t('checkIn.review.signedByName')}</Label>
        <Input
          id="check-in-signed-by-name"
          className="min-h-11"
          value={signedByName}
          disabled={readOnly}
          maxLength={200}
          onChange={(event) => onSignedByNameChange(event.target.value)}
          autoComplete="name"
          data-testid="check-in-signed-by-name"
        />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>{t('checkIn.review.signatureDrawLabel')}</Label>
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              data-testid="check-in-signature-clear"
              onClick={clearCanvas}
            >
              {t('checkIn.review.signatureClear')}
            </Button>
          )}
        </div>
        {readOnly && signaturePreviewUrl ? (
          <img
            src={signaturePreviewUrl}
            alt={t('checkIn.review.signatureImageAlt')}
            className="h-40 w-full rounded-md border border-muted bg-white object-contain"
          />
        ) : (
          <canvas
            ref={canvasRef}
            className="h-40 w-full touch-none rounded-md border border-muted bg-white"
            aria-label={t('checkIn.review.signatureCanvasAria')}
            data-testid="check-in-signature-canvas"
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            onPointerCancel={endStroke}
          />
        )}
        {!readOnly && !hasInk && (
          <p className="text-sm text-muted-foreground">
            {t('checkIn.review.signatureCanvasHint')}
          </p>
        )}
      </div>
    </section>
  )
}
