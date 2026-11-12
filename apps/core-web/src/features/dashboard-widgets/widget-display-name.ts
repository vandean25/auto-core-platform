import type { TFunction } from 'i18next'
import deCommon from '../../../../../locales/de/common.json' with { type: 'json' }
import enCommon from '../../../../../locales/en/common.json' with { type: 'json' }
import type {
  DashboardWidget,
  DashboardWidgetDisplayType,
  DashboardWidgetMetricCalculation,
  DashboardWidgetTableSource,
} from './types'

type BuiltInTitleVariant = 'list' | 'donut' | 'metricCount' | 'metricSum' | 'legacyWidget'

type BuiltInSuffixRule = {
  variant: BuiltInTitleVariant
  suffixes: readonly string[]
}

const BUILTIN_SUFFIX_RULES: BuiltInSuffixRule[] = [
  { variant: 'list', suffixes: ['List', 'Liste'] },
  { variant: 'donut', suffixes: ['Donut', 'Donut chart', 'Donut-Diagramm'] },
  { variant: 'metricCount', suffixes: ['Total', 'Metric', 'Metric card', 'Kennzahl', 'Gesamt'] },
  { variant: 'metricSum', suffixes: ['Sum', 'Summe'] },
  { variant: 'legacyWidget', suffixes: ['Widget', 'widget'] },
]

const EN_SOURCE_LABELS = enCommon.dashboard.sources as Record<string, string>
const DE_SOURCE_LABELS = deCommon.dashboard.sources as Record<string, string>

type BuiltInTitleKey =
  | 'dashboard.builtInWidgetTitle.list'
  | 'dashboard.builtInWidgetTitle.donut'
  | 'dashboard.builtInWidgetTitle.metricCount'
  | 'dashboard.builtInWidgetTitle.metricSum'
  | 'dashboard.defaultWidgetName'

const BUILTIN_TITLE_KEY: Record<BuiltInTitleVariant, BuiltInTitleKey> = {
  list: 'dashboard.builtInWidgetTitle.list',
  donut: 'dashboard.builtInWidgetTitle.donut',
  metricCount: 'dashboard.builtInWidgetTitle.metricCount',
  metricSum: 'dashboard.builtInWidgetTitle.metricSum',
  legacyWidget: 'dashboard.defaultWidgetName',
}

function labelCandidates(sourceKey: string, storedSourceLabel: string): string[] {
  const enLabel = EN_SOURCE_LABELS[sourceKey]
  const deLabel = DE_SOURCE_LABELS[sourceKey]
  const candidates = new Set<string>()
  if (enLabel) candidates.add(enLabel)
  if (deLabel) candidates.add(deLabel)
  if (storedSourceLabel.trim()) candidates.add(storedSourceLabel.trim())
  return [...candidates]
}

function matchesBuiltInName(name: string, label: string, suffix: string): boolean {
  return name === `${label} ${suffix}`
}

function ruleAppliesToWidget(rule: BuiltInSuffixRule, widget: DashboardWidget): boolean {
  return rule.variant !== 'metricSum' || widget.metricCalculation === 'sum'
}

function nameMatchesRule(name: string, labels: string[], rule: BuiltInSuffixRule): boolean {
  return labels.some((label) => rule.suffixes.some((suffix) => matchesBuiltInName(name, label, suffix)))
}

function detectBuiltInVariant(widget: DashboardWidget): BuiltInTitleVariant | null {
  const name = widget.name.trim()
  const labels = labelCandidates(widget.sourceKey, widget.sourceLabel)
  const matchingRule = BUILTIN_SUFFIX_RULES.find(
    (rule) => ruleAppliesToWidget(rule, widget) && nameMatchesRule(name, labels, rule),
  )
  return matchingRule?.variant ?? null
}

function resolveVariantForLegacyWidget(
  widget: DashboardWidget,
): Exclude<BuiltInTitleVariant, 'legacyWidget'> {
  if (widget.displayType === 'metric' && widget.metricCalculation === 'sum') {
    return 'metricSum'
  }
  if (widget.displayType === 'metric') {
    return 'metricCount'
  }
  if (widget.displayType === 'donut') {
    return 'donut'
  }
  return 'list'
}

export function defaultBuiltInWidgetTitleKey(
  displayType: DashboardWidgetDisplayType,
  metricCalculation?: DashboardWidgetMetricCalculation,
): BuiltInTitleKey {
  return BUILTIN_TITLE_KEY[
    resolveVariantForLegacyWidget({ displayType, metricCalculation } as DashboardWidget)
  ]
}

function builtInTitleKey(variant: BuiltInTitleVariant, widget: DashboardWidget): BuiltInTitleKey {
  if (variant === 'legacyWidget') {
    return BUILTIN_TITLE_KEY[resolveVariantForLegacyWidget(widget)]
  }
  return BUILTIN_TITLE_KEY[variant]
}

export function resolveDashboardWidgetDisplayName(
  widget: DashboardWidget,
  source: DashboardWidgetTableSource,
  t: TFunction<'common'>,
): string {
  const variant = detectBuiltInVariant(widget)
  if (!variant) {
    return widget.name
  }

  const titleKey = builtInTitleKey(variant, widget)
  return t(titleKey, { sourceLabel: t(source.labelKey) })
}
