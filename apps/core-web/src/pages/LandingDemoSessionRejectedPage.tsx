import { LandingDemoSessionRejectedCard } from './landing-demo/LandingDemoSessionRejectedCard'

type LandingDemoSessionRejectedPageProps = {
  onSignOut: () => void
}

export default function LandingDemoSessionRejectedPage({
  onSignOut,
}: LandingDemoSessionRejectedPageProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 px-4 py-10">
      <LandingDemoSessionRejectedCard onSignOut={onSignOut} />
    </div>
  )
}
