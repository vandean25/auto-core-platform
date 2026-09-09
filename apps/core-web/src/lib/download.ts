export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } finally {
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url)
    }, 0)
  }
}
