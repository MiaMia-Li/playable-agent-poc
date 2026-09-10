'use client'

import { useState } from 'react'
import { ExternalLink, Loader2, Search, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import type { MarketResearchReport, ReferenceSelectionInput } from '@/lib/playable/research/schemas'

interface ResearchResultCardProps {
  report: MarketResearchReport
  adoptedSelection?: ReferenceSelectionInput
  disabled: boolean
  onAdopt(selection: ReferenceSelectionInput): Promise<void>
  onSearchAgain(): void
  onSkip(): void
}

export function ResearchResultCard({
  report,
  adoptedSelection,
  disabled,
  onAdopt,
  onSearchAgain,
  onSkip,
}: ResearchResultCardProps) {
  const [primaryCandidateId, setPrimaryCandidateId] = useState<string | null>(null)
  const [selectedHighlights, setSelectedHighlights] = useState<Array<{ candidateId: string; value: string }>>([])
  const [customRequirements, setCustomRequirements] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const adoptedCandidate = adoptedSelection?.primaryCandidateId
    ? report.candidates.find((candidate) => candidate.id === adoptedSelection.primaryCandidateId)
    : undefined

  async function adopt(summaryOnly = false) {
    if (submitting || disabled) return
    setSubmitting(true)
    try {
      await onAdopt({
        runId: report.runId,
        primaryCandidateId: summaryOnly ? null : primaryCandidateId,
        selectedHighlights: summaryOnly ? [] : selectedHighlights,
        customRequirements,
        exclusions: [],
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (adoptedSelection) {
    return (
      <section aria-label="市场参考分析" className="bg-muted/30 mt-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="text-primary size-4" aria-hidden="true" />
          <p className="font-medium">{adoptedCandidate ? `已采用：${adoptedCandidate.title}` : '已采用行业总结'}</p>
        </div>
        {adoptedSelection.selectedHighlights.length > 0 && (
          <p className="text-muted-foreground mt-2 text-xs">
            组合亮点：{adoptedSelection.selectedHighlights.map((highlight) => highlight.value).join('、')}
          </p>
        )}
      </section>
    )
  }

  return (
    <section aria-label="市场参考分析" className="mt-3 space-y-4 rounded-xl border p-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Search className="text-primary size-4" aria-hidden="true" />
            <h2 className="font-semibold">市场参考分析</h2>
          </div>
          <Badge variant="secondary">{report.candidates.length} 个可参考方向</Badge>
        </div>
        <p className="text-muted-foreground text-xs leading-5">
          公开案例只用于分析玩法趋势，不代表真实 CTR、CVR、IPM 或 ROAS。
        </p>
        <div className="flex flex-wrap gap-1">
          {report.industrySummary.trends.map((trend) => (
            <Badge key={trend} variant="outline" className="font-normal">
              {trend}
            </Badge>
          ))}
        </div>
      </header>

      <RadioGroup aria-label="选择主要参考方向" value={primaryCandidateId ?? ''} onValueChange={setPrimaryCandidateId}>
        {report.candidates.map((candidate, index) => (
          <article key={candidate.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start gap-3">
              <RadioGroupItem
                id={`${report.runId}-${candidate.id}`}
                value={candidate.id}
                aria-label={`选择${candidate.title}`}
                disabled={disabled || submitting}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={`${report.runId}-${candidate.id}`} className="cursor-pointer font-medium">
                  {index + 1}. {candidate.title}
                </label>
                <p className="text-muted-foreground mt-1 text-xs leading-5">{candidate.coreLoop}</p>
              </div>
              <Badge variant="outline">{Math.round(candidate.confidence * 100)}% 可信度</Badge>
            </div>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-medium">开场钩子</dt>
                <dd className="text-muted-foreground mt-0.5">{candidate.openingHook}</dd>
              </div>
              <div>
                <dt className="font-medium">反馈与 CTA</dt>
                <dd className="text-muted-foreground mt-0.5">
                  {candidate.feedback} {candidate.cta}
                </dd>
              </div>
            </dl>
            <div className="space-y-2">
              <p className="text-xs font-medium">可组合亮点</p>
              <div className="flex flex-wrap gap-2">
                {candidate.borrowableHighlights.map((value) => {
                  const checked = selectedHighlights.some(
                    (highlight) => highlight.candidateId === candidate.id && highlight.value === value,
                  )
                  return (
                    <label
                      key={value}
                      className="bg-muted/40 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1"
                    >
                      <Checkbox
                        aria-label={value}
                        checked={checked}
                        disabled={disabled || submitting}
                        onCheckedChange={(next) =>
                          setSelectedHighlights((highlights) =>
                            next
                              ? [...highlights, { candidateId: candidate.id, value }]
                              : highlights.filter(
                                  (highlight) => highlight.candidateId !== candidate.id || highlight.value !== value,
                                ),
                          )
                        }
                      />
                      <span className="text-xs">{value}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <a
              href={candidate.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
            >
              查看公开来源
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </article>
        ))}
      </RadioGroup>

      <Textarea
        aria-label="采用方向的补充要求"
        value={customRequirements}
        disabled={disabled || submitting}
        maxLength={600}
        placeholder="可选：补充需要保留或调整的玩法要求"
        className="min-h-16"
        onChange={(event) => setCustomRequirements(event.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={disabled || submitting} onClick={() => void adopt()}>
          {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
          采用此方向
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || submitting}
          onClick={() => void adopt(true)}
        >
          仅采用行业总结
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || submitting} onClick={onSearchAgain}>
          重新搜索
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || submitting} onClick={onSkip}>
          跳过，继续需求
        </Button>
      </div>
    </section>
  )
}
