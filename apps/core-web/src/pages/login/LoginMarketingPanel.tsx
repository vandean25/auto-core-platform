import { useTranslation } from 'react-i18next'
import { DOCUMENTATION_URL } from '@/lib/external-links'
import { isDemoHost, LOGIN_HIGHLIGHT_KEYS } from './login-page-support'

export function LoginMarketingPanel() {
  const { t } = useTranslation('common')
  const demoHost = isDemoHost()

  return (
    <section className="space-y-6 text-slate-900">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t('login.title')}</h1>
        <p className="max-w-md text-lg leading-8 text-slate-600">{t('login.tagline')}</p>
      </div>

      <ul className="space-y-3 text-sm font-medium text-slate-700">
        {LOGIN_HIGHLIGHT_KEYS.map((key) => (
          <li key={key} className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-slate-900" />
            {t(`login.highlights.${key}`)}
          </li>
        ))}
      </ul>

      {demoHost ? (
        <div className="max-w-md rounded-xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-600 shadow-sm">
          <p className="font-semibold text-slate-900">{t('login.demoWorkshop')}</p>
          <p>{t('login.demoOffice')}</p>
          <p>{t('login.demoMechanic')}</p>
          <p className="mt-2 text-slate-500">{t('login.demoPasswordHint')}</p>
        </div>
      ) : null}

      <a
        className="inline-flex text-sm font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-900"
        href={DOCUMENTATION_URL}
        rel="noreferrer"
        target="_blank"
      >
        {t('login.documentation')}
      </a>
    </section>
  )
}
