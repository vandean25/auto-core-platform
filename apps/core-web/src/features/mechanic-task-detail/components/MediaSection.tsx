import type { RefObject } from 'react'
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
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Media</CardTitle>
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
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload Photo / Video
              </>
            )}
          </Button>
          {uploadState === 'done' && (
            <span className="text-sm text-emerald-600 font-medium">Uploaded ✓</span>
          )}
          {uploadState === 'error' && (
            <span className="text-sm text-red-500">Upload failed — please retry</span>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">Accepted: JPEG, PNG, WebP, MP4, MOV</p>
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
