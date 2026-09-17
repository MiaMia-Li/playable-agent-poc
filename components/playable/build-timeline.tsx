'use client'

import { useEffect, useState } from 'react'
import { buildStageLabels, type BuildStage } from '@/lib/playable/build-timing'
import { AgentText, ReasoningText } from './reasoning-text'
import { Sparkles, Terminal, FilePenLine } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { buildEventLabel, type BuildTimelineEvent } from '@/lib/playable/build-activity'
import {
  isBuildCompletionMessage,
  readBuildActivityDetail,
  type BuildActivityDetail,
} from '@/lib/playable/build-activity-detail'

/** 同一次调用只占一行：完成事件补充结果，保留开始时的参数。重试会重置调用编号。 */
function compactSteps(events: BuildTimelineEvent[]) {
  const rows: Array<BuildTimelineEvent & { detail?: BuildActivityDetail }> = []
  const calls = new Map<string, number>()
  for (const event of events) {
    if (event.type === 'build_activity_agent_started') calls.clear()
    if (!buildEventLabel(event.type)) continue
    const detail = readBuildActivityDetail(event.message)
    // 兼容已经落库的历史记录；新事件虽在采集端过滤，旧的完成 JSON 仍需在展示时隐藏。
    if (event.type === 'build_activity_agent_message' && isBuildCompletionMessage(detail?.text)) continue
    const tool = /build_activity_(command_|tool_|file_changed)/.test(event.type)
    if (tool && detail?.id) {
      const index = calls.get(detail.id)
      if (index !== undefined) {
        const previous = rows[index]
        rows[index] = { ...event, id: previous.id, detail: { ...previous.detail, ...detail } }
        continue
      }
      calls.set(detail.id, rows.length)
    }
    rows.push({ ...event, detail })
  }
  return rows
}

