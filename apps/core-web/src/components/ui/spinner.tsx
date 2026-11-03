import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { motionKindOf, type MotionTokenName } from "@/lib/motion-tokens"
import { cn } from "@/lib/utils"

/** The spinner is a repeating functional indicator, so the finite 200 ms transition cap does not apply to it. */
const spinnerMotionToken = 'spinner' satisfies MotionTokenName

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useTranslation("common")
  return (
    <Loader2Icon
      role="status"
      aria-label={t("shell.loading")}
      data-motion-kind={motionKindOf(spinnerMotionToken)}
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Spinner, spinnerMotionToken }
