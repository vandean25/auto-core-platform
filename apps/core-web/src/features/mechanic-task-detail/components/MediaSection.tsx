import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { UploadState } from '../types'

type MediaSectionProps = {
  uploadState: UploadState
  fileInputRef: RefObject<HTMLInputElement | null>
  photoInputRef: RefObject<HTMLInputElement | null>
  onPickFile: () => void
  onPickPhoto: () => void
  onFileSelected: (file: File) => void
}

export function MediaSection({
  uploadState,
  fileInputRef,
  photoInputRef,
  onPickFile,
  onPickPhoto,
  onFileSelected,
}: MediaSectionProps) {
  const { t } = useTranslation('workshop')
  const uploading = uploadState === 'uploading'
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onFileSelected(file)
    event.target.value = ''
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('mechanic.taskDetail.media.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          <Button className="min-h-11 gap-2" disabled={uploading} onClick={onPickPhoto}>
            <Camera className="h-4 w-4" />
            {t('mechanic.taskDetail.media.photoFinding')}
          </Button>
          <Button variant="outline" className="min-h-11 gap-2" disabled={uploading} onClick={onPickFile}>
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('mechanic.taskDetail.media.uploading')}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {t('mechanic.taskDetail.media.upload')}
              </>
            )}
          </Button>
          {uploadState === 'done' && (
            <span className="text-sm text-emerald-600 font-medium">{t('mechanic.taskDetail.media.uploaded')}</span>
          )}
          {uploadState === 'error' && (
            <span className="text-sm text-red-500">{t('mechanic.taskDetail.media.failed')}</span>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">{t('mechanic.taskDetail.media.acceptedTypes')}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          className="hidden"
          onChange={handleChange}
        />
        {/* Opens the rear camera on a phone or tablet; the photo goes through the same upload flow. */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleChange}
        />
      </CardContent>
    </Card>
  )
}
