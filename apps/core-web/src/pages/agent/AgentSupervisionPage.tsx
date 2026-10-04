import { useState } from 'react'
import { Languages } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { AgentSafetyBanner } from './components/AgentSafetyBanner'
import { ApprovalsTab } from './components/ApprovalsTab'
import { ActivityTab } from './components/ActivityTab'
import { TraceAuditDetailDialog } from './components/TraceAuditDetailDialog'
import type { Language } from './agent-supervision-copy'
import { getCopy, SUPERVISION_COPY } from './agent-supervision-copy'

export default function AgentSupervisionPage() {
  const [language, setLanguage] = useState<Language>('en')
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [currentTab, setCurrentTab] = useState<'approvals' | 'activity'>('approvals')

  const toggleLanguage = () => {
    setLanguage((prev) => (prev === 'en' ? 'de' : 'en'))
  }

  return (
    <div className="space-y-6" data-testid="agent-supervision-page">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {getCopy(SUPERVISION_COPY.header.title, language)}
            </h1>
            <p className="text-slate-500">
              {getCopy(SUPERVISION_COPY.header.subtitle, language)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 text-xs text-slate-700"
            data-testid="toggle-language-btn"
          >
            <Languages className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{language === 'en' ? 'DE (Deutsch)' : 'EN (English)'}</span>
          </Button>
        </div>
      </div>

      {/* Persistent Safety Banner */}
      <AgentSafetyBanner language={language} />

      {/* Main Supervision Tabs */}
      <Tabs
        value={currentTab}
        onValueChange={(val) => setCurrentTab(val as 'approvals' | 'activity')}
        className="space-y-6"
      >
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="approvals" data-testid="tab-approvals">
            {getCopy(SUPERVISION_COPY.tabs.approvals, language)}
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">
            {getCopy(SUPERVISION_COPY.tabs.activity, language)}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approvals" className="mt-0 space-y-6 focus-visible:outline-none">
          <ApprovalsTab
            language={language}
            onSelectTraceId={(traceId) => setSelectedTraceId(traceId)}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-0 space-y-6 focus-visible:outline-none">
          <ActivityTab
            language={language}
            onSelectTraceId={(traceId) => setSelectedTraceId(traceId)}
          />
        </TabsContent>
      </Tabs>

      {/* Correlated Trace & ADR-0015 Audit Dialog */}
      <TraceAuditDetailDialog
        traceId={selectedTraceId}
        open={Boolean(selectedTraceId)}
        onOpenChange={(open) => !open && setSelectedTraceId(null)}
        language={language}
      />
    </div>
  )
}
