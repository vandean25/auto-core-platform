import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageLoader } from '@/components/ui/PageLoader'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { AgentSafetyBanner } from './components/AgentSafetyBanner'
import { ApprovalsTab } from './components/ApprovalsTab'
import { ActivityTab } from './components/ActivityTab'
import { DecisionShadowTab } from './components/DecisionShadowTab'
import { TraceAuditDetailDialog } from './components/TraceAuditDetailDialog'

type SupervisionTab = 'approvals' | 'activity' | 'decision-shadow'

export default function AgentSupervisionPage() {
  const { t } = useTranslation('agent')
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [currentTab, setCurrentTab] = useState<SupervisionTab>('approvals')
  const [agentLocaleReady, setAgentLocaleReady] = useState(() =>
    i18n.hasResourceBundle(i18n.language, 'agent'),
  )

  useEffect(() => {
    if (agentLocaleReady) return
    void ensureNamespaceLoaded('agent').then(() => setAgentLocaleReady(true))
  }, [agentLocaleReady])

  if (!agentLocaleReady) {
    return <PageLoader />
  }

  return (
    <div className="space-y-6" data-testid="agent-supervision-page">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('header.title')}
            </h1>
            <p className="text-slate-500">{t('header.subtitle')}</p>
          </div>
        </div>
      </div>

      <AgentSafetyBanner />

      <Tabs
        value={currentTab}
        onValueChange={(val) => setCurrentTab(val as SupervisionTab)}
        className="space-y-6"
      >
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="approvals" data-testid="tab-approvals">
            {t('tabs.approvals')}
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">
            {t('tabs.activity')}
          </TabsTrigger>
          <TabsTrigger value="decision-shadow" data-testid="tab-decision-shadow">
            {t('tabs.decisionShadow')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approvals" className="mt-0 space-y-6 focus-visible:outline-none">
          <ApprovalsTab onSelectTraceId={(traceId) => setSelectedTraceId(traceId)} />
        </TabsContent>

        <TabsContent value="activity" className="mt-0 space-y-6 focus-visible:outline-none">
          <ActivityTab onSelectTraceId={(traceId) => setSelectedTraceId(traceId)} />
        </TabsContent>

        <TabsContent value="decision-shadow" className="mt-0 space-y-6 focus-visible:outline-none">
          <DecisionShadowTab />
        </TabsContent>
      </Tabs>

      <TraceAuditDetailDialog
        traceId={selectedTraceId}
        open={Boolean(selectedTraceId)}
        onOpenChange={(open) => !open && setSelectedTraceId(null)}
      />
    </div>
  )
}
