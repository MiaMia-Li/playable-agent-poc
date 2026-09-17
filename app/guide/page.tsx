import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Download,
  Film,
  Layers3,
  MessageSquareText,
  MousePointerClick,
  Play,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: '使用指南 - Playable Studio',
  description: '了解 Playable Studio 的功能，以及从需求描述到试玩交付的使用方法。',
}

const steps = [
  {
    number: '01',
    title: '说出想法',
    description: '在首页描述玩法、视觉风格和目标，也可以附上参考图片或 Reference Video。',
    icon: MessageSquareText,
  },
  {
    number: '02',
    title: '补充并确认',
    description: '在对话中回答问题、核对 Requirement Brief（需求记录），确认 Confirmation Proposal（构建内容）。',
    icon: CheckCircle2,
  },
  {
    number: '03',
    title: '预览试玩',
    description: '确认后开始构建。完成后在任务页试玩，并查看构建与校验结果。',
    icon: Play,
  },
  {
    number: '04',
    title: '修改或下载',
    description: '继续描述要调整的地方，生成新版本；满意后下载单文件 HTML。',
    icon: Download,
  },
] as const

const features = [
  {
    title: '用对话整理需求',
    description: '从一句想法开始，逐步明确玩法规则、画面、文案和交互。Requirement Brief 会记录当前需求。',
    icon: MessageSquareText,
  },
  {
    title: '参考素材与视频分析',
    description:
      '上传图片或 Reference Video（参考视频）。视频分析会生成 Gameplay Blueprint 和 Gameplay Timeline，供你逐段核对；需要纠正时可添加 Gameplay Annotation。',
    icon: Film,
  },
  {
    title: '从玩法模板开始',
    description: '先试玩现有模板，再选一个作为创作起点，继续调整主题、规则、素材和文案。',
    icon: MousePointerClick,
  },
  {
    title: '预览与版本管理',
    description: '在任务页切换试玩版本、调整预览方向并下载交付物；在构建记录中查找历史产物和校验结果。',
    icon: Layers3,
  },
] as const

export default function GuidePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 lg:pt-16 lg:pb-20">
      <header className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/[0.08] via-background to-background px-6 py-10 sm:px-10 sm:py-14">
        <div className="bg-primary/10 text-primary mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium">
          <BookOpen className="size-3.5" aria-hidden="true" />
          使用指南
        </div>
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          从一个想法，做出可试玩的互动广告
        </h1>
        <p className="text-muted-foreground mt-5 max-w-2xl text-sm leading-7 sm:text-base">
          Playable Studio 帮你通过对话梳理需求、确认构建内容，并生成可预览、可修改、可下载的单文件 HTML 试玩。
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">
              新建试玩 <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/best-practices">浏览玩法模板</Link>
          </Button>
        </div>
      </header>

      <section className="mt-14" aria-labelledby="steps-heading">
        <div className="mb-6">
          <p className="text-primary text-xs font-semibold tracking-widest">快速上手</p>
          <h2 id="steps-heading" className="mt-2 text-2xl font-semibold tracking-tight">
            四步完成一个试玩
          </h2>
        </div>
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {steps.map((step) => {
            const Icon = step.icon
            return (
              <li key={step.number} className="rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs font-semibold">{step.number}</span>
                  <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                </div>
                <h3 className="mt-5 font-semibold">{step.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">{step.description}</p>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="mt-16" aria-labelledby="features-heading">
        <div className="mb-6">
          <p className="text-primary text-xs font-semibold tracking-widest">平台功能</p>
          <h2 id="features-heading" className="mt-2 text-2xl font-semibold tracking-tight">
            你可以做什么
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <article key={feature.title} className="rounded-2xl border p-6">
                <Icon className="text-primary size-5" aria-hidden="true" />
                <h3 className="mt-4 font-semibold">{feature.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">{feature.description}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section
        className="mt-16 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]"
        aria-labelledby="details-heading"
      >
        <div>
          <p className="text-primary text-xs font-semibold tracking-widest">使用方法</p>
          <h2 id="details-heading" className="mt-2 text-2xl font-semibold tracking-tight">
            第一次使用，可以这样开始
          </h2>
          <div className="mt-7 space-y-6">
            <div className="border-l-primary border-l-2 pl-5">
              <h3 className="font-semibold">1. 写清玩法与目标</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                打开首页，描述玩家要做什么、怎样算成功、想要什么画面和结束提示。没有素材也可以直接用文字开始。
              </p>
            </div>
            <div className="border-l-primary border-l-2 pl-5">
              <h3 className="font-semibold">2. 按需添加参考素材</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                点击输入框旁的附件按钮或拖入图片、视频。若上传 Reference Video，可在任务页查看 Gameplay
                Timeline，并对不准确的片段添加 Gameplay Annotation。
              </p>
            </div>
            <div className="border-l-primary border-l-2 pl-5">
              <h3 className="font-semibold">3. 核对并确认构建内容</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                系统会根据对话整理 Requirement Brief，并提交 Confirmation
                Proposal。先检查玩法、素材和文案；需要调整就继续在对话中说明，满意后点击“确认方案并开始构建”。
              </p>
            </div>
            <div className="border-l-primary border-l-2 pl-5">
              <h3 className="font-semibold">4. 试玩、迭代与交付</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                构建完成后在右侧预览。要修改时直接描述变化，确认修改计划后生成新版本。完成后使用下载按钮获取
                HTML；历史版本可在“构建记录”中找到。
              </p>
            </div>
          </div>
        </div>

        <aside className="h-fit rounded-2xl border bg-muted/30 p-6 sm:p-8" aria-labelledby="example-heading">
          <p className="text-primary text-xs font-semibold tracking-widest">需求示例</p>
          <h3 id="example-heading" className="mt-2 text-lg font-semibold">
            不知道如何描述？
          </h3>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            可以从玩家操作、成功条件和视觉效果三个方面写起：
          </p>
          <blockquote className="bg-background mt-5 rounded-xl border p-5 text-sm leading-7">
            “做一个竖屏麻将配对试玩。玩家点击两张相同的牌进行消除，在倒计时结束前清空牌面即可获胜。画面使用明亮的金色，结束时展示下载按钮。”
          </blockquote>
          <p className="text-muted-foreground mt-5 text-sm leading-6">
            细节还没想好也没关系。进入对话后，可以继续补充规则、上传素材或调整文案。
          </p>
        </aside>
      </section>

      <section className="mt-16 rounded-2xl border p-6 sm:p-8" aria-labelledby="next-heading">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="next-heading" className="text-xl font-semibold">
              准备开始了吗？
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">从一个新想法开始，或先体验现有玩法模板。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/best-practices">
                <Play aria-hidden="true" /> 试玩模板
              </Link>
            </Button>
            <Button asChild>
              <Link href="/">
                新建试玩 <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}