function BuildRun({ events, running }: { events: BuildTimelineEvent[]; running: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const start = events.findLastIndex((event) => event.type === 'build_started')
  const current = events.slice(Math.max(0, start))
  const rows = compactSteps(current)
  const latest = rows.at(-1)
  const [selection, setSelection] = useState<{ key: string; value: string }>()
  const selectionKey = `${events[start]?.id ?? 'pending'}:${running}`
  // 构建结束自动收起，展开偏好仅影响当前构建，不改变持久化记录。
  const expanded = selection?.key === selectionKey ? selection.value : running ? 'progress' : ''
  const firstTime = Date.parse(current[0]?.createdAt ?? '')
  const lastTime = running ? now : Date.parse(latest?.createdAt ?? '')
  const seconds = Number.isFinite(lastTime - firstTime) ? Math.max(0, Math.round((lastTime - firstTime) / 1000)) : 0
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`
  // 同一阶段可能因修复重试多次进入；只累计完成区间，再加当前运行区间，避免重复计时。
  const totals: Partial<Record<BuildStage, number>> = {}
  let active: { stage: BuildStage; at: number } | undefined
  for (const event of current) {
    const timing = readBuildActivityDetail(event.message)?.timing
    if (!timing) continue
    if (event.type === 'build_activity_stage_started') active = timing
    if (event.type === 'build_activity_stage_completed') {
      totals[timing.stage] = (totals[timing.stage] ?? 0) + (timing.durationMs ?? 0)
      if (active?.stage === timing.stage) active = undefined
    }
  }
  if (active && running) totals[active.stage] = (totals[active.stage] ?? 0) + Math.max(0, now - active.at)
  if (!running && rows.length === 0) return null
  return (
    <section aria-label="构建执行记录" className="flex min-w-0 items-start gap-3">
      <span className="bg-foreground text-background mt-1 flex size-7 shrink-0 items-center justify-center rounded-full">
        <Sparkles className="size-3.5" aria-hidden="true" />
      </span>
      <Accordion
        type="single"
        collapsible
        value={expanded}
        onValueChange={(value) => setSelection({ key: selectionKey, value })}
        className="min-w-0 flex-1"
      >
        <AccordionItem value="progress" className="border-0">
          <AccordionTrigger className="text-muted-foreground justify-start gap-2 py-1 text-xs font-normal hover:no-underline [&>svg]:size-3">
            <span role="status" className="truncate">
              {running ? `正在构建 ${duration}` : `已工作 ${duration}`} ·{' '}
              {running && active ? buildStageLabels[active.stage] : latest ? buildEventLabel(latest.type) : '准备构建'}
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-1">
            {running &&
              current.some((event) => event.type === 'build_activity_preview_delayed') &&
              !current.some((event) => event.type === 'build_preview_ready') && (
                <p role="status" className="text-muted-foreground mt-2 text-xs">
                  生成时间超过预览目标，正在继续完成修改。
                </p>
              )}
            <ol aria-label="构建步骤" className="mt-2 space-y-3 text-sm">
              {rows.map((event) => {
                const detail = event.detail
                if (event.type === 'build_activity_reasoning_summary' && detail?.text) {
                  return (
                    <li key={event.id}>
                      <details className="text-muted-foreground text-xs">
                        <summary className="cursor-pointer select-none">Thinking</summary>
                        <ReasoningText>{detail.text}</ReasoningText>
                      </details>
                    </li>
                  )
                }
                if (event.type === 'build_activity_agent_message' && detail?.text) {
                  return (
                    <li key={event.id}>
                      <AgentText>{detail.text}</AgentText>
                    </li>
                  )
                }
                // 生命周期汇总在外层标题中，避免把准备、开始和结束重复列成一排。
                if (
                  !/build_activity_(command_|tool_|file_changed|preview_check_failed|preview_repair_|host_check_failed)/.test(
                    event.type,
                  )
                )
                  return null
                const Icon = event.type === 'build_activity_file_changed' ? FilePenLine : Terminal
                return (
                  <li key={event.id} className="text-muted-foreground text-xs">
                    <Accordion type="single" collapsible>
                      <AccordionItem value="detail" className="border-0">
                        <AccordionTrigger className="justify-start gap-2 py-0.5 text-xs font-normal hover:no-underline [&>svg]:size-3">
                          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className={event.type.endsWith('_failed') ? 'text-destructive' : ''}>
                            {buildEventLabel(event.type)}
                            {detail?.tool ? ` · ${detail.tool}` : ''}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="mt-2 border-l pb-0 pl-3 text-xs">
                          {/* 详情仍保留，按纯文本显示，不执行输出里的 HTML 或脚本。 */}
                          {detail?.input && (
                            <>
                              <p className="mb-1">参数</p>
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{detail.input}</pre>
                            </>
                          )}
                          {detail?.output && (
                            <>
                              <p className="mt-2 mb-1">结果</p>
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">
                                {detail.output}
                              </pre>
                            </>
                          )}
                          {!detail?.input && !detail?.output && <p>此步骤没有额外详情</p>}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </li>
                )
              })}
            </ol>
          </AccordionContent>
        </AccordionItem>
        {Object.keys(totals).length > 0 && (
          <dl aria-label="构建阶段耗时" className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {Object.entries(buildStageLabels).map(([stage, label]) => (
              <div key={stage} className="flex gap-1">
                <dt>{label}</dt>
                <dd>
                  {totals[stage as BuildStage] === undefined
                    ? stage === 'browser' && !running
                      ? '未记录'
                      : '待开始'
                    : `${Math.floor(totals[stage as BuildStage]! / 60000)}分${Math.floor(totals[stage as BuildStage]! / 1000) % 60}秒`}
                  {running && active?.stage === stage ? ' · 进行中' : ''}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {/* 完成文案只认应用发布成功，不能根据 Agent 返回的 completed 提前宣告产物可用。 */}
        {latest?.type === 'build_succeeded' && !running && (
          <p className="mt-2 text-sm">试玩已生成，可以开始体验。需要调整时，直接描述想改的地方。</p>
        )}
      </Accordion>
    </section>
  )
}

/** 历次构建各自保留折叠记录，新构建只更新自己的 Thinking。 */
export function BuildTimeline({ events, running }: { events: BuildTimelineEvent[]; running: boolean }) {
  const runs: BuildTimelineEvent[][] = []
  for (const event of events) {
    if (event.type === 'build_started') runs.push([])
    if (runs.length) runs[runs.length - 1].push(event)
  }
  if (!runs.length) return <BuildRun events={events} running={running} />
  return (
    <div className="space-y-4">
      {runs.map((run, index) => (
        <BuildRun key={run[0].id} events={run} running={running && index === runs.length - 1} />
      ))}
    </div>
  )
}
