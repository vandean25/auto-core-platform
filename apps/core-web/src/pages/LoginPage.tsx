import { LoginMarketingPanel } from './login/LoginMarketingPanel'
import { LoginSignInCard } from './login/LoginSignInCard'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-50/30 px-4 py-10 sm:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center gap-10 md:grid-cols-2 md:gap-16">
        <LoginMarketingPanel />
        <LoginSignInCard />
      </div>
    </div>
  )
}
