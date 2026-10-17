import type { RefObject } from 'react'
import { CheckInSignaturePad, type CheckInSignaturePadHandle } from './CheckInSignaturePad'

type Props = {
  readOnly: boolean
  signedByName: string
  onSignedByNameChange: (value: string) => void
  acknowledged: boolean
  onAcknowledgedChange: (value: boolean) => void
  padRef: RefObject<CheckInSignaturePadHandle | null>
  signaturePreviewUrl?: string | null
}

export function CheckInSignatureSlot(props: Props) {
  return <CheckInSignaturePad {...props} />
}
