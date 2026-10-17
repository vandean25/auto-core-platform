import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { UploadState } from '../types'

type MediaSectionProps = {
  uploadState: UploadState
  fileInputRef: RefObject<HTMLInputElement | null>
  onPickFile: () => void
  onFileSelected: (file: File) => void
}

export function MediaSection({
  uploadState,
  fileInputRef,
  onPickFile,
  onFileSelected,
}: MediaSectionProps) {
  const { t } = useTranslation('workshop')

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('mechanic.taskDetail.media.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            className="min-h-[44px] gap-2"
            disabled={uploadState === 'uploading'}
            onClick={onPickFile}
          >
            {uploadState === 'uploading' ? (
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
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFileSelected(file)
            event.target.value = ''
          }}
        />
      </CardContent>
    </Card>
  )
}
